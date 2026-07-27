// MEDIUM — one pass, one Jacobian.  2026-07-26  (Track C)
//
// grain.caustic.glsl + field.caustic.glsl merged. Both originals still exist
// and the config can swap back to them in one edit; see the bottom of this
// header for the exact revert.
//
// ── WHAT THIS BUYS THAT TWO PASSES COULD NOT ────────────────────────────
//
// Track A already had the sky DEFLECT the glass, by recomputing the swell
// across the pass boundary. The one thing that genuinely required a merge is
// the multiplicative cross term.
//
// Under split-step the total map is a composition, so by the chain rule
// J = J_glass · J_swell and therefore
//
//     det J = det J_glass · det J_swell
//     -log|det J| = -log|det J_glass| + -log|det J_swell|
//
// THE LOG-MAGNIFICATIONS SIMPLY ADD. That is the whole reason -log was chosen
// over 1/|det J| — a choice originally made for normalisation, which turns out
// to be what makes multi-scale composition linear at all.
//
// Concretely: the sky used to be ADDITIVE LIGHT in its own pass while the
// glass was a MULTIPLICATIVE RATIO. They could not interact, only overlay.
// Now one magnification carries both, so the sky's fold structure modulates
// the light that is actually there instead of glowing on top of it. Where a
// coarse filament runs, the glyphs and grain under it brighten and darken
// with it.
//
// The sky's own EMISSION (gas, filaments, cusps) is still added afterwards.
// That is deliberate, not an oversight: a purely multiplicative sky would
// vanish on an empty screen, because a ratio on a 0.05-luma background is
// nothing. The medium modulates; the emission is what you see it by.
//
// ── WHAT ELSE THE MERGE FIXES, FOR FREE ─────────────────────────────────
//
//   · The swell is evaluated ONCE. Track A had to recompute it, and the
//     duplicated SKY[4] needed a byte-comparison guard to stay honest. Both
//     the recompute and the guard are now gone — addSky() accumulates ∇Φ
//     alongside H and T, and f1 was already being computed.
//   · One clamp, on the PRODUCT, not one per screen. Σ clamp(mᵢ) ≠ clamp(Σ mᵢ)
//     — they differ on 10.6% of pixels, and clamping per screen bounds each
//     term separately, which is not what a composed map does.
//   · ink/heat now read the terminal buffer directly rather than a buffer with
//     the grain and the glass caustic already applied to it.
//
// ── ORDERING IS LOAD-BEARING ────────────────────────────────────────────
//
// Coarse deflects fine, never the reverse: k_fine·|∇Φ_coarse| = 3.58 rad
// against k_coarse·|∇Φ_fine| = 0.33 rad, an asymmetry of 10.9x. Reversed, it
// injects glyph-scale jitter into the filaments.
//
// ── REVERT ──────────────────────────────────────────────────────────────
//
//   SCREEN_SWELL 0     the sky stops touching the glass entirely
//   SKY_MAG 0.0        keeps the deflection, drops the multiplicative cross
//                      term — i.e. exactly Track A's behaviour
//   or in config: swap this line back to grain.caustic.glsl + field.caustic.glsl
//
// ── SCREENS ──
// How much denser the medium gets where you have written. 0.0 = ink is a gain
// again (brightness only), which is what it was before.
//
// This is the one knob here that spends LEGIBILITY, the property the rest of
// the design protects by construction, so it is deliberately conservative.
// Measured against no thickness, with the buffer full of text:
//
//     INK_THICK   effect on text   text/bg contrast   background
//        0.20        1.43 levels        -0.94%          -0.09%
//        0.35        2.40               -2.05%          -0.19%
//        0.60        3.95               -4.51%          -0.40%
//
// The contrast cost is not the DC drifting — that is the small third column.
// It is the text itself dimming, because the DC correction below is
// second-order and the field is not, so a denser medium keeps a little more
// of the light it redistributes. 0.20 is the most this should take.
const float INK_THICK  = 0.20;

#define SCREEN_SWELL   1   // the coarse sky field
#define SCREEN_GLASS   1   // the fine glyph field
// The cross term is SKY_MAG below, a WEIGHT rather than a toggle. It was a
// #define, and that was a mistake twice over: it put a preprocessor branch
// inside the CAUSTIC_DC expression, which no constant parser can read (and
// tools/glsl.py is deliberately preprocessor-unaware, so it silently failed to
// find CAUSTIC_DC at all); and a merged pass wants a dial here, not a switch.
// SKY_MAG = 0.0 reproduces Track A exactly — detSwell collapses to 1 and the
// swell's DC term vanishes — with no branch anywhere.

#define CAUSTIC_ENABLED 1   // 0 = grain + sky emission, no magnification at
                            // all. This was DEAD in the first merged build —
                            // the #if guard was dropped during the merge and
                            // the toggle silently did nothing. Dead code still
                            // compiles, so check_compile could not see it; an
                            // ablation measurement did.
#define DEBUG_CAUSTIC   0   // 1 = det J (grey) with the fold curve in red
                            // 2 = the magnification field itself
                            // 3 = the gathered source light

const float CAUSTIC_GAIN = 0.28;  // depth of the in-place light modulation.
                                  // 0.12 was the quiet build. Raised because
                                  // the Track A coupling REARRANGES the fold
                                  // texture without changing its amplitude, and
                                  // at 0.12 that texture is a sub-1-level
                                  // modulation: rearranging something invisible
                                  // yields something differently invisible.
                                  // Measured, the coupling's rendered effect
                                  // scales with this — pixels moving >=3 levels
                                  // go 0.6% -> 4.9% between 0.12 and 0.28,
                                  // with the near/far structure ratio unchanged
                                  // at ~1.34x. Visibility was gain-limited, not
                                  // coupling-limited.
const float FOCUS        = 1.00;  // scales the Hessian: more folds, same
                                  // wave geometry. 0 = a flat phase screen,
                                  // which focuses nothing (the effect off).
const float FOLD_FLOOR   = 0.09;  // how close to the true fold the log is
                                  // allowed to get. ↓ = hotter fold lines.
                                  // Also sets the symmetric bound on m, since
                                  // |det J| is clamped to [floor, 1/floor]:
                                  // 0.09 bounds |m| at 2.41 where 0.03 allowed
                                  // 3.51. Raised WITH the gain, not instead of
                                  // it — more depth with softer peaks, so the
                                  // extra amplitude goes into the body of the
                                  // fold structure rather than into hotter
                                  // cores. Pairs with CAUSTIC_GAIN 0.28.
                                  //
                                  // ⚠ This changes E[-log|det J|], so it moves
                                  // the DC and B_GEOM must be re-derived. It is
                                  // not just a look knob.
const float DISPERSION   = 0.300; // per-channel index spread → rainbow fringes.
                                  // Was 0.055, which measured at 0.4% of the
                                  // whole texture — the header has always
                                  // promised rainbow fringes "falling out of
                                  // the physics" and they were set too low to
                                  // see. Swept as pure chroma added by the
                                  // caustic, isolated from text colour:
                                  //   0.055 -> 0.19 lv    acutance -0.01%
                                  //   0.150 -> 0.48 lv             -0.09%
                                  //   0.300 -> 0.80 lv             -0.29%
                                  //   0.500 -> 1.07 lv             -0.60%
                                  // 0.30 puts colour in line with every other
                                  // channel here (~1 level) before the returns
                                  // flatten and the acutance cost doubles.
// ── heat AS REFRACTIVE INDEX ────────────────────────────────────────────
// `heat` is the red-versus-green balance of nearby output — it has always been
// a real reading of what the terminal is SAYING, not of what it looks like.
// Until now it did one thing: tint the sky's hue. That is the reading used to
// colour something that would exist anyway, which is the definition of
// decorating the decoration that this project's own doctrine warns about.
//
// The roadmap's line is "heat is the refractive index: what the terminal says
// changes how the medium disperses". This is that, literally. Dispersion is
// already the only place colour enters the caustic, and it enters as an index
// — so modulating it with heat means red-heavy output (failures, diffs) makes
// the medium split light harder, and green-heavy output settles it.
//
// The chromatic fringes on your glyphs now depend on what those glyphs say.
//
// ⚠ BUILT, MEASURED, NOT SHIPPED — the sign is wrong and unexplained.
//
// Predicted: heat > 0 widens the index spread, so red-heavy output should gain
// chromatic fringing. First order, m_r - m_b ≈ 2·disp·tr(H), so a wider spread
// adds a zero-mean term to (r - b), and by convexity of |·| that should RAISE
// E|r - b|. Measured, at HEAT_DISP 0.9 and in the band where heat is strongest
// (|heat| > 0.2, 14.6% of an error-filled screen), chroma moved **-0.055
// levels** — the wrong way — and the whole-frame effect was 0.03 levels.
//
// Best candidate: FOLD_FLOOR clamps |det| to [0.09, 11.1], and a wider index
// spread pushes more of the three channels onto the SAME bound, collapsing the
// differential precisely where the field is strongest — which is where heat is
// high, near bright text. That is a hypothesis. It has not been demonstrated.
//
// So this ships at 0. The mechanism is one constant away and the measurement
// is recorded; what is missing is an explanation, and a coupling whose sign
// nobody can account for is exactly the kind of thing the rest of this file
// exists to keep out.
//
// Worth noting the roadmap's premise did not survive contact either: "heat is
// the refractive index" assumes dispersion is a load-bearing channel. Measured,
// at the old DISPERSION it was 0.4% of the texture. Raising dispersion was the
// real finding here; heat riding it was not.
const float HEAT_DISP    = 0.0;
const float SPILL_GAIN   = 0.11;  // caustic-modulated bloom into the gaps
                                  // between lines. 0.0 disables it and drops
                                  // the shader back to a single texture tap.
const float BLUR_RADIUS  = 12.0;  // px; radius of the spill's gather kernel

