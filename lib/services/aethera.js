// lib/services/aethera.js - Aethera (Docker) service management
// Manages the aethera blog container via Docker commands

const config = require('../../config');
const { runCmd, runCmdFull } = require('../utils');

// ============================================================================
// CACHING (to reduce process spawning)
// ============================================================================

// Cache for status/health to avoid excessive process spawning
// These are called very frequently by SSE streams
const cache = {
  status: { data: null, timestamp: 0 },
  health: { data: null, timestamp: 0 },
};

// Cache TTL in milliseconds
const STATUS_CACHE_TTL = 3000;  // 3 seconds for docker inspect
const HEALTH_CACHE_TTL = 5000;  // 5 seconds for health checks

// ============================================================================
// DOCKER STATUS
// ============================================================================

/**
 * Check if Docker is available
 * @returns {Promise<boolean>}
 */
async function isDockerAvailable() {
  try {
    await runCmd('docker --version');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get status of the aethera container
 * Uses caching to reduce process spawning (called frequently by SSE)
 * @param {boolean} forceRefresh - Bypass cache
 * @returns {Promise<Object>} Container status
 */
async function getStatus(forceRefresh = false) {
  const containerName = config.AETHERA_CONTAINER_NAME;
  
  // Check cache first
  const now = Date.now();
  if (!forceRefresh && cache.status.data && (now - cache.status.timestamp) < STATUS_CACHE_TTL) {
    return cache.status.data;
  }
  
  // Check if Docker is available
  if (!await isDockerAvailable()) {
    const result = {
      available: false,
      running: false,
      error: 'Docker not available',
    };
    cache.status = { data: result, timestamp: now };
    return result;
  }
  
  try {
    // Get container info using docker inspect
    const inspectCmd = `docker inspect ${containerName} --format '{{json .}}'`;
    const result = await runCmdFull(inspectCmd);
    
    if (result.code !== 0) {
      // Container doesn't exist
      const notExistsResult = {
        available: true,
        exists: false,
        running: false,
        containerName,
      };
      cache.status = { data: notExistsResult, timestamp: Date.now() };
      return notExistsResult;
    }
    
    const info = JSON.parse(result.stdout.trim());
    
    // Extract relevant fields
    const state = info.State || {};
    const running = state.Running || false;
    const status = state.Status || 'unknown';
    const health = state.Health?.Status || null;
    const startedAt = state.StartedAt || null;
    const finishedAt = state.FinishedAt || null;
    const restartCount = info.RestartCount || 0;
    
    // Get port bindings
    const ports = info.NetworkSettings?.Ports || {};
    const portBindings = Object.entries(ports)
      .filter(([_, bindings]) => bindings && bindings.length > 0)
      .map(([container, bindings]) => ({
        container,
        host: bindings[0]?.HostPort || null,
      }));
    
    // Get image info
    const image = info.Config?.Image || info.Image || 'unknown';
    
    // Calculate uptime if running
    let uptime = null;
    if (running && startedAt) {
      const startTime = new Date(startedAt).getTime();
      const now = Date.now();
      uptime = Math.floor((now - startTime) / 1000); // seconds
    }
    
    const statusResult = {
      available: true,
      exists: true,
      running,
      status,
      health,
      containerName,
      image,
      startedAt: running ? startedAt : null,
      finishedAt: !running ? finishedAt : null,
      uptime,
      restartCount,
      ports: portBindings,
    };
    
    cache.status = { data: statusResult, timestamp: Date.now() };
    return statusResult;
  } catch (error) {
    console.error('Error getting container status:', error);
    const errorResult = {
      available: true,
      exists: false,
      running: false,
      error: error.message,
      containerName,
    };
    cache.status = { data: errorResult, timestamp: Date.now() };
    return errorResult;
  }
}

// ============================================================================
// CONTAINER LOGS
// ============================================================================

/**
 * Get logs from the aethera container
 * @param {number} lines - Number of lines to retrieve (tail)
 * @param {boolean} timestamps - Include timestamps
 * @returns {Promise<string>} Log content
 */
async function getLogs(lines = 200, timestamps = true) {
  const containerName = config.AETHERA_CONTAINER_NAME;
  
  if (!await isDockerAvailable()) {
    throw new Error('Docker not available');
  }
  
  try {
    const timestampFlag = timestamps ? '-t' : '';
    const cmd = `docker logs ${containerName} --tail ${lines} ${timestampFlag} 2>&1`;
    const logs = await runCmd(cmd);
    return logs;
  } catch (error) {
    // Check if container exists
    const status = await getStatus();
    if (!status.exists) {
      throw new Error(`Container '${containerName}' does not exist`);
    }
    throw new Error(`Failed to get logs: ${error.message}`);
  }
}

// ============================================================================
// CONTAINER CONTROL
// ============================================================================

/**
 * Restart the aethera container
 * @returns {Promise<Object>} Result
 */
async function restart() {
  const containerName = config.AETHERA_CONTAINER_NAME;
  
  if (!await isDockerAvailable()) {
    throw new Error('Docker not available');
  }
  
  // Check if container exists
  const status = await getStatus();
  if (!status.exists) {
    throw new Error(`Container '${containerName}' does not exist`);
  }
  
  try {
    // Use docker restart with a 10 second timeout
    const cmd = `docker restart -t 10 ${containerName}`;
    await runCmd(cmd);
    
    // Wait a moment for container to come back up
    await new Promise(r => setTimeout(r, 2000));
    
    // Get new status
    const newStatus = await getStatus();
    
    return {
      success: true,
      running: newStatus.running,
      status: newStatus.status,
    };
  } catch (error) {
    throw new Error(`Failed to restart container: ${error.message}`);
  }
}

/**
 * Stop the aethera container
 * @returns {Promise<Object>} Result
 */
async function stop() {
  const containerName = config.AETHERA_CONTAINER_NAME;
  
  if (!await isDockerAvailable()) {
    throw new Error('Docker not available');
  }
  
  const status = await getStatus();
  if (!status.exists) {
    throw new Error(`Container '${containerName}' does not exist`);
  }
  
  if (!status.running) {
    return {
      success: true,
      wasRunning: false,
    };
  }
  
  try {
    const cmd = `docker stop -t 10 ${containerName}`;
    await runCmd(cmd);
    
    return {
      success: true,
      wasRunning: true,
    };
  } catch (error) {
    throw new Error(`Failed to stop container: ${error.message}`);
  }
}

/**
 * Start the aethera container
 * @returns {Promise<Object>} Result
 */
async function start() {
  const containerName = config.AETHERA_CONTAINER_NAME;
  
  if (!await isDockerAvailable()) {
    throw new Error('Docker not available');
  }
  
  const status = await getStatus();
  if (!status.exists) {
    throw new Error(`Container '${containerName}' does not exist`);
  }
  
  if (status.running) {
    return {
      success: true,
      wasRunning: true,
    };
  }
  
  try {
    const cmd = `docker start ${containerName}`;
    await runCmd(cmd);
    
    // Wait a moment for container to start
    await new Promise(r => setTimeout(r, 2000));
    
    const newStatus = await getStatus();
    
    return {
      success: newStatus.running,
      wasRunning: false,
      running: newStatus.running,
    };
  } catch (error) {
    throw new Error(`Failed to start container: ${error.message}`);
  }
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Check if aethera is responding to health checks
 * Uses caching to reduce curl process spawning (called frequently by SSE)
 * @param {boolean} forceRefresh - Bypass cache
 * @returns {Promise<Object>} Health status
 */
async function checkHealth(forceRefresh = false) {
  const apiUrl = config.AETHERA_API_URL;
  
  // Check cache first
  const now = Date.now();
  if (!forceRefresh && cache.health.data && (now - cache.health.timestamp) < HEALTH_CACHE_TTL) {
    return cache.health.data;
  }
  
  try {
    // Use curl to check health endpoint
    const cmd = `curl -sf ${apiUrl}/healthz --max-time 5`;
    const result = await runCmdFull(cmd);
    
    const healthResult = {
      healthy: result.code === 0,
      url: `${apiUrl}/healthz`,
      response: result.stdout || null,
    };
    
    cache.health = { data: healthResult, timestamp: now };
    return healthResult;
  } catch (error) {
    const errorResult = {
      healthy: false,
      url: `${apiUrl}/healthz`,
      error: error.message,
    };
    
    cache.health = { data: errorResult, timestamp: now };
    return errorResult;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Status
  isDockerAvailable,
  getStatus,
  checkHealth,
  
  // Logs
  getLogs,
  
  // Control
  start,
  stop,
  restart,
};


