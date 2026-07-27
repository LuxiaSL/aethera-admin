// Cursor Comet for Ghostty (new 2026-07-01)
// Holographic smear + landing spark driven by the cursor uniforms
// (Ghostty 1.2+: iCurrentCursor, iPreviousCursor, iTimeCursorChange,
//  iCurrentCursorColor).
//
// Visual language matches crt-glow's pixel rain: sharp core, thin rays,
// rainbow tint from the same cos palette. Small cursor moves (typing)
// leave a faint one-cell smear; long jumps draw a comet trail that fades
// in ~0.4s with a small holographic spark at the landing cell.
//
// Chain placement: after starfield-depth, before warmth-cycle - the trail
// picks up the final color grade but isn't double-distorted by crt-glow.
//
// Cost: pure pass-through (one uniform branch) except during the fraction
// of a second after a cursor move.
//
// ── TUNING ──
#define COMET_ENABLED 1   // 0 = pass-through
// If the trail appears vertically mirrored from the real cursor position,
// flip this to 1 (cursor coords reported with top-left origin).
#define CURSOR_Y_FLIP 0

const float TRAIL_FADE = 0.38;  // seconds for the trail to die
const float SPARK_FADE = 0.30;  // seconds for the landing spark
const float TRAIL_GAIN = 0.55;  // overall trail brightness
const float SPARK_GAIN = 0.85;  // spark brightness
const float MIN_JUMP   = 1.5;   // jump length (in cell heights) that counts
                                // as a "leap": full trail glow + spark

const float TAU = 6.28318530718;
const vec3 HOLO_PHASE = vec3(0.0, 2.09439510239, 4.18879020479);

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

// Squared distance from p to segment ab; h = normalized position along it
float segDist2(vec2 p, vec2 a, vec2 b, out float h) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    vec2 d = pa - ba * h;
    return dot(d, d);
}

// Cursor rect center in UV. Ghostty reports xy = top-left corner of the
// cursor rect in pixel coords, zw = rect size in pixels.
vec2 cursorCenter(vec4 c) {
#if CURSOR_Y_FLIP
    vec2 tl = vec2(c.x, iResolution.y - c.y);
#else
    vec2 tl = c.xy;
#endif
    return (tl + vec2(c.z, -c.w) * 0.5) / iResolution.xy;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec4 color = texture(iChannel0, uv);

#if COMET_ENABLED
    float age = iTime - iTimeCursorChange;

    // Uniform early-out: boot window, dead trail, or cursor uniforms not
    // yet populated (zw = 0 until the first report).
    if (iTime < 1.5 || age < 0.0 || age > max(TRAIL_FADE, SPARK_FADE)
        || iCurrentCursor.z <= 0.0) {
        fragColor = color;
        return;
    }

    vec2 curC = cursorCenter(iCurrentCursor);
    vec2 prvC = cursorCenter(iPreviousCursor);

    // Aspect-corrected space so the trail is round, not squashed
    float aspect = iResolution.x / iResolution.y;
    vec2 P = vec2(uv.x * aspect, uv.y);
    vec2 A = vec2(prvC.x * aspect, prvC.y);
    vec2 B = vec2(curC.x * aspect, curC.y);

    float cellH = max(iCurrentCursor.w / iResolution.y, 1e-4);
    vec2 AB = B - A;
    float jump = length(AB) / cellH;  // jump length in cell heights

    vec3 glow = vec3(0.0);

    // ── TRAIL ──
    float fade = 1.0 - clamp(age / TRAIL_FADE, 0.0, 1.0);
    fade *= fade;  // ease-out
    if (fade > 0.0 && jump > 0.05) {
        float h;  // 0 at previous cursor, 1 at current
        float d2 = segDist2(P, A, B, h);

        // Width tapers toward the tail, scaled to the cell
        float w = cellH * mix(0.18, 0.46, h);
        float trail = exp(-d2 / max(w * w, 1e-10));

        // Brightness ramps toward the head; leaps glow brighter than typing
        float jumpBoost = 0.3 + smoothstep(0.0, MIN_JUMP, jump) * 0.7;
        trail *= mix(0.25, 1.0, h) * jumpBoost;

        // Holographic tint keyed to travel direction, cycling along the trail
        float ang = atan(AB.y, AB.x);
        vec3 holo = 0.5 + 0.5 * cos(ang * 2.0 + h * 2.5 + HOLO_PHASE);

        // Blend toward the actual cursor color near the head (fallback to
        // pale violet if the theme reports ~black)
        vec3 headCol = (dot(iCurrentCursorColor.rgb, vec3(1.0)) > 0.05)
            ? iCurrentCursorColor.rgb
            : vec3(0.8, 0.7, 1.0);
        vec3 trailCol = mix(holo, headCol, h * 0.55);

        glow += trail * fade * TRAIL_GAIN * trailCol;
    }

    // ── LANDING SPARK (leaps only) ──
    float sparkFade = 1.0 - clamp(age / SPARK_FADE, 0.0, 1.0);
    if (sparkFade > 0.0 && jump >= MIN_JUMP) {
        vec2 toFrag = P - B;
        float d2 = dot(toFrag, toFrag);
        float rayLength = cellH * 1.4;
        float maxR = rayLength + cellH * 0.3;

        if (d2 < maxR * maxR) {
            float d = sqrt(d2);
            float core = smoothstep(cellH * 0.35, 0.0, d) * 0.9;

            // Ray fan re-rolls per jump (seeded by the change timestamp)
            float seed = floor(iTimeCursorChange * 60.0);
            float numRays = 4.0 + floor(hash11(seed) * 3.0);
            float rayRot = hash11(seed + 7.0) * TAU;

            float angle = atan(toFrag.y, toFrag.x);
            float rayAngle = mod(angle + rayRot, TAU) * (numRays / TAU);
            float inRay = step(abs(fract(rayAngle) - 0.5), 0.07);
            float rays = inRay * smoothstep(rayLength, 0.0, d) * 0.8;

            float spark = max(core, rays);
            vec3 holoTint = 0.5 + 0.5 * cos(angle * 2.0 + HOLO_PHASE);
            glow += spark * sparkFade * sparkFade * SPARK_GAIN * holoTint;
        }
    }

    color.rgb += glow;
#endif

    fragColor = color;
}
