// lib/services/membrane-api.js - membrane-api service management
// Manages the membrane-api LLM middleware via systemd

const config = require('../../config');
const { runCmd, runCmdFull, cachedAsync } = require('../utils');

// ============================================================================
// CACHING (to reduce process spawning)
// ============================================================================

// Cache for status/health to avoid excessive process spawning
const cache = {
  status: { data: null, timestamp: 0 },
  health: { data: null, timestamp: 0 },
};

// Cache TTL in milliseconds
const STATUS_CACHE_TTL = 3000;  // 3 seconds for systemctl status
const HEALTH_CACHE_TTL = 5000;  // 5 seconds for health checks

// Service name
const SERVICE_NAME = config.MEMBRANE_API_SERVICE_NAME || 'membrane-api';

// ============================================================================
// SYSTEMD STATUS
// ============================================================================

/**
 * Check if systemd is available
 * @returns {Promise<boolean>}
 */
async function isSystemdAvailable() {
  try {
    await runCmd('systemctl --version');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get status of the membrane-api service
 * Uses caching to reduce process spawning (called frequently by SSE)
 * @param {boolean} forceRefresh - Bypass cache
 * @returns {Promise<Object>} Service status
 */
async function getStatus(forceRefresh = false) {
  // Check cache first
  const now = Date.now();
  if (!forceRefresh && cache.status.data && (now - cache.status.timestamp) < STATUS_CACHE_TTL) {
    return cache.status.data;
  }
  
  // Check if systemd is available
  if (!await isSystemdAvailable()) {
    const result = {
      available: false,
      running: false,
      error: 'Systemd not available',
    };
    cache.status = { data: result, timestamp: now };
    return result;
  }
  
  try {
    // Check if service is active
    const activeResult = await runCmdFull(`systemctl is-active ${SERVICE_NAME}.service`);
    const state = activeResult.stdout.trim();
    const running = state === 'active';
    
    // Get more details
    let details = {};
    if (running) {
      try {
        const showResult = await runCmd(
          `systemctl show ${SERVICE_NAME}.service --property=MainPID,ActiveEnterTimestamp,MemoryCurrent`
        );
        const lines = showResult.split('\n');
        for (const line of lines) {
          const [key, value] = line.split('=');
          if (key && value) {
            details[key] = value;
          }
        }
      } catch (e) {
        // Ignore errors getting details
      }
    }
    
    // Parse uptime from ActiveEnterTimestamp
    let uptime = null;
    if (running && details.ActiveEnterTimestamp) {
      try {
        // ActiveEnterTimestamp format: "Mon 2025-01-31 20:30:00 UTC"
        const startTime = new Date(details.ActiveEnterTimestamp).getTime();
        if (!isNaN(startTime)) {
          uptime = Math.floor((Date.now() - startTime) / 1000);
        }
      } catch (e) {
        // Ignore parsing errors
      }
    }
    
    // Parse memory usage
    let memoryMb = null;
    if (details.MemoryCurrent && details.MemoryCurrent !== '[not set]') {
      const bytes = parseInt(details.MemoryCurrent, 10);
      if (!isNaN(bytes)) {
        memoryMb = Math.round(bytes / (1024 * 1024));
      }
    }
    
    const statusResult = {
      available: true,
      running,
      state,
      serviceName: SERVICE_NAME,
      pid: details.MainPID && details.MainPID !== '0' ? details.MainPID : null,
      startedAt: details.ActiveEnterTimestamp || null,
      uptime,
      memoryMb,
    };
    
    cache.status = { data: statusResult, timestamp: Date.now() };
    return statusResult;
  } catch (error) {
    console.error('Error getting membrane-api status:', error);
    const errorResult = {
      available: true,
      running: false,
      state: 'unknown',
      error: error.message,
      serviceName: SERVICE_NAME,
    };
    cache.status = { data: errorResult, timestamp: Date.now() };
    return errorResult;
  }
}

// ============================================================================
// SERVICE LOGS
// ============================================================================

/**
 * Get logs from the membrane-api service
 * @param {number} lines - Number of lines to retrieve (tail)
 * @returns {Promise<string>} Log content
 */
async function getLogs(lines = 200) {
  if (!await isSystemdAvailable()) {
    throw new Error('Systemd not available');
  }
  
  try {
    const cmd = `journalctl -u ${SERVICE_NAME}.service -n ${lines} --no-pager --output=short-iso`;
    const logs = await runCmd(cmd);
    return logs || '[No logs available]';
  } catch (error) {
    throw new Error(`Failed to get logs: ${error.message}`);
  }
}

// ============================================================================
// SERVICE CONTROL
// ============================================================================

/**
 * Restart the membrane-api service
 * @returns {Promise<Object>} Result
 */
async function restart() {
  if (!await isSystemdAvailable()) {
    throw new Error('Systemd not available');
  }
  
  try {
    const cmd = `systemctl restart ${SERVICE_NAME}.service`;
    await runCmd(cmd);
    
    // Wait a moment for service to come back up
    await new Promise(r => setTimeout(r, 2000));
    
    // Get new status
    const newStatus = await getStatus(true);
    
    return {
      success: newStatus.running,
      running: newStatus.running,
      state: newStatus.state,
    };
  } catch (error) {
    throw new Error(`Failed to restart service: ${error.message}`);
  }
}

/**
 * Stop the membrane-api service
 * @returns {Promise<Object>} Result
 */
async function stop() {
  if (!await isSystemdAvailable()) {
    throw new Error('Systemd not available');
  }
  
  const status = await getStatus();
  
  if (!status.running) {
    return {
      success: true,
      wasRunning: false,
    };
  }
  
  try {
    const cmd = `systemctl stop ${SERVICE_NAME}.service`;
    await runCmd(cmd);
    
    return {
      success: true,
      wasRunning: true,
    };
  } catch (error) {
    throw new Error(`Failed to stop service: ${error.message}`);
  }
}

/**
 * Start the membrane-api service
 * @returns {Promise<Object>} Result
 */
async function start() {
  if (!await isSystemdAvailable()) {
    throw new Error('Systemd not available');
  }
  
  const status = await getStatus();
  
  if (status.running) {
    return {
      success: true,
      wasRunning: true,
    };
  }
  
  try {
    const cmd = `systemctl start ${SERVICE_NAME}.service`;
    await runCmd(cmd);
    
    // Wait a moment for service to start
    await new Promise(r => setTimeout(r, 2000));
    
    const newStatus = await getStatus(true);
    
    return {
      success: newStatus.running,
      wasRunning: false,
      running: newStatus.running,
    };
  } catch (error) {
    throw new Error(`Failed to start service: ${error.message}`);
  }
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Check if membrane-api is responding to health checks
 * Uses caching to reduce curl process spawning (called frequently by SSE)
 * @param {boolean} forceRefresh - Bypass cache
 * @returns {Promise<Object>} Health status
 */
async function checkHealth(forceRefresh = false) {
  const apiUrl = config.MEMBRANE_API_URL;
  
  // Check cache first
  const now = Date.now();
  if (!forceRefresh && cache.health.data && (now - cache.health.timestamp) < HEALTH_CACHE_TTL) {
    return cache.health.data;
  }
  
  try {
    // Use curl to check health endpoint
    const cmd = `curl -sf ${apiUrl}/health --max-time 5`;
    const result = await runCmdFull(cmd);
    
    let healthData = null;
    let providers = {};
    
    if (result.code === 0 && result.stdout) {
      try {
        healthData = JSON.parse(result.stdout);
        providers = healthData.providers || {};
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    const healthResult = {
      healthy: result.code === 0,
      url: `${apiUrl}/health`,
      status: healthData?.status || 'unknown',
      version: healthData?.version || null,
      uptime: healthData?.uptime || null,
      providers,
    };
    
    cache.health = { data: healthResult, timestamp: now };
    return healthResult;
  } catch (error) {
    const errorResult = {
      healthy: false,
      url: `${apiUrl}/health`,
      error: error.message,
    };
    
    cache.health = { data: errorResult, timestamp: now };
    return errorResult;
  }
}

/**
 * Get membrane-api stats (sessions, providers)
 * @returns {Promise<Object>} Stats
 */
async function getStats() {
  const apiUrl = config.MEMBRANE_API_URL;
  
  try {
    const cmd = `curl -sf ${apiUrl}/v1/stats --max-time 5`;
    const result = await runCmdFull(cmd);
    
    if (result.code === 0 && result.stdout) {
      return JSON.parse(result.stdout);
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Get list of available models
 * @returns {Promise<Object>} Models response
 */
async function getModels() {
  const apiUrl = config.MEMBRANE_API_URL;
  
  try {
    const cmd = `curl -sf ${apiUrl}/v1/models --max-time 5`;
    const result = await runCmdFull(cmd);
    
    if (result.code === 0 && result.stdout) {
      return JSON.parse(result.stdout);
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Service name
  SERVICE_NAME,

  // Status (cached for SSE polling)
  isSystemdAvailable,
  getStatus: cachedAsync(getStatus, 5000),
  checkHealth: cachedAsync(checkHealth, 10000),

  // Stats
  getStats,
  getModels,

  // Logs
  getLogs,

  // Control (NOT cached)
  start,
  stop,
  restart,
};

