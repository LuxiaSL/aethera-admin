// CRT Finale for Ghostty (merged pass 2026-07-01)
// warmth-cycle (time-of-day color grade) + crt-poweron (boot animation)
// fused into a single pass: each chained shader costs a full-screen draw
// regardless of how cheap its math is, so merging the two "place LAST"
// shaders saves one draw per frame, forever.
//
// Place LAST in the shader chain. The standalone warmth-cycle.glsl and
// crt-poweron.glsl are kept for the modular presets; tuning defines below
// are copied from them and behave identically.
//
// NOTE: if you use the cron one-liner that rewrites MANUAL_HOUR, point it
// at THIS file now:
//   */30 * * * * sed -i "s/MANUAL_HOUR .*/MANUAL_HOUR $(date +\%H)/" ~/.config/ghostty/shaders/crt-finale.glsl

// ── WARMTH TUNING (from warmth-cycle.glsl) ──
//   MODE 0 = warmth disabled
//   MODE 1 = auto time-of-day (iDate)
//   MODE 2 = fixed hour (MANUAL_HOUR)
//   MODE 3 = always warm   MODE 4 = always cool
#define MODE 1
#define MANUAL_HOUR 22.0
#define INTENSITY 0.5

// ── POWER-ON TUNING (from crt-poweron.glsl) ──
const float DURATION = 45.0;  // total animation length (0.0 = disabled)

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

