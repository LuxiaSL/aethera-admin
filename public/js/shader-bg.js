/**
 * shader-bg.js - MEGA SHADER: luxia violet edition
 * Combined: Starfield + Grain/Aurora + Moiré + CRT finishing
 * Adapted from Ghostty shader stack for æthera admin
 */

(function() {
  'use strict';

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
    const float PI = 3.14159265359;
    
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
    // LAYER 1: STARFIELD DEPTH
    // Stars + dust wisps approaching from central vanishing point
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
    // LAYER 2: GRAIN WITH AURORA MODULATION
    // Frosted chromatic blobs with flowing aurora intensity
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
    
    float blobNoise(vec2 cellId, float z, float seed) {
      vec2 p = cellId * 0.12 + seed;
      float iz = floor(z);
      float fz = fract(z);
      fz = fz * fz * (3.0 - 2.0 * fz);
      
      vec2 o0 = vec2(iz * 17.0, iz * 37.0);
      vec2 o1 = vec2((iz + 1.0) * 17.0, (iz + 1.0) * 37.0);
      
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
    
    vec3 grainAuroraLayer(vec2 uv, float time) {
      float t = time * 0.10;
      
      // Breathing
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
      
      // Aurora modulation
      float auroraTime = time * 0.02;
      vec2 auroraUV = uv + flow * 0.4;
      float aurora = smoothNoise(auroraUV * 0.5 + auroraTime * 0.25) * 0.6
                   + smoothNoise(auroraUV * 0.95 + auroraTime * 0.12 + 50.0) * 0.4;
      float auroraIntensity = 0.6 + aurora * 0.8;
      
      float auroraAngle = (aurora - 0.5) * 0.5;
      float cosA = cos(auroraAngle);
      float sinA = sin(auroraAngle);
      
      // Chromatic spread with aurora modulation
      float chroma = (0.02 + breath * 0.05) * auroraIntensity;
      vec2 rBase = vec2(chroma, chroma * 0.4);
      vec2 bBase = vec2(-chroma * 0.9, chroma * 0.5);
      
      vec2 rOff = vec2(rBase.x * cosA - rBase.y * sinA, rBase.x * sinA + rBase.y * cosA);
      vec2 bOff = vec2(bBase.x * cosA - bBase.y * sinA, bBase.x * sinA + bBase.y * cosA);
      
      float zBase = t * 0.5;
      
      // 4 overlapping blob scales per channel
      float r = layerGrainFrosted(warpedUV + rOff, 40.0, 0.0, zBase)
              + layerGrainFrosted(warpedUV + rOff, 25.0, 10.0, zBase) * 0.8
              + layerGrainFrosted(warpedUV + rOff, 60.0, 5.0, zBase) * 0.5
              + layerGrainFrosted(warpedUV + rOff, 15.0, 55.0, zBase) * 0.9;
      
      float g = layerGrainFrosted(warpedUV, 40.0, 20.0, zBase)
              + layerGrainFrosted(warpedUV, 25.0, 30.0, zBase) * 0.8
              + layerGrainFrosted(warpedUV, 60.0, 25.0, zBase) * 0.5
              + layerGrainFrosted(warpedUV, 15.0, 65.0, zBase) * 0.9;
      
      float b = layerGrainFrosted(warpedUV + bOff, 40.0, 40.0, zBase)
              + layerGrainFrosted(warpedUV + bOff, 25.0, 50.0, zBase) * 0.8
              + layerGrainFrosted(warpedUV + bOff, 60.0, 45.0, zBase) * 0.5
              + layerGrainFrosted(warpedUV + bOff, 15.0, 75.0, zBase) * 0.9;
      
      vec3 grain = vec3(r, g, b) / 3.2;
      
      return (grain - 0.5) * 0.42;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // LAYER 3: MOIRÉ RADIAL INTERFERENCE
    // Hypnotic concentric ring interference patterns
    // ═══════════════════════════════════════════════════════════════════════
    
    float moireLayer(vec2 uv, float time, float aspect) {
      const float RING_FREQUENCY = 180.0;
      const float CENTER_SEPARATION = 0.02;
      const float DRIFT_SPEED = 0.005;
      const float BREATHE_SPEED = 0.015;
      
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
      color += grainAuroraLayer(uv, u_time);
      
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
      
      this.lastFrameTime = 0;
      this.targetFPS = 30;
      this.frameInterval = 1000 / this.targetFPS;
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
      window.addEventListener('resize', () => this.resize());

      this.render();

      console.log('✦ Mega shader initialized: Starfield + Grain/Aurora + Moiré + CRT');
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
      const dpr = Math.min(window.devicePixelRatio, 1.5);
      const width = window.innerWidth * dpr;
      const height = window.innerHeight * dpr;
      
      this.canvas.width = width;
      this.canvas.height = height;
      
      this.gl.viewport(0, 0, width, height);
    }

    render(currentTime = 0) {
      if (!this.enabled) {
        this.animationId = requestAnimationFrame((t) => this.render(t));
        return;
      }

      const elapsed = currentTime - this.lastFrameTime;
      if (elapsed < this.frameInterval) {
        this.animationId = requestAnimationFrame((t) => this.render(t));
        return;
      }
      this.lastFrameTime = currentTime - (elapsed % this.frameInterval);

      const gl = this.gl;
      const time = (Date.now() - this.startTime) / 1000;

      gl.useProgram(this.program);
      gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.uniforms.time, time);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      this.animationId = requestAnimationFrame((t) => this.render(t));
    }

    toggle(enabled) {
      this.enabled = enabled;
      this.canvas.style.display = enabled ? 'block' : 'none';
    }

    destroy() {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
      }
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
