// lib/services/server.js - Server monitoring and metrics
// Provides system metrics, log management, and health checks

const fs = require('fs');
const os = require('os');
const { runCmd, runCmdFull } = require('../utils');

// ============================================================================
// CPU METRICS
// ============================================================================

// Store previous CPU times for calculating usage percentage
let prevCpuTimes = null;

/**
 * Parse /proc/stat for CPU times
 * @returns {Object} CPU times by category
 */
function parseCpuTimes() {
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8');
    const cpuLine = stat.split('\n')[0]; // First line is aggregate CPU
    const parts = cpuLine.split(/\s+/);
    
    // cpu user nice system idle iowait irq softirq steal guest guest_nice
    return {
      user: parseInt(parts[1], 10),
      nice: parseInt(parts[2], 10),
      system: parseInt(parts[3], 10),
      idle: parseInt(parts[4], 10),
      iowait: parseInt(parts[5], 10) || 0,
      irq: parseInt(parts[6], 10) || 0,
      softirq: parseInt(parts[7], 10) || 0,
      steal: parseInt(parts[8], 10) || 0,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Calculate CPU usage percentage
 * @returns {Object} CPU usage info
 */
function getCpuUsage() {
  const current = parseCpuTimes();
  
  if (!current) {
    // Fallback: try using os module (less accurate)
    const cpus = os.cpus();
    const avgIdle = cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0) / cpus.length;
    const avgTotal = cpus.reduce((sum, cpu) => {
      const t = cpu.times;
      return sum + t.user + t.nice + t.sys + t.idle + t.irq;
    }, 0) / cpus.length;
    
    return {
      percent: Math.round((1 - avgIdle / avgTotal) * 100),
      cores: cpus.length,
    };
  }
  
  if (!prevCpuTimes) {
    prevCpuTimes = current;
    // First call, return estimate
    return {
      percent: 0,
      cores: os.cpus().length,
      user: 0,
      system: 0,
      iowait: 0,
    };
  }
  
  // Calculate deltas
  const userDelta = current.user - prevCpuTimes.user;
  const niceDelta = current.nice - prevCpuTimes.nice;
  const systemDelta = current.system - prevCpuTimes.system;
  const idleDelta = current.idle - prevCpuTimes.idle;
  const iowaitDelta = current.iowait - prevCpuTimes.iowait;
  const irqDelta = current.irq - prevCpuTimes.irq;
  const softirqDelta = current.softirq - prevCpuTimes.softirq;
  const stealDelta = current.steal - prevCpuTimes.steal;
  
  const totalDelta = userDelta + niceDelta + systemDelta + idleDelta + 
                     iowaitDelta + irqDelta + softirqDelta + stealDelta;
  
  prevCpuTimes = current;
  
  if (totalDelta === 0) {
    return {
      percent: 0,
      cores: os.cpus().length,
      user: 0,
      system: 0,
      iowait: 0,
    };
  }
  
  return {
    percent: Math.round(((totalDelta - idleDelta) / totalDelta) * 100),
    cores: os.cpus().length,
    user: Math.round((userDelta / totalDelta) * 100),
    system: Math.round((systemDelta / totalDelta) * 100),
    iowait: Math.round((iowaitDelta / totalDelta) * 100),
  };
}

// ============================================================================
// MEMORY METRICS
// ============================================================================

/**
 * Get memory usage info
 * @returns {Object} Memory stats
 */
function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  
  // Try to get more detailed info from /proc/meminfo
  let available = free;
  let cached = 0;
  let buffers = 0;
  
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const lines = meminfo.split('\n');
    
    for (const line of lines) {
      const [key, value] = line.split(':').map(s => s.trim());
      if (key === 'MemAvailable') {
        available = parseInt(value, 10) * 1024; // Convert from kB
      } else if (key === 'Cached') {
        cached = parseInt(value, 10) * 1024;
      } else if (key === 'Buffers') {
        buffers = parseInt(value, 10) * 1024;
      }
    }
  } catch (e) {
    // Use basic values
  }
  
  const actualUsed = total - available;
  
  return {
    total,
    used: actualUsed,
    free,
    available,
    cached,
    buffers,
    percent: Math.round((actualUsed / total) * 100),
    // Formatted values
    totalFormatted: formatBytes(total),
    usedFormatted: formatBytes(actualUsed),
    availableFormatted: formatBytes(available),
  };
}