// Time-of-day grade, applied to the composited content in both the
// animation path and the steady-state path.
vec3 applyWarmth(vec3 rgb, vec2 uv) {
#if MODE == 0
    return rgb;
#else
    float hour = 12.0;

#if MODE == 1
    hour = mod(iDate.w / 3600.0, 24.0);
    // Guard: iDate not populated -> no effect rather than midnight warmth.
    if (iDate.x < 1.0 && iDate.w < 1.0) return rgb;
#elif MODE == 2
    hour = MANUAL_HOUR;
#elif MODE == 3
    hour = 23.0;
#elif MODE == 4
    hour = 12.0;
#endif

    // Cosine warmth curve: 0 at noon, 1 at midnight
    float dayPhase = cos((hour - 12.0) / 12.0 * 3.14159);
    float warmth = (1.0 - dayPhase) * 0.5;

    // Asymmetric dawn/dusk bias
    float eveningBias = smoothstep(17.0, 21.0, hour) * (1.0 - smoothstep(23.0, 24.0, hour));
    float morningBias = (1.0 - smoothstep(5.0, 8.0, hour)) * step(0.0, hour);
    warmth = max(warmth, max(eveningBias * 0.8, morningBias * 0.6));

    // Gentle amber shift (the CRT shader already carries a VHS warmth tint)
    vec3 nightTint = vec3(1.0 + warmth * 0.035,
                          1.0 - warmth * 0.006,
                          1.0 - warmth * 0.028);
    rgb *= mix(vec3(1.0), nightTint, INTENSITY);

    // Uneven-electron-gun vignette warmth at the edges
    vec2 c = uv - 0.5;
    float edgeDist = dot(c, c);
    float edgeWarmth = edgeDist * warmth * INTENSITY * 0.015;
    rgb.r += edgeWarmth;
    rgb.b -= edgeWarmth * 0.5;

    return rgb;
#endif
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec4 src = texture(iChannel0, uv);

    // ── STEADY STATE ──
    // After the power-on animation: just the warmth grade.
    if (iTime > DURATION || DURATION <= 0.0) {
        fragColor = vec4(applyWarmth(src.rgb, uv), src.a);
        return;
    }

    float t = iTime;

    // ════════════════════════════════════════════
    //  PHASE 1: DEAD BLACK + CATHODE GLOW
    // ════════════════════════════════════════════
    float masterFade = smoothstep(0.0, 0.2, t);

    vec2 center = uv - 0.5;
    float centerDist2 = dot(center, center);
    float cathodeGlow = exp(-centerDist2 * 8.0)
                      * smoothstep(0.1, 0.2, t)
                      * (1.0 - smoothstep(0.4, 0.8, t));
    vec3 cathodeColor = vec3(0.18, 0.09, 0.02);

    // ════════════════════════════════════════════
    //  PHASE 2: HORIZONTAL LINE
    // ════════════════════════════════════════════
    float linePhase = smoothstep(0.25, 0.4, t)
                    * (1.0 - smoothstep(0.7, 1.2, t));

    float distFromMid = abs(uv.y - 0.5);
    float sigma = 0.002 + smoothstep(0.4, 0.7, t) * 0.015;
    float line = exp(-distFromMid * distFromMid / (sigma * sigma));
    float lineNoise = hash11(floor(fragCoord.x * 0.5) + floor(t * 60.0) * 137.0);
    line *= (0.65 + lineNoise * 0.35);
    vec3 lineColor = vec3(0.92, 0.97, 0.95);

    // ════════════════════════════════════════════
    //  PHASE 3: RASTER EXPANSION (FAST)
    // ════════════════════════════════════════════
    float expandBase = smoothstep(0.5, 1.35, t);
    float oscT = max(t - 0.85, 0.0);
    float overshoot = 0.07 * sin(oscT * 11.0) * exp(-oscT * 4.0);
    float expansion = clamp(expandBase + overshoot, 0.0, 1.0);

    float halfH = expansion * 0.5;
    float rasterEdge = 0.006;
    float rasterMask = smoothstep(0.5 - halfH - rasterEdge, 0.5 - halfH + rasterEdge, uv.y)
                     * smoothstep(0.5 + halfH + rasterEdge, 0.5 + halfH - rasterEdge, uv.y);

    float topEdge = abs(uv.y - (0.5 - halfH));
    float botEdge = abs(uv.y - (0.5 + halfH));
    float nearestEdge = min(topEdge, botEdge);
    float edgeGlow = exp(-nearestEdge * nearestEdge / 0.00008)
                   * (1.0 - expansion)
                   * 0.4;

    // ════════════════════════════════════════════
    //  PHASE 4: COLOR CONVERGENCE (SLOW SETTLE)
    // ════════════════════════════════════════════
    float convError = (1.0 - smoothstep(0.9, 25.0, t)) * 0.004;
    vec2 convR = vec2( convError,       convError * 0.4);
    vec2 convB = vec2(-convError * 0.7, -convError * 0.3);

    float finalR = texture(iChannel0, uv + convR).r;
    float finalG = src.g;
    float finalB = texture(iChannel0, uv + convB).b;
    vec3 content = vec3(finalR, finalG, finalB);

    // Warmth grade rides on the content, exactly as when warmth-cycle
    // ran as the pass before crt-poweron.
    content = applyWarmth(content, uv);

    // ════════════════════════════════════════════
    //  PHASE 5: BRIGHTNESS SETTLING (SLOW)
    // ════════════════════════════════════════════
    float overdrive = 1.0 + (1.0 - smoothstep(0.7, 20.0, t)) * 0.35;
    float flutterEnv = exp(-(t - 3.0) * (t - 3.0) * 0.5);
    float flutter = sin(t * 37.0) * flutterEnv * 0.06;
    float brightness = overdrive + flutter;

    // ════════════════════════════════════════════
    //  PHASE 6: WARM-UP SCANLINES (VERY SLOW)
    // ════════════════════════════════════════════
    float extraScan = (1.0 - smoothstep(1.0, 42.0, t)) * 0.10;
    float scanline = 1.0 - extraScan * (0.5 + 0.5 * sin(fragCoord.y * 3.14159));

    // ════════════════════════════════════════════
    //  COMPOSITE
    // ════════════════════════════════════════════
    vec3 result = content * rasterMask * brightness * scanline;
    result += lineColor * line * linePhase * 1.6;
    result += vec3(0.75, 0.80, 0.70) * edgeGlow;
    result += cathodeColor * cathodeGlow;
    result *= masterFade;

    float hvFlash = exp(-(t - 0.33) * (t - 0.33) * 800.0) * 0.12;
    result += vec3(hvFlash);

    float animAlpha = mix(1.0, src.a, max(rasterMask, smoothstep(1.0, 2.0, t)));

    fragColor = vec4(result, animAlpha);
}
