// live-data.js - SSE connection manager for live dashboard updates
// Provides EventSource wrapper with auto-reconnect and connection state management

// ============================================================================
// LIVE DATA CLASS
// ============================================================================

/**
 * LiveData - Manages a single SSE connection for a domain
 * 
 * Usage:
 *   const live = new LiveData('bots', (data) => {
 *     currentBots = data.bots;
 *     renderBotsGrid();
 *   });
 *   live.connect();
 *   // Later:
 *   live.disconnect();
 */
class LiveData {
  /**
   * @param {string} domain - Stream domain (dashboard, bots, services, dreams, server, blog)
   * @param {Function} onData - Callback for data updates: (data) => void
   * @param {Object} [options] - Configuration options
   * @param {Function} [options.onError] - Callback for errors: (error) => void
   * @param {Function} [options.onConnect] - Callback when connected: () => void
   * @param {Function} [options.onDisconnect] - Callback when disconnected: () => void
   * @param {number} [options.maxReconnectAttempts=5] - Max reconnection attempts
   * @param {number} [options.reconnectDelay=3000] - Base delay between reconnects (ms)
   */
  constructor(domain, onData, options = {}) {
    this.domain = domain;
    this.onData = onData;
    this.onError = options.onError || (() => {});
    this.onConnect = options.onConnect || (() => {});
    this.onDisconnect = options.onDisconnect || (() => {});
    
    this.source = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.reconnectDelay = options.reconnectDelay || 3000;
    this.reconnectBackoffMultiplier = 1.5;
    this.shouldReconnect = false;
  }
  
  /**
   * Connect to the SSE stream
   */
  connect() {
    if (this.source) {
      console.warn(`[LiveData] Already connected to ${this.domain}`);
      return;
    }
    
    const url = `/api/stream/${this.domain}`;
    this.source = new EventSource(url);
    this.shouldReconnect = true;
    
    this.source.onopen = () => {
      console.log(`[LiveData] Connected: ${this.domain}`);
      this.reconnectAttempts = 0;
      this.onConnect();
    };
    
    this.source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onData(data);
      } catch (error) {
        console.error(`[LiveData] Parse error for ${this.domain}:`, error);
      }
    };
    
    // Handle error events (including auth failures)
    this.source.addEventListener('error', (event) => {
      console.warn(`[LiveData] Error on ${this.domain}`);
      this.handleDisconnect();
    });
    
    // Handle explicit error messages from server
    this.source.addEventListener('error', (event) => {
      // This handles the custom 'error' event type from the server
    });
  }
  
  /**
   * Handle disconnection and reconnection logic
   */
  handleDisconnect() {
    this.disconnect(false); // Don't clear shouldReconnect
    this.onDisconnect();
    
    if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectDelay * Math.pow(this.reconnectBackoffMultiplier, this.reconnectAttempts);
      this.reconnectAttempts++;
      
      console.log(`[LiveData] Reconnecting ${this.domain} in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        if (this.shouldReconnect) {
          this.connect();
        }
      }, delay);
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[LiveData] Max reconnect attempts reached for ${this.domain}`);
      this.onError(new Error('Connection lost - max reconnect attempts reached'));
      this.shouldReconnect = false;
    }
  }
  
  /**
   * Disconnect from the SSE stream
   * @param {boolean} [clearReconnect=true] - Whether to prevent reconnection
   */
  disconnect(clearReconnect = true) {
    if (clearReconnect) {
      this.shouldReconnect = false;
    }
    
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    
    if (clearReconnect) {
      this.reconnectAttempts = 0;
    }
  }
  
  /**
   * Check if currently connected
   * @returns {boolean}
   */
  isConnected() {
    return this.source?.readyState === EventSource.OPEN;
  }
  
  /**
   * Get connection state
   * @returns {'connected'|'connecting'|'disconnected'}
   */
  getState() {
    if (!this.source) return 'disconnected';
    switch (this.source.readyState) {
      case EventSource.CONNECTING: return 'connecting';
      case EventSource.OPEN: return 'connected';
      default: return 'disconnected';
    }
  }
}

// ============================================================================
// STREAM MANAGER
// ============================================================================

/**
 * StreamManager - Coordinates streams across page navigation
 * 
 * Only one stream is active at a time (the current page's stream).
 * When navigating to a new page, the old stream is disconnected
 * and a new one is created.
 * 
 * Usage:
 *   streams.connect('bots', (data) => { ... });
 *   // Navigate away:
 *   streams.disconnect();
 */
