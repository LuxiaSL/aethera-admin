// VCR/CRT Shader for Ghostty (perf pass 2026-02-03)
// Breathing chromatic aberration + ripple glitch + crackling scanlines + heat shimmer + pixel rain
//
// Optimization goals:
// - Keep the same "luxia violet" vibe (glitch timing/shape, shimmer, holographic sparks)
// - Trade expensive transcendental ops (sqrt/sin/cos/atan) for cheaper polynomials where it's low-risk
// - Avoid work in Pixel Rain when no spark is active (uniform branches)
//
// Key wins vs previous version:
// - Removed sqrt() for edge-weight/vignette (use squared distance thresholds).
// - Replaced sin/cos easing in jitter envelope with a cheap quadratic ease.
// - Vectorized heat-shimmer sins (same math, fewer scalar ops for the compiler).
// - Pixel Rain: uniform early-continue when no spark is alive; early radius cull; core uses dist^2.
//
// Notes: if you *really* want max perf, consider setting PIXEL_RAIN_HISTORY to 2.

const float TAU    = 6.28318530718;
const float HALFPI = 1.57079632679;

// 1D hash without trig (Dave Hoskins-style)
float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

// Smooth 1D noise (for wobble)
float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f); // smoothstep poly
    return mix(hash11(i), hash11(i + 1.0), f);
}