// ── THE SUBSTRATE: /‾‾‾‾\ ────────────────────────────────────────────────
// Nothing here touches tempo — see the note above SOURCES for why a modulated
// ω is a latent bug rather than a taste call. All of this moves DEPTH, which
// is flux-neutral, so the surface can respond without the black level shifting
// a step. Motion-while-typing comes from the cursor source instead.
//
//   /      CALM_DEPTH → CALM_DEPTH+INK_DEPTH, as text accumulates on screen
//   ‾‾‾‾   held for as long as keys keep arriving (the gate cannot re-fire)
//   \      one slow glide to CALM_FLOOR, HOLD seconds after the last one
//
const float CALM_DEPTH   = 0.60;  // depth over empty screen
const float INK_DEPTH    = 0.40;  // added where text is dense. The `/` — it
                                  // accumulates per character and saturates,
                                  // because it IS the text, not a timer.
const float HOLD         = 1.5;   // s after the last cursor move before the
                                  // release begins. Still far longer than any
                                  // realistic gap between keystrokes, so a
                                  // burst holds the plateau flat rather than
                                  // re-triggering — that survives any value
                                  // above roughly 0.5s.
const float RELEASE      = 6.0;   // s of glide down; settles in HOLD+RELEASE
                                  // total. Short enough to feel connected to
                                  // what you did, long enough not to read as a
                                  // motion in its own right.
const float REST_RADIUS  = 0.16;  // how far the cursor source wanders off
                                  // the caret once settled. Bounds the
                                  // re-attach step, which is why it is small.
const float CALM_FLOOR   = 0.55;  // depth once fully settled. Not 0 — an idle
                                  // terminal should still breathe faintly.
const float ATTACH_FLOOR = 0.70;  // how much of the way the cursor source
                                  // drifts back toward `home` once settled.
                                  // 0 = all the way, which reads as the field
                                  // moving by itself after you stop.


#define LAYER_GAS       1   // broad glow
#define LAYER_FILAMENTS 1   // the fold curves
#define LAYER_STARS     1   // the cusps
#define SUBSTRATE       1   // 0 = fixed hue, ignores the terminal
#define DEBUG_SKY       0   // 1 = det J   2 = dFold   3 = cusp align
                            // 4 = the three layers as R/G/B


const float R_GAS       = 0.0160; // gaussian sigma. Judged by its MEAN over
                                  // the screen (the floor it lifts), not peak.
const float R_FILAMENT  = 0.0040; // sparser again
const float R_STAR      = 0.0075; // wider than filaments on purpose: cusps
                                  // should be a POPULATION, not lone flares
const float A_CUSP      = 0.110; // how degenerate counts as a cusp. ↓ = fewer,
                                 // sharper stars. This is the star DENSITY.
const float GAS_GAIN    = 0.030;
const float FIL_GAIN    = 0.050;
const float STAR_GAIN   = 0.30;  // was 1.35, which is 6.75x the ceiling, so
                                 // every cusp clipped to flat white — a
                                 // standout sitting on top of a standout
const float SKY_CEILING = 0.14;  // hard bound on light this pass may add
const float HEAT_SWING  = 0.34;  // how far red<->green output swings the hue
const float TEXT_AWARE  = 0.88;  // how hard the sky recedes from glyphs
const float TAU = 6.28318530718;

// Four sources, deliberately far coarser than grain.caustic's 22–113. This is
// the SWELL: k 9–26 puts only a handful of fold curves on screen, so they read
// as filaments crossing the void rather than as texture.
//
// Scale separation is why this can coexist with the glass. The two fields do
// not beat — beats need commensurate k, which is exactly what would produce
// uniform mush. They interact through the FOLD SET instead: adding any layer
// moves where det J crosses zero, so a coarse swell decides where filaments
// run while a fine frost decides how they crenellate. Cross-scale interaction,
// no commensurability required.
//


// GRAIN_SEED: set to any float for a different spatial grain pattern per window.
// Useful when running multiple same-size windows simultaneously.
#define GRAIN_SEED 0.0

// FROSTED_LEGACY: 1 = original cell-quantized path (32 hashes/layer),
// 0 = direct continuous evaluation of the same blob field (8 hashes/layer).
#define FROSTED_LEGACY 0

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), f);
}

float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
}

float smoothNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Shared flow field - computed once, used for all channels
vec2 flowField(vec2 uv, float t) {
    vec2 q = uv * 1.5 + t * 0.3;
    float nx = smoothNoise(q);
    float ny = smoothNoise(q + 50.0);

    // Spatial strength modulation - low freq noise for regional variation
    float strengthMod = smoothNoise(uv * 0.3 + t * 0.05) * 0.6
                      + smoothNoise(uv * 0.7 + t * 0.03 + 100.0) * 0.4;
    strengthMod = 0.3 + strengthMod * 1.4;  // range ~0.3 to 1.7

    return (vec2(nx, ny) - 0.5) * 0.35 * strengthMod;
}

#if FROSTED_LEGACY
float blobNoise(vec2 cellId, float z, float seed) {
    vec2 p = cellId * 0.12 + seed;

    float iz = floor(z);
    float fz = fract(z);
    fz = fz * fz * (3.0 - 2.0 * fz);

    // Wrap iz to prevent float32 precision loss in hash21 over long sessions.
    float iz0 = mod(iz, 997.0);
    float iz1 = mod(iz + 1.0, 997.0);

    vec2 o0 = vec2(iz0 * 17.0, iz0 * 37.0);
    vec2 o1 = vec2(iz1 * 17.0, iz1 * 37.0);

    float n0 = smoothNoise(p + o0);
    float n1 = smoothNoise(p + o1);
    return mix(n0, n1, fz);
}

float layerGrainFrosted(vec2 uv, float scale, float seed, float zBase) {
    vec2 seedOff = vec2(seed * 0.00012, seed * 0.00009);
    vec2 scaledUV = (uv + seedOff) * scale;

    vec2 cellId = floor(scaledUV);
    vec2 f = fract(scaledUV);
    f = f * f * (3.0 - 2.0 * f);

    float z = zBase + seed * 0.07;

    float n00 = blobNoise(cellId, z, seed);
    float n10 = blobNoise(cellId + vec2(1.0, 0.0), z, seed);
    float n01 = blobNoise(cellId + vec2(0.0, 1.0), z, seed);
    float n11 = blobNoise(cellId + vec2(1.0, 1.0), z, seed);

    return mix(mix(n00, n10, f.x), mix(n01, n11, f.x), f.y);
}
#else
float layerGrainFrosted(vec2 uv, float scale, float seed, float zBase) {
    vec2 seedOff = vec2(seed * 0.00012, seed * 0.00009);
    vec2 p = (uv + seedOff) * scale * 0.12 + seed;

    float z = zBase + seed * 0.07;
    float iz = floor(z);
    float fz = fract(z);
    fz = fz * fz * (3.0 - 2.0 * fz);

    float iz0 = mod(iz, 997.0);
    float iz1 = mod(iz + 1.0, 997.0);

    float n0 = smoothNoise(p + vec2(iz0 * 17.0, iz0 * 37.0));
    float n1 = smoothNoise(p + vec2(iz1 * 17.0, iz1 * 37.0));
    return mix(n0, n1, fz);
}
#endif



// ════════════════════════════════════════════════════════════════════════
//  THE SHIMMER — screen 0, the coarsest, and the first REAL refraction
// ════════════════════════════════════════════════════════════════════════
//
// crt-glow's heat shimmer was the least physical thing in this stack. It was
//
//     distortedUV.y += (sin(12x + 3y + t) + 0.6 sin(7x + 5y - t)) * A(y)
//
// — a wave whose wavevector points mostly ALONG X displacing the image along
// Y. That is a shear, not a refraction: D = (0, s(x,y)) is a gradient field
// only if ∂s/∂x = 0, and it is not. So it could never be a phase screen while
// written that way, and it could never focus. It only wobbled.
//
// Given a potential it does both, which is the whole point — real heat haze
// over asphalt has bright wobbling bands because the air focuses as well as
// bends. With a vertical ramp g(y) = 1 - y (heat is strongest low, where the
// phosphor is hottest):
//
//     Φ = a·g(y)·sin(θ),   θ = kx·x + ky·y + ω·t
//     ∂xΦ = a·g·kx·cos                    ∂yΦ = -a·sin + a·g·ky·cos
//     Hxx = -a·g·kx²·sin
//     Hxy = -a·kx·cos - a·g·kx·ky·sin
//     Hyy = -2a·ky·cos - a·g·ky²·sin
//
// g' = -1 and g'' = 0, so the ramp costs two extra terms and nothing else.
//
// ── BAND ──
// |k| ≈ 6-7 in isotropic space, against the swell's 9-26 and the glass's
// 22-113. So it is the COARSEST screen, and the split-step order is
// shimmer → swell → glass: coarse deflects fine, never the reverse.
//
// ── THIS IS THE FIRST BUDGETED IMAGE DISPLACEMENT ──
// SPEC §3 forbids sampling the buffer at the deflected coordinate, but
// explicitly reserves "a separate, budgeted, ink-gated term in single-digit
// px". This is it — and it adds no risk, because crt-glow was ALREADY
// displacing the image by exactly this much (0.0018 x 1.6 = 0.00288 uv = 3.1px
// at 1070). The wobble is not new. It has been moved into a principled home
// where the same field that bends the light also focuses it.
#define SCREEN_SHIMMER 1
#define SHIM_DEFLECTS  1    // 0 = shimmer focuses but does not bend the others
const float SHIM_FOCUS = 0.30;   // a·k² per component. The swell runs 0.62.
const float SHIM_DISP  = 0.0;    // ⚠ TRIED AND REJECTED ON MEASUREMENT.
                                 //
                                 // SPEC §3 reserves a budgeted single-digit-px
                                 // image displacement, and this was it: 3.1px,
                                 // exactly what crt-glow's old shear did. It
                                 // measured badly, for an ARCHITECTURAL reason
                                 // rather than a physical one.
                                 //
                                 //   crt-glow displacing:   -1.0% edge acutance
                                 //   medium  displacing:    -8.6%
                                 //
                                 // Same 3px, nine times the blur. crt-glow
                                 // folded the shimmer into `distortedUV`, so it
                                 // rode a texture fetch that was happening
                                 // anyway. From inside medium it is a SECOND
                                 // resample, of a buffer that crt-glow has
                                 // already resampled and quantized to 8 bits.
                                 // An extra generation of resampling costs far
                                 // more than the displacement itself.
                                 //
                                 // Consequence for §3 generally: the reserved
                                 // refraction term is cheap only where a fetch
                                 // already happens. That is crt-glow — which
                                 // does not have the field. Any future glyph
                                 // refraction has to solve that, not just pick
                                 // a pixel budget.
                                 //
                                 // Set >0 to re-enable; 0.173 was the calibrated
                                 // value for a 3.1px peak.
