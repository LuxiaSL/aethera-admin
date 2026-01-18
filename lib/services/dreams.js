// lib/services/dreams.js - Dreams/RunPod GPU management
// Provides admin control over the Dream Window GPU lifecycle
//
// Architecture:
// - Aethera (core) handles WebSocket connections, frame broadcasting, presence tracking
// - This service provides ADMIN OVERRIDE capabilities:
//   - Force start GPU (bypass presence requirements)
//   - Force stop GPU (immediate, no grace period)
//   - Direct RunPod API access for monitoring
//   - Status aggregation from both aethera and RunPod

const config = require('../../config');

// ============================================================================
// HTTP CLIENT SETUP
// ============================================================================

// Use native fetch (Node 18+) or fall back
const fetch = globalThis.fetch || require('node-fetch');

/**
 * Make a request to the RunPod API
 * @param {string} path - API path (without base URL)
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Response data
 */
async function runpodRequest(path, options = {}) {
  if (!config.RUNPOD_API_KEY) {
    throw new Error('RUNPOD_API_KEY not configured');
  }
  
  const url = `${config.RUNPOD_API_URL}${path}`;
  const headers = {
    'Authorization': `Bearer ${config.RUNPOD_API_KEY}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  const response = await fetch(url, {
    ...options,
    headers,
  });
  
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  
  if (!response.ok) {
    const error = new Error(`RunPod API error: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  
  return data;
}

/**
 * Make a request to the aethera API
 * @param {string} path - API path (without base URL)
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Response data
 */
async function aetheraRequest(path, options = {}) {
  const url = `${config.AETHERA_API_URL}${path}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      const error = new Error(`Aethera API error: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    
    return await response.json();
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Aethera not reachable - is the container running?');
    }
    throw error;
  }
}

// ============================================================================
// CONFIGURATION CHECK
// ============================================================================

/**
 * Check if RunPod is configured
 * @returns {boolean}
 */
function isConfigured() {
  return !!(config.RUNPOD_API_KEY && config.RUNPOD_ENDPOINT_ID);
}

/**
 * Get configuration status
 * @returns {Object}
 */
function getConfig() {
  return {
    configured: isConfigured(),
    hasApiKey: !!config.RUNPOD_API_KEY,
    hasEndpointId: !!config.RUNPOD_ENDPOINT_ID,
    endpointId: config.RUNPOD_ENDPOINT_ID ? 
      `${config.RUNPOD_ENDPOINT_ID.slice(0, 4)}...${config.RUNPOD_ENDPOINT_ID.slice(-4)}` : null,
    aetheraUrl: config.AETHERA_API_URL,
  };
}

// ============================================================================
// AETHERA STATUS (Proxy)
// ============================================================================

/**
 * Get dreams status from aethera
 * This shows the VPS-side view: viewers, GPU connection, frames
 * @returns {Promise<Object>}
 */
async function getAetheraStatus() {
  try {
    const data = await aetheraRequest('/api/dreams/status');
    return {
      available: true,
      ...data,
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
    };
  }
}

/**
 * Get dreams health from aethera
 * @returns {Promise<Object>}
 */
async function getAetheraHealth() {
  try {
    const data = await aetheraRequest('/api/dreams/health');
    return {
      available: true,
      ...data,
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
    };
  }
}

// ============================================================================
// RUNPOD ENDPOINT STATUS
// ============================================================================

/**
 * Get RunPod endpoint health/status
 * @returns {Promise<Object>}
 */
async function getEndpointHealth() {
  if (!isConfigured()) {
    return {
      configured: false,
      error: 'RunPod not configured',
    };
  }
  
  try {
    const data = await runpodRequest(`/${config.RUNPOD_ENDPOINT_ID}/health`);
    return {
      configured: true,
      available: true,
      ...data,
    };
  } catch (error) {
    return {
      configured: true,
      available: false,
      error: error.message,
    };
  }
}