// Quadratic ease-in/out-ish for [0..1] (cheap replacement for sin/cos quarter-wave)
float ease01(float t) {
    // 0->1 with gentle ease; similar feel to sin(t*pi/2)
    return t * (2.0 - t);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 invRes = 1.0 / iResolution.xy;
    vec2 uv = fragCoord * invRes;

    // ── CRT boot sync: pass-through during raster expansion for true black ──
    // Only pay the extra un-distorted fetch during the 3s boot window;
    // after that the blend weight is 1.0 and _bootSrc is never visible.
    vec4 _bootSrc = vec4(0.0);
    if (iTime < 3.0) {
        _bootSrc = texture(iChannel0, uv);
        if (iTime < 1.5) { fragColor = _bootSrc; return; }
    }

    // === SUBTLE TEXT CHROMATIC ABERRATION ===
    vec2 center = uv - 0.5;
    float dist2 = dot(center, center); // squared distance (reused for vignette)
    // Original used smoothstep(0.2, 0.8, sqrt(dist2)). Use squared thresholds to avoid sqrt.
    float edgeWeight = smoothstep(0.04, 0.64, dist2);
    float aberration = 0.001 * (0.3 + edgeWeight * 0.7);

    // subtle barrel distortion (kept)
    vec2 distortedUV = uv + center * dist2 * 0.02;

    // === LINE GLITCH SYSTEM (RIPPLE) ===
    float glitchSeed = floor(iTime * 0.5);  // new glitch opportunities ~every 2s
    float glitchRandom = hash11(glitchSeed);
    float glitchActive = step(0.88, glitchRandom);  // ~12% chance of glitch

    float glitchY = hash11(glitchSeed + 100.0);

    // Ripple timing: brief hold at epicenter, then 0.8s propagation
    float holdDuration = 0.12;
    float rippleDuration = 0.8;
    float glitchStartTime = glitchSeed * 2.0;
    float rippleElapsed = iTime - glitchStartTime;
    float totalDuration = holdDuration + rippleDuration;
    float propagationTime = max(rippleElapsed - holdDuration, 0.0);
    float ripplePhase = clamp(propagationTime / rippleDuration, 0.0, 1.0);
    float rippleAlive = glitchActive * step(0.0, rippleElapsed) * step(rippleElapsed, totalDuration);

    // Ripple propagation geometry
    float maxRadius = 0.25;                          // max extent (fraction of screen)
    float rippleFront = ripplePhase * maxRadius;      // current wavefront distance
    float distFromOrigin = abs(uv.y - glitchY);

    // Wavefront mask: only affect where the front has reached
    float frontReached = smoothstep(rippleFront + 0.003, rippleFront - 0.003, distFromOrigin);

    // Traveling wave displacement (sin wave with exponential spatial decay)
    float spatialFreq = 40.0;
    float temporalFreq = 12.0;
    float spatialDecay = 10.0;
    float wave = sin(distFromOrigin * spatialFreq - rippleElapsed * temporalFreq)
               * exp(-distFromOrigin * spatialDecay)
               * frontReached
               * rippleAlive;

    // Amplitude fades as ripple dissipates
    float rippleAmplitude = 0.008 * (1.0 - ripplePhase * 0.6);
    distortedUV.x += wave * rippleAmplitude;

    // Epicenter jitter: rapid glitchy displacement at the origin line itself
    float inHold = step(rippleElapsed, holdDuration) * step(0.0, rippleElapsed) * glitchActive;
    float originMask = smoothstep(0.015, 0.0, distFromOrigin) * rippleAlive;
    // Stronger during hold phase, fading during propagation
    float originIntensity = mix(1.0 - ripplePhase, 1.5, inHold);
    float jitterHash = hash11(floor(iTime * 30.0) + glitchSeed);
    distortedUV.x += (jitterHash * 2.0 - 1.0) * 0.005 * originMask * originIntensity;

    // Wavefront band mask for crackling scanlines (wider band at the expanding front)
    float waveFrontBand = rippleAlive
        * smoothstep(rippleFront + 0.008, rippleFront - 0.008, distFromOrigin)
        * smoothstep(rippleFront - 0.055, rippleFront - 0.008, distFromOrigin)
        * (1.0 - ripplePhase * 0.7);
    // During hold, crackle at the epicenter too
    waveFrontBand = max(waveFrontBand, originMask * inHold);

    // === CRACKLING SCANLINE DISTORTION ===
    // Within glitch zones, individual scanlines distort and flicker rapidly
    float scanlineY = floor(fragCoord.y);
    float crackleTime = floor(iTime * 25.0); // ~25 updates/sec for rapid crackling

    // Determine which scanlines crackle this frame (changes rapidly)
    float crackleHash = hash11(scanlineY * 0.1 + crackleTime * 0.3 + glitchSeed);
    float isCrackleLine = step(0.70, crackleHash) * waveFrontBand; // ~30% of lines at wavefront

    // Per-scanline distortion parameters (cheap hashes, no trig)
    float lineHash1 = hash11(scanlineY + crackleTime + glitchSeed * 2.0);
    float lineHash2 = hash11(scanlineY * 1.7 + crackleTime * 0.7 + glitchSeed);

    // Horizontal displacement (main distortion - pixels shift left/right)
    float hDisplace = (lineHash1 * 2.0 - 1.0) * 0.016;

    // Vertical micro-jitter (makes scanlines look unstable/doubled)
    float vDisplace = (lineHash2 * 2.0 - 1.0) * 0.002;

    // Apply distortion only to crackle lines
    distortedUV.x += isCrackleLine * hDisplace;
    distortedUV.y += isCrackleLine * vDisplace;

    // Per-line chromatic separation for extra glitch feel
    float crackleChroma = isCrackleLine * 0.0025;

    // === VHS TRACKING WOBBLE ===
    float wobbleTime = iTime * 0.25;
    float wobble = noise1(uv.y * 6.0  + wobbleTime) * 0.0006;
    wobble       += noise1(uv.y * 20.0 + wobbleTime * 1.3) * 0.0003;
    distortedUV.x += wobble;

    // === HEAT SHIMMER — moved to medium.glsl (2026-07-26) ===
    // It used to live here as
    //     distortedUV.y += (sin(12x+3y+t) + 0.6 sin(7x+5y-t)) * (1-uv.y)*0.0018
    // which is a SHEAR, not a refraction: a wavevector pointing mostly along x
    // displacing the image along y. D = (0, s(x,y)) is a gradient field only
    // if ds/dx = 0, and it is not, so it could never be a phase screen and it
    // could never focus. It only wobbled.
    //
    // medium.glsl now carries it as screen 0 with a real potential, so the
    // same field that bends the light also magnifies it. The displacement is
    // unchanged in magnitude (3.1px, budgeted under SPEC §3) — it moved, it
    // did not grow.

    // === CHROMATIC SAMPLING ===
    // Add crackle-line chromatic separation on top of base aberration
    vec2 redOffset   = vec2(aberration * 1.2 + crackleChroma,  aberration * 0.3);
    vec2 greenOffset = vec2(-aberration * 0.2, -aberration * 0.1);
    vec2 blueOffset  = vec2(-aberration * 1.0 - crackleChroma,  aberration * 0.4);

    float r = texture(iChannel0, distortedUV + redOffset).r;
    float g = texture(iChannel0, distortedUV + greenOffset).g;
    float b = texture(iChannel0, distortedUV + blueOffset).b;

    vec4 color = vec4(r, g, b, 1.0);

    // === PIXEL RAIN (glitch-synced) ===
    // Uniform branching: if there's no active spark this frame, skip the expensive shape math entirely.
    vec3 pixelRainColor = vec3(0.0);
    float currentSeed = floor(iTime * 0.5);

    const int PIXEL_RAIN_HISTORY = 3; // last N glitch windows
    const vec3 HOLO_PHASE = vec3(0.0, 2.09439510239, 4.18879020479);

    for (int i = 0; i < PIXEL_RAIN_HISTORY; i++) {
        float pastSeed = currentSeed - float(i);

        float pastActive = step(0.88, hash11(pastSeed));
        float pastJitters = 1.0 + floor(hash11(pastSeed + 300.0) * 5.0);
        float shouldSpawn = pastActive * step(3.0, pastJitters); // uniform 0/1

        // Time since the glitch window started
        float glitchStart = pastSeed * 2.0;
        float elapsed = iTime - glitchStart;

        // Fixed lifetime ~1s
        const float lifetime = 1.0;
        // uniform alive (depends only on iTime + seed)
        float alive = step(elapsed, lifetime);

        // Uniform gate: if no spark should exist for this seed right now, skip the whole block.
        if (shouldSpawn * alive < 0.5) {
            continue;
        }

        float spawnX = hash11(pastSeed + 800.0);
        float spawnY = hash11(pastSeed + 100.0);

        float fallSpeed = 0.15 + hash11(pastSeed + 900.0) * 0.08;
        float currentY = spawnY - elapsed * fallSpeed;

        // Lifetime fade
        float fade = 1.0 - clamp(elapsed / lifetime, 0.0, 1.0);

        // Spark geometry
        vec2 toFrag = uv - vec2(spawnX, currentY);
        float d2 = dot(toFrag, toFrag);

        // Rays params (mostly uniform per spark)
        float numRays = 3.0 + floor(hash11(pastSeed + 950.0) * 3.0);
        float rayRotation = hash11(pastSeed + 960.0) * TAU;
        float rayLength = 0.006 + hash11(pastSeed + 970.0) * 0.005;

        // Early radius cull (saves atan/cos for most pixels)
        float maxR = rayLength + 0.0025;
        if (d2 > maxR * maxR) {
            continue;
        }

        float d = sqrt(d2);

        // Bright core (use dist^2 compare, no sqrt needed here, but we already have d for rays)
        float core = step(d2, 0.0025 * 0.0025) * 0.95;

        // Angular coords (atan is now only paid near the spark)
        float angle = atan(toFrag.y, toFrag.x);

        // Thin ray mask in angle space
        float rayAngle = mod(angle + rayRotation, TAU) * (numRays / TAU);
        float inRay = step(abs(fract(rayAngle) - 0.5), 0.08);

        // Rays taper outward
        float rayBrightness = inRay * smoothstep(rayLength, 0.001, d) * 0.8;

        float spark = max(core, rayBrightness * step(d, rayLength));
        float brightness = spark * fade;

        // Holographic tint (rainbow based on direction)
        vec3 holoTint = 0.5 + 0.5 * cos(angle * 2.0 + HOLO_PHASE);
        pixelRainColor += brightness * holoTint;
    }

    // Ripple-front stars: small chance per ripple, spawned when wavefront passes
    for (int i = 0; i < PIXEL_RAIN_HISTORY; i++) {
        float pastSeed = currentSeed - float(i);
        float pastActive = step(0.88, hash11(pastSeed));

        // ~25% of active ripples spawn a wavefront star
        float rippleStarGate = pastActive * step(0.75, hash11(pastSeed + 1100.0));

        float rStart = pastSeed * 2.0;
        float rElapsed = iTime - rStart;

        // Star sits at a random distance along the ripple path
        float starDist = 0.03 + hash11(pastSeed + 1200.0) * 0.18;
        // Time when the wavefront reaches this distance (after hold)
        float starSpawnTime = holdDuration + starDist * (rippleDuration / maxRadius);
        float starAge = rElapsed - starSpawnTime;
        float starLifetime = 0.8;
        float starAlive = step(0.0, starAge) * step(starAge, starLifetime);

        if (rippleStarGate * starAlive < 0.5) continue;

        // Star position: random X, on the ripple path (random side of origin)
        float starX = hash11(pastSeed + 1300.0);
        float rGlitchY = hash11(pastSeed + 100.0);
        float starSide = step(0.5, hash11(pastSeed + 1400.0)) * 2.0 - 1.0;
        float starY = rGlitchY + starSide * starDist;
        // Gentle drift after spawning
        starY -= starAge * (0.05 + hash11(pastSeed + 1500.0) * 0.04);

        float starFade = 1.0 - clamp(starAge / starLifetime, 0.0, 1.0);

        // Spark geometry (slightly smaller/dimmer than epicenter stars)
        vec2 toFrag = uv - vec2(starX, starY);
        float d2 = dot(toFrag, toFrag);

        float numRays = 3.0 + floor(hash11(pastSeed + 1600.0) * 3.0);
        float rayRotation = hash11(pastSeed + 1700.0) * TAU;
        float rayLength = 0.004 + hash11(pastSeed + 1800.0) * 0.003;

        float maxR = rayLength + 0.002;
        if (d2 > maxR * maxR) continue;

        float d = sqrt(d2);
        float core = step(d2, 0.002 * 0.002) * 0.85;
        float angle = atan(toFrag.y, toFrag.x);

        float rayAngle = mod(angle + rayRotation, TAU) * (numRays / TAU);
        float inRay = step(abs(fract(rayAngle) - 0.5), 0.08);
        float rayBrightness = inRay * smoothstep(rayLength, 0.001, d) * 0.7;

        float spark = max(core, rayBrightness * step(d, rayLength));
        pixelRainColor += spark * starFade * (0.5 + 0.5 * cos(angle * 2.0 + HOLO_PHASE));
    }

    color.rgb += pixelRainColor;

    // === SUBTLE EFFECTS ===
    float scanline  = sin(fragCoord.y) * 0.02 + 1.0;
    float interlace = sin(fragCoord.y * 0.5 + iTime * 6.0) * 0.006 + 1.0;
    color.rgb *= (scanline * interlace);

    // VHS warmth
    color.rgb = mix(color.rgb, color.rgb * vec3(1.02, 1.0, 0.95), 0.25);

    // vignette (reuse dist2)
    color.rgb *= (1.0 - dist2 * 0.3);

    // subtle power flicker
    color.rgb *= (1.0 + sin(iTime * 50.0) * 0.002);

    fragColor = (iTime < 3.0) ? mix(_bootSrc, color, smoothstep(1.5, 3.0, iTime)) : color;
}