const float SHIM_PX    = 3.1;    // px of real image displacement. crt-glow's
                                 // old shimmer was 3.08px, deliberately matched.
const int   NUM_SHIM   = 2;
// vec4(kx, ky, omega, weight). kx is divided by aspect at evaluation so the
// frequencies read as they did in uv space.
const vec4 SHIM[2] = vec4[2](
    vec4(12.0, 3.0,  2.0,  1.0),
    vec4( 7.0, 5.0, -1.3,  0.6)
);

// Accumulates ∇Φ and H for one ramped plane wave. No third derivatives: the
// shimmer never needs to locate its own fold set the way the sky does.
void addShimmer(vec2 p, float aspect, vec4 sh, float t,
                inout vec2 grad, inout vec3 H) {
    float kx = sh.x / aspect;
    float ky = sh.y;
    float k2 = kx * kx + ky * ky;
    float a  = SHIM_FOCUS / k2 * sh.w;

    float g  = 1.0 - p.y;                 // heat is strongest low
    float th = kx * p.x + ky * p.y + sh.z * t;
    float sn = sin(th), cs = cos(th);

    grad += vec2(a * g * kx * cs,
                 -a * sn + a * g * ky * cs);
    H.x += -a * g * kx * kx * sn;
    H.y += -2.0 * a * ky * cs - a * g * ky * ky * sn;
    H.z += -a * kx * cs - a * g * kx * ky * sn;
}

// ════════════════════════════════════════════════════════════════════════
//  THE SWELL — screen 1
// ════════════════════════════════════════════════════════════════════════
const float SKY_FOCUS = 0.62;   // a·k² per source; higher = more fold curves
const float SKY_R_MIN = 0.035;  // guards the 1/r terms at a source centre
const vec4 SKY[4] = vec4[4](
    vec4(0.28, 0.71,  9.0, 0.041),
    vec4(1.44, 0.22, 14.0, 0.033),
    vec4(0.95, 1.06, 19.0, 0.052),
    vec4(1.62, 0.62, 26.0, 0.045)
);
vec2 skySourceCentre(int i, float t) {
    float orb = t * (0.0055 + 0.0031 * float(i));
    return SKY[i].xy + vec2(cos(orb + float(i) * 2.3),
                            sin(orb * 1.27 + float(i) * 1.1)) * 0.22;
}

// How much of the swell's magnification enters the shared term. 1.0 is the
// physics — determinants multiply, nothing is weighted. Lower it to keep the
// deflection while softening the coarse brightness modulation.
//
// It scales the sky's Hessian inside the magnification ONLY; the sky's own
// dFold, cusps and rendering are computed from the unweighted field, so the
// filaments stay where they are and only their effect on the glass changes.
// 1.0 is the physics: determinants multiply, nothing is weighted. 0.0 is
// exactly Track A (deflection only). In between is a dial on how hard the
// coarse field modulates the fine one.
const float SKY_MAG = 1.0;
const int   NUM_SKY = 4;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

// Blue-leaning by construction, unlike its predecessor: g maxes at 0.48 while
// b bottoms at 0.50, so blue >= green for every hue. Red still exceeds blue
// (0.68 vs 0.50) so rose and magenta remain reachable — it is the olive that
// is unreachable, not the warmth.
vec3 skyPalette(float t) {
    return vec3(0.42, 0.34, 0.66)
         + vec3(0.26, 0.14, 0.16) * cos(TAU * (t + vec3(0.00, 0.40, 0.62)));
}

// One radial source's contribution to the 2nd and 3rd derivatives of Φ.
// For a radial f(r):
//   ∂ᵢ∂ⱼf      = f'' uᵢuⱼ + (f'/r)(δᵢⱼ - uᵢuⱼ)
//   ∂ᵢ∂ⱼ∂ₖf    = f''' uᵢuⱼuₖ + Q(δᵢⱼuₖ + δⱼₖuᵢ + δᵢₖuⱼ - 3uᵢuⱼuₖ),
//                Q = f''/r - f'/r²
// With f = a·sin(kr+φ): f' = ak·cos, f'' = -ak²·sin, f''' = -ak³·cos.

void addSky(vec2 p, vec2 c, float k, float phase,
            inout vec2 grad, // ∇Φ — free here; f1 is already computed
            inout vec3 H,    // (Hxx, Hyy, Hxy)
            inout vec4 T)    // (Txxx, Txxy, Txyy, Tyyy)
{
    float a = SKY_FOCUS / (k * k);
    vec2 d = p - c;
    float r = max(length(d), SKY_R_MIN);
    vec2 u = d / r;

    float th = k * r + phase;
    float sn = sin(th), cs = cos(th);

    float f1 =  a * k * cs;
    float f2 = -a * k * k * sn;
    float f3 = -a * k * k * k * cs;

    grad += f1 * u;

    float B  = f1 / r;
    float AB = f2 - B;
    H.x += AB * u.x * u.x + B;
    H.y += AB * u.y * u.y + B;
    H.z += AB * u.x * u.y;

    float Q = f2 / r - f1 / (r * r);
    float ux = u.x, uy = u.y;
    T.x += f3 * ux*ux*ux + Q * (3.0 * ux - 3.0 * ux*ux*ux);
    T.y += f3 * ux*ux*uy + Q * (uy - 3.0 * ux*ux*uy);
    T.z += f3 * ux*uy*uy + Q * (ux - 3.0 * ux*uy*uy);
    T.w += f3 * uy*uy*uy + Q * (3.0 * uy - 3.0 * uy*uy*uy);
}

// ink: how written-on this region is. heat: its red<->green balance.
// The two want DIFFERENT radii — the gas is pushed off the text by ink, so if
// heat read the same tight neighbourhood it would only ever be coloured where
// it is not drawn. heat reads about a line's height out.

void readTerm(vec2 uv, vec3 here, out float ink, out float heat) {
    vec2 e = 3.0 / iResolution.xy;
    vec3 m = here;
    m = max(m, textureLod(iChannel0, uv + vec2( e.x, 0.0), 0.0).rgb);
    m = max(m, textureLod(iChannel0, uv + vec2(-e.x, 0.0), 0.0).rgb);
    m = max(m, textureLod(iChannel0, uv + vec2(0.0,  e.y), 0.0).rgb);
    m = max(m, textureLod(iChannel0, uv + vec2(0.0, -e.y), 0.0).rgb);
    ink = dot(m, LUMA);

    vec2 f = 30.0 / iResolution.xy;
    vec3 w = m;
    w = max(w, textureLod(iChannel0, uv + vec2( f.x,  f.y), 0.0).rgb);
    w = max(w, textureLod(iChannel0, uv + vec2(-f.x,  f.y), 0.0).rgb);
    w = max(w, textureLod(iChannel0, uv + vec2( f.x, -f.y), 0.0).rgb);
    w = max(w, textureLod(iChannel0, uv + vec2(-f.x, -f.y), 0.0).rgb);
    // The terminal background is itself red-leaning (#0f0a1a is r15 g10), so
    // an ungated reading calls every empty region an error.
    float lit = smoothstep(0.05, 0.17, dot(w, LUMA));
    heat = lit * (w.r - w.g) / max(0.03, w.r + w.g);
}

vec3 softCeil(vec3 g, float knee, float top) {
    vec3 over = max(g - knee, vec3(0.0));
    return min(g, vec3(knee)) + (top - knee) * (1.0 - exp(-over / (top - knee)));
}


// ════════════════════════════════════════════════════════════════════════
//  THE GLASS — screen 2
// ════════════════════════════════════════════════════════════════════════
const float FOCUS_TARGET = 0.55;
const float R_MIN        = 0.02;  // guards the 1/r in B at a source centre
// NOTHING MODULATES ω. Not because tempo response is unwanted, but because
// `th = k·r + ω·t·wScale` is a latent bug: it scales an ACCUMULATED phase, so
// d(phase)/dt picks up a term proportional to t. At t = 10000s an imperceptible
// change in wScale teleports the whole pattern. The first build had this; it
// was masked only because agit decayed within a second and nothing was ever
// tested far from t = 120. A time-varying rate would have to be integrated,
// ∫ω dt, and there is no persistent state in which to accumulate it.
//
// So the response has to come from a POSITION rather than a rate — and the
// cursor is one. See CURSOR_K below.
const float TEMPO = 1.0;   // scales every ω. 1.0 is the original resting rate;
                           // 0.5 was the too-dead build; the original build's
                           // typing peak was an effective 2.6.
const vec4 SOURCES[4] = vec4[4](
    vec4(0.35, 0.62,  34.0, 0.31),
    vec4(1.32, 0.28,  51.0, 0.24),
    vec4(0.88, 0.95,  77.0, 0.43),
    vec4(1.55, 0.70, 113.0, 0.37)
);

