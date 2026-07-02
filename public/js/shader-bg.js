/**
 * shader-bg.js - MEGA SHADER: luxia violet edition (perf pass 2026-07-02)
 * Combined: Starfield + Grain/Aurora + Moiré + CRT finishing
 * Re-derived from the Ghostty shader stack (~/.config/ghostty/shaders):
 *   starfield-depth.perfpass.glsl + grain.perfpass.glsl + moire-radial.glsl
 *
 * Perf notes (vs previous version):
 * - Grain layer ported from grain.perfpass.glsl: layerGrainFast() is ONE
 *   smoothNoise sample per layer instead of the frosted-cell bilinear
 *   (4x blobNoise x 2x smoothNoise = 8 per layer). 12 layers -> ~8x less ALU
 *   on the dominant layer.
 * - Aurora chroma rotation uses the small-angle approximation (angle is only
 *   ±0.25 rad) — no per-pixel sin/cos.
 * - JS side: renders at RESOLUTION_SCALE of CSS pixels (soft background —
 *   upscaling is invisible), 24fps cap, fully pauses when the tab is hidden
 *   or the effect is toggled off, static single frame for
 *   prefers-reduced-motion.
 */

(function() {
  'use strict';

  // Backbuffer scale relative to CSS pixels (not devicePixelRatio).
  // 0.6 ≈ 2.8x fewer fragments than 1.0, ~6x fewer than the old 1.5x dpr.
  const RESOLUTION_SCALE = 0.6;
  const TARGET_FPS = 24;

  const vertexShaderSource = `#version 300 es
    in vec2 a_position;
    out vec2 v_uv;

    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // ═══════════════════════════════════════════════════════════════════════════
  // MEGA FRAGMENT SHADER
  // Layer order: Starfield → Grain/Aurora → Moiré → CRT Post
  // ═══════════════════════════════════════════════════════════════════════════
  const fragmentShaderSource = `#version 300 es
    precision highp float;

    uniform vec2 u_resolution;
    uniform float u_time;

    in vec2 v_uv;
    out vec4 fragColor;

    const float TAU = 6.28318530718;

    // ═══════════════════════════════════════════════════════════════════════
    // SHARED UTILITIES
    // ═══════════════════════════════════════════════════════════════════════

    float hash11(float p) {
      p = fract(p * 0.1031);
      p *= p + 33.33;
      p *= p + p;
      return fract(p);
    }

    float hash21(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }

    float noise1(float x) {
      float i = floor(x);
      float f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(hash11(i), hash11(i + 1.0), f);
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

    // Random unit vector without trig
    vec2 randDir(float seed) {
      vec2 v = vec2(hash11(seed) * 2.0 - 1.0, hash11(seed + 17.0) * 2.0 - 1.0);
      return v * inversesqrt(dot(v, v) + 1e-6);
    }

    // Cheap triangular wave [0..1]
    float tri01(float x) {
      float f = fract(x);
      return 1.0 - abs(f * 2.0 - 1.0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LAYER 1: STARFIELD DEPTH (from starfield-depth.perfpass.glsl)
    // Stars + dust wisps approaching from central vanishing point.
    // No per-star trig: randDir + squared-distance falloff + triangle twinkle.
    // ═══════════════════════════════════════════════════════════════════════

    vec3 starfieldLayer(vec2 uv, float time) {
      vec2 center = vec2(0.5, 0.5);
      vec3 starLight = vec3(0.0);

      const int NUM_STARS = 25;
      float baseSpeed = 0.012;
      float tBase = time * baseSpeed;

      for (int i = 0; i < NUM_STARS; i++) {
        float seed = float(i);
        vec2 dir = randDir(seed);

        float speedVar = 0.7 + hash11(seed + 100.0) * 0.6;
        float birthOffset = hash11(seed + 200.0);
        float depth = fract(tBase * speedVar + birthOffset);

        vec2 starPos = center + dir * depth * 0.55;

        vec2 dv = uv - starPos;
        float d2 = dot(dv, dv);

        float starSize = 0.0008 + depth * depth * 0.006;
        float starSize2 = starSize * starSize;

        float envelope = smoothstep(0.0, 0.15, depth) * smoothstep(1.0, 0.75, depth);

        float twFreq = 2.0 + hash11(seed + 400.0) * 3.0;
        float twinkle = 0.7 + 0.3 * tri01(time * twFreq + seed * 0.13);

        float core = smoothstep(starSize2, 0.0, d2);
        float brightness = core * envelope * twinkle * 0.35;

        // Subtle color variation
        vec3 starColor = vec3(0.9, 0.85, 1.0) + vec3(hash11(seed + 500.0) - 0.5) * 0.2;
        starLight += brightness * starColor;
      }

      // Dust wisps
      float dustTime = time * 0.006;
      for (int j = 0; j < 3; j++) {
        float dustSeed = float(j) * 100.0;
        vec2 dustDir = randDir(dustSeed + 3.0);

        float dustSpeed = 0.4 + hash11(dustSeed + 10.0) * 0.4;
        float dustBirth = hash11(dustSeed + 20.0);
        float dustDepth = fract(dustTime * dustSpeed + dustBirth);

        vec2 dustPos = center + dustDir * dustDepth * 0.5;

        vec2 dv = uv - dustPos;
        float dd2 = dot(dv, dv);

        float dustSize = 0.04 + dustDepth * 0.12;
        float dustSize2 = dustSize * dustSize;

        float dustAlpha = smoothstep(dustSize2, (dustSize * 0.3) * (dustSize * 0.3), dd2);
        dustAlpha *= smoothstep(0.0, 0.2, dustDepth) * smoothstep(1.0, 0.6, dustDepth);

        vec3 dustColor = mix(vec3(0.5, 0.4, 0.6), vec3(0.4, 0.5, 0.6), hash11(dustSeed + 30.0));
        starLight += dustAlpha * dustColor * 0.025;
      }

      return starLight;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LAYER 2: GRAIN WITH AURORA MODULATION (from grain.perfpass.glsl)
    // Fast frosted blobs: ONE continuous value-noise sample per layer with
    // smoothstep shaping, instead of the old bilinear-over-cells blobNoise
    // (~8 smoothNoise per layer). Visual character preserved, ~8x cheaper.
    // ═══════════════════════════════════════════════════════════════════════

    vec2 flowField(vec2 uv, float t) {
      vec2 q = uv * 1.5 + t * 0.3;
      float nx = smoothNoise(q);
      float ny = smoothNoise(q + 50.0);

      float strengthMod = smoothNoise(uv * 0.3 + t * 0.05) * 0.6
                        + smoothNoise(uv * 0.7 + t * 0.03 + 100.0) * 0.4;
      strengthMod = 0.3 + strengthMod * 1.4;

      return (vec2(nx, ny) - 0.5) * 0.35 * strengthMod;
    }

    float layerGrainFast(vec2 uv, float scale, float seed, float zBase) {
      // Tiny per-seed offset breaks banding when multiple layers share scale.
      vec2 seedOff = vec2(seed * 0.00012, seed * 0.00009);

      float z = zBase + seed * 0.07;

      // The old frosted sampler effectively sampled at cellId * 0.12 —
      // fold that into the scale so spatial frequency stays similar.
      float s = scale * 0.12;

      // Seed as a 2D offset (avoid correlated axes)
      vec2 seed2 = vec2(seed * 1.37, seed * 2.11);

      // Smooth time evolution: drift the noise input with z
      // (replaces the old 3D slice interpolation).
      vec2 p = (uv + seedOff) * s + seed2 + vec2(z * 17.0, z * 37.0);

      float n = smoothNoise(p);

      // Shape into softer blobs (keeps the "dense chromatic pools" feel)
      return smoothstep(0.20, 0.85, n);
    }

    vec3 grainAuroraLayer(vec2 uv, float time) {
      float t = time * 0.10;

      // Breathing (time-only -> cheap 1D noise)
      float breath = sin(time * 0.1) * 0.5 + 0.5;
      breath *= 0.7 + noise1(time * 0.04) * 0.3;

      // Glass warp
      float warp1 = smoothNoise(uv * 3.0 + t * 0.8) - 0.5;
      float warp2 = smoothNoise(uv * 5.0 - t * 0.5 + 30.0) - 0.5;
      vec2 glassOffset = vec2(
        warp1 * 0.008 + warp2 * 0.004,
        warp1 * 0.006 + warp2 * 0.004
      );

      vec2 baseUV = uv + glassOffset;
      vec2 flow = flowField(baseUV, t);
      vec2 warpedUV = baseUV + flow;

      // Aurora modulation (very slow drift)
      float auroraTime = time * 0.02;
      float aurora = smoothNoise(uv * 0.4 + vec2(auroraTime, auroraTime * 0.7)) * 0.6
                   + smoothNoise(uv * 0.8 + vec2(-auroraTime * 0.5, auroraTime * 0.3) + 50.0) * 0.4;
      float auroraIntensity = 0.6 + aurora * 0.8;

      // Aurora rotates chromatic direction slightly: angle in [-0.25, +0.25]
      // rad -> small-angle approximation, no sin/cos.
      float auroraAngle = (aurora - 0.5) * 0.5;
      float sinA = auroraAngle;
      float cosA = 1.0 - 0.5 * auroraAngle * auroraAngle;

      // Chromatic spread with aurora modulation
      float chroma = (0.02 + breath * 0.05) * auroraIntensity;
      vec2 rBase = vec2(chroma, chroma * 0.4);
      vec2 bBase = vec2(-chroma * 0.9, chroma * 0.5);

      vec2 rOff = vec2(rBase.x * cosA - rBase.y * sinA, rBase.x * sinA + rBase.y * cosA);
      vec2 bOff = vec2(bBase.x * cosA - bBase.y * sinA, bBase.x * sinA + bBase.y * cosA);

      float zBase = t * 0.5;

      // 4 overlapping blob scales per channel — each ONE noise sample now
      float r = layerGrainFast(warpedUV + rOff, 40.0, 0.0, zBase)
              + layerGrainFast(warpedUV + rOff, 25.0, 10.0, zBase) * 0.8
              + layerGrainFast(warpedUV + rOff, 60.0, 5.0, zBase) * 0.5
              + layerGrainFast(warpedUV + rOff, 15.0, 55.0, zBase) * 0.9;

      float g = layerGrainFast(warpedUV, 40.0, 20.0, zBase)
              + layerGrainFast(warpedUV, 25.0, 30.0, zBase) * 0.8
              + layerGrainFast(warpedUV, 60.0, 25.0, zBase) * 0.5
              + layerGrainFast(warpedUV, 15.0, 65.0, zBase) * 0.9;

      float b = layerGrainFast(warpedUV + bOff, 40.0, 40.0, zBase)
              + layerGrainFast(warpedUV + bOff, 25.0, 50.0, zBase) * 0.8
              + layerGrainFast(warpedUV + bOff, 60.0, 45.0, zBase) * 0.5
              + layerGrainFast(warpedUV + bOff, 15.0, 75.0, zBase) * 0.9;

      vec3 grain = vec3(r, g, b) / 3.2;

      // 0.36 (was 0.42): the fast grain variant has punchier pools than the
      // old frosted average — trimmed so the background stays behind the text.
      return (grain - 0.5) * 0.36;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LAYER 3: MOIRÉ RADIAL INTERFERENCE (from moire-radial.glsl)
    // Hypnotic concentric ring interference; params synced to the local copy
    // (RING_FREQUENCY 200, CENTER_SEPARATION 0.025), blend strengths kept
    // from the panel tuning since this runs behind UI content.
    // ═══════════════════════════════════════════════════════════════════════

    float moireLayer(vec2 uv, float time, float aspect) {
      const float RING_FREQUENCY = 200.0;
      const float CENTER_SEPARATION = 0.025;
      const float DRIFT_SPEED = 0.006;
      const float BREATHE_SPEED = 0.02;

      vec2 centered = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
      float t = time * DRIFT_SPEED;

      // Two orbiting ring centers
      float orbitAngle = t * 0.5;
      vec2 offset = vec2(cos(orbitAngle), sin(orbitAngle * 0.7)) * CENTER_SEPARATION * 0.5;

      vec2 centerA = offset;
      vec2 centerB = -offset;

      float distA = length(centered - centerA);
      float distB = length(centered - centerB);

      float breathe = sin(time * BREATHE_SPEED) * 0.02;

      float ringsA = sin((distA + breathe) * RING_FREQUENCY * TAU);
      float ringsB = sin((distB - breathe * 0.7) * RING_FREQUENCY * TAU);

      float interference = ringsA * ringsB;
      float moire = (interference * 0.5 + 0.5);
      moire = smoothstep(0.4, 0.7, moire);

      // Secondary layer to break symmetry
      vec2 centerC = vec2(0.03, -0.02);
      float distC = length(centered - centerC);
      float ringsC = sin(distC * RING_FREQUENCY * 0.85 * TAU);
      float interference2 = ringsA * ringsC;
      float moire2 = smoothstep(0.4, 0.7, interference2 * 0.5 + 0.5) * 0.6;

      moire = mix(moire, moire2, 0.4);

      // Soft radial falloff - effect lives in a ring
      float edgeDist = length(centered);
      float falloff = smoothstep(0.1, 0.3, edgeDist) * smoothstep(0.9, 0.5, edgeDist);
      moire *= falloff;

      return moire * 0.035;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LAYER 4: CRT POST-PROCESSING
    // Scanlines, heat shimmer, vignette, power flicker
    // ═══════════════════════════════════════════════════════════════════════

    vec3 crtPostProcess(vec3 color, vec2 uv, vec2 fragCoord, float time) {
      // Heat shimmer (bottom rises)
      float heatTime = time * 0.12;
      float heatStrength = (1.0 - uv.y) * 0.0012;
      vec2 heatAngles = vec2(
        uv.x * 12.0 + heatTime * 2.0 + uv.y * 3.0,
        uv.x * 7.0 - heatTime * 1.3 + uv.y * 5.0
      );
      vec2 heatS = sin(heatAngles);
      float heatShimmer = (heatS.x + heatS.y * 0.6) * heatStrength;

      // Apply shimmer as subtle color shift
      color.r += heatShimmer * 0.5;
      color.b -= heatShimmer * 0.3;

      // Scanlines
      float scanline = sin(fragCoord.y * 1.5) * 0.03 + 1.0;
      float interlace = sin(fragCoord.y * 0.5 + time * 4.0) * 0.015 + 1.0;
      color *= scanline * interlace;

      // VHS warmth - slight magenta/violet push
      color = mix(color, color * vec3(1.04, 0.98, 1.06), 0.3);

      // Vignette
      vec2 center = uv - 0.5;
      float dist2 = dot(center, center);
      color *= 1.0 - dist2 * 0.4;

      // Power flicker
      color *= 1.0 + sin(time * 45.0) * 0.003;

      // Subtle edge glow (inverted vignette for dreamy edges)
      float edgeGlow = smoothstep(0.2, 0.5, dist2) * 0.02;
      color += vec3(0.3, 0.2, 0.5) * edgeGlow;

      return color;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MAIN COMPOSITION
    // ═══════════════════════════════════════════════════════════════════════

    void main() {
      vec2 uv = v_uv;
      vec2 fragCoord = uv * u_resolution;
      float aspect = u_resolution.x / u_resolution.y;

      // Base color - deep violet void
      vec3 color = vec3(0.03, 0.015, 0.05);

      // Layer 1: Starfield (additive)
      color += starfieldLayer(uv, u_time);

      // Layer 2: Grain with aurora (additive chromatic)
      // 0.5x clock: layerGrainFast scrolls the noise field over time (the old
      // frosted sampler morphed slices in place), so the same rate reads as
      // roughly double the motion — halve it to match the old feel.
      color += grainAuroraLayer(uv, u_time * 0.5);

      // Layer 3: Moiré interference (subtle inversion blend)
      float moire = moireLayer(uv, u_time, aspect);
      vec3 inverted = 1.0 - color;
      color = mix(color, inverted, moire * 0.6);
      color += moire * 0.015; // slight luminance boost at interference peaks

      // Layer 4: CRT post-processing
      color = crtPostProcess(color, uv, fragCoord, u_time);

      // Final clamp
      color = clamp(color, 0.0, 1.0);

      fragColor = vec4(color, 1.0);
    }
  `;

  class ShaderBackground {
    constructor() {
      this.canvas = null;
      this.gl = null;
      this.program = null;
      this.startTime = Date.now();
      this.animationId = null;
      this.uniforms = {};
      this.enabled = true;
      this.running = false;

      this.lastFrameTime = 0;
      this.targetFPS = TARGET_FPS;
      this.frameInterval = 1000 / this.targetFPS;
      this.resolutionScale = RESOLUTION_SCALE;

      this.reducedMotion = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    init() {
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'shader-bg';
      this.canvas.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: -1;
        pointer-events: none;
      `;
      document.body.insertBefore(this.canvas, document.body.firstChild);

      this.gl = this.canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: false,
        powerPreference: 'low-power'
      });

      if (!this.gl) {
        console.warn('WebGL2 not supported, shader background disabled');
        this.canvas.remove();
        return false;
      }

      if (!this.createProgram()) {
        console.warn('Failed to create shader program');
        this.canvas.remove();
        return false;
      }

      this.setupGeometry();

      this.uniforms.resolution = this.gl.getUniformLocation(this.program, 'u_resolution');
      this.uniforms.time = this.gl.getUniformLocation(this.program, 'u_time');

      this.resize();
      window.addEventListener('resize', () => {
        this.resize();
        if (!this.running) this.drawFrame(); // keep static frame crisp
      });

      // Fully stop the loop when the tab is hidden — no wasted wakeups.
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.stop();
        } else if (this.enabled && !this.reducedMotion) {
          this.start();
        }
      });

      if (this.reducedMotion) {
        // Accessibility: render one static frame, no animation loop.
        this.drawFrame();
        console.log('✦ Mega shader: static frame (prefers-reduced-motion)');
      } else {
        this.start();
        console.log(`✦ Mega shader initialized (perfpass): ${this.targetFPS}fps @ ${this.resolutionScale}x`);
      }
      return true;
    }

    createShader(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    createProgram() {
      const gl = this.gl;

      const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
      const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

      if (!vertexShader || !fragmentShader) return false;

      this.program = gl.createProgram();
      gl.attachShader(this.program, vertexShader);
      gl.attachShader(this.program, fragmentShader);
      gl.linkProgram(this.program);

      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(this.program));
        return false;
      }

      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);

      return true;
    }

    setupGeometry() {
      const gl = this.gl;

      const vertices = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1
      ]);

      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      const positionLoc = gl.getAttribLocation(this.program, 'a_position');
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
    }

    resize() {
      // Render at a fraction of CSS pixels and let the browser upscale —
      // the background is soft, so the difference is invisible, and the
      // fragment count drops with the square of the scale.
      const width = Math.max(1, Math.round(window.innerWidth * this.resolutionScale));
      const height = Math.max(1, Math.round(window.innerHeight * this.resolutionScale));

      this.canvas.width = width;
      this.canvas.height = height;

      this.gl.viewport(0, 0, width, height);
    }

    drawFrame() {
      const gl = this.gl;
      const time = (Date.now() - this.startTime) / 1000;

      gl.useProgram(this.program);
      gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.uniforms.time, time);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.lastFrameTime = 0;
      this.animationId = requestAnimationFrame((t) => this.render(t));
    }

    stop() {
      this.running = false;
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
    }

    render(currentTime = 0) {
      if (!this.running) return;

      const elapsed = currentTime - this.lastFrameTime;
      if (elapsed >= this.frameInterval) {
        this.lastFrameTime = currentTime - (elapsed % this.frameInterval);
        this.drawFrame();
      }

      this.animationId = requestAnimationFrame((t) => this.render(t));
    }

    toggle(enabled) {
      this.enabled = enabled;
      this.canvas.style.display = enabled ? 'block' : 'none';
      // Actually stop the loop when hidden — the old version kept rAF spinning.
      if (enabled && !this.reducedMotion && !document.hidden) {
        this.start();
      } else {
        this.stop();
      }
    }

    /** Runtime quality knob: shaderBg.setQuality(0.4..1.0) */
    setQuality(scale) {
      this.resolutionScale = Math.min(Math.max(scale, 0.25), 1.5);
      this.resize();
      if (!this.running) this.drawFrame();
    }

    destroy() {
      this.stop();
      if (this.canvas) {
        this.canvas.remove();
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.shaderBg = new ShaderBackground();
      window.shaderBg.init();
    });
  } else {
    window.shaderBg = new ShaderBackground();
    window.shaderBg.init();
  }
})();
