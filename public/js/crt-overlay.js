/**
 * crt-overlay.js - CRT overlay effect controller
 * Toggleable post-processing effects for the entire page
 * 
 * Usage:
 *   window.crtOverlay.toggle()     - toggle on/off
 *   window.crtOverlay.enable()     - enable
 *   window.crtOverlay.disable()    - disable
 *   window.crtOverlay.isEnabled()  - check state
 *   
 * Optional effects (add/remove individually):
 *   window.crtOverlay.setFlicker(true/false)
 *   window.crtOverlay.setChroma(true/false)
 *   window.crtOverlay.setInterlace(true/false)
 *   window.crtOverlay.setCurve(true/false)
 * 
 * Presets:
 *   window.crtOverlay.preset('subtle')   - base scanlines + vignette only
 *   window.crtOverlay.preset('classic')  - + flicker + chroma
 *   window.crtOverlay.preset('intense')  - + interlace + curve
 *   window.crtOverlay.preset('off')      - disable all
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'aethera-crt-overlay';
  
  const CLASSES = {
    base: 'crt-overlay',
    flicker: 'crt-flicker',
    chroma: 'crt-chroma',
    interlace: 'crt-interlace',
    curve: 'crt-curve'
  };

  const PRESETS = {
    off: {
      enabled: false,
      flicker: false,
      chroma: false,
      interlace: false,
      curve: false
    },
    subtle: {
      enabled: true,
      flicker: false,
      chroma: false,
      interlace: false,
      curve: false
    },
    classic: {
      enabled: true,
      flicker: true,
      chroma: true,
      interlace: false,
      curve: false
    },
    intense: {
      enabled: true,
      flicker: true,
      chroma: true,
      interlace: true,
      curve: true
    }
  };

  class CRTOverlay {
    constructor() {
      this.state = this.loadState();
      this.applyState();
      
      console.log(`✦ CRT Overlay: ${this.state.enabled ? 'enabled' : 'disabled'} (preset: ${this.detectPreset()})`);
    }

    loadState() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          return JSON.parse(saved);
        }
      } catch (e) {
        console.warn('Failed to load CRT overlay state:', e);
      }
      
      // Default: subtle preset (just scanlines + vignette)
      return { ...PRESETS.subtle };
    }

    saveState() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (e) {
        console.warn('Failed to save CRT overlay state:', e);
      }
    }

    applyState() {
      const body = document.body;
      
      // Base class
      body.classList.toggle(CLASSES.base, this.state.enabled);
      
      // Optional effect classes
      body.classList.toggle(CLASSES.flicker, this.state.enabled && this.state.flicker);
      body.classList.toggle(CLASSES.chroma, this.state.enabled && this.state.chroma);
      body.classList.toggle(CLASSES.interlace, this.state.enabled && this.state.interlace);
      body.classList.toggle(CLASSES.curve, this.state.enabled && this.state.curve);
    }

    detectPreset() {
      for (const [name, preset] of Object.entries(PRESETS)) {
        const matches = Object.keys(preset).every(key => this.state[key] === preset[key]);
        if (matches) return name;
      }
      return 'custom';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════

    toggle() {
      this.state.enabled = !this.state.enabled;
      this.applyState();
      this.saveState();
      console.log(`✦ CRT Overlay: ${this.state.enabled ? 'enabled' : 'disabled'}`);
      return this.state.enabled;
    }

    enable() {
      this.state.enabled = true;
      this.applyState();
      this.saveState();
      console.log('✦ CRT Overlay: enabled');
    }

    disable() {
      this.state.enabled = false;
      this.applyState();
      this.saveState();
      console.log('✦ CRT Overlay: disabled');
    }

    isEnabled() {
      return this.state.enabled;
    }

    // Individual effect toggles
    setFlicker(enabled) {
      this.state.flicker = enabled;
      this.applyState();
      this.saveState();
    }

    setChroma(enabled) {
      this.state.chroma = enabled;
      this.applyState();
      this.saveState();
    }

    setInterlace(enabled) {
      this.state.interlace = enabled;
      this.applyState();
      this.saveState();
    }

    setCurve(enabled) {
      this.state.curve = enabled;
      this.applyState();
      this.saveState();
    }

    // Preset application
    preset(name) {
      const preset = PRESETS[name];
      if (!preset) {
        console.warn(`Unknown preset: ${name}. Available: ${Object.keys(PRESETS).join(', ')}`);
        return;
      }
      
      this.state = { ...preset };
      this.applyState();
      this.saveState();
      console.log(`✦ CRT Overlay: preset '${name}' applied`);
    }

    // Get current state for debugging
    getState() {
      return { ...this.state, preset: this.detectPreset() };
    }

    // List available presets
    listPresets() {
      return Object.keys(PRESETS);
    }
  }

  // Initialize on DOM ready
  function init() {
    window.crtOverlay = new CRTOverlay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