// A fifth source rides the cursor. This is where movement-while-typing comes
// from, and it works where the tempo boost could not:
//
//   · it is a POSITION, so there is no accumulated phase to corrupt.
//   · the cursor advances one cell per character, so the ripple sweeps
//     smoothly along with you — genuinely proportional to typing rather than
//     re-triggered by it. Nothing to stack, nothing to reset.
//   · its weight is CONSTANT. Weighting it by the gate would change the
//     field's statistics, hence mean(m), hence the DC — reintroducing exactly
//     the brightness pumping CAUSTIC_DC exists to remove. It is always
//     present; it simply stops moving when you do.
//
// k halved from 44: the rings were legible AS rings, a bullseye pinned under
// the caret. At 22 the spacing doubles and the same energy reads as one broad
// swell travelling with you instead of a target.
//
// Broadening is not free, and the trap is in the B term. Amplitude is derived
// as a = FOCUS_TARGET/k², so A = -a·k²·sin is invariant to k by construction —
// but B = a·k·cos/r = FOCUS_TARGET·cos/(k·r) goes as 1/k. Halving k DOUBLES
// the wavefront-curvature term, and B is the part that blows up at r → 0. Left
// alone, widening the rings would have made the centre of the bullseye twice
// as hot while making the rings themselves less visible — the exact opposite
// of the intent. CURSOR_R_MIN is the correction: a wider core for a wider
// wave, holding peak B roughly where it was.
const float CURSOR_K      = 22.0;
const float CURSOR_W      = 0.28;
const float CURSOR_R_MIN  = 0.07;  // NOT R_MIN. See above.
const float CURSOR_WEIGHT = 0.85;  // constant, and it must stay constant — a
                                   // time-varying weight changes mean(m) and
                                   // therefore the DC. Position may vary; mass
                                   // may not.
const float CURSOR_SMOOTH = 0.18;  // s to ease from the previous cell to the
                                   // current one. The cursor moves in whole
                                   // 9px cells, so an un-eased source teleports
                                   // once per character — that is the jitter.
                                   // iPreviousCursor gives us the two-sample
                                   // history needed to interpolate it away.


// ════════════════════════════════════════════════════════════════════════
//  COUPLING — the sky decides where the glass is evaluated
// ════════════════════════════════════════════════════════════════════════
//
// Until now the two wave fields in this stack never met. This pass computes
// Φ_glass (k 22–113); field.caustic computes Φ_swell (k 9–26); and their
// caustics were composited as LIGHT, in different passes. Two phase fields
// composited as colour cannot interfere, so nothing about the sky influenced
// where the glyph caustics fell. That is the architectural root of "nothing
// talks to each other", and no amount of tuning reaches it.
//
// The fix does NOT require merging the passes. A later pass does not need the
// buffer to carry a field it can simply RECOMPUTE: everything in the sky is
// closed-form and stateless — four constants plus iTime — so the swell is
// rebuilt here from the shared block below and used to displace where this
// field is sampled. Split-step, across a pass boundary:
//
//     p_glass = p + COUPLING * ∇Φ_swell(p)
//
// Cost is 4 sqrt + 8 trig in a pass that already does five such evaluations.
// Zero extra texture taps, zero extra draws, no rewrite.
//
// ── DIRECTION IS LOAD-BEARING, NOT A CONVENTION ─────────────────────────
//
// Coarse deflects fine, never the reverse. Measured, the asymmetry is 10.9x:
// k_fine·|∇Φ_coarse| = 3.58 rad against k_coarse·|∇Φ_fine| = 0.33 rad. Run
// backwards it would inject glyph-scale jitter into the filaments.
//
// ── WHAT SUCCESS LOOKS LIKE, BECAUSE IT IS THE OPPOSITE OF THE GUESS ────
//
// The intuition is "fine folds bend along the coarse ones". That is WRONG,
// and an acceptance test written from it reads FAIL while this works. On a
// coarse fold the swell's Jacobian is singular — σ_min → 0 — so fine features
// are stretched up to 100x along the filament normal, and fine zero-crossings
// per unit area must FALL there. Measured on the model:
//
//     distance to coarse fold   fine-fold density   uncoupled
//        0.002–0.004              0.479%            1.092%   (0.44x, depleted)
//        > 0.120                  1.216%            0.902%   (1.35x, enriched)
//        orientation |n·n|        0.419             0.745    (runs ACROSS)
//
// So: fine folds are EVACUATED from the coarse filaments and run across them.
// A combed field with a clear lane along each filament. Verify with
// tools/coupling_check.py, not by eye.
//
// ── WHY 0.45, AND WHY NOT THE 0.15 THE SPEC SAID ────────────────────────
//
// SPEC gave two numbers that turn out to disagree, and the disagreement was
// invisible because they came from different measurements:
//
//   · §A2 derived COUPLING = 0.15 from a "bend don't scramble" phase-warp
//     window of 0.5–2 rad, since the warp a source feels is
//     k·COUPLING·|∇Φ_swell| and 0.15 puts the finest source (k=113) at
//     1.8 rad.
//   · §A4's acceptance targets — density ≤0.6x on a filament, ≥1.3x far
//     away, orientation ≤0.5 — were quoted from §4b's table, which was
//     measured at FULL SPLIT-STEP. Split-step is p + ∇Φ with no factor at
//     all: those numbers are COUPLING = 1.0.
//
// So the spec's acceptance test could never pass at the spec's starting
// value, and a fresh session running it as written would have concluded
// Track A failed and reverted a working change. Verified both ways:
// COUPLING = 1.0 reproduces §4b (0.468x / 1.465x / 0.373 against its
// 0.44x / 1.35x / 0.419); 0.15 gives 0.806x and moves orientation by 4%.
//
// Measured across the range (tools/coupling_check.py --sweep), the two ends
// of the §4g tension:
//
//     COUPLING   on-fold   far   |n·n| near   power below k=30
//       0.00       1.000  1.000     0.729        15.3%   <- uncoupled
//       0.15       0.806  1.037     0.697        16.0%
//       0.45       0.716  1.158     0.591        19.8%
//       0.60       0.662  1.241     0.550        22.9%
//       0.80       0.515  1.367     0.458        26.0%
//       1.00       0.492  1.511     0.394        25.3%
//
// Organisation wants this up; scale separation wants it down. "Power below
// k=30" is the glass leaking into the sky's own band — the uniform-mush
// mechanism arriving through the very coupling meant to organise things.
//
// 0.45 is the knee: all three organisation metrics have moved decisively
// (orientation -19%, folds depleted to 0.73x on a filament) while leakage is
// +4.5pp rather than the +10.7pp at 0.8. Below ~0.3 the effect is real but
// barely visible; above ~0.8 the glass starts becoming coarse.
//
// THIS IS THE ONE GENUINELY AESTHETIC KNOB HERE. The range 0.30–0.60 is all
// defensible; the numbers cannot pick within it. Move it and look.
//
// Remaining catch, unchanged from §A2: warp is proportional to k, so at 0.45
// the cursor source (k=22) feels 1.05 rad while k=113 feels 5.39 — the fine
// glass listens to the sky considerably more than the coarse glass does. If
// that reads as inconsistent, the fix is per-source coupling weighted by 1/k
// so every scale feels equal warp, which costs the glass being a single ray
// map. Legal (this pass never applies the map to the buffer) but make it
// A DECISION, NOT A DRIFT.
//
// ── TWO THINGS THIS DELIBERATELY DOES NOT DO ────────────────────────────
//
// It does not reproduce the multiplicative cross-brightness a merged pass
// would get, where the two log-magnifications sum and apply together; here
// the sky is still additive light in its own pass. And it is not phase-sum
// interference between the screens — split-step never provided that either,
// and that died with emergent moiré.
//
// The image is NOT moved. Deflected coordinates are for EVALUATING THE FIELD;
// the buffer is still sampled in place at uv and magnification applied as a
// ratio. Sampling at the deflected coordinate would displace text by a
// measured mean of 67px — 7.5 character cells — and destroy the one property
// this whole design has protected.
//
// ⚠ COUPLING changes this field's det J statistics, so B_GEOM is a
//   CALIBRATION THAT MUST BE RE-MEASURED whenever COUPLING moves. See the
//   procedure at B_GEOM below.
#define COUPLE_SWELL 1        // 0 = the two fields never meet again
const float COUPLING = 0.45;  // uv of deflection per unit ∇Φ_swell.
                              // 1.0 would be true split-step. See above:
                              // 0.30–0.60 all defensible, look before moving.

// The frost rides the SAME ray the glass does — literally COUPLING, not a
// number that happens to match it. This was briefly an independent knob, and
// sweeping it showed why that was wrong: raising it does produce a bigger
// visible change (35% at 1.0, 100% at 5.0), but a bigger change is not a
// stronger version of the same coupling — it is a DIFFERENT, exaggerated map
// that the glass is not on. One medium, one ray map.
//
// Its visible effect is small (0.12 levels) and that is correct rather than
// disappointing: layerGrainFrosted multiplies its scale by 0.12, so the blobs
// are ~0.21 uv across and the shared deflection is under a tenth of a period.
// The frost is genuinely on the map; the map is just fine compared to it.
//
// Set to 0.0 to make the grain an overlay again.
const float FROST_RIDE = COUPLING;


void addSource(vec2 p, vec2 c, float k, float phase, float rMin, float w,
               inout vec2 grad, inout vec3 H) {
    float a = FOCUS_TARGET / (k * k) * w;
    vec2 d = p - c;
    float r = max(length(d), rMin);
    vec2 u = d / r;

    float th = k * r + phase;
    float sn = sin(th);
    float cs = cos(th);

    float A = -a * k * k * sn;   // curvature along the ray
    float B =  a * k * cs / r;   // curvature of the wavefront itself
    float AB = A - B;

    grad += a * k * cs * u;
    H.x += AB * u.x * u.x + B;
    H.y += AB * u.y * u.y + B;
    H.z += AB * u.x * u.y;
}

// grad = ∇φ (the deflection), H = (Hxx, Hyy, Hxy) (what focuses it).
// `pc` is the cursor in the same isotropic space as `p`.
void causticField(vec2 p, vec2 pc, float t, out vec2 grad, out vec3 H) {
    grad = vec2(0.0);
    H = vec3(0.0);

    for (int i = 0; i < 4; i++) {
        vec4 s = SOURCES[i];
        // The centres drift on slow, mutually incommensurate orbits, so the
        // interference pattern never settles into a repeat.
        float orb = t * (0.013 + 0.007 * float(i));
        vec2 c = s.xy + vec2(cos(orb + float(i) * 1.7),
                             sin(orb * 1.3 + float(i) * 2.4)) * 0.18;
        addSource(p, c, s.z, s.w * TEMPO * t, R_MIN, 1.0, grad, H);
    }

    addSource(p, pc, CURSOR_K, CURSOR_W * TEMPO * t, CURSOR_R_MIN, CURSOR_WEIGHT,
              grad, H);
}