/**
 * Get running jobs on the endpoint
 * @returns {Promise<Object>}
 */
async function getRunningJobs() {
  if (!isConfigured()) {
    return {
      configured: false,
      jobs: [],
    };
  }
  
  try {
    // RunPod doesn't have a "list jobs" endpoint directly,
    // but we can check the endpoint health which shows worker counts
    const health = await getEndpointHealth();
    
    return {
      configured: true,
      // Extract worker info from health response
      workers: health.workers || 0,
      activeWorkers: health.workersRunning || 0,
      idleWorkers: health.workersIdle || 0,
      queuedJobs: health.jobsInQueue || 0,
    };
  } catch (error) {
    return {
      configured: true,
      error: error.message,
    };
  }
}

// ============================================================================
// GPU LIFECYCLE CONTROL
// ============================================================================

// Track active job IDs (in memory - jobs started from this admin panel)
// This helps us cancel them even if aethera doesn't expose the job ID
const activeJobIds = new Set();

/**
 * Force start the GPU by submitting a RunPod job
 * This bypasses presence detection - use for admin override
 * @returns {Promise<Object>}
 */
async function startGpu() {
  if (!isConfigured()) {
    throw new Error('RunPod not configured');
  }
  
  try {
    // Submit a streaming job to RunPod
    // This is the same call that gpu_manager.start_gpu() makes
    const data = await runpodRequest(`/${config.RUNPOD_ENDPOINT_ID}/run`, {
      method: 'POST',
      body: JSON.stringify({
        input: {
          type: 'start',
          // The VPS WebSocket URL is configured in RunPod's env vars
          // so we don't need to send it here
        },
      }),
    });
    
    // Track this job ID so we can cancel it later
    if (data.id) {
      activeJobIds.add(data.id);
      console.log(`Tracking new job ID: ${data.id} (total tracked: ${activeJobIds.size})`);
    }
    
    return {
      success: true,
      jobId: data.id,
      status: data.status,
      message: 'GPU start job submitted',
    };
  } catch (error) {
    console.error('Failed to start GPU:', error);
    throw new Error(`Failed to start GPU: ${error.message}`);
  }
}

/**
 * Cancel a specific RunPod job
 * @param {string} jobId - Job ID to cancel
 * @returns {Promise<Object>}
 */
async function cancelJob(jobId) {
  try {
    const data = await runpodRequest(`/${config.RUNPOD_ENDPOINT_ID}/cancel/${jobId}`, {
      method: 'POST',
    });
    
    // Remove from our tracking
    activeJobIds.delete(jobId);
    
    return {
      success: true,
      jobId,
      status: data.status || 'cancelled',
      ...data,
    };
  } catch (error) {
    // Job may have already completed or been cancelled
    activeJobIds.delete(jobId);
    console.log(`Cancel job ${jobId} returned error (may already be done): ${error.message}`);
    return {
      success: false,
      jobId,
      error: error.message,
    };
  }
}

/**
 * FORCE STOP the GPU - comprehensive shutdown
 * 
 * This does multiple things to ensure the GPU is truly stopped:
 * 1. Cancel all tracked job IDs (jobs we started from admin)
 * 2. Try to get job ID from aethera status and cancel that too
 * 3. Purge the queue (stops any pending jobs)
 * 
 * Note: purge-queue only clears PENDING jobs, not RUNNING ones.
 * That's why we need to cancel specific job IDs.
 * 
 * @returns {Promise<Object>}
 */
