// lib/utils.js - General utility functions

const { exec, execFile, spawn } = require('child_process');

// ============================================================================
// PROCESS TRACKING & ZOMBIE PREVENTION
// ============================================================================

// Track active child processes for cleanup
const activeProcesses = new Set();

// Periodic zombie reaper - forces Node.js to check for dead children
let zombieReaperInterval = null;

/**
 * Start the zombie reaper interval
 * This periodically triggers Node's internal child process cleanup
 */
function startZombieReaper() {
  if (zombieReaperInterval) return;
  
  // Every 30 seconds, trigger cleanup by spawning a trivial process
  // This forces Node.js to check for and reap zombie children
  zombieReaperInterval = setInterval(() => {
    const cleanup = spawn('true', [], { 
      stdio: 'ignore',
      detached: false,
    });
    cleanup.on('close', () => {});
    cleanup.unref();
  }, 30000);
  
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
 * Get count of zombie child processes for this Node process
 * @returns {Promise<{count: number, pids: number[]}>}
 */
async function getZombieCount() {
  try {
    const ppid = process.pid;
    const result = await runCmdFullInternal(
      `ps --ppid ${ppid} -o pid,stat | awk '$2 ~ /Z/ {print $1}'`
    );
    
    const pids = result.stdout
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(pid => parseInt(pid.trim(), 10))
      .filter(pid => !isNaN(pid));
    
    return {
      count: pids.length,
      pids,
    };
  } catch (e) {
    return { count: 0, pids: [], error: e.message };
  }
}

/**
 * Force cleanup of zombie processes by sending SIGCHLD to self
 * This triggers Node's internal waitpid() call
 * @returns {Promise<{cleaned: number, remaining: number}>}
 */
async function cleanupZombies() {
  const before = await getZombieCount();
  
  // Send SIGCHLD to ourselves to trigger waitpid
  process.kill(process.pid, 'SIGCHLD');
  
  // Wait a moment for cleanup
  await new Promise(r => setTimeout(r, 100));
  
  // Spawn a quick process to force another round of cleanup
  await runCmdFullInternal('true');
  
  const after = await getZombieCount();
  
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
  
  // String utilities
  truncate,
  escapeHtml,
  formatDate,
  relativeTime,
};