// det(I + n·H). n is the per-channel refractive index scale — this is the
// only place colour enters, and it enters as physics.
float detJ(vec3 H, float n) {
    float xy = n * H.z;
    return (1.0 + n * H.x) * (1.0 + n * H.y) - xy * xy;
}


// ONE clamp, on the PRODUCT of the determinants. Not one per screen.
//
// This is the composition the chain rule actually gives: the total map's
// Jacobian is the product, so its determinant is the product, and bounding
// that is bounding the real quantity. Clamping each screen first bounds two
// things that were never separately meaningful — and Σ clamp(mᵢ) differs from
// clamp(Σ mᵢ) on 10.6% of pixels.
// SOFT_FOLD: bound m smoothly instead of truncating |det|.
//
// The hard clamp is a real defect, not a detail. Measured over the live field:
//
//     25.1% of pixels have at least one channel clamped
//      9.1% have ALL THREE clamped — where chroma is exactly zero
//     the clamp destroys 30.2% of the per-channel spread |m_r - m_b|,
//     and 100% of it inside the all-clamped region
//
// clamp() truncates, so once two channels land on the same bound their
// difference is identically zero. That kills colour in the brightest fold
// structure — exactly where rainbow fringes belong — and it is why raising
// DISPERSION *reduced* chroma: a wider index spread pushes more channels onto
// the shared bound faster than it separates the unclamped ones. That was the
// unexplained sign in the heat experiment, and this is the explanation.
//
// tanh saturates at the same bound M = -log(FOLD_FLOOR) with slope 1 at the
// origin, so small magnifications pass through untouched, large ones compress
// instead of truncating, and the per-channel difference never collapses to
// zero. FOLD_FLOOR keeps its meaning as the bound on |m|.
// ⚠ MEASURED AND LEFT OFF. The diagnosis above is correct; this fix is not.
//
// Softening the bound does un-flatten the dead region, but a bound compresses
// differences NEAR it by construction, and the compressed majority outweighs
// the rescued minority at every knee position:
//
//   knee   total spread   vs hard clamp   spread inside the dead 9%
//   1.00      0.4731          +0.0%              0.0000   (hard clamp)
//   0.85      0.4714          -0.3%              0.0096
//   0.70      0.4667          -1.3%              0.0284
//   0.55      0.4591          -2.9%              0.0495
//   0.40      0.4491          -5.1%              0.0704
//
// A plain tanh over the whole range (no knee) was worse still: -12.4%.
//
// The only real lever is FOLD_FLOOR itself, which sets the bound:
//
//   FOLD_FLOOR   all-clamped   spread    E[m]
//      0.150        14.18%     -15.4%   0.511
//      0.090         9.18%      +0.0%   0.607   <- shipped
//      0.050         5.59%     +13.0%   0.686
//      0.030         3.61%     +21.4%   0.734
//
// And that is exactly the constant raised 0.03 -> 0.09 to get softer fold
// cores alongside CAUSTIC_GAIN 0.28. **The floor that tames the peaks is the
// floor that kills the colour.** Recovering all 30% would be worth about
// +0.05 levels of chroma against dispersion's 0.169 — not a trade worth
// re-opening a look for.
//
// So: mechanism understood, fix measured and rejected, no change shipped.
#define SOFT_FOLD 0
const float SOFT_KNEE = 0.70;  // fraction of the bound below which m is exact

// ── CHROMA_PRESERVE: the shared-shift bound (2026-07-26, outside review) ──
//
// A third scheme, after the tanh and the knee both lost. Those two bounded
// each channel's m SEPARATELY, so they could not avoid compressing the
// majority. This one bounds the TRIPLE: slide all three channels down (or up)
// by the same amount until the extreme one sits ON the bound, then clip.
//
//     u_c   = -log(max(|d_c|, 1e-6))            unclamped
//     shift = max(0, max(u) - M) - max(0, -M - min(u))
//     m_c   = clamp(u_c - shift, -M, M)
//
// Where nothing violates the bound, shift = 0 and this is EXACT — zero
// compression of the majority, by construction, which is what the knee could
// not do at any setting. Where channels saturate, the shared shift preserves
// their differences instead of truncating them to zero. Luma can never exceed
// M, so the brightness look the clamp was retuned for is untouched.
//
// Measured against the hard clamp (numpy mirror, 3 drift times, 1920x1070,
// tools/chroma_check.py):
//
//              spread   dead-9%   never-clamped   fidelity   luma|m|max
//   hard       0.4541    0.0000       0.4285        exact      2.408
//   shift      0.6511    0.8434       0.4285        exact      2.408
//
// and the dispersion sweep is MONOTONIC under shift (0.74/1.12/1.23/1.31 in
// the strong-field region vs hard's inverted 0.11/0.33/0.49/0.58) — the heat
// inversion's mechanism is gone. A bounded-differential variant (green anchor
// + tanh on r/b deltas) was tried first and REJECTED: it compresses the
// never-clamped majority 0.43 -> 0.32, the same failure as the knee, because
// the differential's near-fold tails are real structure.
//
// Cost: the scheme dims the saturated cores in the channels that focus less
// (that is what preserving the differential MEANS), so E[m] drops per channel:
// r -0.239, g -0.152, b -0.123 (sd ~0.01-0.03 over six drift times). Left
// uncompensated that is a ~3% background dim AND a static tint, so the
// measured difference is added back as CHROMA_SHIFT_DC. Re-derive it with
// tools/chroma_check.py if FOLD_FLOOR, DISPERSION, or any field constant
// moves. If CHROMA_PRESERVE ships above 0, re-bisect B_GEOM afterwards — the
// per-channel compensation is measured to ~0.02, coarser than the ±0.05%
// background tolerance.
//
// ⚠ SHIPPED AT 0.0 — pending live judgement. This is an aesthetic decision,
// not a correctness fix: at 1.0 the brightest fold cores stop clipping to a
// flat shared value and carry strong rainbow structure instead (dead-region
// spread p95 ~2.8, rendered chroma ~ depth times that). The mechanism works;
// whether the look wants it is a call for the eye. 0.0 is bit-identical to
// the hard clamp.
const float CHROMA_PRESERVE = 0.75;  // 0 = hard clamp exactly, 1 = full shift.
                                     // 1.0 judged live 2026-07-26: pretty but
                                     // the rainbows pull focus; 0.75 keeps the
                                     // cores hued without them shouting.
const vec3  CHROMA_SHIFT_DC = vec3(-0.239, -0.152, -0.123);

float magnifyTotal(vec3 Hg, float n, float detSwell) {
    float d = detJ(Hg, n) * detSwell;
#if SOFT_FOLD
    // Identity below SOFT_KNEE, smooth saturation above it. A plain tanh over
    // the whole range was tried first and made things WORSE (-12.4% spread):
    // it rescues the clamped 9% but compresses the 75% that was never clamped,
    // and the majority wins. The knee keeps the untouched majority untouched.
    float M   = -log(FOLD_FLOOR);
    float u   = -log(max(abs(d), 1e-6)) / M;
    float au  = abs(u);
    float ov  = max(au - SOFT_KNEE, 0.0);
    float v   = min(au, SOFT_KNEE)
              + (1.0 - SOFT_KNEE) * tanh(ov / (1.0 - SOFT_KNEE));
    return sign(u) * v * M;
#else
    return -log(clamp(abs(d), FOLD_FLOOR, 1.0 / FOLD_FLOOR));
#endif
}

