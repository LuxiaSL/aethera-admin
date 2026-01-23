// lib/services/dreams.js - Dreams/RunPod GPU management
// Provides admin control over the Dream Window GPU lifecycle
//
// Architecture (Two-Pod):
// - Aethera (core) handles WebSocket connections, frame broadcasting, presence tracking
// - ComfyUI Pod: Runs SD 1.5 for image generation (RTX 4070, ~$0.20/hr)
// - DreamGen Pod: Runs orchestration + VAE interpolation (RTX 3060, ~$0.10/hr)
// - This service provides ADMIN OVERRIDE capabilities:
//   - Pod lifecycle management via RunPod GraphQL API
//   - Force start/stop pods (bypass presence requirements)
//   - Status aggregation from aethera, RunPod, and ComfyUI registry
//
// Note: The Python SDK is for serverless endpoints. Pods use GraphQL API.

const config = require('../../config');

// ============================================================================
// CACHING (to reduce HTTP requests to aethera)
// ============================================================================

// Cache for aethera status to avoid excessive HTTP requests
// This endpoint is called frequently by SSE streams
const cache = {
  aetheraStatus: { data: null, timestamp: 0 },
  endpointHealth: { data: null, timestamp: 0 },
};

// Cache TTL in milliseconds
const AETHERA_STATUS_CACHE_TTL = 5000;  // 5 seconds
const ENDPOINT_HEALTH_CACHE_TTL = 10000; // 10 seconds (RunPod API is slower)
const POD_STATUS_CACHE_TTL = 10000; // 10 seconds for pod status

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
 * Check if two-pod architecture is configured
 * @returns {boolean}
 */
function isConfigured() {
  return !!(config.RUNPOD_API_KEY && config.RUNPOD_COMFYUI_POD_ID && config.RUNPOD_DREAMGEN_POD_ID);
}

/**
 * Check if legacy serverless is configured (deprecated)
 * @returns {boolean}
 */
function isServerlessConfigured() {
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
    // Two-pod architecture (primary)
    hasComfyuiPodId: !!config.RUNPOD_COMFYUI_POD_ID,
    hasDreamgenPodId: !!config.RUNPOD_DREAMGEN_POD_ID,
    comfyuiPodId: config.RUNPOD_COMFYUI_POD_ID ? 
      `${config.RUNPOD_COMFYUI_POD_ID.slice(0, 4)}...` : null,
    dreamgenPodId: config.RUNPOD_DREAMGEN_POD_ID ? 
      `${config.RUNPOD_DREAMGEN_POD_ID.slice(0, 4)}...` : null,
    // Legacy serverless (deprecated)
    hasEndpointId: !!config.RUNPOD_ENDPOINT_ID,
    serverlessConfigured: isServerlessConfigured(),
    aetheraUrl: config.AETHERA_API_URL,
  };
}

// ============================================================================
// AETHERA STATUS (Proxy)
// ============================================================================

/**
 * Get dreams status from aethera
 * This shows the VPS-side view: viewers, GPU connection, frames
 * Uses caching to reduce HTTP requests (called frequently by SSE)
 * @param {boolean} forceRefresh - Bypass cache
 * @returns {Promise<Object>}
 */
