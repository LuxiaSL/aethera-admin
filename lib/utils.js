// lib/utils.js - General utility functions

const { exec } = require('child_process');

// ============================================================================
// COMMAND EXECUTION
// ============================================================================

/**
 * Run a shell command and return promise
 * @param {string} cmd - Command to execute
 * @param {Object} options - Options for exec
 * @returns {Promise<string>} - Command output (stdout)
 */
function runCmd(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 10, ...options }, (err, stdout, stderr) => {
      if (err && !stdout) {
        reject(err);
      } else {
        resolve(stdout || stderr || '');
      }
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
    exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: err ? err.code || 1 : 0,
      });
    });
  });
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
// EXPORTS
// ============================================================================

module.exports = {
  runCmd,
  runCmdFull,
  truncate,
  escapeHtml,
  formatDate,
  relativeTime,
};