// THE DC IS NOW DERIVED, NOT MEASURED.
//
// For Φ = Σ aᵢψᵢ, log det(I+H) = tr(H) - tr(H²)/2 + O(H³). E[tr H] = 0 because
// every term is a sinusoid. For a radial source tr(Hᵢ²) = Aᵢ² + Bᵢ², and since
// amplitude is derived as a = FOCUS_TARGET/k², E[A²] = FOCUS_TARGET²/2 exactly
// — independent of k. Summing over N independent sources:
//
//     E[-log|det J|] ≈ N · FOCUS_TARGET² / 4
//
// Numerically that predicts 0.378 against a measured 0.410 at FOLD_FLOOR 0.03.
// The 8% residual is the B term (wavefront curvature), whose E[1/r²] depends on
// domain geometry rather than on the source list — so it is a stable RATIO,
// captured in B_GEOM, while everything that actually changes when you edit the
// field is in the formula.
//
// This is the whole point: add a source, change FOCUS_TARGET, and the DC
// follows. The measured constant was wrong three times in one day (0.86, 0.97,
// 0.93), each time invisibly, and each time only because the field had grown.
// That failure mode is now unreachable.
const int   NUM_SOURCES = 5;      // four static + the cursor. KEEP IN SYNC.
const float B_GEOM      = 0.816;  // CALIBRATION for THE MERGED PASS. It was
                                  // 1.060 when this shader carried only the
                                  // glass; the DC bracket now also carries the
                                  // swell (4 x 0.62^2 alongside 5 x 0.55^2), so
                                  // the analytic term nearly doubled and the
                                  // residual shrinks to match. Re-derive with
                                  //   tools/bisect_bgeom.py --source _cal_medium.glsl
                                  // where _cal_medium has the sky's ADDITIVE
                                  // emission off and the cross term on — additive
                                  // light muddies a multiplicative measurement.
                                  // Original note follows.
                                  // CALIBRATION, and it must be measured
                                  // THROUGH THE RENDER, not from the field.
                                  //
                                  // The analytic term gets the SCALING right —
                                  // it tracks NUM_SOURCES and FOCUS_TARGET, and
                                  // that is what stops this going stale when
                                  // the field changes. It does not get the
                                  // absolute value right. Measured on the pure
                                  // field, E[-log|det J|]/analytic = 1.07-1.08
                                  // (1.068 luma-weighted across the three
                                  // dispersion channels, so dispersion is not
                                  // the gap). Measured through the actual chain
                                  // it is 1.25 — a ~16% difference, because the
                                  // rendered mean is E[bg*(1+depth*m)] over a
                                  // background that already has crt-glow's and
                                  // grain's own texture, not E[m] over a flat
                                  // field.
                                  //
                                  // Shipped at 1.410 for a day, from a
                                  // measurement taken WITH the additive sky
                                  // pass in the chain. It held black 0.47% low.
                                  //
                                  // 1.060 is for FOLD_FLOOR 0.09 / GAIN 0.28.
                                  // It was 1.250 at floor 0.03 / gain 0.12.
                                  // FOLD_FLOOR sets the clamp that E[-log|detJ|]
                                  // is taken over, so it moves the DC directly:
                                  // shipping 1.250 at the new floor would have
                                  // held the background ~0.7% high, over ten
                                  // times the tolerance, and the higher gain
                                  // amplifies the error 2.3x on top. Re-derive
                                  // whenever EITHER of those two moves.
                                  //
                                  // SPEC §A5 predicted COUPLING would move this
                                  // and require re-measuring. Measured, it does
                                  // not — averaged over four drift times at
                                  // 1920x1070 the coupled optimum was 1.248
                                  // against a shipped 1.250, inside the noise.
                                  // COUPLING is the one thing here that does
                                  // NOT disturb the DC.
                                  //
                                  // What that investigation DID find is that
                                  // this constant has fewer significant figures
                                  // than it had been quoted to. Holding B_GEOM
                                  // at 1.250, the residual measures
                                  //     1600x900  t=120   +0.0003%
                                  //     1600x900  t=300   +0.0996%
                                  //     1920x1070 t=120   -0.0974%
                                  //     1920x1070 t=300   +0.0456%
                                  // Not time-of-day (checked: flat across
                                  // iDate). It is resolution and drift time. So
                                  // a single-frame bisection converges tidily on
                                  // a number that is only right for that one
                                  // frame, and 1.250 vs 1.259 was two frames
                                  // arguing, not a real disagreement. **B_GEOM
                                  // is good to about two decimals. Do not chase
                                  // the third.**
                                  //
                                  // TO RE-DERIVE: python3 tools/bisect_bgeom.py
                                  // It renders this pass against grain.glsl with
                                  // the SKY PASS REMOVED (the sky adds light
                                  // additively and muddies a multiplicative
                                  // measurement), freeze + pinned iDate, and
                                  // BISECTS — never a single-point algebraic
                                  // solve, which is how 1.410 happened. It works
                                  // on a copy, so the live shader is untouched
                                  // during the search, and it AVERAGES OVER
                                  // DRIFT TIMES — a single frame is where the
                                  // false precision came from.
                                  // History: 1.083 -> +0.49%, 1.410 -> -0.47%
                                  // (shipped a day, found by review).

// The DC is ADDITIVE ACROSS SCREENS, which is the property that makes this
// tractable at all: E[-log|det J_total|] = E[-log|det J_glass|]
//                                        + E[-log|det J_swell|],
// and each term follows N·FOCUS²/4 in its own field. So adding a screen adds
// a term rather than invalidating a measured constant.
//
// The swell's contribution carries SKY_MAG², because E[-log det] scales with
// the square of the Hessian scale.
// One expression, no preprocessor: SKY_MAG = 0 zeroes the swell term on its
// own, so the constant stays machine-readable in every configuration.
const float CAUSTIC_DC = B_GEOM * 0.25 *
    (float(NUM_SOURCES) * FOCUS_TARGET * FOCUS_TARGET
   + float(NUM_SKY) * (SKY_MAG * SKY_FOCUS) * (SKY_MAG * SKY_FOCUS)
   + float(NUM_SHIM) * SHIM_FOCUS * SHIM_FOCUS);
// The glass half of the DC alone, per unit thickness². Used to correct the DC
// where ink thickens the medium (see `thick` in mainImage).
const float DC_GLASS_UNIT = B_GEOM * 0.25 * float(NUM_SOURCES)
                          * (FOCUS_TARGET * FOCUS) * (FOCUS_TARGET * FOCUS);


void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec4 color = texture(iChannel0, uv);

    vec4 _bootSrc = color;
    if (iTime < 1.5) { fragColor = _bootSrc; return; }

    // ink/heat are read from the RAW terminal buffer here. In the two-pass
    // build the sky read a buffer that already had the grain and the glass
    // caustic applied, so `heat` — a red-versus-green reading — was biased by
    // whatever the glass had just done to those channels.
    float ink = 0.0, heat = 0.0;
#if SUBSTRATE
    readTerm(uv, color.rgb, ink, heat);
#endif

    // The swell is computed FIRST, above the grain, because the frost now
    // rides it too — see FROST_RIDE below. Nothing here depends on the grain,
    // so hoisting it is free.
    float aspect = iResolution.x / iResolution.y;
    vec2 p = vec2(uv.x * aspect, uv.y);
    float age = max(0.0, iTime - iTimeCursorChange);

    // ── SCREEN 0: the shimmer, coarsest, evaluated first ──
    vec2 gShim = vec2(0.0);
    vec3 Hshim = vec3(0.0);
#if SCREEN_SHIMMER
    for (int i = 0; i < NUM_SHIM; i++) {
        addShimmer(p, aspect, SHIM[i], iTime * 0.15, gShim, Hshim);
    }
#endif
    // Split-step: every later screen is evaluated where this one bent the ray.
    vec2 pShim = p;
#if SCREEN_SHIMMER && SHIM_DEFLECTS
    pShim += gShim;
#endif

    // ── THE BUDGETED DISPLACEMENT (SPEC §3, first use) ──
    // The ONE place this design moves the image. Everything else is applied as
    // a multiplicative ratio precisely so legibility cannot be traded away by
    // tuning. Here the trade is explicit, bounded, and no larger than what
    // crt-glow was already doing unbudgeted.
    //
    // SHIM_DISP scales ∇Φ_shim to that budget. Analytically the peak gradient
    // is Σ a(1 + ky) ≈ 0.0164 uv = 17.5 px at 1070, so 3.1/17.5 ≈ 0.18.
#if SCREEN_SHIMMER
    vec2 dispUV = vec2(gShim.x / aspect, gShim.y) * SHIM_DISP;
    color = texture(iChannel0, uv + dispUV);
    _bootSrc = color;
#endif

    // ── SCREEN 1: the swell ──
    vec2 gSky = vec2(0.0);
    vec3 Hs = vec3(0.0);
    vec4 Ts = vec4(0.0);
#if SCREEN_SWELL
    for (int i = 0; i < 4; i++) {
        addSky(pShim, skySourceCentre(i, iTime), SKY[i].z, SKY[i].w * iTime,
               gSky, Hs, Ts);
    }
