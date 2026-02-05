/**
 * shader-bg.js - Frosted chromatic void background
 * Adapted from Ghostty terminal shader for æthera admin
 */

(function() {
  'use strict';

  // Vertex shader - simple fullscreen quad
  const vertexShaderSource = `#version 300 es
    in vec2 a_position;
    out vec2 v_uv;
    
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // Fragment shader - adapted from maybe_this_shader.glsl
  const fragmentShaderSource = `#version 300 es
    precision highp float;
    
    uniform vec2 u_resolution;
    uniform float u_time;
    
    in vec2 v_uv;
    out vec4 fragColor;
    
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
      
      // Spatial strength modulation
      float strengthMod = smoothNoise(uv * 0.3 + t * 0.05) * 0.6
                        + smoothNoise(uv * 0.7 + t * 0.03 + 100.0) * 0.4;
      strengthMod = 0.3 + strengthMod * 1.4;
      
      return (vec2(nx, ny) - 0.5) * 0.35 * strengthMod;
    }
    
    // 2D blob noise with smooth time evolution
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
    
    // Frosted layer grain
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
    
    void main() {
      vec2 uv = v_uv;
      
      // Start with black
      vec3 color = vec3(0.0);
      
      float t = u_time * 0.10;
      
      // Breathing
      float breath = sin(u_time * 0.1) * 0.5 + 0.5;
      breath *= 0.7 + noise1(u_time * 0.04) * 0.3;
      
      // Glass warp
      float warp1 = smoothNoise(uv * 3.0 + t * 0.8) - 0.5;
      float warp2 = smoothNoise(uv * 5.0 - t * 0.5 + 30.0) - 0.5;
      vec2 glassOffset = vec2(
        warp1 * 0.008 + warp2 * 0.004,
        warp1 * 0.006 + warp2 * 0.004
      );
      
      vec2 baseUV = uv + glassOffset;
      
      // Shared flow warp
      vec2 flow = flowField(baseUV, t);
      vec2 warpedUV = baseUV + flow;
      
      // Chromatic spread - matched to original, boosted for standalone background
      float chroma = 0.02 + breath * 0.05;
      vec2 rOff = vec2(chroma, chroma * 0.4);
      vec2 bOff = vec2(-chroma * 0.9, chroma * 0.5);

      float zBase = t * 0.5;

      // 4 overlapping blob scales per channel (matching original)
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

      // Base dark color with purple/blue tint (simulating terminal background)
      vec3 baseColor = vec3(0.04, 0.02, 0.06);
      color = baseColor;

      // Apply grain effect - boosted significantly for standalone background
      // Original uses 0.055 on existing content; we need ~5x to create the content itself
      color += (grain - 0.5) * 0.45;

      // Subtle color bias toward purple/magenta (matching terminal palette)
      color.r += 0.02;
      color.b += 0.03;

      // Vignette (matching original)
      vec2 center = uv - 0.5;
      float dist = dot(center, center);
      color *= 1.0 - dist * 0.1;
      
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
      
      // Performance: reduce update frequency
      this.lastFrameTime = 0;
      this.targetFPS = 30;
      this.frameInterval = 1000 / this.targetFPS;
    }

    init() {
      // Create canvas
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

      // Get WebGL2 context
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

      // Create shader program
      if (!this.createProgram()) {
        console.warn('Failed to create shader program');
        this.canvas.remove();
        return false;
      }

      // Setup geometry
      this.setupGeometry();

      // Get uniform locations
      this.uniforms.resolution = this.gl.getUniformLocation(this.program, 'u_resolution');
      this.uniforms.time = this.gl.getUniformLocation(this.program, 'u_time');

      // Handle resize
      this.resize();
      window.addEventListener('resize', () => this.resize());

      // Start render loop
      this.render();

      console.log('✦ Shader background initialized');
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
      
      // Fullscreen quad vertices
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
      const dpr = Math.min(window.devicePixelRatio, 1.5); // Limit for performance
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

      // Frame rate limiting
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

  // Initialize on DOM ready
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