async function getAetheraStatus(forceRefresh = false) {
  // Check cache first
  const now = Date.now();
  if (!forceRefresh && cache.aetheraStatus.data && (now - cache.aetheraStatus.timestamp) < AETHERA_STATUS_CACHE_TTL) {
    return cache.aetheraStatus.data;
  }
  
  try {
    const data = await aetheraRequest('/api/dreams/status');
    const result = {
      available: true,
      ...data,
    };
    cache.aetheraStatus = { data: result, timestamp: now };
    return result;
  } catch (error) {
    const result = {
      available: false,
      error: error.message,
    };
    cache.aetheraStatus = { data: result, timestamp: now };
    return result;
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
 * Uses caching to reduce API calls (called frequently by SSE)
 * @param {boolean} forceRefresh - Bypass cache
 * @returns {Promise<Object>}
 */
async function getEndpointHealth(forceRefresh = false) {
  if (!isConfigured()) {
    return {
      configured: false,
      error: 'RunPod not configured',
    };
  }
  
  // Check cache first
  const now = Date.now();
  if (!forceRefresh && cache.endpointHealth.data && (now - cache.endpointHealth.timestamp) < ENDPOINT_HEALTH_CACHE_TTL) {
    return cache.endpointHealth.data;
  }
  
  try {
    const data = await runpodRequest(`/${config.RUNPOD_ENDPOINT_ID}/health`);
    
    // RunPod returns nested objects for workers and jobs - flatten them
    const workers = data.workers || {};
    const jobs = data.jobs || {};
    
    // Calculate total workers
    const totalWorkers = Object.values(workers).reduce((sum, n) => sum + (n || 0), 0);
    
    const result = {
      configured: true,
      available: true,
      // Flattened worker counts
      workers: totalWorkers,
      workersRunning: workers.running || 0,
      workersIdle: workers.idle || 0,
      workersReady: workers.ready || 0,
      workersInitializing: workers.initializing || 0,
      // Flattened job counts
      jobsInQueue: jobs.inQueue || 0,
      jobsInProgress: jobs.inProgress || 0,
      jobsCompleted: jobs.completed || 0,
      jobsFailed: jobs.failed || 0,
      // Keep raw data too
      raw: data,
    };
    
    cache.endpointHealth = { data: result, timestamp: now };
    return result;
  } catch (error) {
    const result = {
      configured: true,
      available: false,
      error: error.message,
    };
    cache.endpointHealth = { data: result, timestamp: now };
    return result;
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
// RUNPOD GRAPHQL API (for Pod Management)
// ============================================================================
// The Python SDK is for serverless endpoints. Pods use the GraphQL API.
// Reference: https://docs.runpod.io/api-reference/graphql

const RUNPOD_GRAPHQL_URL = 'https://api.runpod.io/graphql';

// Cache for pod status
const podStatusCache = {
  comfyui: { data: null, timestamp: 0 },
  dreamgen: { data: null, timestamp: 0 },
};

/**
 * Make a GraphQL request to RunPod API
 * @param {string} query - GraphQL query or mutation
 * @param {Object} variables - Query variables
 * @returns {Promise<Object>} Response data
 */
async function graphqlRequest(query, variables = {}) {
  if (!config.RUNPOD_API_KEY) {
    throw new Error('RUNPOD_API_KEY not configured');
  }
  
  const response = await fetch(RUNPOD_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  
  const data = await response.json();
  
  if (data.errors) {
    const errorMsg = data.errors.map(e => e.message).join(', ');
    throw new Error(`GraphQL error: ${errorMsg}`);
  }
  
  return data.data;
}

/**
 * Get pod status from RunPod GraphQL API
 * @param {string} podId - Pod ID
 * @param {boolean} forceRefresh - Bypass cache
 * @returns {Promise<Object|null>} Pod status or null if not found
 */
async function getPodStatus(podId, forceRefresh = false) {
  if (!podId) {
    return null;
  }
  
  // Check cache
  const cacheKey = podId === config.RUNPOD_COMFYUI_POD_ID ? 'comfyui' : 
                   podId === config.RUNPOD_DREAMGEN_POD_ID ? 'dreamgen' : null;
  
  if (cacheKey && !forceRefresh) {
    const cached = podStatusCache[cacheKey];
    if (cached.data && (Date.now() - cached.timestamp) < POD_STATUS_CACHE_TTL) {
      return cached.data;
    }
  }
  
  const query = `
    query getPod($podId: String!) {
      pod(input: { podId: $podId }) {
        id
        name
        desiredStatus
        lastStatusChange
        imageName
        machineId
        machine {
          podHostId
        }
        runtime {
          uptimeInSeconds
          ports {
            ip
            isIpPublic
            privatePort
            publicPort
          }
          gpus {
            id
            gpuUtilPercent
            memoryUtilPercent
          }
        }
      }
    }
  `;
  
  try {
    const data = await graphqlRequest(query, { podId });
    const pod = data.pod;
    
    // Cache the result
    if (cacheKey) {
      podStatusCache[cacheKey] = { data: pod, timestamp: Date.now() };
    }
    
    return pod;
  } catch (error) {
    console.error(`Failed to get pod status for ${podId}:`, error.message);
    return null;
  }
}

/**
 * Start (resume) a stopped pod
 * Uses RunPod REST API: POST /pods/{podId}/start
 * Reference: https://docs.runpod.io/api-reference/pods/POST/pods/podId/start
 * 
 * @param {string} podId - Pod ID
 * @returns {Promise<Object>} Result
 */
async function startPod(podId) {
  if (!podId) {
    throw new Error('Pod ID required');
  }
  
  if (!config.RUNPOD_API_KEY) {
    throw new Error('RUNPOD_API_KEY not configured');
  }
  
  const url = `https://rest.runpod.io/v1/pods/${podId}/start`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.RUNPOD_API_KEY}`,
    },
  });
  
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  
  if (!response.ok) {
    const error = new Error(`RunPod API error: ${response.status} - ${JSON.stringify(data)}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  
  console.log(`Pod ${podId} start requested:`, data);
  
  // Clear cache
  const cacheKey = podId === config.RUNPOD_COMFYUI_POD_ID ? 'comfyui' : 
                   podId === config.RUNPOD_DREAMGEN_POD_ID ? 'dreamgen' : null;
  if (cacheKey) {
    podStatusCache[cacheKey] = { data: null, timestamp: 0 };
  }
  
  return {
    success: true,
    pod: data,
    message: `Pod ${podId} start requested`,
  };
}

/**
 * Update a pod (triggers reset and pulls latest image)
 * Uses RunPod REST API: PATCH /pods/{podId}
 * Reference: https://docs.runpod.io/api-reference/pods/PATCH/pods/podId
 * 
 * @param {string} podId - Pod ID
 * @param {Object} updates - Fields to update (imageName, env, etc.)
 * @returns {Promise<Object>} Result
 */
async function updatePod(podId, updates = {}) {
  if (!podId) {
    throw new Error('Pod ID required');
  }
  
  if (!config.RUNPOD_API_KEY) {
    throw new Error('RUNPOD_API_KEY not configured');
  }
  
  // Use REST API for pod updates (triggers reset)
  const url = `https://rest.runpod.io/v1/pods/${podId}`;
  
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.RUNPOD_API_KEY}`,
    },
    body: JSON.stringify(updates),
  });
  
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  
  if (!response.ok) {
    const error = new Error(`RunPod API error: ${response.status} - ${JSON.stringify(data)}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  
  console.log(`Pod ${podId} updated:`, data);
  
  // Clear cache for this pod
  const cacheKey = podId === config.RUNPOD_COMFYUI_POD_ID ? 'comfyui' : 
                   podId === config.RUNPOD_DREAMGEN_POD_ID ? 'dreamgen' : null;
  if (cacheKey) {
    podStatusCache[cacheKey] = { data: null, timestamp: 0 };
  }
  
  return {
    success: true,
    pod: data,
    message: `Pod ${podId} update triggered (will reset and pull latest image)`,
  };
}

/**
 * Stop a running pod (pauses billing, keeps volume)
 * Uses RunPod REST API: POST /pods/{podId}/stop
 * Reference: https://docs.runpod.io/api-reference/pods/POST/pods/podId/stop
 * 
 * @param {string} podId - Pod ID
 * @returns {Promise<Object>} Result
 */
async function stopPod(podId) {
  if (!podId) {
    throw new Error('Pod ID required');
  }
  
  if (!config.RUNPOD_API_KEY) {
    throw new Error('RUNPOD_API_KEY not configured');
  }
  
  const url = `https://rest.runpod.io/v1/pods/${podId}/stop`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.RUNPOD_API_KEY}`,
    },
  });
  
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  
  if (!response.ok) {
    const error = new Error(`RunPod API error: ${response.status} - ${JSON.stringify(data)}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  
  console.log(`Pod ${podId} stop requested:`, data);
  
  // Clear cache
  const cacheKey = podId === config.RUNPOD_COMFYUI_POD_ID ? 'comfyui' : 
                   podId === config.RUNPOD_DREAMGEN_POD_ID ? 'dreamgen' : null;
  if (cacheKey) {
    podStatusCache[cacheKey] = { data: null, timestamp: 0 };
  }
  
  return {
    success: true,
    pod: data,
    message: `Pod ${podId} stop requested`,
  };
}

/**
 * Get pod billing information from RunPod REST API
 * Reference: https://docs.runpod.io/api-reference/billing/GET/billing/pods
 * 
 * @param {Object} options - Query options
 * @param {string} options.podId - Filter to specific pod
 * @param {string} options.bucketSize - 'hour', 'day', 'week', 'month', 'year'
 * @param {string} options.startTime - ISO date string
 * @param {string} options.endTime - ISO date string
 * @returns {Promise<Object>} Billing records
 */
async function getPodBilling(options = {}) {
  if (!config.RUNPOD_API_KEY) {
    throw new Error('RUNPOD_API_KEY not configured');
  }
  
  const params = new URLSearchParams();
  if (options.podId) params.append('podId', options.podId);
  if (options.bucketSize) params.append('bucketSize', options.bucketSize);
  if (options.startTime) params.append('startTime', options.startTime);
  if (options.endTime) params.append('endTime', options.endTime);
  params.append('grouping', 'podId');
  
  const url = `https://rest.runpod.io/v1/billing/pods?${params}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${config.RUNPOD_API_KEY}`,
    },
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
 * Get billing for our configured pods (ComfyUI + DreamGen)
 * @param {string} period - 'day', 'week', 'month'
 * @returns {Promise<Object>} Combined billing info
 */
async function getDreamsBilling(period = 'day') {
  const bucketSize = period === 'day' ? 'hour' : 'day';
  
  // Calculate time range
  const endTime = new Date().toISOString();
  let startTime;
  switch (period) {
    case 'day':
      startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      break;
    case 'week':
      startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      break;
    case 'month':
      startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      break;
    default:
      startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  }
  
  try {
    const records = await getPodBilling({ bucketSize, startTime, endTime });
    
    // Filter to our pods and aggregate
    const comfyuiPodId = config.RUNPOD_COMFYUI_POD_ID;
    const dreamgenPodId = config.RUNPOD_DREAMGEN_POD_ID;
    
    let comfyuiTotal = 0;
    let dreamgenTotal = 0;
    let comfyuiTime = 0;
    let dreamgenTime = 0;
    
    for (const record of records) {
      if (record.podId === comfyuiPodId) {
        comfyuiTotal += record.amount || 0;
        comfyuiTime += record.timeBilledMs || 0;
      } else if (record.podId === dreamgenPodId) {
        dreamgenTotal += record.amount || 0;
        dreamgenTime += record.timeBilledMs || 0;
      }
    }
    
    return {
      period,
      startTime,
      endTime,
      comfyui: {
        podId: comfyuiPodId,
        cost: Math.round(comfyuiTotal * 100) / 100,
        timeMs: comfyuiTime,
        timeFormatted: formatUptime(comfyuiTime / 1000),
      },
      dreamgen: {
        podId: dreamgenPodId,
        cost: Math.round(dreamgenTotal * 100) / 100,
        timeMs: dreamgenTime,
        timeFormatted: formatUptime(dreamgenTime / 1000),
      },
      total: Math.round((comfyuiTotal + dreamgenTotal) * 100) / 100,
      raw: records,
    };
  } catch (error) {
    console.error('Failed to get billing:', error.message);
    return {
      period,
      error: error.message,
      comfyui: { cost: 0 },
      dreamgen: { cost: 0 },
      total: 0,
    };
  }
}

/**
 * Get ComfyUI registry status from Aethera
 * @returns {Promise<Object>} Registry status
 */
async function getComfyUIRegistryStatus() {
  try {
    const data = await aetheraRequest('/api/dreams/comfyui/status');
    return data;
  } catch (error) {
    return {
      registered: false,
      error: error.message,
    };
  }
}

/**
 * Unregister ComfyUI from Aethera (called when stopping ComfyUI pod)
 * @returns {Promise<Object>} Result
 */
async function unregisterComfyUI() {
  try {
    // Need auth token for this endpoint
    const authToken = process.env.DREAM_GEN_AUTH_TOKEN;
    if (!authToken) {
      console.warn('DREAM_GEN_AUTH_TOKEN not set, cannot unregister ComfyUI');
      return { success: false, error: 'Auth token not configured' };
    }
    
    const response = await fetch(`${config.AETHERA_API_URL}/api/dreams/comfyui`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });
    
    if (response.ok) {
      return { success: true };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get generation state info from Aethera
 * @returns {Promise<Object>} State info
 */
async function getStateInfo() {
  try {
    const data = await aetheraRequest('/api/dreams/state');
    return data;
  } catch (error) {
    return {
      has_state: false,
      error: error.message,
    };
  }
}

/**
 * Clear saved generation state (for fresh start)
 * @returns {Promise<Object>} Result
 */
async function clearState() {
  try {
    const authToken = process.env.DREAM_GEN_AUTH_TOKEN;
    if (!authToken) {
      return { success: false, error: 'Auth token not configured' };
    }
    
    const response = await fetch(`${config.AETHERA_API_URL}/api/dreams/state`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });
    
    if (response.ok) {
      return { success: true };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// TWO-POD ORCHESTRATION
// ============================================================================

/**
 * Start the Dreams system (two-pod architecture)
 * 
 * Sequence:
 * 1. Start ComfyUI pod
 * 2. Wait for ComfyUI to register with VPS
 * 3. Start DreamGen pod
 * 
 * @returns {Promise<Object>} Result with pod statuses
 */
async function startDreams() {
  const comfyuiPodId = config.RUNPOD_COMFYUI_POD_ID;
  const dreamgenPodId = config.RUNPOD_DREAMGEN_POD_ID;
  
  if (!comfyuiPodId || !dreamgenPodId) {
    throw new Error('Pod IDs not configured (RUNPOD_COMFYUI_POD_ID and RUNPOD_DREAMGEN_POD_ID required)');
  }
  
  const results = {
    success: true,
    steps: [],
    warnings: [],
  };
  
  try {
    // Step 1: Start ComfyUI pod
    console.log('Starting ComfyUI pod...');
    results.steps.push({ step: 'start_comfyui', status: 'starting' });
    
    const comfyuiResult = await startPod(comfyuiPodId);
    results.steps[0].status = 'started';
    results.steps[0].pod = comfyuiResult.pod;
    
    // Step 2: Wait for ComfyUI to register with VPS
    console.log('Waiting for ComfyUI registration...');
    results.steps.push({ step: 'wait_registration', status: 'waiting' });
    
    let registered = false;
    const maxWaitTime = 5 * 60 * 1000; // 5 minutes
    const pollInterval = 5000; // 5 seconds
    const startTime = Date.now();
    
    while (!registered && (Date.now() - startTime) < maxWaitTime) {
      const registryStatus = await getComfyUIRegistryStatus();
      if (registryStatus.registered) {
        registered = true;
        results.steps[1].status = 'registered';
        results.steps[1].endpoint = registryStatus.endpoint;
        console.log('ComfyUI registered:', registryStatus.endpoint?.url);
        break;
      }
      
      await new Promise(r => setTimeout(r, pollInterval));
    }
    
    if (!registered) {
      results.steps[1].status = 'timeout';
      results.warnings.push('ComfyUI registration timeout - DreamGen may fail to connect');
      console.warn('ComfyUI registration timeout');
    }
    
    // Step 3: Start DreamGen pod
    console.log('Starting DreamGen pod...');
    results.steps.push({ step: 'start_dreamgen', status: 'starting' });
    
    const dreamgenResult = await startPod(dreamgenPodId);
    results.steps[2].status = 'started';
    results.steps[2].pod = dreamgenResult.pod;
    
    results.message = 'Dreams system starting';
    return results;
    
  } catch (error) {
    console.error('Failed to start Dreams:', error);
    results.success = false;
    results.error = error.message;
    return results;
  }
}

/**
 * Stop the Dreams system (two-pod architecture)
 * 
 * Sequence:
 * 1. Stop DreamGen pod (stops frame generation)
 * 2. Unregister ComfyUI from VPS
 * 3. Stop ComfyUI pod
 * 
 * @returns {Promise<Object>} Result
 */
async function stopDreams() {
  const comfyuiPodId = config.RUNPOD_COMFYUI_POD_ID;
  const dreamgenPodId = config.RUNPOD_DREAMGEN_POD_ID;
  
  const results = {
    success: true,
    steps: [],
    warnings: [],
  };
  
  try {
    // Step 1: Stop DreamGen pod first
    if (dreamgenPodId) {
      console.log('Stopping DreamGen pod...');
      results.steps.push({ step: 'stop_dreamgen', status: 'stopping' });
      
      try {
        const dreamgenResult = await stopPod(dreamgenPodId);
        results.steps[0].status = 'stopped';
        results.steps[0].pod = dreamgenResult.pod;
      } catch (error) {
        results.steps[0].status = 'error';
        results.steps[0].error = error.message;
        results.warnings.push(`DreamGen stop failed: ${error.message}`);
      }
    }
    
    // Step 2: Unregister ComfyUI from VPS
    console.log('Unregistering ComfyUI...');
    results.steps.push({ step: 'unregister_comfyui', status: 'unregistering' });
    
    const unregisterResult = await unregisterComfyUI();
    results.steps[1].status = unregisterResult.success ? 'unregistered' : 'error';
    if (!unregisterResult.success) {
      results.warnings.push(`ComfyUI unregister failed: ${unregisterResult.error}`);
    }
    
    // Step 3: Stop ComfyUI pod
    if (comfyuiPodId) {
      console.log('Stopping ComfyUI pod...');
      results.steps.push({ step: 'stop_comfyui', status: 'stopping' });
      
      try {
        const comfyuiResult = await stopPod(comfyuiPodId);
        results.steps[2].status = 'stopped';
        results.steps[2].pod = comfyuiResult.pod;
      } catch (error) {
        results.steps[2].status = 'error';
        results.steps[2].error = error.message;
        results.warnings.push(`ComfyUI stop failed: ${error.message}`);
      }
    }
    
    results.message = 'Dreams system stopped';
    return results;
    
  } catch (error) {
    console.error('Failed to stop Dreams:', error);
    results.success = false;
    results.error = error.message;
    return results;
  }
}

/**
 * Get comprehensive Dreams status (two-pod architecture)
 * @returns {Promise<Object>} Combined status
 */
async function getDreamsStatus() {
  const comfyuiPodId = config.RUNPOD_COMFYUI_POD_ID;
  const dreamgenPodId = config.RUNPOD_DREAMGEN_POD_ID;
  
  // Fetch all statuses in parallel
  const [comfyuiPod, dreamgenPod, registryStatus, aetheraStatus, stateInfo] = await Promise.all([
    comfyuiPodId ? getPodStatus(comfyuiPodId) : null,
    dreamgenPodId ? getPodStatus(dreamgenPodId) : null,
    getComfyUIRegistryStatus(),
    getAetheraStatus(),
    getStateInfo(),
  ]);
  
  // Determine overall state
  let overallState = 'unknown';
  let stateMessage = '';
  
  const comfyuiRunning = comfyuiPod?.desiredStatus === 'RUNNING';
  const dreamgenRunning = dreamgenPod?.desiredStatus === 'RUNNING';
  const gpuConnected = aetheraStatus.available && aetheraStatus.gpu?.active;
  
  if (!comfyuiPodId && !dreamgenPodId) {
    overallState = 'not_configured';
    stateMessage = 'Pod IDs not configured';
  } else if (gpuConnected) {
    overallState = 'running';
    stateMessage = 'Dreams flowing...';
  } else if (comfyuiRunning && dreamgenRunning) {
    overallState = 'starting';
    stateMessage = 'Pods running, waiting for connection...';
  } else if (comfyuiRunning || dreamgenRunning) {
    overallState = 'partial';
    stateMessage = 'One pod running';
  } else {
    overallState = 'idle';
    stateMessage = 'Dream machine sleeping...';
  }
  
  // Calculate costs
  const comfyuiUptime = comfyuiPod?.runtime?.uptimeInSeconds || 0;
  const dreamgenUptime = dreamgenPod?.runtime?.uptimeInSeconds || 0;
  const comfyuiCost = (comfyuiUptime / 3600) * (config.COMFYUI_COST_PER_HOUR || 0.20);
  const dreamgenCost = (dreamgenUptime / 3600) * (config.DREAMGEN_COST_PER_HOUR || 0.10);
  
  return {
    // Configuration
    configured: !!(comfyuiPodId && dreamgenPodId),
    config: {
      comfyuiPodId: comfyuiPodId ? `${comfyuiPodId.slice(0, 4)}...` : null,
      dreamgenPodId: dreamgenPodId ? `${dreamgenPodId.slice(0, 4)}...` : null,
      aetheraUrl: config.AETHERA_API_URL,
    },
    
    // Overall state
    state: overallState,
    stateMessage,
    
    // Pod statuses
    pods: {
      comfyui: comfyuiPod ? {
        id: comfyuiPod.id,
        name: comfyuiPod.name,
        status: comfyuiPod.desiredStatus,
        uptime: comfyuiUptime,
        uptimeFormatted: formatUptime(comfyuiUptime),
        gpu: comfyuiPod.runtime?.gpus?.[0] || null,
      } : null,
      dreamgen: dreamgenPod ? {
        id: dreamgenPod.id,
        name: dreamgenPod.name,
        status: dreamgenPod.desiredStatus,
        uptime: dreamgenUptime,
        uptimeFormatted: formatUptime(dreamgenUptime),
        gpu: dreamgenPod.runtime?.gpus?.[0] || null,
      } : null,
    },
    
    // ComfyUI registry
    registry: registryStatus,
    
    // Aethera status
    aethera: aetheraStatus.available ? {
      status: aetheraStatus.status,
      gpu: aetheraStatus.gpu,
      generation: aetheraStatus.generation,
      viewers: aetheraStatus.viewers,
    } : {
      error: aetheraStatus.error,
    },
    
    // Saved state info
    state: stateInfo,
    
    // Cost tracking
    cost: {
      comfyui: {
        uptime: comfyuiUptime,
        hourlyRate: config.COMFYUI_COST_PER_HOUR || 0.20,
        sessionCost: Math.round(comfyuiCost * 100) / 100,
      },
      dreamgen: {
        uptime: dreamgenUptime,
        hourlyRate: config.DREAMGEN_COST_PER_HOUR || 0.10,
        sessionCost: Math.round(dreamgenCost * 100) / 100,
      },
      total: Math.round((comfyuiCost + dreamgenCost) * 100) / 100,
    },
  };
}

// ============================================================================
// GPU LIFECYCLE CONTROL (Legacy Serverless - kept for backwards compatibility)
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
 * Tell Aethera to abort GPU startup / stop the GPU
 * This is separate from RunPod job cancellation - it tells Aethera's
 * GPU manager to stop its health check loop and reset to IDLE state.
 * 
 * @returns {Promise<Object>}
 */
async function stopAetheraGpu() {
  try {
    const result = await aetheraRequest('/api/dreams/stop', {
      method: 'POST',
    });
    console.log('Aethera GPU stop result:', result);
    return {
      success: result.success,
      previousState: result.previous_state,
      newState: result.new_state,
    };
  } catch (error) {
    console.log('Could not stop Aethera GPU:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * FORCE STOP the GPU - comprehensive shutdown
 * 
 * This does multiple things to ensure the GPU is truly stopped:
 * 1. Tell Aethera to abort startup (stops health check loop, resets state)
 * 2. Cancel all tracked job IDs (jobs we started from admin)
 * 3. Try to get job ID from aethera status and cancel that too
 * 4. Purge the queue (stops any pending jobs)
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
    aetheraAborted: false,
    warnings: [],
  };
  
  try {
    // Step 0: Tell Aethera to abort startup (CRITICAL - do this FIRST)
    // This stops the health check loop and resets state to IDLE immediately
    try {
      const aetheraStopResult = await stopAetheraGpu();
      if (aetheraStopResult.success) {
        results.aetheraAborted = true;
        console.log(`Force stop: Aethera aborted (${aetheraStopResult.previousState} -> ${aetheraStopResult.newState})`);
      } else {
        results.warnings.push(`Aethera abort failed: ${aetheraStopResult.error}`);
      }
    } catch (error) {
      console.log('Could not abort Aethera startup:', error.message);
      results.warnings.push('Could not contact Aethera to abort startup');
    }
    
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
    if (results.aetheraAborted) {
      message += 'GPU startup aborted. ';
    }
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
  isServerlessConfigured,
  getConfig,
  
  // Aethera status
  getAetheraStatus,
  getAetheraHealth,
  
  // RunPod Serverless status (legacy)
  getEndpointHealth,
  getRunningJobs,
  getJobStatus,
  
  // GPU control (legacy serverless)
  startGpu,
  stopGpu,
  forceStopGpu,
  stopAetheraGpu,
  cancelJob,
  getTrackedJobIds,
  
  // Combined status (legacy)
  getStatus,
  
  // === Two-Pod Architecture (new) ===
  
  // Pod management (REST API)
  getPodStatus,
  startPod,
  stopPod,
  updatePod,
  
  // Two-pod orchestration
  startDreams,
  stopDreams,
  getDreamsStatus,
  
  // ComfyUI registry
  getComfyUIRegistryStatus,
  unregisterComfyUI,
  
  // State management
  getStateInfo,
  clearState,
  
  // Billing
  getPodBilling,
  getDreamsBilling,
  
  // Helpers
  formatUptime,
  GPU_COST_PER_HOUR,
};