#endif
    float jxx = 1.0 + Hs.x, jyy = 1.0 + Hs.y, jxy = Hs.z;
    float detS = jxx * jyy - jxy * jxy;

    vec2 gradDet = vec2(
        Ts.x * jyy + jxx * Ts.z - 2.0 * jxy * Ts.y,
        Ts.y * jyy + jxx * Ts.w - 2.0 * jxy * Ts.z
    );
    float gLen = max(length(gradDet), 1e-4);
    float dFold = abs(detS) / gLen;

    vec2 v1 = vec2(jxy, -jxx);
    vec2 v2 = vec2(-jyy, jxy);
    vec2 nv = normalize(dot(v1, v1) > dot(v2, v2) ? v1 : v2);
    float align = abs(dot(gradDet / gLen, nv));

    // ∇Φ_swell in uv units, for anything that wants to ride the coarse map.
    vec2 dSky = vec2(gSky.x / aspect, gSky.y);

    float t = iTime * 0.10;

    // breathing (time-only, so use cheaper 1D noise)
    float breath = sin(iTime * 0.1) * 0.5 + 0.5;
    breath *= 0.7 + noise1(iTime * 0.04) * 0.3;

    // glass warp (kept as-is; it's part of the "warped glass" feel)
    float warp1 = smoothNoise(uv * 3.0 + t * 0.8) - 0.5;
    float warp2 = smoothNoise(uv * 5.0 - t * 0.5 + 30.0) - 0.5;
    vec2 glassOffset = vec2(
        warp1 * 0.008 + warp2 * 0.004,
        warp1 * 0.006 + warp2 * 0.004
    );

    vec2 baseUV = uv + glassOffset;

    // Shared flow warp (single computation for all channels)
    vec2 flow = flowField(baseUV, t);
    vec2 warpedUV = baseUV + flow;

    // === AURORA MODULATION ===
    float auroraTime = iTime * 0.02;

    // Flow-warped aurora (reuses existing flow field - zero extra cost)
    vec2 auroraUV = uv + flow * 0.4;
    float aurora = smoothNoise(auroraUV * 0.5 + auroraTime * 0.25) * 0.6
                 + smoothNoise(auroraUV * 0.95 + auroraTime * 0.12 + 50.0) * 0.4;

    // Remap to useful range: 0.6 to 1.4 (subtle variation around 1.0)
    float auroraIntensity = 0.6 + aurora * 0.8;

    // Aurora also rotates chromatic direction slightly for color variation
    float auroraAngle = (aurora - 0.5) * 0.5;  // -0.25 to +0.25 radians
    float cosA = cos(auroraAngle);
    float sinA = sin(auroraAngle);

    // chromatic spread (now modulated by aurora intensity)
    float chroma = (0.02 + breath * 0.05) * auroraIntensity;

    // Base offsets
    vec2 rBase = vec2(chroma, chroma * 0.4);
    vec2 bBase = vec2(-chroma * 0.9, chroma * 0.5);

    // Rotate offsets by aurora angle for directional color variation
    vec2 rOff = vec2(rBase.x * cosA - rBase.y * sinA, rBase.x * sinA + rBase.y * cosA);
    vec2 bOff = vec2(bBase.x * cosA - bBase.y * sinA, bBase.x * sinA + bBase.y * cosA);

    // time base for blob evolution
    float zBase = t * 0.5;

    // Per-instance spatial offset for window uniqueness.
    float resSeed = hash21(iResolution.xy * 0.1);
    vec2 instanceOffset = vec2(resSeed, hash21(iResolution.xy * 0.1 + 71.0)) * 100.0
                        + vec2(GRAIN_SEED * 73.0, GRAIN_SEED * 137.0);

    // Frame-timing jitter for per-window decorrelation.
    float frameSeed = fract(iTimeDelta * 123456.789);
    vec2 frameJitter = vec2(frameSeed, fract(frameSeed * 7.319)) * 0.001;

    // ── THE FROST RIDES THE MEDIUM ──────────────────────────────────────
    // The grain was the last thing in this stack that participated in
    // nothing: its own noise field, its own warp, added in pixel space. It
    // was 10% of the visible texture and interacted with none of it.
    //
    // It cannot contribute ∇Φ *to* the stack — smoothNoise is only C¹, and
    // differencing it puts the cell grid back on screen, which is the exact
    // crease the FROSTED_LEGACY perf pass removed. But that blocks only one
    // direction. The stack can deflect the FROST, which needs no derivative
    // of the noise at all: sample the blob field at the coordinate the swell
    // bent this ray to, and the frost crenellates along the same coarse
    // structure the filaments and the glass folds follow.
    //
    // This is the roadmap's own phrasing, finally true: a coarse swell
    // decides where the filaments run, a fine frost decides how they
    // crenellate. Its rendering is untouched — the frost stays the cherished
    // non-physical artifact it always was; only where it is sampled changes.
    vec2 grainUV = warpedUV + instanceOffset + frameJitter + FROST_RIDE * dSky;

    // 4 overlapping blob scales, per channel - using frosted (soft) sampling
    float r = layerGrainFrosted(grainUV + rOff, 40.0, 0.0,  zBase)
            + layerGrainFrosted(grainUV + rOff, 25.0, 10.0, zBase) * 0.8
            + layerGrainFrosted(grainUV + rOff, 60.0, 5.0,  zBase) * 0.5
            + layerGrainFrosted(grainUV + rOff, 15.0, 55.0, zBase) * 0.9;

    float g = layerGrainFrosted(grainUV,        40.0, 20.0, zBase)
            + layerGrainFrosted(grainUV,        25.0, 30.0, zBase) * 0.8
            + layerGrainFrosted(grainUV,        60.0, 25.0, zBase) * 0.5
            + layerGrainFrosted(grainUV,        15.0, 65.0, zBase) * 0.9;

    float b = layerGrainFrosted(grainUV + bOff, 40.0, 40.0, zBase)
            + layerGrainFrosted(grainUV + bOff, 25.0, 50.0, zBase) * 0.8
            + layerGrainFrosted(grainUV + bOff, 60.0, 45.0, zBase) * 0.5
            + layerGrainFrosted(grainUV + bOff, 15.0, 75.0, zBase) * 0.9;

    vec3 grain = vec3(r, g, b) / 3.2;

    // apply grain effect
    color.rgb += (grain - 0.5) * 0.055;


    // ════════════════════════════════════════════════════════════════════
    //  THE FIELDS — coarse first, then fine at the deflected coordinate
    // ════════════════════════════════════════════════════════════════════

    // ── WHERE THE FIFTH SOURCE SITS ─────────────────────────────────────
    //
    // Its rest position is a small slow orbit AROUND THE CURSOR, not a fixed
    // point on screen. That distinction is the fix for a real bug: with an
    // absolute home, `attach` stepping 0.5 -> 1.0 the instant a key lands
    // after an idle moved the source half the screen in ONE FRAME. Measured at
    // 0.00513 — 8.7x a normal keystroke, and a third of the old impulse spike
    // this whole design existed to remove. CURSOR_SMOOTH eases cell-to-cell
    // moves but never touched the attach term.
    //
    // Anchoring rest to the cursor bounds the excursion at REST_RADIUS instead
    // of at the screen diagonal, so the worst case is (1-ATTACH_FLOOR)*RADIUS.
    // It also reads better: the ripple stays where you were working and wanders
    // lazily, rather than flying off to a corner and being hauled back.
    float orbH = iTime * (0.013 + 0.007 * 4.0);
    vec2 restOff = vec2(cos(orbH + 6.8), sin(orbH * 1.3 + 9.6)) * REST_RADIUS;

    vec2 pc = vec2(0.5 * aspect, 0.5) + restOff;
    if (iCurrentCursor.z > 0.0) {
        // Ghostty reports xy as the top-left of the cursor rect in pixels and
        // zw as its size. The cursor moves in whole cells, so a source pinned
        // straight to it TELEPORTS ~9px once per character — that is the
        // jitter. iPreviousCursor gives a two-sample history (cursor-comet
        // already relies on it), which is exactly enough to ease between them.
        // Typing faster than CURSOR_SMOOTH simply leaves the source trailing
        // sub-cell behind the caret, moving continuously instead of stepping.
        vec2 cur = (iCurrentCursor.xy  + vec2(iCurrentCursor.z,  -iCurrentCursor.w)  * 0.5)
                 / iResolution.xy;
        vec2 prv = (iPreviousCursor.xy + vec2(iPreviousCursor.z, -iPreviousCursor.w) * 0.5)
                 / iResolution.xy;
        vec2 eased = mix(prv, cur, smoothstep(0.0, CURSOR_SMOOTH, age));
        vec2 pcur = vec2(eased.x * aspect, eased.y);

        // THE PLATEAU, APPLIED TO MOTION. Together the two curves are the
        // /‾‾‾‾\ that the depth gate could only ever draw for brightness:
        //
        //   /     CURSOR_SMOOTH eases the source up to speed behind the caret
        //   ‾‾‾‾  while keys keep arriving it simply tracks — no attack to
        //         re-fire, no decay to restart, so a burst cannot stack
        //   \     HOLD seconds after the last one it drifts back to `home`
        //         over RELEASE, so motion decays to nothing instead of
        //         stopping dead
        //
        // This moves the source's POSITION, never its mass — and mass is what
        // sets mean(m), so the envelope is nearly free of brightness pumping.
        // Nearly, not exactly: measured, E[m_raw] is 0.949 attached and 0.904
        // at home, because moving a source does slightly change how it
        // interferes with the other four. That is 0.17% of background luma
        // across a 6s glide, far under anything visible, and CAUSTIC_DC is set
        // between the two states so neither end drifts far. Worth knowing it
        // is not zero, since a bigger ATTACH excursion would make it matter.
        //
        // ATTACH_FLOOR bounds how far it drifts off the caret once settled.
        // Combined with the cursor-relative rest position above, the largest
        // step this can ever take is (1-ATTACH_FLOOR)*REST_RADIUS.
        float attach = 1.0 - (1.0 - ATTACH_FLOOR)
                     * smoothstep(HOLD, HOLD + RELEASE, age);
        pc = pcur + restOff * (1.0 - attach);
    }


    // ── SCREEN 2: the glass, at the deflected coordinate ──
    // The sample point moves; `pc` does not. We are asking what the glass
    // field — whose fifth source sits at the caret — is doing at the position
    // the swell deflected this ray to.
    vec2 pf = pShim;
#if SCREEN_SWELL && COUPLE_SWELL
    pf += COUPLING * gSky;
#endif

    // Declared outside the SCREEN_GLASS guard: the DC correction below reads
    // it whether or not the glass screen is compiled in. (check_compile found
    // this — with SCREEN_GLASS 0 it was an undeclared identifier.)
    float thick = 1.0 + INK_THICK * smoothstep(0.05, 0.30, ink);

    vec2 grad;
    vec3 H;
#if SCREEN_GLASS
    causticField(pf, pc, iTime, grad, H);

    // ── ink AS OPTICAL THICKNESS ────────────────────────────────────────
    // `ink` used to scale `depth`, which is brightness: written regions got a
    // deeper modulation of the same field. This scales FOCUS, which is the
    // field itself — so text makes the medium genuinely DENSER, moving where
    // det J crosses zero rather than how bright the crossing is. Written
    // regions grow their own fold structure instead of being lit harder.
    //
    // Scaling FOCUS is NOT flux-neutral the way scaling depth is: E[-log det]
    // goes as the square of the Hessian scale, so a spatially varying FOCUS
    // varies the DC and would pump the black level around your text — the
    // exact failure this design has spent three rounds eliminating.
    //
    // It is affordable only because the DC is DERIVED rather than measured.
    // The analytic form tracks FOCUS², so the correction is closed-form and
    // can be evaluated per pixel. This is the payoff for that choice.
    H *= FOCUS * thick;
#else
    grad = vec2(0.0);
    H = vec3(0.0);
#endif

    vec2 e = BLUR_RADIUS / iResolution.xy;
    vec3 nearLight = texture(iChannel0, uv + vec2( e.x,  e.y)).rgb
                   + texture(iChannel0, uv + vec2(-e.x,  e.y)).rgb
                   + texture(iChannel0, uv + vec2( e.x, -e.y)).rgb
                   + texture(iChannel0, uv + vec2(-e.x, -e.y)).rgb;
    nearLight *= 0.25;
    // Gated above the background floor. #0f0a1a is luma ≈ 0.052 and a floor is
    // not light — the same reading that made the first build tile the frame,
    // and the same one `heat` hit in field.syrinx.
    float nearLum = dot(nearLight, vec3(0.299, 0.587, 0.114));
    float lit = smoothstep(0.06, 0.20, nearLum);
    nearLight *= lit;

    // Guarded: before ghostty populates the cursor uniforms iTimeCursorChange
    // is 0, so age is huge and the gate rests at CALM_FLOOR. Calm is the right
    // fallback for a reading we do not have.
    float gate = mix(1.0, CALM_FLOOR, smoothstep(HOLD, HOLD + RELEASE, age));

    float depth = CAUSTIC_GAIN * (CALM_DEPTH + INK_DEPTH * lit) * gate;


    // ── THE SHARED MAGNIFICATION ──
    // Determinants multiply, so the log-magnifications add. This is the term
    // that two passes could never produce: the sky is no longer light laid
    // over the glass, it is part of the same ratio.
    // No branch: at SKY_MAG = 0 this is det(I) = 1 identically, which is the
    // uncoupled case, so the same arithmetic serves both.
    float sxx = 1.0 + SKY_MAG * Hs.x;
    float syy = 1.0 + SKY_MAG * Hs.y;
    float sxy = SKY_MAG * Hs.z;
    float detSwell = sxx * syy - sxy * sxy;

    // The shimmer is a screen like any other, so its determinant multiplies in
    // and its log-magnification adds. This is the part the old shear could
    // never do: a phase screen focuses as well as bends, which is why heat
    // haze has bright bands and not just wobble.
