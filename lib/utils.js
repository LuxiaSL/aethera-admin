// lib/utils.js - General utility functions

const fs = require('fs');
const { exec, execFile, spawn } = require('child_process');

// ============================================================================
// PROCESS TRACKING & ZOMBIE PREVENTION
// ============================================================================

// Track active child processes for cleanup
const activeProcesses = new Set();

// Periodic zombie reaper - triggers Node's internal child process cleanup
let zombieReaperInterval = null;

/**
 * Start the zombie reaper interval.
 * Sends SIGCHLD to ourselves periodically to trigger Node/libuv's internal
 * waitpid() loop, which reaps any zombie children. Unlike the previous approach
 * of spawning 'true', this creates zero child processes.
 */
function startZombieReaper() {
  if (zombieReaperInterval) return;

  zombieReaperInterval = setInterval(() => {
    try {
      process.kill(process.pid, 'SIGCHLD');
    } catch (e) {
      // Ignore — shouldn't fail but don't let it crash the interval
    }
  }, 10000);

  // Don't prevent process exit
  zombieReaperInterval.unref();
}

/**
 * Stop the zombie reaper
 */
function stopZombieReaper() {
  if (zombieReaperInterval) {
    clearInterval(zombieReaperInterval);
    zombieReaperInterval = null;
  }
}

/**
 * Get count of zombie child processes for this Node process.
 * Reads /proc directly instead of shelling out (which would create more children).
 * @returns {{count: number, pids: number[]}}
 */
function getZombieCount() {
  const ppid = process.pid.toString();
  const pids = [];

  try {
    const entries = fs.readdirSync('/proc');
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
        // Format: pid (comm) state ppid ...
        const match = stat.match(/^\d+ \([^)]*\) (\S+) (\d+)/);
        if (match && match[1] === 'Z' && match[2] === ppid) {
          pids.push(parseInt(entry, 10));
        }
      } catch (e) {
        // Process may have exited between readdir and readFile
      }
    }
  } catch (e) {
    // /proc not available (non-Linux) — fall back gracefully
    return { count: 0, pids: [], error: '/proc not available' };
  }

  return { count: pids.length, pids };
}

/**
 * Force cleanup of zombie processes by sending SIGCHLD to self.
 * This triggers Node's internal waitpid() call.
 * @returns {Promise<{before: number, after: number, cleaned: number}>}
 */
async function cleanupZombies() {
  const before = getZombieCount();

  // Send SIGCHLD to ourselves to trigger waitpid
  try {
    process.kill(process.pid, 'SIGCHLD');
  } catch (e) {
    // Ignore
  }

  // Wait a moment for the event loop to process the signal
  await new Promise(r => setTimeout(r, 100));

  const after = getZombieCount();

  return {
    before: before.count,
    after: after.count,
    cleaned: before.count - after.count,
  };
}

// Start zombie reaper on module load
startZombieReaper();

// ============================================================================
// COMMAND EXECUTION
// ============================================================================

/**
 * Internal run command (doesn't go through tracking)
 * Used by zombie cleanup functions to avoid circular dependency
 */
function runCmdFullInternal(cmd) {
  return new Promise((resolve) => {
    const child = exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: err ? err.code || 1 : 0,
      });
    });
    
    // Ensure process is cleaned up even if callback fails
    child.on('exit', () => {
      activeProcesses.delete(child);
    });
  });
}

/**
 * Run a shell command and return promise
 * @param {string} cmd - Command to execute
 * @param {Object} options - Options for exec
 * @returns {Promise<string>} - Command output (stdout)
 */
function runCmd(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, { maxBuffer: 1024 * 1024 * 10, ...options }, (err, stdout, stderr) => {
      activeProcesses.delete(child);
      
      if (err && !stdout) {
        reject(err);
      } else {
        resolve(stdout || stderr || '');
      }
    });
    
    activeProcesses.add(child);
    
    // Safety: ensure cleanup on unexpected events
    child.on('error', () => {
      activeProcesses.delete(child);
    });
    
    child.on('exit', () => {
      activeProcesses.delete(child);
    });
  });
}

/**
 * Run a command and return both stdout and stderr
 * @param {string} cmd - Command to execute
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function runCmdFull(cmd) {
  return new Promise((resolve) => {
    const child = exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      activeProcesses.delete(child);
      
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: err ? err.code || 1 : 0,
      });
    });
    
    activeProcesses.add(child);
    
    // Safety: ensure cleanup on unexpected events
    child.on('error', () => {
      activeProcesses.delete(child);
    });
    
    child.on('exit', () => {
      activeProcesses.delete(child);
    });
  });
}

/**
 * Get count of active child processes being tracked
 * @returns {number}
 */
function getActiveProcessCount() {
  return activeProcesses.size;
}

// ============================================================================
// STRING UTILITIES
// ============================================================================

/**
 * Truncate string to max length with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
function truncate(str, maxLength = 100) {
  if (!str || str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Escape HTML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Format timestamp for display
 * @param {number|string|Date} timestamp - Timestamp to format
 * @returns {string} Formatted date string
 */
function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Get relative time string
 * @param {number|string|Date} timestamp - Timestamp
 * @returns {string} Relative time (e.g., "5 minutes ago")
 */
function relativeTime(timestamp) {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

// ============================================================================
// ASYNC CACHING
// ============================================================================

/**
 * Wrap an async function with a TTL cache.
 * Deduplicates concurrent calls for the same arguments (thundering herd prevention).
 * Call .invalidate() on the returned function to clear all cached entries,
 * or .invalidate(arg1, arg2, ...) to clear a specific key.
 *
 * @param {Function} fn - Async function to cache
 * @param {number} ttlMs - Cache TTL in milliseconds
 * @returns {Function} Cached version of the function
 */
function cachedAsync(fn, ttlMs) {
  const cache = new Map();
  const inflight = new Map();

  const wrapped = async function (...args) {
    const key = args.length === 0 ? '' : JSON.stringify(args);
    const entry = cache.get(key);

    if (entry && Date.now() - entry.time < ttlMs) {
      return entry.value;
    }

    // Deduplicate concurrent calls for the same key
    if (inflight.has(key)) {
      return inflight.get(key);
    }

    const promise = fn.apply(this, args).then(
      (value) => {
        cache.set(key, { value, time: Date.now() });
        inflight.delete(key);
        return value;
      },
      (err) => {
        inflight.delete(key);
        throw err;
      }
    );

    inflight.set(key, promise);
    return promise;
  };

  wrapped.invalidate = (...args) => {
    if (args.length === 0) cache.clear();
    else cache.delete(JSON.stringify(args));
  };

  return wrapped;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Command execution
  runCmd,
  runCmdFull,

  // Zombie/process management
  getZombieCount,
  cleanupZombies,
  getActiveProcessCount,
  startZombieReaper,
  stopZombieReaper,

  // Caching
  cachedAsync,

  // String utilities
  truncate,
  escapeHtml,
  formatDate,
  relativeTime,
};