async function forceStopGpu() {
  if (!isConfigured()) {
    throw new Error('RunPod not configured');
  }
  
  const results = {
    success: true,
    cancelledJobs: [],
    failedCancels: [],
    queuePurged: false,
    warnings: [],
  };
  
  try {
    // Step 1: Cancel all tracked job IDs
    const trackedIds = [...activeJobIds];
    console.log(`Force stop: cancelling ${trackedIds.length} tracked jobs`);
    
    for (const jobId of trackedIds) {
      const result = await cancelJob(jobId);
      if (result.success) {
        results.cancelledJobs.push(jobId);
      } else {
        results.failedCancels.push({ jobId, error: result.error });
      }
    }
    
    // Step 2: Try to get job ID from aethera's status and cancel it too
    // (In case a job was started by presence detection, not by admin)
    try {
      const aetheraStatus = await getAetheraStatus();
      
      // Check if aethera exposes the running job ID
      // The gpu_manager stores it in _running_job_id but we need to check
      // if it's exposed in the status endpoint
      const aetheraJobId = aetheraStatus.gpu?.running_job_id || 
                           aetheraStatus.gpu?.job_id ||
                           aetheraStatus.gpu?.instance_id;
      
      if (aetheraJobId && !results.cancelledJobs.includes(aetheraJobId)) {
        console.log(`Force stop: found job ID from aethera: ${aetheraJobId}`);
        const result = await cancelJob(aetheraJobId);
        if (result.success) {
          results.cancelledJobs.push(aetheraJobId);
        } else {
          results.failedCancels.push({ jobId: aetheraJobId, error: result.error, source: 'aethera' });
        }
      }
    } catch (error) {
      console.log('Could not get job ID from aethera:', error.message);
      results.warnings.push('Could not contact aethera to get job ID');
    }
    
    // Step 3: Purge the queue (clears any pending jobs that haven't started yet)
    try {
      await runpodRequest(`/${config.RUNPOD_ENDPOINT_ID}/purge-queue`, {
        method: 'POST',
      });
      results.queuePurged = true;
      console.log('Force stop: queue purged');
    } catch (error) {
      console.error('Failed to purge queue:', error.message);
      results.warnings.push(`Failed to purge queue: ${error.message}`);
    }
    
    // Step 4: Check if there are still workers running
    try {
      const health = await getEndpointHealth();
      if (health.workersRunning > 0) {
        results.warnings.push(
          `${health.workersRunning} worker(s) may still be running. ` +
          `If job IDs are unknown, the worker will stop when it completes its current task ` +
          `or when the WebSocket connection from aethera is closed.`
        );
      }
    } catch (error) {
      // Ignore health check errors
    }
    
    // Build summary message
    let message = '';
    if (results.cancelledJobs.length > 0) {
      message += `Cancelled ${results.cancelledJobs.length} job(s). `;
    }
    if (results.queuePurged) {
      message += 'Queue purged. ';
    }
    if (results.warnings.length > 0) {
      message += `Warnings: ${results.warnings.length}`;
    }
    if (!message) {
      message = 'No active jobs found to cancel.';
    }
    
    results.message = message.trim();
    return results;
    
  } catch (error) {
    console.error('Force stop error:', error);
    results.success = false;
    results.error = error.message;
    return results;
  }
}

/**
 * Simple stop - just cancels a specific job
 * Use forceStopGpu() for comprehensive shutdown
 * @param {string} [jobId] - Specific job ID to cancel (optional)
 * @returns {Promise<Object>}
 */
async function stopGpu(jobId = null) {
  if (!isConfigured()) {
    throw new Error('RunPod not configured');
  }
  
  // If specific job ID provided, just cancel that
  if (jobId) {
    return cancelJob(jobId);
  }
  
  // Otherwise, do a full force stop
  return forceStopGpu();
}

/**
 * Get list of tracked job IDs
 * @returns {string[]}
 */
function getTrackedJobIds() {
  return [...activeJobIds];
}

/**
 * Get status of a specific job
 * @param {string} jobId - Job ID
 * @returns {Promise<Object>}
 */
async function getJobStatus(jobId) {
  if (!isConfigured()) {
    throw new Error('RunPod not configured');
  }
  
  try {
    const data = await runpodRequest(`/${config.RUNPOD_ENDPOINT_ID}/status/${jobId}`);
    return data;
  } catch (error) {
    throw new Error(`Failed to get job status: ${error.message}`);
  }
}