// ============================================================================
// DISK METRICS
// ============================================================================

/**
 * Get disk usage for mounted filesystems
 * @returns {Promise<Array>} Disk usage per mount
 */
async function getDiskUsage() {
  try {
    const result = await runCmdFull('df -B1 --output=source,size,used,avail,pcent,target -x tmpfs -x devtmpfs -x squashfs 2>/dev/null');
    
    if (result.code !== 0) {
      // Fallback for non-Linux or different df version
      const fallback = await runCmdFull('df -k');
      return parseDfOutput(fallback.stdout, true);
    }
    
    return parseDfOutput(result.stdout, false);
  } catch (e) {
    return [];
  }
}

/**
 * Parse df output
 * @param {string} output - df command output
 * @param {boolean} isKb - Whether values are in KB (fallback mode)
 * @returns {Array} Parsed disk info
 */
function parseDfOutput(output, isKb = false) {
  const lines = output.trim().split('\n').slice(1); // Skip header
  const disks = [];
  
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    
    const source = parts[0];
    // Skip pseudo filesystems
    if (source.startsWith('/dev/loop') || source === 'overlay') continue;
    
    const multiplier = isKb ? 1024 : 1;
    const size = parseInt(parts[1], 10) * multiplier;
    const used = parseInt(parts[2], 10) * multiplier;
    const avail = parseInt(parts[3], 10) * multiplier;
    const percentStr = parts[4];
    const mount = parts.slice(5).join(' ');
    
    // Only include real mounts we care about
    if (!mount.startsWith('/') || mount.startsWith('/snap')) continue;
    
    disks.push({
      source,
      mount,
      size,
      used,
      available: avail,
      percent: parseInt(percentStr, 10) || Math.round((used / size) * 100),
      sizeFormatted: formatBytes(size),
      usedFormatted: formatBytes(used),
      availableFormatted: formatBytes(avail),
    });
  }
  
  return disks;
}

// ============================================================================
// LOAD AVERAGE & UPTIME
// ============================================================================

/**
 * Get system load average
 * @returns {Object} Load averages
 */
function getLoadAverage() {
  const loads = os.loadavg();
  const cpuCount = os.cpus().length;
  
  return {
    load1: loads[0].toFixed(2),
    load5: loads[1].toFixed(2),
    load15: loads[2].toFixed(2),
    cpuCount,
    // Normalized (per-CPU) percentages
    load1Percent: Math.min(100, Math.round((loads[0] / cpuCount) * 100)),
    load5Percent: Math.min(100, Math.round((loads[1] / cpuCount) * 100)),
    load15Percent: Math.min(100, Math.round((loads[2] / cpuCount) * 100)),
  };
}

/**
 * Get system uptime
 * @returns {Object} Uptime info
 */
function getUptime() {
  const uptimeSeconds = os.uptime();
  
  return {
    seconds: uptimeSeconds,
    formatted: formatUptime(uptimeSeconds),
  };
}

// ============================================================================
// NETWORK DIAGNOSTICS
// ============================================================================

/**
 * Ping a host and return latency
 * @param {string} host - Host to ping
 * @returns {Promise<Object>} Ping result
 */
async function pingHost(host = '8.8.8.8') {
  try {
    const start = Date.now();
    const result = await runCmdFull(`ping -c 1 -W 3 ${host}`);
    const elapsed = Date.now() - start;
    
    if (result.code !== 0) {
      return {
        host,
        success: false,
        error: 'Host unreachable',
      };
    }
    
    // Parse ping output for actual RTT
    const match = result.stdout.match(/time[=<](\d+\.?\d*)/);
    const latency = match ? parseFloat(match[1]) : elapsed;
    
    return {
      host,
      success: true,
      latency: Math.round(latency * 100) / 100,
      latencyMs: `${Math.round(latency)}ms`,
    };
  } catch (e) {
    return {
      host,
      success: false,
      error: e.message,
    };
  }
}

/**
 * Check network connectivity to multiple hosts
 * @returns {Promise<Object>} Network status
 */