#if SCREEN_SHIMMER
    detSwell *= (1.0 + Hshim.x) * (1.0 + Hshim.y) - Hshim.z * Hshim.z;
#endif

    // Blue bends most — normal dispersion, and the only place colour enters
    // the caustic. Applied to the glass Hessian only: giving each channel its
    // own path through both screens needs three independent accumulations of
    // ∇Φ, ~27 radial evaluations instead of ~9, for a fringe on the coarse
    // field that nothing else in the design asks for.
    // heat modulates the index spread. Clamped at 0: a negative spread is not
    // "less dispersion", it swaps which channel bends most, and green-heavy
    // output should calm the medium rather than invert it.
    float disp = max(0.0, DISPERSION * (1.0 + HEAT_DISP * heat));

    vec3 m = vec3(0.0);
#if CAUSTIC_ENABLED
    m = vec3(
        magnifyTotal(H, 1.0 - disp, detSwell),
        magnifyTotal(H, 1.0,        detSwell),
        magnifyTotal(H, 1.0 + disp, detSwell)
    );
    // The DC follows the local thickness, closed-form. CAUSTIC_DC is the
    // thick = 1 reference (and what check_shared.py verifies); this adds the
    // FOCUS² correction where the medium is denser.
    float dcLocal = CAUSTIC_DC + DC_GLASS_UNIT * (thick * thick - 1.0);
    m -= vec3(dcLocal);

    // The shared-shift bound — see the CHROMA_PRESERVE block above. A uniform
    // branch on a const: at 0.0 the compiler strips it and m is bit-identical
    // to the hard clamp. CHROMA_SHIFT_DC is subtracted (its values are
    // negative) so the scheme's lower E[m] is paid back per channel.
    if (CHROMA_PRESERVE > 0.0) {
        vec3 dv = vec3(detJ(H, 1.0 - disp), detJ(H, 1.0), detJ(H, 1.0 + disp))
                * detSwell;
        vec3 u  = -log(max(abs(dv), vec3(1e-6)));
        float fm = -log(FOLD_FLOOR);
        float hi = max(u.r, max(u.g, u.b));
        float lo = min(u.r, min(u.g, u.b));
        float sh = max(0.0, hi - fm) - max(0.0, -fm - lo);
        vec3 ms = clamp(u - sh, vec3(-fm), vec3(fm))
                - vec3(dcLocal) - CHROMA_SHIFT_DC;
        m = mix(m, ms, CHROMA_PRESERVE);
    }
#endif

    // ── APPLIED IN PLACE, MULTIPLICATIVELY ──
    //
    // The obvious implementation gathers light from where the ray came from,
    // uv - ∇φ, and adds it here. That is what the optics says, and it looked
    // wrong: a displaced point-sample returns the SHAPE of the glyph that
    // cast the light, so the screen filled with faint but *readable* ghost
    // words hanging beside the real ones. Blurring the gather enough to
    // destroy legibility costs far more taps than the effect is worth.
    //
    // The fix is to stop pretending the glass is far away. This shader models
    // blobs behind glass sitting ON the text, and for a phase screen in
    // contact with the image plane the deflection is negligible while the
    // magnification is not: light is redistributed locally, in place.
    //
    // That makes it multiplicative, which turns out to be the whole ballgame:
    //
    //   · no gather, no throw, no ghosts, and no extra texture taps at all.
    //   · a ratio preserves contrast exactly, so legibility is guaranteed by
    //     construction rather than by a fudge factor — the destInk guard the
    //     additive version needed is simply gone.
    //   · the background can only be scaled in proportion to itself, so the
    //     "background is not a light source" bug cannot recur here. It does
    //     still ripple — #0f0a1a is not black — but bounded and mean-zero,
    //     rather than having absolute light invented on top of it.
    //
    // What it gives up is light thrown into the gaps between lines. SPILL
    // buys that back without the ghosting, because it is centred rather than
    // displaced — a caustic-modulated bloom is just a glow around the text,
    // which is what it should have looked like in the first place.
    //
    // `depth` rather than a constant gain is what makes the substrate visible.
    // Scaling it is exactly flux-neutral: m is already centred, so the mean of
    // (1 + depth·m) is 1 for ANY depth, including one that varies across the
    // screen. The surface can get deeper or calmer without the black level
    // moving a step — which is the property that lets it respond at all
    // without reintroducing the brightness pumping the DC subtraction fixed.
    color.rgb *= 1.0 + depth * m;

    if (SPILL_GAIN > 0.0) {
        color.rgb += max(m, vec3(0.0)) * nearLight * SPILL_GAIN * gate;
    }

#if DEBUG_CAUSTIC == 1
    float dd = detJ(H, 1.0) * detSwell;
    vec3 dbg = vec3(smoothstep(0.0, 2.5, abs(dd)));
    dbg = mix(dbg, vec3(1.0, 0.18, 0.42), step(abs(dd), FOLD_FLOOR * 1.6));
    fragColor = vec4(dbg, 1.0); return;
#elif DEBUG_CAUSTIC == 2
    fragColor = vec4(max(m, vec3(0.0)) * 0.5, 1.0); return;
#elif DEBUG_CAUSTIC == 3
    fragColor = vec4(vec3(length(grad) * 40.0), 1.0); return;
#endif

    // ════════════════════════════════════════════════════════════════════
    //  THE SKY'S EMISSION — still additive, and deliberately so
    // ════════════════════════════════════════════════════════════════════
    // A purely multiplicative sky vanishes on an empty screen: a ratio on a
    // 0.05-luma background is nothing. The magnification above is how the sky
    // acts ON the medium; this is how you see it.
    // ── THE THREE LAYERS, all radii around the same curve ───────────────
    // GAUSSIAN falloff. Three profiles were tried and the reasoning matters,
    // because each failure was a different shape of wrong:
    //
    //   smoothstep(R,0,d)  flat saturated core, hard edge at d=R. That is an
    //                      OBJECT WITH A BOUNDARY, and no amount of dimming
    //                      changes it — a dim neon tube is still a tube.
    //   exp(-d/R)          fixed the core, broke the floor. It never reaches
    //                      zero, so the mean over the WHOLE screen was 0.23 —
    //                      a uniform lift of the black level that washed out
    //                      everything underneath, the grain included.
    //   exp(-(d/R)²)       soft peak, no plateau, no edge, and a tail that
    //                      actually dies: 0.018 at 2R where the exponential
    //                      was still at 0.135.
    //
    // The lesson is that a profile has to be judged by its MEAN, not its peak.
    // The peak is what you notice; the mean is what quietly raises the floor
    // the rest of the stack has to sit on top of.
    float gas = 0.0, fil = 0.0, star = 0.0;
#if LAYER_GAS
    // Note what "gas" actually is here: not independent structure, but a WIDER
    // HALO AROUND THE SAME FOLDS. There is only one field, so a second radius
    // cannot invent a second phenomenon. It is filament glow, and treating it
    // as a nebula is what let its tail get out of hand.
    float gGas = dFold / R_GAS;
    gas = exp(-gGas * gGas);
#endif
#if LAYER_FILAMENTS
    float f = dFold / R_FILAMENT;
    fil = exp(-f * f);
#endif
#if LAYER_STARS
    star = smoothstep(R_STAR, 0.0, dFold) * smoothstep(A_CUSP, 0.0, align);
    // Squared, not cubed. Cusps are ALREADY points — measured at 2px median
    // across 67 of them — so sharpening further just crushed them below
    // visibility. The distribution is bimodal: most are sharp, a minority are
    // near-degenerate stretches of fold that read as small glows. That spread
    // is doing the work a per-star brightness hash used to do, for free.
    star *= star;
#endif


#if DEBUG_SKY == 1
    fragColor = vec4(vec3(smoothstep(0.0, 3.0, abs(detS))), 1.0); return;
#elif DEBUG_SKY == 2
    fragColor = vec4(vec3(smoothstep(0.25, 0.0, dFold)), 1.0); return;
#elif DEBUG_SKY == 3
    fragColor = vec4(vec3(smoothstep(0.35, 0.0, align)), 1.0); return;
#elif DEBUG_SKY == 4
    fragColor = vec4(fil, star, gas, 1.0); return;
#endif

    // ── COLOUR ──────────────────────────────────────────────────────────
    // Hue is the substrate. Not a per-wisp hash on a timer — the red<->green
    // balance of whatever is written nearby, plus a slow global drift.
    float hue = 0.34 + iTime * 0.0035 + heat * HEAT_SWING + gas * 0.22;
    vec3 gasCol = skyPalette(hue);
    vec3 filCol = skyPalette(hue + 0.14);

    vec3 sky = gasCol * gas * GAS_GAIN
             + filCol * fil * FIL_GAIN;

    // Stars take their colour from the field too, but desaturated toward white
    // the brighter they get — the same thing a real overexposed point does.
    vec3 starCol = mix(skyPalette(hue + 0.5), vec3(1.0), 0.35);
    sky += starCol * star * STAR_GAIN;

    // The sky parts around text, exactly as before.
    sky *= 1.0 - TEXT_AWARE * smoothstep(0.075, 0.26, ink);

    sky = softCeil(sky, SKY_CEILING * 0.5, SKY_CEILING);
    color.rgb += sky;


    // vignette
    vec2 center = uv - 0.5;
    float dist = dot(center, center);
    color.rgb *= 1.0 - dist * 0.1;

    fragColor = mix(_bootSrc, vec4(color.rgb, color.a), smoothstep(1.5, 3.0, iTime));
}