// ============================================================================
// COMBINED STATUS
// ============================================================================

/**
 * GPU cost rate (approximate) - RTX 3060/3070 on RunPod
 * This is a rough estimate; actual rates vary
 */
const GPU_COST_PER_HOUR = 0.19; // USD, typical for 12GB GPU

/**
 * Get comprehensive status from all sources
 * Combines aethera status, RunPod endpoint health, and computed metrics
 * @returns {Promise<Object>}
 */
async function getStatus() {
  const [aetheraStatus, endpointHealth] = await Promise.all([
    getAetheraStatus(),
    getEndpointHealth(),
  ]);
  
  // Determine overall GPU state
  let gpuState = 'unknown';
  let gpuStateMessage = '';
  
  if (!isConfigured()) {
    gpuState = 'not_configured';
    gpuStateMessage = 'RunPod API not configured';
  } else if (aetheraStatus.available && aetheraStatus.gpu?.active) {
    gpuState = 'running';
    gpuStateMessage = 'GPU connected and streaming';
  } else if (aetheraStatus.available && aetheraStatus.gpu?.state === 'starting') {
    gpuState = 'starting';
    gpuStateMessage = 'GPU is starting up...';
  } else if (endpointHealth.available && (endpointHealth.workersRunning > 0 || endpointHealth.jobsInQueue > 0)) {
    gpuState = 'starting';
    gpuStateMessage = 'RunPod job active, waiting for GPU connection';
  } else {
    gpuState = 'idle';
    gpuStateMessage = 'GPU is not running';
  }
  
  // Calculate estimated cost from uptime
  const uptimeSeconds = aetheraStatus.gpu?.uptime_seconds || 0;
  const uptimeHours = uptimeSeconds / 3600;
  const estimatedCost = uptimeHours * GPU_COST_PER_HOUR;
  
  return {
    // Config status
    configured: isConfigured(),
    config: getConfig(),
    
    // Overall state
    state: gpuState,
    stateMessage: gpuStateMessage,
    
    // Aethera (VPS) status
    aethera: aetheraStatus.available ? {
      status: aetheraStatus.status,
      gpu: aetheraStatus.gpu,
      generation: aetheraStatus.generation,
      viewers: aetheraStatus.viewers,
      cache: aetheraStatus.cache,
      playback: aetheraStatus.playback,
    } : {
      error: aetheraStatus.error,
    },
    
    // RunPod endpoint status
    runpod: endpointHealth.available ? {
      workers: endpointHealth.workers || 0,
      workersRunning: endpointHealth.workersRunning || 0,
      workersIdle: endpointHealth.workersIdle || 0,
      jobsInQueue: endpointHealth.jobsInQueue || 0,
      jobsCompleted: endpointHealth.jobsCompleted || 0,
    } : {
      error: endpointHealth.error,
    },
    
    // Cost tracking (estimated)
    cost: {
      uptimeSeconds,
      uptimeFormatted: formatUptime(uptimeSeconds),
      hourlyRate: GPU_COST_PER_HOUR,
      estimatedSessionCost: Math.round(estimatedCost * 100) / 100,
      note: 'Estimated based on session uptime. Actual billing may differ.',
    },
  };
}

/**
 * Format uptime in a human-readable way
 * @param {number} seconds
 * @returns {string}
 */
function formatUptime(seconds) {
  if (!seconds || seconds < 1) return '0s';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Configuration
  isConfigured,
  getConfig,
  
  // Aethera status
  getAetheraStatus,
  getAetheraHealth,
  
  // RunPod status
  getEndpointHealth,
  getRunningJobs,
  getJobStatus,
  
  // GPU control
  startGpu,
  stopGpu,
  forceStopGpu,
  cancelJob,
  getTrackedJobIds,
  
  // Combined status
  getStatus,
  
  // Helpers
  formatUptime,
  GPU_COST_PER_HOUR,
};