async function checkNetworkStatus() {
  const hosts = [
    { name: 'Google DNS', host: '8.8.8.8' },
    { name: 'Cloudflare', host: '1.1.1.1' },
  ];
  
  const results = await Promise.all(
    hosts.map(async ({ name, host }) => ({
      name,
      ...await pingHost(host),
    }))
  );
  
  const successCount = results.filter(r => r.success).length;
  const avgLatency = results
    .filter(r => r.success)
    .reduce((sum, r) => sum + r.latency, 0) / (successCount || 1);
  
  return {
    status: successCount === hosts.length ? 'connected' : 
            successCount > 0 ? 'degraded' : 'offline',
    hosts: results,
    avgLatency: Math.round(avgLatency),
  };
}

// ============================================================================
// LOG MANAGEMENT
// ============================================================================

/**
 * Get journalctl disk usage
 * @returns {Promise<Object>} Journal size info
 */
async function getJournalSize() {
  try {
    const result = await runCmd('journalctl --disk-usage 2>/dev/null');
    // Output: "Archived and active journals take up 123.4M in the file system."
    const match = result.match(/take up ([\d.]+\s*\w+)/i);
    
    return {
      available: true,
      size: match ? match[1] : 'Unknown',
      raw: result.trim(),
    };
  } catch (e) {
    return {
      available: false,
      error: e.message,
    };
  }
}

/**
 * Vacuum journalctl logs
 * @param {Object} options - Vacuum options
 * @param {string} options.size - Max size (e.g., '500M')
 * @param {string} options.time - Max age (e.g., '7d')
 * @returns {Promise<Object>} Result
 */
async function vacuumJournalLogs(options = {}) {
  const { size = '500M', time } = options;
  
  try {
    // Get size before
    const before = await getJournalSize();
    
    // Run vacuum
    let cmd = 'journalctl --vacuum-size=' + size;
    if (time) {
      cmd = 'journalctl --vacuum-time=' + time;
    }
    
    const result = await runCmdFull(`sudo ${cmd} 2>&1 || ${cmd} 2>&1`);
    
    // Get size after
    const after = await getJournalSize();
    
    return {
      success: result.code === 0,
      output: result.stdout + result.stderr,
      sizeBefore: before.size,
      sizeAfter: after.size,
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
    };
  }
}

/**
 * Get Docker system disk usage
 * @returns {Promise<Object>} Docker disk usage
 */
async function getDockerDiskUsage() {
  try {
    const result = await runCmdFull('docker system df -v --format json 2>/dev/null');
    
    if (result.code !== 0) {
      // Try without --format json (older Docker versions)
      const fallback = await runCmdFull('docker system df 2>/dev/null');
      if (fallback.code !== 0) {
        return { available: false, error: 'Docker not available' };
      }
      
      return {
        available: true,
        raw: fallback.stdout,
      };
    }
    
    // Parse JSON output (one per line)
    const lines = result.stdout.trim().split('\n').filter(l => l);
    const data = lines.map(l => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
    
    return {
      available: true,
      data,
      raw: result.stdout,
    };
  } catch (e) {
    return {
      available: false,
      error: e.message,
    };
  }
}

/**
 * Prune Docker system (unused data)
 * @returns {Promise<Object>} Result
 */
async function pruneDocker() {
  try {
    const result = await runCmdFull('docker system prune -f 2>&1');
    
    return {
      success: result.code === 0,
      output: result.stdout + result.stderr,
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
    };
  }
}

// ============================================================================
// AGGREGATE METRICS
// ============================================================================

/**
 * Get all system metrics in one call
 * @returns {Promise<Object>} All metrics
 */
async function getAllMetrics() {
  const [disk, journal] = await Promise.all([
    getDiskUsage(),
    getJournalSize(),
  ]);
  
  return {
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpu: getCpuUsage(),
    memory: getMemoryUsage(),
    disk,
    load: getLoadAverage(),
    uptime: getUptime(),
    journal,
  };
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Bytes to format
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format uptime seconds to human-readable string
 * @param {number} seconds - Seconds
 * @returns {string} Formatted uptime
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  
  return parts.join(' ');
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // CPU
  getCpuUsage,
  
  // Memory
  getMemoryUsage,
  
  // Disk
  getDiskUsage,
  
  // Load & Uptime
  getLoadAverage,
  getUptime,
  
  // Network
  pingHost,
  checkNetworkStatus,
  
  // Logs
  getJournalSize,
  vacuumJournalLogs,
  getDockerDiskUsage,
  pruneDocker,
  
  // Aggregate
  getAllMetrics,
  
  // Utils
  formatBytes,
  formatUptime,
};