class StreamManager {
  constructor() {
    this.current = null;
    this.currentDomain = null;
    this.statusCallbacks = [];
  }
  
  /**
   * Connect to a domain stream
   * Automatically disconnects any existing stream first.
   * 
   * @param {string} domain - Stream domain (dashboard, bots, etc.)
   * @param {Function} handler - Data handler function
   */
  connect(domain, handler) {
    // Disconnect any existing connection
    this.disconnect();
    
    this.currentDomain = domain;
    this.current = new LiveData(domain, handler, {
      onConnect: () => this.updateStatus('connected'),
      onDisconnect: () => this.updateStatus('reconnecting'),
      onError: (err) => {
        this.updateStatus('disconnected');
        // Show toast if available
        if (typeof showToast === 'function') {
          showToast(`Live updates lost: ${err.message}`, 'warning');
        }
      },
    });
    
    this.current.connect();
    this.updateStatus('connecting');
  }
  
  /**
   * Disconnect the current stream
   */
  disconnect() {
    if (this.current) {
      this.current.disconnect();
      this.current = null;
      this.currentDomain = null;
      this.updateStatus('disconnected');
    }
  }
  
  /**
   * Update connection status and notify listeners
   * @param {'connected'|'connecting'|'reconnecting'|'disconnected'} status
   */
  updateStatus(status) {
    this.statusCallbacks.forEach(cb => {
      try {
        cb(status, this.currentDomain);
      } catch (e) {
        console.error('[StreamManager] Status callback error:', e);
      }
    });
  }
  
  /**
   * Register a callback for status changes
   * @param {Function} callback - (status, domain) => void
   */
  onStatusChange(callback) {
    this.statusCallbacks.push(callback);
  }
  
  /**
   * Remove a status change callback
   * @param {Function} callback
   */
  offStatusChange(callback) {
    const idx = this.statusCallbacks.indexOf(callback);
    if (idx !== -1) {
      this.statusCallbacks.splice(idx, 1);
    }
  }
  
  /**
   * Get current connection status
   * @returns {'connected'|'connecting'|'reconnecting'|'disconnected'}
   */
  getStatus() {
    if (!this.current) return 'disconnected';
    return this.current.getState();
  }
  
  /**
   * Get current domain
   * @returns {string|null}
   */
  getDomain() {
    return this.currentDomain;
  }
  
  /**
   * Check if connected to a specific domain
   * @param {string} domain
   * @returns {boolean}
   */
  isConnectedTo(domain) {
    return this.currentDomain === domain && this.current?.isConnected();
  }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

/**
 * Global stream manager instance
 * Use this to manage SSE connections across the app
 */
const streams = new StreamManager();

// ============================================================================
// UTILITY: PULSE UPDATE
// ============================================================================

/**
 * Update an element's text content with a visual pulse effect
 * Only pulses if the value actually changed.
 * 
 * @param {string} elementId - DOM element ID
 * @param {*} newValue - New value to set
 * @param {Object} [options] - Options
 * @param {string} [options.pulseClass='pulse-update'] - CSS class for pulse animation
 * @param {number} [options.duration=600] - Duration of pulse animation (ms)
 */
function pulseUpdate(elementId, newValue, options = {}) {
  const el = document.getElementById(elementId);
  if (!el) return;
  
  const pulseClass = options.pulseClass || 'pulse-update';
  const duration = options.duration || 600;
  
  const oldValue = el.textContent;
  const newValueStr = String(newValue);
  
  // Update the content
  el.textContent = newValueStr;
  
  // Only pulse if value changed
  if (oldValue !== newValueStr) {
    el.classList.add(pulseClass);
    setTimeout(() => el.classList.remove(pulseClass), duration);
  }
}

/**
 * Update multiple elements with pulse effect
 * @param {Object} updates - Map of elementId -> newValue
 * @param {Object} [options] - Pulse options
 */
function pulseUpdateMany(updates, options = {}) {
  for (const [elementId, newValue] of Object.entries(updates)) {
    pulseUpdate(elementId, newValue, options);
  }
}

// Export for use in other scripts
window.LiveData = LiveData;
window.StreamManager = StreamManager;
window.streams = streams;
window.pulseUpdate = pulseUpdate;
window.pulseUpdateMany = pulseUpdateMany;

