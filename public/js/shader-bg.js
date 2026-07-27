/**
 * shader-bg.js — runs the LIVE Ghostty shader chain as the panel background.
 *
 * This file used to be a hand-derived "mega shader": one pass that re-implemented
 * a snapshot of the terminal stack from memory. It drifted, as that arrangement
 * always will — it was still rendering moire-radial months after that pass was
 * removed from the real chain for being a measured no-op.
 *
 * So it no longer re-implements anything. It fetches the actual .glsl files out
 * of /shaders/ and runs them through the same ping-pong a terminal compositor
 * does, against the same uniform contract (preview/prologue.glsl). The shader
 * sources here are byte-identical to ~/.config/ghostty/shaders — see
 * scripts/sync-shaders.mjs, which is the only way they get updated.
 *
 * Chain and order come from /shaders/chain.json, which the sync script writes
 * by parsing the uncommented `custom-shader =` lines out of the real config.
 * Nothing about the chain is written down twice.
 *
 * ── THE THREE PLACES A BROWSER IS NOT A TERMINAL ──────────────────────────
 *
 * 1. iChannel0. In Ghostty, pass 1 reads the terminal's own glyphs — that is
 *    what crt-glow blooms, and what medium.glsl's readTerm() turns into `ink`
 *    (how written-on a region is) and `heat` (its red-vs-green balance, which
 *    modulates the refractive index). Here the UI is DOM sitting ON TOP of the
 *    canvas, so the shader can never read it directly. TerminalProxy below
 *    rasterizes the panel's actual text line-boxes, in their actual computed
 *    colors, onto a #0f0a1a field — so the sky still parts around the text and
 *    a red error badge still warms the medium under it.
 *
 * 2. The cursor. cursor-comet.glsl and medium.glsl both read iCurrentCursor /
 *    iPreviousCursor / iTimeCursorChange. There are no cells here, so the mouse
 *    pointer drives them, quantized to a synthetic cell so that a move reads as
 *    a discrete jump the way a terminal cursor does.
 *
 * 3. The boot animation. See BOOT TIME WARP below.
 *
 * ── BOOT TIME WARP ────────────────────────────────────────────────────────
 *
 * crt-finale.glsl runs a power-on animation for DURATION = 45s. It is tempting
 * to read that as "45 seconds of black" and shorten it, but the phases are at
 * hardcoded absolute times and the dramatic ones are over early:
 *
 *     cathode glow  → 0.0-0.8s      raster expansion → 0.5-1.35s
 *     horizontal line 0.25-1.2s     hv flash         ~0.33s
 *     brightness overdrive → t=20   color convergence → t=25
 *     warm-up scanlines    → t=42   DURATION (handoff) = 45
 *
 * So it is ~1.4s of black and then a 43s settle. Ghostty launches once and can
 * afford that; this panel gets reloaded constantly and cannot.
 *
 * Editing DURATION would be the obvious fix and it is wrong: at t=4 the shader
 * is still at 1.29x brightness overdrive with ~0.09 of warm-up scanline left,
 * so handing off to steady state there is a visible POP, not a shorter boot.
 *
 * Instead crt-finale — and only crt-finale — gets a warped clock. Real time up
 * to BOOT_LINEAR_UNTIL passes through 1:1, so the whole dramatic phase plays at
 * true speed and stays in sync with crt-glow's own boot window (it holds
 * pass-through until iTime 1.5, on the real clock). After that the clock
 * accelerates on a smoothstep, reaching t=45 at BOOT_COMPRESSED_UNTIL, so the
 * long settle plays out fully but fast, easing into steady state instead of
 * cutting to it. Monotonic and continuous throughout.
 *
 * The payoff: every .glsl file here is byte-identical to the one Ghostty loads.
 * No preprocessor rewriting, no per-target forks, nothing to keep in sync but
 * the files themselves.
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════════════════════

  const SHADER_BASE = '/shaders/';
  const TARGET_FPS = 24;

  /** GPU ms/frame we are willing to spend on a background. Well under the
   *  41ms a 24fps frame allows — this is decoration behind a control panel,
   *  and it shares the GPU with whatever else the machine is doing. */
  const FRAME_BUDGET_MS = 8;

  /** A single bench frame slower than this means no quality step will fit;
   *  stop measuring and pin the floor rather than stall the page proving it. */
  const BENCH_ABORT_MS = 80;
  /** Hard wall-clock cap on the whole bench, however few frames it managed. */
  const BENCH_DEADLINE_MS = 2500;

  const QUALITY_STEPS = [1.0, 0.85, 0.7, 0.6, 0.5, 0.4];
  const FALLBACK_SCALE = 0.6;
  const STORAGE_KEY = 'aethera-shader-quality';

  // Boot time warp (see header).
  const BOOT_LINEAR_UNTIL = 1.5;
  const BOOT_COMPRESSED_UNTIL = 4.5;
  const BOOT_SHADER_DURATION = 45.0;
  /** Only passes named here get the warped clock. Everything else animates on
   *  the real one, or the chain desynchronizes. */
  const TIME_WARPED_PASSES = new Set(['crt-finale.glsl']);

  /** Time to render at when animation is suppressed — past DURATION, so the
   *  single static frame is steady state rather than a black boot frame. */
  const STATIC_FRAME_TIME = 120.0;

  // ── Terminal proxy (iChannel0) ──────────────────────────────────────────
  //
  // Drawn at FULL buffer resolution with REAL GLYPHS, and both of those are
  // load-bearing rather than fussiness. medium.glsl's grain is applied purely
  // multiplicatively — `color.rgb *= 1.0 + depth * m` — so it can only scale
  // light that is already in the buffer. It has no additive term at all; only
  // the sky's emission does, which is why the sky shows up on an empty screen
  // and the grain does not.
  //
  // A first version drew soft rectangles over text line-boxes at 0.45 coverage
  // and half resolution. Measured, that buffer peaked at 0.296 luma with NOTHING
  // above 0.35, against real terminal text at ~0.84 — so the grain was scaling a
  // field ~3x too dim, with no glyph-scale structure for the per-channel
  // dispersion to fringe. The chromatic pools simply had nothing to work on.
  //
  // Real glyphs fix both at once, and delete the reason the blur existed: a
  // solid bar of ink brightens the medium in a visible RECTANGLE, and letterforms
  // do not.
  const PROXY_SCALE = 1.0;
  /** Bound the 2D redraw + texture upload on very large displays. */
  const MAX_PROXY_PIXELS = 1_400_000;
  const TERM_BG = '#0f0a1a';        // ghostty `background`. medium.glsl's `lit`
                                     // gates are tuned to its luma (~0.052) —
                                     // any other base and readTerm misreads the
                                     // empty screen as written-on.
  /**
   * How hard the panel's content drives the medium. This is THE dial for grain
   * strength: the grain is a ratio, so its visible depth is proportional to the
   * luminance in this buffer and to nothing else. 1.0 puts panel text at the
   * same luma a terminal's glyphs have. Runtime override: shaderBg.setInkGain().
   */
  const PROXY_INK_GAIN = 1.0;
  const INK_GAIN_KEY = 'aethera-shader-ink-gain';

  /** Only the wrapped-text fallback path still draws boxes, so it still blurs. */
  const BLUR_OF_LINE = 0.55;
  const BLUR_MIN_PX = 1.2;
  const BLUR_MAX_PX = 7.0;
  const PROXY_REBUILD_MS = 220;
  const MAX_TEXT_RECTS = 900;

  // Synthetic cursor cell.
  const CELL_ROWS = 45;              // buffer height / this = cell height
  const CELL_ASPECT = 0.45;
  const CURSOR_COLOR = [0.91, 0.47, 0.98, 1.0];

  const VERTEX_SOURCE = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const UNIFORM_NAMES = [
    'iResolution', 'iTime', 'iTimeDelta', 'iFrame', 'iDate', 'iChannel0',
    'iCurrentCursor', 'iPreviousCursor', 'iCurrentCursorColor', 'iTimeCursorChange',
  ];

  /**
   * Renderers with no GPU behind them. This chain is not merely slow on these,
   * it is unusable: one frame of medium.glsl on a CPU rasterizer takes tens of
   * SECONDS, which freezes the tab — and no resolution scale rescues that, so
   * the auto-tuner cannot help either (it never gets a second frame in which to
   * notice). The panel is a control surface first; it gets the CSS background.
   */
  const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;

  /**
   * Debug escape hatches, mirroring the ghostty preview harness:
   *   ?shaderbg=force  run even on a software renderer (correctness checks)
   *   ?shadert=120     start the shader clock here — past the boot animation,
   *                    so a single captured frame is steady state
   */
  const QUERY = (() => {
    try { return new URLSearchParams(window.location.search); }
    catch { return new URLSearchParams(); }
  })();
  const FORCE_SOFTWARE = QUERY.get('shaderbg') === 'force';
  const START_TIME_OFFSET = (() => {
    const v = Number(QUERY.get('shadert'));
    return Number.isFinite(v) && v > 0 ? v : 0;
  })();

  const log = (...a) => console.log('%c✦ shader-bg', 'color:#a78bfa', ...a);
  const warn = (...a) => console.warn('✦ shader-bg', ...a);

  /**
   * Real seconds → crt-finale's clock. Identity through the dramatic phases,
   * then a smoothstep-eased acceleration onto DURATION, then real-time again
   * (past DURATION the shader only compares against it, so the value is free).
   */
  function warpBootTime(t) {
    if (t <= BOOT_LINEAR_UNTIL) return t;
    if (t >= BOOT_COMPRESSED_UNTIL) return BOOT_SHADER_DURATION + (t - BOOT_COMPRESSED_UNTIL);
    const u = (t - BOOT_LINEAR_UNTIL) / (BOOT_COMPRESSED_UNTIL - BOOT_LINEAR_UNTIL);
    const eased = u * u * (3.0 - 2.0 * u);
    return BOOT_LINEAR_UNTIL + (BOOT_SHADER_DURATION - BOOT_LINEAR_UNTIL) * eased;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TERMINAL PROXY — the panel's own text, as something the chain can read
  // ═══════════════════════════════════════════════════════════════════════════

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CANVAS', 'TEXTAREA', 'TITLE']);

  class TerminalProxy {
    constructor(gl) {
      this.gl = gl;
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { alpha: false, willReadFrequently: false });
      this.texture = null;
      this.width = 0;
      this.height = 0;
      this.dirty = true;
      // -Infinity, not 0: PROXY_REBUILD_MS is a cooldown measured against
      // performance.now(), and at first paint that is typically under 220ms —
      // so a 0 here rate-limits the FIRST build, which is the one build that
      // must not be skipped.
      this.lastBuild = -Infinity;
      this.overflowed = false;
      this.lastRectCount = 0;

      let gain = PROXY_INK_GAIN;
      try {
        const saved = Number(window.localStorage.getItem(INK_GAIN_KEY));
        if (Number.isFinite(saved) && saved > 0) gain = saved;
      } catch { /* storage unavailable — the default is fine */ }
      this.inkGain = Math.min(Math.max(gain, 0), 2);
      this.supportsFilter = this.ctx !== null && typeof this.ctx.filter === 'string';
      this.observers = [];
      this.scheduled = false;

      if (!this.ctx) {
        warn('2D context unavailable — iChannel0 will be a flat field');
      }
    }

    init() {
      const gl = this.gl;
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // Seed with one TERM_BG texel so the texture is COMPLETE from frame zero.
      // An unallocated texture samples as pure black, and black is not a
      // neutral placeholder here: medium.glsl gates `ink`, `heat` and
      // `nearLight` on luma clearing ~0.05-0.06, thresholds chosen against
      // #0f0a1a's 0.052. A black iChannel0 reads as "screen is empty" and the
      // sky quietly stops emitting.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0x0f, 0x0a, 0x1a, 0xff]));

      const markDirty = () => this.markDirty();

      // Text moving under the viewport changes where the ink is, so scroll is
      // as much a rebuild trigger as a DOM edit. rAF-coalesced.
      const onScroll = () => {
        if (this.scheduled) return;
        this.scheduled = true;
        requestAnimationFrame(() => { this.scheduled = false; markDirty(); });
      };
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
      this.observers.push(() => window.removeEventListener('scroll', onScroll, { capture: true }));

      if (typeof MutationObserver === 'function') {
        const mo = new MutationObserver(markDirty);
        mo.observe(document.body, {
          childList: true, subtree: true, characterData: true,
        });
        this.observers.push(() => mo.disconnect());
      }
      if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(markDirty);
        ro.observe(document.body);
        this.observers.push(() => ro.disconnect());
      }
    }

    markDirty() { this.dirty = true; }

    resize(width, height) {
      let w = Math.max(1, Math.round(width * PROXY_SCALE));
      let h = Math.max(1, Math.round(height * PROXY_SCALE));
      const px = w * h;
      if (px > MAX_PROXY_PIXELS) {
        const k = Math.sqrt(MAX_PROXY_PIXELS / px);
        w = Math.max(1, Math.round(w * k));
        h = Math.max(1, Math.round(h * k));
      }
      this.width = w;
      this.height = h;
      this.canvas.width = w;
      this.canvas.height = h;
      this.dirty = true;
    }

    /** Rebuild + upload if dirty and off cooldown. Cheap no-op otherwise. */
    update(now) {
      if (!this.dirty || !this.texture) return;
      if (now - this.lastBuild < PROXY_REBUILD_MS) return;
      this.dirty = false;
      this.lastBuild = now;

      try {
        this.draw();
      } catch (err) {
        warn('proxy draw failed, keeping previous frame:', err);
        return;
      }

      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      // Flipped: DOM y grows downward, GL uv.y grows upward.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }

    /**
     * Repaint the panel's text into the buffer the chain reads as its
     * "terminal". Real glyphs at real luminance, because medium.glsl's grain is
     * a RATIO — see the PROXY_SCALE note above for the measurement that forced
     * this. Wrapped text nodes fall back to a blurred box, which is fine
     * because they are rare in this UI and the box artifact only shows on large
     * type.
     */
    draw() {
      const ctx = this.ctx;
      if (!ctx) return;

      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
      ctx.fillStyle = TERM_BG;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.textBaseline = 'top';
      // Applied to the ink only, never to the TERM_BG fill above — the base
      // field has to stay at #0f0a1a's luma or readTerm's gates all shift.
      ctx.globalAlpha = this.inkGain;

      const sx = this.width / Math.max(1, window.innerWidth);
      const sy = this.height / Math.max(1, window.innerHeight);

      let blurBucket = -1;
      let filterOn = false;

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const colorCache = new Map();
      const range = document.createRange();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let drawn = 0;

      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (drawn >= MAX_TEXT_RECTS) {
          if (!this.overflowed) {
            this.overflowed = true;
            warn(`proxy hit MAX_TEXT_RECTS (${MAX_TEXT_RECTS}); ink map is truncated`);
          }
          break;
        }

        const parent = node.parentElement;
        let style = colorCache.get(parent);
        if (style === undefined) {
          const cs = window.getComputedStyle(parent);
          style = (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0')
            ? null
            // Font rebuilt at proxy scale rather than reused verbatim: the
            // canvas is not the viewport, so a 13px computed size has to become
            // 13 * sy here or every glyph lands at the wrong weight.
            : {
              color: cs.color,
              font: `${cs.fontStyle} ${cs.fontWeight} `
                  + `${Math.max(1, parseFloat(cs.fontSize) * sy).toFixed(2)}px `
                  + `${cs.fontFamily}`,
            };
          colorCache.set(parent, style);
        }
        if (!style) continue;

        range.selectNodeContents(node);
        const rects = range.getClientRects();

        // One rect means one unwrapped line, so the string can be drawn as
        // itself. The rect came from this very text, so fillText with the same
        // font reproduces its extent — no overdraw past a clipping container.
        const asGlyphs = rects.length === 1;

        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (r.width <= 0 || r.height <= 0) continue;
          if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;

          ctx.fillStyle = style.color;

          if (asGlyphs) {
            if (filterOn) { ctx.filter = 'none'; filterOn = false; blurBucket = -1; }
            ctx.font = style.font;
            ctx.fillText(node.nodeValue, r.left * sx, r.top * sy);
          } else {
            if (this.supportsFilter) {
              // Bucketed to 0.5px so a page of same-size text does not reassign
              // ctx.filter hundreds of times per rebuild.
              const h = r.height * sy;
              const blur = Math.min(BLUR_MAX_PX, Math.max(BLUR_MIN_PX, h * BLUR_OF_LINE));
              const bucket = Math.round(blur * 2);
              if (bucket !== blurBucket) {
                blurBucket = bucket;
                filterOn = true;
                ctx.filter = `blur(${(bucket / 2).toFixed(1)}px)`;
              }
            }
            ctx.fillRect(r.left * sx, r.top * sy, r.width * sx, r.height * sy);
          }

          drawn++;
          if (drawn >= MAX_TEXT_RECTS) break;
        }
      }

      range.detach?.();
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
      this.lastRectCount = drawn;
    }

    destroy() {
      for (const off of this.observers) {
        try { off(); } catch { /* observer already gone */ }
      }
      this.observers = [];
      if (this.texture) {
        this.gl.deleteTexture(this.texture);
        this.texture = null;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHADER CHAIN — ping-pong, exactly as the compositor does it
  // ═══════════════════════════════════════════════════════════════════════════

  class ShaderChain {
    constructor(gl) {
      this.gl = gl;
      this.passes = [];
      this.ping = null;
      this.pong = null;
      this.vao = null;
      this.width = 0;
      this.height = 0;
    }

    compileShader(type, source, label) {
      const gl = this.gl;
      if (gl.isContextLost()) {
        warn(`${label}: context already lost`);
        return null;
      }
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        warn(`${label}: compile failed\n${gl.getShaderInfoLog(shader) || '(empty log)'}`);
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    /** Build one pass. `source` is the untouched shader file. */
    addPass(name, source, prologue, epilogue) {
      const gl = this.gl;
      const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SOURCE, `${name} (vert)`);
      const fs = this.compileShader(gl.FRAGMENT_SHADER, prologue + source + epilogue, name);
      if (!vs || !fs) return false;

      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        warn(`${name}: link failed\n${gl.getProgramInfoLog(program)}`);
        gl.deleteProgram(program);
        return false;
      }

      const uniforms = {};
      for (const u of UNIFORM_NAMES) uniforms[u] = gl.getUniformLocation(program, u);

      this.passes.push({ name, program, uniforms, warped: TIME_WARPED_PASSES.has(name) });
      return true;
    }

    makeTarget(width, height) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // RGBA8 on purpose — the same 8-bit the terminal composites in, and the
      // same the canvas presents in. Anything wider here would hide banding
      // the real chain produces (it is how moire-radial was caught rounding
      // to zero: its perturbation never cleared one 8-bit level).
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) {
        warn('framebuffer incomplete at', width, 'x', height);
        return null;
      }
      return { tex, fbo };
    }

    resize(width, height) {
      const gl = this.gl;
      if (width === this.width && height === this.height) return true;
      for (const t of [this.ping, this.pong]) {
        if (!t) continue;
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
      this.ping = this.makeTarget(width, height);
      this.pong = this.makeTarget(width, height);
      if (!this.ping || !this.pong) return false;
      this.width = width;
      this.height = height;
      if (!this.vao) this.vao = gl.createVertexArray();
      return true;
    }

    /** @param {{time:number,delta:number,frame:number,date:number[],cursor:object}} f */
    render(contentTex, f) {
      const gl = this.gl;
      const { width: w, height: h } = this;
      const warpedTime = warpBootTime(f.time);
      let srcTex = contentTex;

      gl.bindVertexArray(this.vao);

      for (let i = 0; i < this.passes.length; i++) {
        const pass = this.passes[i];
        const last = i === this.passes.length - 1;
        const target = i % 2 === 0 ? this.ping : this.pong;

        gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : target.fbo);
        gl.viewport(0, 0, w, h);
        gl.useProgram(pass.program);

        gl.uniform3f(pass.uniforms.iResolution, w, h, 1);
        gl.uniform1f(pass.uniforms.iTime, pass.warped ? warpedTime : f.time);
        gl.uniform1f(pass.uniforms.iTimeDelta, f.delta);
        gl.uniform1i(pass.uniforms.iFrame, f.frame);
        gl.uniform4f(pass.uniforms.iDate, f.date[0], f.date[1], f.date[2], f.date[3]);

        const c = f.cursor;
        gl.uniform4f(pass.uniforms.iCurrentCursor, c.cur[0], c.cur[1], c.cellW, c.cellH);
        gl.uniform4f(pass.uniforms.iPreviousCursor, c.prev[0], c.prev[1], c.cellW, c.cellH);
        gl.uniform4f(pass.uniforms.iCurrentCursorColor, ...CURSOR_COLOR);
        gl.uniform1f(pass.uniforms.iTimeCursorChange, c.changeTime);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.uniform1i(pass.uniforms.iChannel0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!last) srcTex = target.tex;
      }
    }

    destroy() {
      const gl = this.gl;
      for (const p of this.passes) gl.deleteProgram(p.program);
      this.passes = [];
      for (const t of [this.ping, this.pong]) {
        if (!t) continue;
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
      this.ping = this.pong = null;
      if (this.vao) { gl.deleteVertexArray(this.vao); this.vao = null; }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BACKGROUND — lifecycle, quality auto-tune, cursor, visibility
  // ═══════════════════════════════════════════════════════════════════════════

  class ShaderBackground {
    constructor() {
      this.canvas = null;
      this.gl = null;
      this.chain = null;
      this.proxy = null;
      this.manifest = null;

      // Shifted back by ?shadert= so the clock starts mid-chain when asked.
      this.startTime = performance.now() - START_TIME_OFFSET * 1000;
      this.animationId = null;
      this.enabled = true;
      this.running = false;
      this.ready = false;
      this.failed = false;

      this.frame = 0;
      this.lastFrameTime = 0;
      this.lastRenderClock = 0;
      this.targetFPS = TARGET_FPS;
      this.frameInterval = 1000 / TARGET_FPS;
      this.resolutionScale = FALLBACK_SCALE;

      this.dateVec = [1970, 0, 1, 0];
      this.dateStamp = 0;

      this.cursor = {
        cur: [0, 0], prev: [0, 0], cellW: 8, cellH: 18, changeTime: -1e4,
      };

      this.bench = null;

      this.reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // ── setup ───────────────────────────────────────────────────────────────

    async init() {
      try {
        this.manifest = await this.loadManifest();
      } catch (err) {
        return this.giveUp(`could not load ${SHADER_BASE}chain.json: ${err.message}`);
      }

      this.canvas = document.createElement('canvas');
      this.canvas.id = 'shader-bg';
      document.body.insertBefore(this.canvas, document.body.firstChild);

      this.gl = this.canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'low-power',
      });
      if (!this.gl) return this.giveUp('WebGL2 not supported');

      const renderer = this.rendererTag();
      if (SOFTWARE_RENDERER.test(renderer) && !FORCE_SOFTWARE) {
        return this.giveUp(`software renderer (${renderer})`);
      }

      this.canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.stop();
        warn('WebGL context lost — background suspended');
      });
      this.canvas.addEventListener('webglcontextrestored', () => {
        warn('WebGL context restored — rebuilding');
        this.rebuild();
      });

      let sources;
      try {
        sources = await this.loadSources();
      } catch (err) {
        return this.giveUp(`could not load shader sources: ${err.message}`);
      }
      this.sources = sources;

      if (!this.buildChain()) return this.giveUp('shader chain failed to build');

      this.proxy = new TerminalProxy(this.gl);
      this.proxy.init();

      this.resolutionScale = this.restoreQuality() ?? FALLBACK_SCALE;
      if (!this.resize()) return this.giveUp('could not allocate render targets');

      window.addEventListener('resize', () => {
        this.resize();
        if (!this.running) this.drawFrame();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.stop();
        else if (this.enabled && !this.reducedMotion) this.start();
      });
      window.addEventListener('pointermove', (e) => this.onPointerMove(e), { passive: true });

      this.ready = true;
      document.documentElement.dataset.shaderBg = `ok: ${this.manifest.chain.join(' → ')}`;

      if (this.reducedMotion) {
        this.drawFrame(STATIC_FRAME_TIME);
        log('static frame (prefers-reduced-motion) —', this.manifest.chain.join(' → '));
        return true;
      }

      if (this.restoreQuality() === null) this.beginBench();
      this.start();
      log(`${this.manifest.chain.length} passes @ ${this.targetFPS}fps, `
        + `scale ${this.resolutionScale}${this.bench ? ' (benching…)' : ''}`);
      log('chain:', this.manifest.chain.join(' → '));
      return true;
    }

    async loadManifest() {
      const res = await fetch(`${SHADER_BASE}chain.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = await res.json();
      if (!Array.isArray(manifest.chain) || manifest.chain.length === 0) {
        throw new Error('manifest has no chain');
      }
      return manifest;
    }

    async loadSources() {
      const names = ['prologue.glsl', 'epilogue.glsl', ...this.manifest.chain];
      const texts = await Promise.all(names.map(async (name) => {
        const res = await fetch(SHADER_BASE + name);
        if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
        return [name, await res.text()];
      }));
      return new Map(texts);
    }

    buildChain() {
      const prologue = this.sources.get('prologue.glsl');
      const epilogue = this.sources.get('epilogue.glsl');
      if (!prologue || !epilogue) {
        warn('missing prologue/epilogue — the uniform contract');
        return false;
      }
      this.chain = new ShaderChain(this.gl);
      for (const name of this.manifest.chain) {
        const src = this.sources.get(name);
        if (!src) { warn(`missing source for ${name}`); return false; }
        // One bad pass is not a reason to drop the rest of the chain silently;
        // it is a reason to fail loudly, because a chain missing a pass does not
        // look like a degraded version of itself, it looks broken.
        if (!this.chain.addPass(name, src, prologue, epilogue)) return false;
      }
      return this.chain.passes.length > 0;
    }

    rebuild() {
      if (this.failed || !this.sources) return;
      if (this.chain) this.chain.destroy();
      if (!this.buildChain() || !this.resize()) {
        this.giveUp('rebuild failed after context restore');
        return;
      }
      if (this.enabled && !this.reducedMotion && !document.hidden) this.start();
    }

    giveUp(reason) {
      this.failed = true;
      this.ready = false;
      warn(`${reason} — falling back to the static CSS background`);
      document.documentElement.classList.add('no-shader-bg');
      // Reflected onto the root element so the state is readable without a JS
      // console — which is what lets scripts/verify-shader-bg.mjs assert on it,
      // and what makes "is the background actually running" answerable over a
      // screen share.
      document.documentElement.dataset.shaderBg = `failed: ${reason}`;
      if (this.canvas) { this.canvas.remove(); this.canvas = null; }
      return false;
    }

    // ── quality ─────────────────────────────────────────────────────────────

    rendererTag() {
      try {
        const dbg = this.gl.getExtension('WEBGL_debug_renderer_info');
        return String(dbg
          ? this.gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
          : this.gl.getParameter(this.gl.RENDERER));
      } catch {
        return 'unknown';
      }
    }

    /** Chain identity — retune when the shaders themselves change. */
    chainTag() {
      const files = this.manifest.files ?? {};
      return this.manifest.chain.map((n) => `${n}@${files[n]?.sha256 ?? '?'}`).join(',');
    }

    restoreQuality() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const saved = JSON.parse(raw);
        if (saved.renderer !== this.rendererTag()) return null;
        if (saved.chain !== this.chainTag()) return null;
        if (typeof saved.scale !== 'number' || !Number.isFinite(saved.scale)) return null;
        return Math.min(Math.max(saved.scale, 0.25), 1.5);
      } catch {
        return null;  // private mode, quota, corrupt entry — all mean "retune"
      }
    }

    saveQuality(scale) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          scale, renderer: this.rendererTag(), chain: this.chainTag(),
        }));
      } catch { /* storage unavailable: retune next load, no worse than that */ }
    }

    /**
     * Measure at the current scale, then pick the largest scale whose predicted
     * cost fits FRAME_BUDGET_MS. Cost is taken as proportional to fragment
     * count, which for a fixed chain of full-screen passes it essentially is.
     *
     * Runs during the boot animation, when the screen is mostly black anyway —
     * gl.finish() per frame stalls the pipeline, so this is not something to do
     * while anything is on screen worth looking at.
     */
    beginBench() {
      this.bench = {
        samples: [], warmup: 12, need: 24, last: 0, startedAt: performance.now(),
      };
    }

    /** Give up on measuring and pin the lowest quality step. */
    abortBench(why) {
      const floor = QUALITY_STEPS[QUALITY_STEPS.length - 1];
      this.bench = null;
      warn(`bench aborted (${why}) — pinning scale ${floor}. Renderer: ${this.rendererTag()}`);
      this.saveQuality(floor);
      if (floor !== this.resolutionScale) {
        this.resolutionScale = floor;
        this.resize();
      }
    }

    tickBench(now) {
      const b = this.bench;
      if (!b) return;
      this.gl.finish();
      const t = performance.now();

      // Wall-clock deadline, checked BEFORE the warmup counter. Bench frames
      // run uncapped with gl.finish(), so on a software rasterizer (and
      // medium.glsl is 1590 lines of it) a single frame can take seconds — the
      // page would sit frozen through a 12-frame warmup that never produces
      // the sample a per-sample guard needs in order to fire.
      if (t - b.startedAt > BENCH_DEADLINE_MS) {
        this.abortBench(`${Math.round(t - b.startedAt)}ms elapsed, `
          + `${b.samples.length} sample(s)`);
        return;
      }

      if (b.warmup > 0) { b.warmup--; b.last = t; return; }
      if (b.last > 0) b.samples.push(t - b.last);
      b.last = t;

      // Faster path for a GPU that is merely too slow rather than absent.
      if (b.samples.length && Math.max(...b.samples) > BENCH_ABORT_MS) {
        this.abortBench(`${Math.max(...b.samples).toFixed(0)}ms/frame at `
          + `${this.chain.width}x${this.chain.height}`);
        return;
      }

      if (b.samples.length < b.need) return;

      const sorted = b.samples.slice().sort((a, c) => a - c);
      const median = sorted[Math.floor(sorted.length / 2)];
      const frags = this.chain.width * this.chain.height;
      const perFrag = median / Math.max(1, frags);

      let chosen = QUALITY_STEPS[QUALITY_STEPS.length - 1];
      for (const step of QUALITY_STEPS) {
        const w = window.innerWidth * step;
        const h = window.innerHeight * step;
        if (perFrag * w * h <= FRAME_BUDGET_MS) { chosen = step; break; }
      }

      this.bench = null;
      log(`bench: ${median.toFixed(2)}ms @ ${this.chain.width}x${this.chain.height}`
        + ` → scale ${chosen} (budget ${FRAME_BUDGET_MS}ms)`);
      this.saveQuality(chosen);
      if (chosen !== this.resolutionScale) {
        this.resolutionScale = chosen;
        this.resize();
      }
    }

    /**
     * Grain strength, effectively. The grain is multiplicative, so how visible
     * it is depends entirely on the luminance of the buffer it scales; 1.0 is
     * "panel text is as bright as terminal glyphs". Persisted, since the point
     * of the dial is tuning it against the live panel.
     */
    setInkGain(gain) {
      if (typeof gain !== 'number' || !Number.isFinite(gain)) {
        warn('setInkGain expects a number, got', gain);
        return;
      }
      if (!this.proxy) { warn('no content proxy to tune'); return; }
      this.proxy.inkGain = Math.min(Math.max(gain, 0), 2);
      this.proxy.markDirty();
      this.proxy.lastBuild = -Infinity;   // apply now, not after the cooldown
      try { window.localStorage.setItem(INK_GAIN_KEY, String(this.proxy.inkGain)); }
      catch { /* not persistable here; still applies for this session */ }
      if (!this.running) this.drawFrame();
      return this.proxy.inkGain;
    }

    setQuality(scale) {
      if (typeof scale !== 'number' || !Number.isFinite(scale)) {
        warn('setQuality expects a number, got', scale);
        return;
      }
      this.bench = null;
      this.resolutionScale = Math.min(Math.max(scale, 0.25), 1.5);
      this.saveQuality(this.resolutionScale);
      this.resize();
      if (!this.running) this.drawFrame();
    }

    retune() {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* fine */ }
      this.resolutionScale = FALLBACK_SCALE;
      this.resize();
      this.beginBench();
      log('retuning…');
    }

    // ── frame ───────────────────────────────────────────────────────────────

    resize() {
      if (!this.gl || !this.chain) return false;
      const width = Math.max(1, Math.round(window.innerWidth * this.resolutionScale));
      const height = Math.max(1, Math.round(window.innerHeight * this.resolutionScale));
      this.canvas.width = width;
      this.canvas.height = height;
      if (!this.chain.resize(width, height)) return false;
      this.proxy?.resize(width, height);
      this.updateCellMetrics();
      return true;
    }

    updateCellMetrics() {
      const h = Math.max(8, Math.round(this.canvas.height / CELL_ROWS));
      this.cursor.cellH = h;
      this.cursor.cellW = Math.max(3, Math.round(h * CELL_ASPECT));
    }

    /**
     * Mouse → cursor uniforms. Quantized to a cell so a move reads as a discrete
     * jump: cursor-comet measures `jump` in cell heights and only draws a full
     * trail past MIN_JUMP, which a raw per-pixel mousemove stream would never
     * produce cleanly.
     */
    onPointerMove(e) {
      if (!this.ready || !this.canvas) return;
      const scaleX = this.canvas.width / Math.max(1, window.innerWidth);
      const scaleY = this.canvas.height / Math.max(1, window.innerHeight);
      const { cellW, cellH } = this.cursor;

      const glX = e.clientX * scaleX;
      const glY = this.canvas.height - e.clientY * scaleY;

      // Report the TOP-LEFT of the cell in y-up coords: both cursor-comet and
      // medium.glsl recover the centre as xy + vec2(z, -w) * 0.5.
      const tlX = glX - cellW * 0.5;
      const tlY = glY + cellH * 0.5;

      const dx = tlX - this.cursor.cur[0];
      const dy = tlY - this.cursor.cur[1];
      if (dx * dx + dy * dy < cellH * cellH * 0.25) return;

      this.cursor.prev = this.cursor.cur;
      this.cursor.cur = [tlX, tlY];
      this.cursor.changeTime = (performance.now() - this.startTime) / 1000;
    }

    refreshDate(nowMs) {
      if (nowMs - this.dateStamp < 1000) return;
      this.dateStamp = nowMs;
      const d = new Date();
      this.dateVec = [
        d.getFullYear(), d.getMonth(), d.getDate(),
        d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(),
      ];
    }

    drawFrame(forcedTime) {
      if (!this.ready || !this.chain) return;
      const nowMs = performance.now();
      const time = forcedTime !== undefined ? forcedTime : (nowMs - this.startTime) / 1000;
      const delta = this.lastRenderClock > 0
        ? Math.min(0.25, (nowMs - this.lastRenderClock) / 1000)
        : 1 / 60;
      this.lastRenderClock = nowMs;

      this.refreshDate(nowMs);
      this.proxy?.update(nowMs);

      this.chain.render(this.proxy?.texture ?? null, {
        time,
        delta,
        frame: this.frame++,
        date: this.dateVec,
        cursor: this.cursor,
      });

      if (this.bench) this.tickBench(nowMs);
    }

    start() {
      if (this.running || !this.ready || this.failed) return;
      this.running = true;
      this.lastFrameTime = 0;
      this.animationId = requestAnimationFrame((t) => this.render(t));
    }

    stop() {
      this.running = false;
      if (this.animationId !== null) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
    }

    render(currentTime = 0) {
      if (!this.running) return;
      const elapsed = currentTime - this.lastFrameTime;
      // Bench frames run uncapped: the measurement wants back-to-back frames,
      // and it only lasts ~36 of them.
      if (this.bench || elapsed >= this.frameInterval) {
        this.lastFrameTime = currentTime - (this.bench ? 0 : elapsed % this.frameInterval);
        this.drawFrame();
      }
      this.animationId = requestAnimationFrame((t) => this.render(t));
    }

    // ── public API ──────────────────────────────────────────────────────────

    toggle(enabled) {
      this.enabled = enabled !== undefined ? !!enabled : !this.enabled;
      if (this.canvas) this.canvas.style.display = this.enabled ? 'block' : 'none';
      document.documentElement.classList.toggle('no-shader-bg', !this.enabled);
      if (this.enabled && !this.reducedMotion && !document.hidden) this.start();
      else this.stop();
      return this.enabled;
    }

    status() {
      return {
        ok: this.ready && !this.failed,
        chain: this.manifest?.chain ?? [],
        passes: this.chain?.passes.length ?? 0,
        resolution: this.canvas ? [this.canvas.width, this.canvas.height] : null,
        scale: this.resolutionScale,
        fps: this.targetFPS,
        renderer: this.gl ? this.rendererTag() : null,
        benching: this.bench !== null,
        proxyRects: this.proxy?.lastRectCount ?? 0,
        proxySize: this.proxy ? [this.proxy.width, this.proxy.height] : null,
        inkGain: this.proxy?.inkGain ?? null,
        shaderTime: (performance.now() - this.startTime) / 1000,
      };
    }

    destroy() {
      this.stop();
      this.proxy?.destroy();
      this.chain?.destroy();
      this.canvas?.remove();
      this.ready = false;
    }
  }

  function boot() {
    window.shaderBg = new ShaderBackground();
    window.shaderBg.init().catch((err) => {
      warn('init threw:', err);
      document.documentElement.classList.add('no-shader-bg');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
