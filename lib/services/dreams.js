// lib/services/dreams.js - Dreams/RunPod GPU management
// Provides admin control over the Dream Window GPU lifecycle
//
// Architecture (Two-Pod):
// - Aethera (core) handles WebSocket connections, frame broadcasting, presence tracking
// - ComfyUI Pod: Runs SD 1.5 for image generation (RTX 4090, ~$0.44/hr)
// - DreamGen Pod: Runs orchestration + VAE interpolation (RTX A4000, ~$0.20/hr)
// - This service provides ADMIN OVERRIDE capabilities:
//   - Pod lifecycle management via RunPod REST API
//   - Proactive ComfyUI registration using deterministic proxy URL
//   - Force start/stop pods (bypass presence requirements)
//   - Status aggregation from aethera, RunPod, and ComfyUI registry
//
// Startup Flow (Proactive Registration):
// 1. Start/create ComfyUI pod (get pod ID immediately)
// 2. Construct proxy URL: https://{pod_id}-8188.proxy.runpod.net
// 3. Register ComfyUI with VPS (no waiting for self-registration)
// 4. Wait for ComfyUI to be healthy (health check, ~1-3 min)
// 5. Start DreamGen pod (discovers ComfyUI via VPS)
//
// This eliminates the old 5-minute polling loop waiting for ComfyUI to
// self-register, since we now construct the proxy URL deterministically.
//
// Note: The Python SDK is for serverless endpoints. Pods use REST API.

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
// ERROR TRACKING
// ============================================================================

// Track last errors for each pod (for frontend display)
const lastErrors = {
  comfyui: null,
  dreamgen: null,
  general: null,
};

/**
 * Record an error for a pod
 * @param {string} pod - 'comfyui', 'dreamgen', or 'general'
 * @param {string} message - Error message
 * @param {Object} details - Additional error details
 */
function recordError(pod, message, details = {}) {
  lastErrors[pod] = {
    message,
    details,
    timestamp: Date.now(),
    timestampIso: new Date().toISOString(),
  };
  console.error(`[Dreams Error] ${pod}: ${message}`, details);
}

/**
 * Clear error for a pod
 * @param {string} pod - 'comfyui', 'dreamgen', or 'general'
 */
function clearError(pod) {
  lastErrors[pod] = null;
}

/**
 * Get all current errors
 * @returns {Object} Error states
 */
function getErrors() {
  return { ...lastErrors };
}

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
  // With lifecycle management, we only need the API key
  // Pods can be discovered by name or created automatically
  return !!config.RUNPOD_API_KEY;
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
// RUNPOD REST API BASE URL
// ============================================================================
// Reference: https://docs.runpod.io/api-reference/pods

const RUNPOD_REST_URL = 'https://rest.runpod.io/v1';

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

// Cache for discovered pods (to avoid repeated API calls)
const discoveredPodsCache = {
  pods: null,
  timestamp: 0,
};
const PODS_CACHE_TTL = 30000; // 30 seconds

// ============================================================================
// POD CONFIGURATION TEMPLATES
// ============================================================================
// These define the desired configuration for each pod type.
// When a pod doesn't exist or has GPU issues, we create a new one with this config.
// Values are loaded from config where possible to allow env var customization.

// Build templates with config values (called lazily to ensure config is loaded)
// Data centers ordered by distance from San Francisco (closest first)
// Used for pod placement to minimize latency to the VPS
const US_DATACENTERS_BY_DISTANCE_FROM_SF = [
  'US-CA-2',   // California - same state, ~0-100 miles
  'US-WA-1',   // Washington - Pacific Northwest, ~800 miles
  'US-TX-3',   // Texas - Southwest, ~1700 miles
  'US-TX-1',   // Texas
  'US-TX-4',   // Texas
  'US-KS-2',   // Kansas - Central US, ~1800 miles
  'US-KS-3',   // Kansas
  'US-IL-1',   // Illinois - Midwest, ~2100 miles
  'US-GA-1',   // Georgia - Southeast, ~2500 miles
  'US-GA-2',   // Georgia
  'US-NC-1',   // North Carolina - East Coast, ~2900 miles
  'US-DE-1',   // Delaware - East Coast, ~2900 miles
  'CA-MTL-1',  // Montreal, Canada - ~3100 miles
  'CA-MTL-2',  // Montreal
  'CA-MTL-3',  // Montreal
];

function getPodTemplates() {
  // Determine admin URL for bootstrap mode
  const adminUrl = process.env.ADMIN_EXTERNAL_URL || 
                   (config.HOST === '0.0.0.0' ? `https://admin.aetherawi.red` : `http://${config.HOST}:${config.PORT}`);
  
  // Parse custom data centers from env var if provided (comma-separated)
  const customDataCenters = process.env.RUNPOD_DATACENTER_IDS
    ? process.env.RUNPOD_DATACENTER_IDS.split(',').map(dc => dc.trim())
    : null;
  
  // Use custom data centers or default US-focused list
  const dataCenterIds = customDataCenters || US_DATACENTERS_BY_DISTANCE_FROM_SF;
  
  return {
    comfyui: {
      name: process.env.COMFYUI_POD_NAME || 'dreamgen-comfyui',  // Pod name to search for
      cloudType: process.env.RUNPOD_CLOUD_TYPE || 'SECURE',       // SECURE or COMMUNITY
      computeType: 'GPU',
      gpuTypeIds: [
        'NVIDIA GeForce RTX 4090',  // Primary choice - high performance
        'NVIDIA GeForce RTX 5090',
        'NVIDIA L40S'
      ],
      gpuCount: 1,
      containerDiskInGb: 50,
      volumeInGb: 20,
      volumeMountPath: '/workspace',
      imageName: process.env.COMFYUI_IMAGE || 'luxiasl/dreamgen-comfyui:latest',
      ports: ['8188/http'],
      // CUDA version requirement - ensures we get a machine with compatible drivers
      // Our Docker images use CUDA 12.8 (cu128 PyTorch wheels)
      allowedCudaVersions: ['12.8', '12.9'],
      // Data center priority - US/North America, ordered by distance from San Francisco
      // Uses 'availability' priority to allow RunPod to select based on GPU availability
      dataCenterIds: dataCenterIds,
      dataCenterPriority: process.env.RUNPOD_DC_PRIORITY || 'availability',
      // Environment variables - supports both direct and bootstrap modes
      env: {
        // Direct mode secrets (injected at runtime)
        COMFYUI_AUTH_USER: config.COMFYUI_AUTH_USER || 'dreamgen',
        VPS_REGISTER_URL: config.VPS_REGISTER_URL || 'https://aetherawi.red/api/dreams/comfyui/register',
        // Bootstrap mode (fetches secrets from admin panel)
        ADMIN_PANEL_URL: adminUrl,
        // POD_BOOTSTRAP_TOKEN: injected at runtime if using bootstrap mode
      },
      // Cost tracking
      estimatedCostPerHour: config.COMFYUI_COST_PER_HOUR || 0.44, // ~$0.44/hr for 4090
    },
    
    dreamgen: {
      name: process.env.DREAMGEN_POD_NAME || 'dreamgen-backend',  // Pod name to search for
      cloudType: process.env.RUNPOD_CLOUD_TYPE || 'SECURE',
      computeType: 'GPU',
      gpuTypeIds: [
        'NVIDIA RTX A4000',         // Primary choice - cost effective for VAE
        'NVIDIA RTX A5000',         // Fallback - more VRAM
        'NVIDIA GeForce RTX 3070',  // Fallback - consumer grade
      ],
      gpuCount: 1,
      containerDiskInGb: 30,
      volumeInGb: 10,
      volumeMountPath: '/workspace',
      imageName: process.env.DREAMGEN_IMAGE || 'luxiasl/dreamgen-backend:latest',
      ports: [],  // No exposed ports - connects outbound
      // CUDA version requirement - ensures we get a machine with compatible drivers
      // Our Docker images use CUDA 12.8 (cu128 PyTorch wheels)
      allowedCudaVersions: ['12.8', '12.9'],
      // Data center priority - US/North America, ordered by distance from San Francisco
      dataCenterIds: dataCenterIds,
      dataCenterPriority: process.env.RUNPOD_DC_PRIORITY || 'availability',
      env: {
        DREAMGEN_MODE: 'pod',
        // Direct mode secrets (can be overridden by bootstrap)
        VPS_WEBSOCKET_URL: config.VPS_WEBSOCKET_URL || 'wss://aetherawi.red/ws/gpu',
        VPS_API_URL: config.VPS_BASE_URL || 'https://aetherawi.red',
        LOG_LEVEL: process.env.DREAMGEN_LOG_LEVEL || 'INFO',
        // Bootstrap mode (fetches secrets from admin panel)
        ADMIN_PANEL_URL: adminUrl,
        // POD_BOOTSTRAP_TOKEN: injected at runtime if using bootstrap mode
        // DREAM_GEN_AUTH_TOKEN: injected at runtime (direct mode)
      },
      estimatedCostPerHour: config.DREAMGEN_COST_PER_HOUR || 0.20, // ~$0.20/hr for A4000
    },
  };
}

// Cached templates (lazy initialization)
let _podTemplates = null;
const POD_TEMPLATES = new Proxy({}, {
  get(target, prop) {
    if (!_podTemplates) {
      _podTemplates = getPodTemplates();
    }
    return _podTemplates[prop];
  },
  ownKeys() {
    if (!_podTemplates) {
      _podTemplates = getPodTemplates();
    }
    return Object.keys(_podTemplates);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (!_podTemplates) {
      _podTemplates = getPodTemplates();
    }
    return Object.getOwnPropertyDescriptor(_podTemplates, prop);
  },
});

// ============================================================================
// POD SECRET MANAGEMENT
// ============================================================================
// Functions for managing secrets that pods need at runtime

/**
 * Get secrets for a specific pod type
 * Used by the /api/dreams/secrets endpoint to provide secrets to pods
 * 
 * @param {string} podType - 'comfyui' or 'dreamgen'
 * @param {string} bootstrapToken - Token to verify the request is legitimate
 * @returns {Object|null} Secrets object or null if unauthorized
 */
function getPodSecrets(podType, bootstrapToken) {
  // Verify bootstrap token if configured
  if (config.POD_BOOTSTRAP_TOKEN && bootstrapToken !== config.POD_BOOTSTRAP_TOKEN) {
    console.warn(`Invalid bootstrap token for ${podType} secrets request`);
    return null;
  }
  
  const secrets = {
    vps_auth_token: config.DREAM_GEN_AUTH_TOKEN || '',
    vps_base_url: config.VPS_BASE_URL || 'https://aetherawi.red',
    vps_websocket_url: config.VPS_WEBSOCKET_URL || 'wss://aetherawi.red/ws/gpu',
  };
  
  if (podType === 'comfyui') {
    secrets.comfyui_auth_user = config.COMFYUI_AUTH_USER || 'dreamgen';
    secrets.comfyui_auth_pass = config.COMFYUI_AUTH_PASS || '';
    secrets.vps_register_url = config.VPS_REGISTER_URL || 'https://aetherawi.red/api/dreams/comfyui/register';
  } else if (podType === 'dreamgen') {
    secrets.dream_gen_auth_token = config.DREAM_GEN_AUTH_TOKEN || '';
  }
  
  return secrets;
}

/**
 * Check if secret configuration is valid
 * @returns {Object} Configuration status
 */
function getSecretConfigStatus() {
  return {
    hasApiKey: !!config.RUNPOD_API_KEY,
    hasDreamGenAuthToken: !!config.DREAM_GEN_AUTH_TOKEN,
    hasComfyuiAuthPass: !!config.COMFYUI_AUTH_PASS,
    hasBootstrapToken: !!config.POD_BOOTSTRAP_TOKEN,
    vpsBaseUrl: config.VPS_BASE_URL || 'https://aetherawi.red',
    secretsConfigured: !!(config.DREAM_GEN_AUTH_TOKEN && config.COMFYUI_AUTH_PASS),
  };
}

// ============================================================================
// POD LISTING & DISCOVERY
// ============================================================================
// Use GET /pods to list all pods and find ours by name

/**
 * List all pods from RunPod account
 * Reference: https://docs.runpod.io/api-reference/pods/GET/pods
 * 
 * @param {boolean} forceRefresh - Bypass cache
 * @returns {Promise<Array>} Array of pod objects
 */
async function listPods(forceRefresh = false) {
  if (!config.RUNPOD_API_KEY) {
    throw new Error('RUNPOD_API_KEY not configured');
  }
  
  // Check cache
  const now = Date.now();
  if (!forceRefresh && discoveredPodsCache.pods && 
      (now - discoveredPodsCache.timestamp) < PODS_CACHE_TTL) {
    return discoveredPodsCache.pods;
  }
  
  const response = await fetch(`${RUNPOD_REST_URL}/pods`, {
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
    throw new Error(`Failed to parse RunPod response: ${text}`);
  }
  
  if (!response.ok) {
    throw new Error(`RunPod API error: ${response.status} - ${JSON.stringify(data)}`);
  }
  
  // RunPod returns array of pods directly
  const pods = Array.isArray(data) ? data : [];
  
  // Update cache
  discoveredPodsCache.pods = pods;
  discoveredPodsCache.timestamp = now;
  
  console.log(`Listed ${pods.length} pods from RunPod`);
  return pods;
}

/**
 * Discover pods by name prefix
 * 
 * @param {string} namePrefix - Name prefix to search for (e.g., 'dreamgen-comfyui')
 * @returns {Promise<Object|null>} First matching pod or null
 */
async function discoverPodByName(namePrefix) {
  const pods = await listPods();
  
  // Find pod by name (case-insensitive match)
  const normalizedPrefix = namePrefix.toLowerCase();
  const match = pods.find(pod => 
    pod.name && pod.name.toLowerCase().startsWith(normalizedPrefix)
  );
  
  if (match) {
    console.log(`Discovered pod '${match.name}' (ID: ${match.id}) for prefix '${namePrefix}'`);
  } else {
    console.log(`No pod found matching prefix '${namePrefix}'`);
  }
  
  return match || null;
}

/**
 * Discover both ComfyUI and DreamGen pods
 * 
 * @returns {Promise<Object>} Object with comfyui and dreamgen pod info
 */
async function discoverDreamPods() {
  const pods = await listPods(true); // Force refresh
  
  const comfyuiPod = pods.find(pod => 
    pod.name && pod.name.toLowerCase().includes('comfyui')
  );
  
  const dreamgenPod = pods.find(pod => 
    pod.name && (
      pod.name.toLowerCase().includes('dreamgen') && 
      !pod.name.toLowerCase().includes('comfyui')
    )
  );
  
  return {
    comfyui: comfyuiPod || null,
    dreamgen: dreamgenPod || null,
    allPods: pods,
  };
}

/**
 * Get current pod IDs (from discovery or fallback to config)
 * 
 * @returns {Promise<Object>} Object with comfyuiPodId and dreamgenPodId
 */
async function getCurrentPodIds() {
  // First try to discover pods by name
  const discovered = await discoverDreamPods();
  
  return {
    comfyuiPodId: discovered.comfyui?.id || config.RUNPOD_COMFYUI_POD_ID || null,
    dreamgenPodId: discovered.dreamgen?.id || config.RUNPOD_DREAMGEN_POD_ID || null,
    discovered: {
      comfyui: discovered.comfyui,
      dreamgen: discovered.dreamgen,
    },
  };
}

// ============================================================================
// RUNPOD PROXY URL
// ============================================================================
// RunPod uses a deterministic proxy URL format: https://{pod_id}-{port}.proxy.runpod.net
// This allows us to construct the URL immediately after knowing the pod ID,
// without waiting for the pod to self-register.

/**
 * Construct RunPod proxy URL from pod ID
 * 
 * @param {string} podId - RunPod pod ID
 * @param {number} port - Port number (default: 8188 for ComfyUI)
 * @returns {string} Proxy URL (e.g., https://abc123-8188.proxy.runpod.net)
 */
function getRunPodProxyUrl(podId, port = 8188) {
  if (!podId) {
    throw new Error('Pod ID is required to construct proxy URL');
  }
  return `https://${podId}-${port}.proxy.runpod.net`;
}

/**
 * Register ComfyUI with VPS directly from admin panel
 * 
 * Instead of waiting for ComfyUI pod to self-register, the admin panel
 * can proactively register the proxy URL once we know the pod ID.
 * This eliminates the 5-minute polling loop in startDreams().
 * 
 * @param {string} podId - ComfyUI pod ID
 * @param {Object} options - Additional registration options
 * @param {string} options.authUser - Basic auth username (default from config)
 * @param {string} options.authPass - Basic auth password (default from config)
 * @returns {Promise<Object>} Registration result
 */
async function registerComfyUIFromAdmin(podId, options = {}) {
  const {
    authUser = config.COMFYUI_AUTH_USER || 'dreamgen',
    authPass = config.COMFYUI_AUTH_PASS || '',
  } = options;
  
  const proxyUrl = getRunPodProxyUrl(podId, 8188);
  
  console.log(`Registering ComfyUI with VPS (admin-side): ${proxyUrl}`);
  
  // Get auth token for VPS
  const authToken = config.DREAM_GEN_AUTH_TOKEN;
  if (!authToken) {
    console.warn('DREAM_GEN_AUTH_TOKEN not set, cannot register ComfyUI with VPS');
    return { success: false, error: 'Auth token not configured' };
  }
  
  try {
    const response = await fetch(`${config.AETHERA_API_URL}/api/dreams/comfyui/register`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: proxyUrl,
        ip: podId,  // Store pod ID in ip field for backwards compatibility
        port: 8188,
        auth_user: authUser,
        auth_pass: authPass,
        pod_id: podId,
      }),
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`ComfyUI registered successfully: ${proxyUrl}`);
      return { success: true, endpoint: proxyUrl, data };
    } else {
      const errorText = await response.text();
      console.error(`ComfyUI registration failed: HTTP ${response.status} - ${errorText}`);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }
  } catch (error) {
    console.error(`ComfyUI registration failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Wait for ComfyUI to be healthy at the proxy URL
 * 
 * After registering the URL, wait for ComfyUI to actually be ready
 * to accept requests. This replaces waiting for self-registration.
 * 
 * @param {string} podId - ComfyUI pod ID
 * @param {Object} options - Health check options
 * @param {number} options.timeout - Max wait time in ms (default: 3 minutes)
 * @param {number} options.interval - Poll interval in ms (default: 5 seconds)
 * @returns {Promise<Object>} Health check result
 */
async function waitForComfyUIHealthy(podId, options = {}) {
  const {
    timeout = 3 * 60 * 1000,  // 3 minutes (reduced from 5 - proxy URL is faster)
    interval = 5000,
  } = options;
  
  const proxyUrl = getRunPodProxyUrl(podId, 8188);
  const healthUrl = `${proxyUrl}/system_stats`;
  
  // Setup basic auth
  const authUser = config.COMFYUI_AUTH_USER || 'dreamgen';
  const authPass = config.COMFYUI_AUTH_PASS || '';
  const authHeader = authUser && authPass 
    ? 'Basic ' + Buffer.from(`${authUser}:${authPass}`).toString('base64')
    : null;
  
  console.log(`Waiting for ComfyUI to be healthy at: ${proxyUrl}`);
  
  const startTime = Date.now();
  let pollCount = 0;
  
  while ((Date.now() - startTime) < timeout) {
    pollCount++;
    
    try {
      const headers = {};
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers,
        // Short timeout for health check itself
        signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
      });
      
      if (response.ok) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`ComfyUI healthy after ${elapsed}s (${pollCount} polls)`);
        return { success: true, elapsed, polls: pollCount, url: proxyUrl };
      }
      
      // Log non-200 responses occasionally
      if (pollCount % 6 === 0) {
        console.log(`  ComfyUI returned HTTP ${response.status}, retrying...`);
      }
    } catch (error) {
      // Connection errors are expected while pod is starting
      if (pollCount % 6 === 0) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`  Still waiting for ComfyUI... (${elapsed}s elapsed, error: ${error.message})`);
      }
    }
    
    await new Promise(r => setTimeout(r, interval));
  }
  
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.warn(`ComfyUI health check timeout after ${elapsed}s (${pollCount} polls)`);
  return { success: false, elapsed, polls: pollCount, url: proxyUrl, error: 'timeout' };
}

// ============================================================================
// POD CREATION
// ============================================================================
// Use POST /pods to create new pods with specific configurations

/**
 * Create a new pod with the specified configuration
 * Reference: https://docs.runpod.io/api-reference/pods/POST/pods
 * 
 * @param {Object} podConfig - Pod configuration
 * @returns {Promise<Object>} Created pod info
 */
async function createPod(podConfig) {
  if (!config.RUNPOD_API_KEY) {
    throw new Error('RUNPOD_API_KEY not configured');
  }
  
  const response = await fetch(`${RUNPOD_REST_URL}/pods`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.RUNPOD_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(podConfig),
  });
  
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  
  if (!response.ok) {
    const error = new Error(`Failed to create pod: ${response.status} - ${JSON.stringify(data)}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  
  console.log(`Created pod '${podConfig.name}' (ID: ${data.id})`);
  
  // Clear pods cache so next discovery sees the new pod
  discoveredPodsCache.pods = null;
  discoveredPodsCache.timestamp = 0;
  
  return data;
}

/**
 * Create a pod from a template with injected secrets
 * 
 * Supports two modes:
 * 1. Direct mode: Pass all secrets via env vars at creation time
 * 2. Bootstrap mode: Pass only ADMIN_PANEL_URL and POD_BOOTSTRAP_TOKEN,
 *    pod fetches full secrets from admin panel on startup
 * 
 * @param {string} templateName - 'comfyui' or 'dreamgen'
 * @param {Object} secretOverrides - Additional env vars to inject
 * @param {boolean} secretOverrides.useBootstrap - Use bootstrap mode (default: true if token available)
 * @returns {Promise<Object>} Created pod info
 */
async function createPodFromTemplate(templateName, secretOverrides = {}) {
  const template = POD_TEMPLATES[templateName];
  if (!template) {
    throw new Error(`Unknown pod template: ${templateName}`);
  }
  
  // Build environment variables with secrets
  const env = { ...template.env };
  
  // Determine if we should use bootstrap mode
  // Use bootstrap if we have a token configured, unless explicitly disabled
  const bootstrapToken = config.POD_BOOTSTRAP_TOKEN || '';
  const useBootstrap = secretOverrides.useBootstrap !== false && !!bootstrapToken;
  
  if (useBootstrap) {
    // Bootstrap mode: Minimal secrets, pod fetches rest from admin
    console.log(`[createPodFromTemplate] Using bootstrap mode for ${templateName}`);
    env.POD_BOOTSTRAP_TOKEN = bootstrapToken;
    // ADMIN_PANEL_URL is already in template.env
    
    // Still provide some fallback values in case bootstrap fails
    if (templateName === 'comfyui') {
      env.COMFYUI_AUTH_PASS = secretOverrides.comfyuiAuthPass || config.COMFYUI_AUTH_PASS || '';
      env.VPS_AUTH_TOKEN = secretOverrides.vpsAuthToken || config.DREAM_GEN_AUTH_TOKEN || '';
    } else if (templateName === 'dreamgen') {
      env.DREAM_GEN_AUTH_TOKEN = secretOverrides.dreamGenAuthToken || config.DREAM_GEN_AUTH_TOKEN || '';
    }
  } else {
    // Direct mode: Provide all secrets via env vars
    console.log(`[createPodFromTemplate] Using direct mode for ${templateName} (no bootstrap token)`);
    
    if (templateName === 'comfyui') {
      // ComfyUI needs auth credentials and VPS token
      env.COMFYUI_AUTH_PASS = secretOverrides.comfyuiAuthPass || 
                             config.COMFYUI_AUTH_PASS || 
                             generateRandomPassword();
      env.VPS_AUTH_TOKEN = secretOverrides.vpsAuthToken || 
                           config.DREAM_GEN_AUTH_TOKEN || '';
    } else if (templateName === 'dreamgen') {
      // DreamGen needs the auth token
      env.DREAM_GEN_AUTH_TOKEN = secretOverrides.dreamGenAuthToken || 
                                 config.DREAM_GEN_AUTH_TOKEN || '';
    }
  }
  
  // Apply any additional overrides (except internal flags)
  const { useBootstrap: _, ...envOverrides } = secretOverrides;
  Object.assign(env, envOverrides);
  
  // Build the pod creation payload
  const podConfig = {
    name: template.name,
    cloudType: template.cloudType,
    computeType: template.computeType,
    gpuTypeIds: template.gpuTypeIds,
    gpuCount: template.gpuCount,
    containerDiskInGb: template.containerDiskInGb,
    volumeInGb: template.volumeInGb,
    volumeMountPath: template.volumeMountPath,
    imageName: template.imageName,
    ports: template.ports,
    env: env,
  };
  
  // Add CUDA version requirements if specified
  // This ensures we get a machine with drivers that support our CUDA version
  if (template.allowedCudaVersions && template.allowedCudaVersions.length > 0) {
    podConfig.allowedCudaVersions = template.allowedCudaVersions;
  }
  
  // Add data center restrictions if specified
  // Restricts to US/North America, prioritized by distance from San Francisco
  if (template.dataCenterIds && template.dataCenterIds.length > 0) {
    podConfig.dataCenterIds = template.dataCenterIds;
    podConfig.dataCenterPriority = template.dataCenterPriority || 'availability';
  }
  
  // Log config with secrets redacted
  const redactedEnv = { ...podConfig.env };
  for (const key of Object.keys(redactedEnv)) {
    if (key.toLowerCase().includes('pass') || 
        key.toLowerCase().includes('token') || 
        key.toLowerCase().includes('secret')) {
      redactedEnv[key] = redactedEnv[key] ? '***' : '(not set)';
    }
  }
  console.log(`Creating ${templateName} pod with config:`, { ...podConfig, env: redactedEnv });
  
  return await createPod(podConfig);
}

/**
 * Generate a random password for ComfyUI auth
 * @returns {string} Random alphanumeric password
 */
function generateRandomPassword(length = 24) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ============================================================================
// POD LIFECYCLE MANAGEMENT (ENSURE PATTERN)
// ============================================================================
// These functions implement the "ensure" pattern: discover, start if exists,
// or create if missing, and handle GPU unavailability gracefully.

/**
 * Check if a pod start failed due to GPU unavailability
 * 
 * @param {Error} error - Error from start attempt
 * @returns {boolean} True if error indicates GPU unavailability
 */
function isGpuUnavailableError(error) {
  const message = error.message?.toLowerCase() || '';
  const errorData = error.data?.error?.toLowerCase() || '';
  
  return (
    message.includes('no gpu available') ||
    message.includes('insufficient gpu') ||
    message.includes('no machines available') ||
    message.includes('could not find a machine') ||
    errorData.includes('no gpu available') ||
    errorData.includes('insufficient gpu')
  );
}

/**
 * Ensure a pod exists and is startable
 * 
 * This implements the full lifecycle:
 * 1. Try to discover existing pod by name
 * 2. If exists, try to start it
 * 3. If start fails due to GPU unavailability, delete and recreate
 * 4. If doesn't exist, create new pod
 * 5. Optionally: verify startability then stop (verifyOnly mode)
 * 
 * @param {string} templateName - 'comfyui' or 'dreamgen'
 * @param {Object} options - Options for pod management
 * @param {boolean} options.verifyOnly - If true, verify pod can start then stop it (default: true)
 * @param {boolean} options.leaveRunning - If true, leave pod running after ensure (default: false)
 * @returns {Promise<Object>} Result with pod info and status
 */
async function ensurePod(templateName, options = {}) {
  const {
    secretOverrides = {},
    maxRecreateAttempts = 2,
    waitForRunning = false,
    waitTimeout = 300000, // 5 minutes
    verifyOnly = true,    // Default: verify then stop
    leaveRunning = false, // Explicit flag to keep running
  } = options;
  
  const template = POD_TEMPLATES[templateName];
  if (!template) {
    throw new Error(`Unknown pod template: ${templateName}`);
  }
  
  const result = {
    success: false,
    podId: null,
    pod: null,
    action: null, // 'started', 'created', 'recreated'
    attempts: 0,
    warnings: [],
  };
  
  // Step 1: Try to discover existing pod
  console.log(`[ensurePod] Looking for existing ${templateName} pod...`);
  let existingPod = await discoverPodByName(template.name);
  
  if (existingPod) {
    console.log(`[ensurePod] Found existing pod: ${existingPod.id} (status: ${existingPod.desiredStatus})`);
    
    // If already running
    if (existingPod.desiredStatus === 'RUNNING') {
      result.success = true;
      result.podId = existingPod.id;
      result.pod = existingPod;
      result.action = 'already_running';
      
      // If verifyOnly mode, stop the pod
      if (verifyOnly && !leaveRunning) {
        console.log(`[ensurePod] Verify mode: stopping already-running pod ${existingPod.id}`);
        try {
          await stopPod(existingPod.id);
          result.action = 'verified';
          result.pod = await getPodStatus(existingPod.id, true);
        } catch (stopError) {
          result.warnings.push(`Failed to stop after verify: ${stopError.message}`);
        }
      }
      
      return result;
    }
    
    // Try to start the existing pod
    for (let attempt = 1; attempt <= maxRecreateAttempts; attempt++) {
      result.attempts = attempt;
      
      try {
        console.log(`[ensurePod] Attempting to start pod ${existingPod.id} (attempt ${attempt})...`);
        await startPod(existingPod.id);
        
        result.success = true;
        result.podId = existingPod.id;
        result.pod = await getPodStatus(existingPod.id, true);
        result.action = 'started';
        
        // Clear cache for this pod type
        const cacheKey = templateName;
        if (podStatusCache[cacheKey]) {
          podStatusCache[cacheKey] = { data: null, timestamp: 0 };
        }
        
        // If verifyOnly mode, stop the pod after confirming it starts
        if (verifyOnly && !leaveRunning) {
          console.log(`[ensurePod] Verify mode: stopping pod ${existingPod.id} after successful start`);
          try {
            await stopPod(existingPod.id);
            result.action = 'verified';
            result.pod = await getPodStatus(existingPod.id, true);
          } catch (stopError) {
            result.warnings.push(`Failed to stop after verify: ${stopError.message}`);
          }
        }
        
        return result;
        
      } catch (error) {
        console.error(`[ensurePod] Start failed: ${error.message}`);
        recordError(templateName, `Start failed: ${error.message}`, { attempt });
        
        // Check if it's a GPU unavailability issue
        if (isGpuUnavailableError(error)) {
          result.warnings.push(`Attempt ${attempt}: GPU unavailable for existing pod`);
          
          if (attempt < maxRecreateAttempts) {
            // Delete and try to recreate
            console.log(`[ensurePod] GPU unavailable, deleting pod ${existingPod.id} to recreate...`);
            
            try {
              await terminatePod(existingPod.id);
              await new Promise(r => setTimeout(r, 3000)); // Wait for deletion
              existingPod = null; // Clear so we fall through to creation
              break; // Exit loop to create new pod
            } catch (deleteError) {
              result.warnings.push(`Failed to delete pod: ${deleteError.message}`);
            }
          } else {
            result.warnings.push('Max recreate attempts reached');
            throw error;
          }
        } else {
          // Non-GPU error, don't retry
          throw error;
        }
      }
    }
  }
  
  // Step 2: No existing pod (or deleted), create new one
  console.log(`[ensurePod] Creating new ${templateName} pod...`);
  
  try {
    const newPod = await createPodFromTemplate(templateName, secretOverrides);
    
    result.success = true;
    result.podId = newPod.id;
    result.pod = newPod;
    result.action = existingPod ? 'recreated' : 'created';
    
    // Pod is created - RunPod starts it automatically after creation
    
    // Wait for pod to start (brief wait to verify it's starting)
    console.log(`[ensurePod] Waiting for pod ${newPod.id} to start...`);
    await new Promise(r => setTimeout(r, 5000));
    
    let finalStatus = await getPodStatus(newPod.id, true);
    result.pod = finalStatus;
    
    // If waitForRunning, wait longer for full startup
    if (waitForRunning) {
      const startTime = Date.now();
      while ((Date.now() - startTime) < waitTimeout) {
        await new Promise(r => setTimeout(r, 5000));
        finalStatus = await getPodStatus(newPod.id, true);
        
        if (finalStatus?.desiredStatus === 'RUNNING' && finalStatus?.runtime) {
          result.pod = finalStatus;
          console.log(`[ensurePod] Pod ${newPod.id} is now running`);
          break;
        }
        
        console.log(`[ensurePod] Waiting for pod... (status: ${finalStatus?.desiredStatus})`);
      }
    }
    
    // If verifyOnly mode and pod started successfully, stop it
    if (verifyOnly && !leaveRunning) {
      // Check if pod is starting/running before stopping
      if (finalStatus?.desiredStatus === 'RUNNING' || finalStatus?.desiredStatus === 'CREATED') {
        console.log(`[ensurePod] Verify mode: stopping newly created pod ${newPod.id}`);
        try {
          await stopPod(newPod.id);
          result.action = result.action === 'created' ? 'created_verified' : 'recreated_verified';
          result.pod = await getPodStatus(newPod.id, true);
        } catch (stopError) {
          result.warnings.push(`Failed to stop after verify: ${stopError.message}`);
        }
      }
    }
    
    clearError(templateName);
    return result;
    
  } catch (createError) {
    console.error(`[ensurePod] Failed to create pod: ${createError.message}`);
    recordError(templateName, `Creation failed: ${createError.message}`, { error: createError });
    throw createError;
  }
}

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
  
  // Determine which pod this is for error tracking
  const podKey = podId === config.RUNPOD_COMFYUI_POD_ID ? 'comfyui' : 
                 podId === config.RUNPOD_DREAMGEN_POD_ID ? 'dreamgen' : null;
  
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
    // Parse error message for user-friendly display
    let errorMessage = `RunPod API error: ${response.status}`;
    if (data.error) {
      errorMessage = data.error;
    }
    
    // Record error for frontend display
    if (podKey) {
      recordError(podKey, errorMessage, {
        status: response.status,
        response: data,
        action: 'start',
      });
    }
    
    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;
    error.podKey = podKey;
    throw error;
  }
  
  console.log(`Pod ${podId} start requested:`, data);
  
  // Clear error and cache on success
  if (podKey) {
    clearError(podKey);
    podStatusCache[podKey] = { data: null, timestamp: 0 };
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
 * Terminate (delete) a pod completely
 * Uses RunPod REST API: DELETE /pods/{podId}
 * 
 * WARNING: This deletes the pod entirely. You'll need to recreate it.
 * Use stop() for normal lifecycle - this is for full cleanup only.
 * 
 * @param {string} podId - Pod ID
 * @returns {Promise<Object>} Result
 */
async function terminatePod(podId) {
  if (!podId) {
    throw new Error('Pod ID required');
  }
  
  if (!config.RUNPOD_API_KEY) {
    throw new Error('RUNPOD_API_KEY not configured');
  }
  
  const url = `https://rest.runpod.io/v1/pods/${podId}`;
  
  const response = await fetch(url, {
    method: 'DELETE',
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
  
  console.log(`Pod ${podId} TERMINATED:`, data);
  
  // Clear cache
  const cacheKey = podId === config.RUNPOD_COMFYUI_POD_ID ? 'comfyui' : 
                   podId === config.RUNPOD_DREAMGEN_POD_ID ? 'dreamgen' : null;
  if (cacheKey) {
    podStatusCache[cacheKey] = { data: null, timestamp: 0 };
  }
  
  return {
    success: true,
    pod: data,
    message: `Pod ${podId} terminated (deleted)`,
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
 * Start the Dreams system (two-pod architecture) with automatic lifecycle management
 * 
 * FLOW (Proactive Registration):
 * 1. Discover or create ComfyUI pod (handles GPU unavailability)
 * 2. Construct proxy URL from pod ID & register with VPS (immediate)
 * 3. Wait for ComfyUI to be healthy (health check)
 * 4. Discover or create DreamGen pod, then start it
 * 
 * This eliminates the old 5-minute polling loop waiting for ComfyUI to
 * self-register by using the deterministic proxy URL format.
 * 
 * LEGACY FLOW (with hardcoded IDs):
 * Uses config.RUNPOD_COMFYUI_POD_ID and config.RUNPOD_DREAMGEN_POD_ID
 * but still uses proactive registration.
 * 
 * @param {Object} options - Start options
 * @param {boolean} options.useLifecycle - Use new lifecycle management (default: true)
 * @param {Object} options.secretOverrides - Override secrets for pod creation
 * @returns {Promise<Object>} Result with pod statuses
 */
async function startDreams(options = {}) {
  const {
    useLifecycle = true,
    secretOverrides = {},
  } = options;
  
  const results = {
    success: true,
    steps: [],
    warnings: [],
    pods: {},
  };
  
  try {
    // Determine which approach to use
    const hasHardcodedIds = config.RUNPOD_COMFYUI_POD_ID && config.RUNPOD_DREAMGEN_POD_ID;
    const shouldUseLifecycle = useLifecycle || !hasHardcodedIds;
    
    if (shouldUseLifecycle) {
      // ============= EXPLICIT LIFECYCLE APPROACH =============
      // 
      // FLOW (Proactive Registration):
      // 1. Clear stale registration
      // 2. Discover or create ComfyUI pod, start it
      // 3. Discover or create DreamGen pod (but STOP it if it starts)
      // 4. Register ComfyUI using proxy URL (immediate - no waiting for self-registration)
      // 5. Wait for ComfyUI to be healthy (health check)
      // 6. Start DreamGen pod
      //
      // If GPU unavailable at any point, terminate and retry creation
      
      console.log('============================================================');
      console.log('DREAMS LIFECYCLE STARTUP');
      console.log('============================================================');
      
      const comfyuiSecrets = {
        comfyuiAuthPass: secretOverrides.comfyuiAuthPass || process.env.COMFYUI_AUTH_PASS,
        vpsAuthToken: secretOverrides.vpsAuthToken || process.env.DREAM_GEN_AUTH_TOKEN,
      };
      const dreamgenSecrets = {
        dreamGenAuthToken: secretOverrides.dreamGenAuthToken || process.env.DREAM_GEN_AUTH_TOKEN,
      };
      
      // ==================== PHASE 0: Clear stale registration ====================
      console.log('\n[PHASE 0] Clearing any stale ComfyUI registration...');
      try {
        await unregisterComfyUI();
        console.log('  ✓ Cleared stale registration');
      } catch (e) {
        console.log('  ○ No stale registration to clear');
      }
      
      // ==================== PHASE 1: Ensure ComfyUI is RUNNING ====================
      console.log('\n[PHASE 1] ComfyUI Pod Management');
      console.log('  Goal: ComfyUI pod exists and is RUNNING');
      results.steps.push({ step: 'comfyui_pod', status: 'in_progress' });
      
      let comfyuiPod = await discoverPodByName(POD_TEMPLATES.comfyui.name);
      let comfyuiAction = null;
      
      if (comfyuiPod) {
        console.log(`  Found existing pod: ${comfyuiPod.id} (status: ${comfyuiPod.desiredStatus})`);
        
        if (comfyuiPod.desiredStatus === 'RUNNING') {
          console.log('  ✓ ComfyUI already running');
          comfyuiAction = 'already_running';
        } else {
          // Pod exists but not running - try to start it
          console.log(`  Starting existing pod ${comfyuiPod.id}...`);
          try {
            await startPod(comfyuiPod.id);
            comfyuiPod = await getPodStatus(comfyuiPod.id, true);
            comfyuiAction = 'started';
            console.log('  ✓ ComfyUI pod started');
          } catch (startError) {
            console.log(`  ✗ Failed to start: ${startError.message}`);
            
            // Check if GPU unavailable
            if (isGpuUnavailableError(startError)) {
              console.log('  GPU unavailable - terminating old pod to recreate...');
              try {
                await terminatePod(comfyuiPod.id);
                await new Promise(r => setTimeout(r, 3000));
                comfyuiPod = null;  // Will fall through to creation
              } catch (termError) {
                throw new Error(`Failed to terminate unresponsive pod: ${termError.message}`);
              }
            } else {
              throw startError;
            }
          }
        }
      }
      
      // Create new pod if needed
      if (!comfyuiPod) {
        console.log('  Creating new ComfyUI pod...');
        try {
          const newPod = await createPodFromTemplate('comfyui', comfyuiSecrets);
          comfyuiPod = newPod;
          comfyuiAction = 'created';
          console.log(`  ✓ Created pod: ${newPod.id}`);
          
          // Wait briefly for pod to initialize
          await new Promise(r => setTimeout(r, 5000));
          comfyuiPod = await getPodStatus(newPod.id, true);
        } catch (createError) {
          console.error(`  ✗ Failed to create: ${createError.message}`);
          throw createError;
        }
      }
      
      results.steps[0].status = 'done';
      results.steps[0].action = comfyuiAction;
      results.steps[0].podId = comfyuiPod.id;
      results.pods.comfyui = { success: true, podId: comfyuiPod.id, pod: comfyuiPod, action: comfyuiAction };
      console.log(`  Result: ${comfyuiAction} (pod: ${comfyuiPod.id})`);
      
      // ==================== PHASE 2: Ensure DreamGen pod EXISTS (but stopped) ====================
      console.log('\n[PHASE 2] DreamGen Pod Management');
      console.log('  Goal: DreamGen pod exists (but will start after ComfyUI is ready)');
      results.steps.push({ step: 'dreamgen_pod', status: 'in_progress' });
      
      let dreamgenPod = await discoverPodByName(POD_TEMPLATES.dreamgen.name);
      let dreamgenAction = null;
      
      if (dreamgenPod) {
        console.log(`  Found existing pod: ${dreamgenPod.id} (status: ${dreamgenPod.desiredStatus})`);
        
        if (dreamgenPod.desiredStatus === 'RUNNING') {
          // DreamGen is running but ComfyUI might not be ready - stop it
          console.log('  Stopping DreamGen (will restart after ComfyUI is ready)...');
          try {
            await stopPod(dreamgenPod.id);
            dreamgenPod = await getPodStatus(dreamgenPod.id, true);
            dreamgenAction = 'stopped_for_sequencing';
            console.log('  ✓ DreamGen stopped (will restart in Phase 4)');
          } catch (stopError) {
            console.log(`  ⚠ Could not stop: ${stopError.message}`);
            dreamgenAction = 'already_running';
          }
        } else {
          dreamgenAction = 'exists_stopped';
          console.log('  ✓ DreamGen pod exists and is stopped');
        }
      } else {
        // Create DreamGen pod
        console.log('  Creating new DreamGen pod...');
        try {
          const newPod = await createPodFromTemplate('dreamgen', dreamgenSecrets);
          dreamgenPod = newPod;
          dreamgenAction = 'created';
          console.log(`  ✓ Created pod: ${newPod.id}`);
          
          // Wait briefly then STOP it (RunPod auto-starts new pods)
          await new Promise(r => setTimeout(r, 5000));
          
          // Stop the newly created pod - we'll start it after ComfyUI is ready
          console.log('  Stopping newly created pod (will start after ComfyUI is ready)...');
          try {
            await stopPod(newPod.id);
            dreamgenAction = 'created_and_stopped';
            console.log('  ✓ DreamGen created and stopped');
          } catch (stopError) {
            console.log(`  ⚠ Could not stop new pod: ${stopError.message}`);
          }
          
          dreamgenPod = await getPodStatus(newPod.id, true);
        } catch (createError) {
          console.error(`  ✗ Failed to create: ${createError.message}`);
          throw createError;
        }
      }
      
      results.steps[1].status = 'done';
      results.steps[1].action = dreamgenAction;
      results.steps[1].podId = dreamgenPod.id;
      results.pods.dreamgen = { success: true, podId: dreamgenPod.id, pod: dreamgenPod, action: dreamgenAction };
      console.log(`  Result: ${dreamgenAction} (pod: ${dreamgenPod.id})`);
      
      // ==================== PHASE 3: Register ComfyUI & Wait for Healthy ====================
      // NEW APPROACH: Instead of waiting for ComfyUI to self-register, we:
      // 1. Construct the proxy URL directly from pod ID (deterministic format)
      // 2. Register it with VPS immediately
      // 3. Wait for ComfyUI to be healthy (faster than waiting for self-registration)
      console.log('\n[PHASE 3] Registering ComfyUI with VPS');
      console.log('  Using proactive registration (admin-side) instead of waiting for self-registration');
      results.steps.push({ step: 'register_comfyui', status: 'in_progress' });
      
      const proxyUrl = getRunPodProxyUrl(comfyuiPod.id, 8188);
      console.log(`  Proxy URL: ${proxyUrl}`);
      
      // Register immediately with VPS
      const registrationResult = await registerComfyUIFromAdmin(comfyuiPod.id, {
        authUser: comfyuiSecrets.comfyuiAuthUser || config.COMFYUI_AUTH_USER,
        authPass: comfyuiSecrets.comfyuiAuthPass || process.env.COMFYUI_AUTH_PASS,
      });
      
      if (registrationResult.success) {
        console.log(`  ✓ ComfyUI registered with VPS`);
        results.steps[2].status = 'registered';
        results.steps[2].endpoint = { url: proxyUrl };
      } else {
        console.log(`  ⚠ Registration failed: ${registrationResult.error}`);
        results.steps[2].status = 'registration_failed';
        results.warnings.push(`ComfyUI registration failed: ${registrationResult.error}`);
        // Continue anyway - DreamGen can still discover via VPS if ComfyUI self-registers
      }
      
      // Wait for ComfyUI to be healthy (replaces waiting for self-registration)
      console.log('\n[PHASE 3b] Waiting for ComfyUI to be healthy');
      results.steps.push({ step: 'wait_healthy', status: 'in_progress' });
      
      const healthResult = await waitForComfyUIHealthy(comfyuiPod.id, {
        timeout: 3 * 60 * 1000,  // 3 minutes (faster than old 5 min registration wait)
      });
      
      let registryEndpoint = { url: proxyUrl };
      
      if (healthResult.success) {
        console.log(`  ✓ ComfyUI is healthy after ${healthResult.elapsed}s`);
        results.steps[3].status = 'healthy';
        results.steps[3].elapsed = healthResult.elapsed;
      } else {
        console.log(`  ⚠ ComfyUI health check timeout after ${healthResult.elapsed}s`);
        results.steps[3].status = 'timeout';
        results.warnings.push('ComfyUI health check timeout - DreamGen may fail to connect');
        console.log('    Will start DreamGen anyway, but it may fail to connect');
      }
      
      // ==================== PHASE 4: Start DreamGen ====================
      console.log('\n[PHASE 4] Starting DreamGen');
      console.log(`  Starting pod: ${dreamgenPod.id}`);
      results.steps.push({ step: 'start_dreamgen', status: 'in_progress' });
      
      const maxStartAttempts = 3;
      let startAttempt = 0;
      let dreamgenStarted = false;
      
      while (!dreamgenStarted && startAttempt < maxStartAttempts) {
        startAttempt++;
        console.log(`  Attempt ${startAttempt}/${maxStartAttempts}...`);
        
        try {
          await startPod(dreamgenPod.id);
          dreamgenPod = await getPodStatus(dreamgenPod.id, true);
          dreamgenStarted = true;
          console.log('  ✓ DreamGen started successfully');
        } catch (startError) {
          console.log(`  ✗ Start failed: ${startError.message}`);
          
          if (isGpuUnavailableError(startError)) {
            console.log('  GPU unavailable - terminating and recreating...');
            
            try {
              await terminatePod(dreamgenPod.id);
              await new Promise(r => setTimeout(r, 3000));
              
              // Create new pod
              const newPod = await createPodFromTemplate('dreamgen', dreamgenSecrets);
              dreamgenPod = newPod;
              console.log(`  Created replacement pod: ${newPod.id}`);
              
              // Don't stop it - we want it to start
              await new Promise(r => setTimeout(r, 3000));
              dreamgenPod = await getPodStatus(newPod.id, true);
              
              // Check if it started (RunPod auto-starts)
              if (dreamgenPod.desiredStatus === 'RUNNING') {
                dreamgenStarted = true;
                console.log('  ✓ Replacement pod started');
              }
            } catch (recreateError) {
              console.log(`  ✗ Recreate failed: ${recreateError.message}`);
              results.warnings.push(`DreamGen recreate attempt ${startAttempt} failed: ${recreateError.message}`);
            }
          } else {
            // Non-GPU error - don't retry
            results.warnings.push(`DreamGen start failed: ${startError.message}`);
            break;
          }
        }
      }
      
      if (dreamgenStarted) {
        results.steps[4].status = 'started';
        results.steps[4].podId = dreamgenPod.id;
        results.pods.dreamgen = { success: true, podId: dreamgenPod.id, pod: dreamgenPod, action: 'started' };
      } else {
        results.steps[4].status = 'failed';
        results.steps[4].podId = dreamgenPod?.id;
        results.warnings.push('Failed to start DreamGen after all attempts');
      }
      
      // ==================== DONE ====================
      console.log('\n============================================================');
      console.log('DREAMS STARTUP COMPLETE');
      console.log(`  ComfyUI: ${comfyuiPod?.id} (${comfyuiAction})`);
      console.log(`  DreamGen: ${dreamgenPod?.id} (${dreamgenStarted ? 'started' : 'failed'})`);
      console.log(`  ComfyUI URL: ${registryEndpoint?.url || 'not registered'}`);
      console.log('============================================================\n');
      
      results.message = 'Dreams system startup complete';
      results.lifecycleUsed = true;
      
    } else {
      // ============= LEGACY APPROACH (hardcoded IDs) =============
      // Uses the same proactive registration as lifecycle approach
      console.log('Starting Dreams with hardcoded pod IDs...');
      
      const comfyuiPodId = config.RUNPOD_COMFYUI_POD_ID;
      const dreamgenPodId = config.RUNPOD_DREAMGEN_POD_ID;
      
      // Step 1: Start ComfyUI pod
      console.log('Starting ComfyUI pod...');
      results.steps.push({ step: 'start_comfyui', status: 'starting' });
      
      const comfyuiResult = await startPod(comfyuiPodId);
      results.steps[0].status = 'started';
      results.steps[0].pod = comfyuiResult.pod;
      results.steps[0].podId = comfyuiPodId;
      
      // Step 2: Register ComfyUI proactively & wait for healthy
      console.log('Registering ComfyUI with VPS (proactive)...');
      results.steps.push({ step: 'register_comfyui', status: 'registering' });
      
      const proxyUrl = getRunPodProxyUrl(comfyuiPodId, 8188);
      const registrationResult = await registerComfyUIFromAdmin(comfyuiPodId);
      
      if (registrationResult.success) {
        results.steps[1].status = 'registered';
        results.steps[1].endpoint = { url: proxyUrl };
        console.log('ComfyUI registered:', proxyUrl);
      } else {
        results.steps[1].status = 'registration_failed';
        results.warnings.push(`ComfyUI registration failed: ${registrationResult.error}`);
      }
      
      // Wait for ComfyUI to be healthy
      console.log('Waiting for ComfyUI to be healthy...');
      results.steps.push({ step: 'wait_healthy', status: 'waiting' });
      
      const healthResult = await waitForComfyUIHealthy(comfyuiPodId);
      if (healthResult.success) {
        results.steps[2].status = 'healthy';
        results.steps[2].elapsed = healthResult.elapsed;
      } else {
        results.steps[2].status = 'timeout';
        results.warnings.push('ComfyUI health check timeout - DreamGen may fail to connect');
        console.warn('ComfyUI health check timeout');
      }
      
      // Step 3: Start DreamGen pod
      console.log('Starting DreamGen pod...');
      results.steps.push({ step: 'start_dreamgen', status: 'starting' });
      
      const dreamgenResult = await startPod(dreamgenPodId);
      results.steps[3].status = 'started';
      results.steps[3].pod = dreamgenResult.pod;
      results.steps[3].podId = dreamgenPodId;
      
      results.message = 'Dreams system starting (legacy mode)';
      results.lifecycleUsed = false;
    }
    
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
 * Now uses pod discovery instead of just config pod IDs.
 * 
 * @returns {Promise<Object>} Result
 */
async function stopDreams() {
  const results = {
    success: true,
    steps: [],
    warnings: [],
  };
  
  try {
    // Discover current pods (fall back to config if discovery fails)
    let comfyuiPodId, dreamgenPodId;
    try {
      const podIds = await getCurrentPodIds();
      comfyuiPodId = podIds.comfyuiPodId;
      dreamgenPodId = podIds.dreamgenPodId;
    } catch (error) {
      console.warn('Pod discovery failed, using config IDs:', error.message);
      comfyuiPodId = config.RUNPOD_COMFYUI_POD_ID;
      dreamgenPodId = config.RUNPOD_DREAMGEN_POD_ID;
    }
    
    // Step 1: Stop DreamGen pod first
    if (dreamgenPodId) {
      console.log('Stopping DreamGen pod...');
      const step = { step: 'stop_dreamgen', status: 'stopping' };
      results.steps.push(step);
      
      try {
        const dreamgenResult = await stopPod(dreamgenPodId);
        step.status = 'stopped';
        step.pod = dreamgenResult.pod;
      } catch (error) {
        step.status = 'error';
        step.error = error.message;
        results.warnings.push(`DreamGen stop failed: ${error.message}`);
      }
    }
    
    // Step 2: Unregister ComfyUI from VPS (always attempt this)
    console.log('Unregistering ComfyUI...');
    const unregisterStep = { step: 'unregister_comfyui', status: 'unregistering' };
    results.steps.push(unregisterStep);
    
    try {
      const unregisterResult = await unregisterComfyUI();
      unregisterStep.status = unregisterResult.success ? 'unregistered' : 'skipped';
      if (!unregisterResult.success && unregisterResult.error) {
        results.warnings.push(`ComfyUI unregister: ${unregisterResult.error}`);
      }
    } catch (error) {
      unregisterStep.status = 'error';
      unregisterStep.error = error.message;
      results.warnings.push(`ComfyUI unregister failed: ${error.message}`);
    }
    
    // Step 3: Stop ComfyUI pod
    if (comfyuiPodId) {
      console.log('Stopping ComfyUI pod...');
      const step = { step: 'stop_comfyui', status: 'stopping' };
      results.steps.push(step);
      
      try {
        const comfyuiResult = await stopPod(comfyuiPodId);
        step.status = 'stopped';
        step.pod = comfyuiResult.pod;
      } catch (error) {
        step.status = 'error';
        step.error = error.message;
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
 * Now supports automatic pod discovery by name
 * 
 * @returns {Promise<Object>} Combined status
 */
async function getDreamsStatus() {
  // First, try to discover pods by name
  let podIds;
  try {
    podIds = await getCurrentPodIds();
  } catch (error) {
    console.warn('Pod discovery failed, falling back to config:', error.message);
    podIds = {
      comfyuiPodId: config.RUNPOD_COMFYUI_POD_ID,
      dreamgenPodId: config.RUNPOD_DREAMGEN_POD_ID,
      discovered: { comfyui: null, dreamgen: null },
    };
  }
  
  const { comfyuiPodId, dreamgenPodId, discovered } = podIds;
  
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
  
  // Check if we have any configured or discovered pods
  const hasPods = comfyuiPodId || dreamgenPodId;
  const canAutoCreate = config.RUNPOD_API_KEY; // Can create pods if API key is set
  
  if (!hasPods && !canAutoCreate) {
    overallState = 'not_configured';
    stateMessage = 'RunPod not configured';
  } else if (!hasPods && canAutoCreate) {
    overallState = 'idle';
    stateMessage = 'No pods found - will create on start';
  } else if (gpuConnected) {
    overallState = 'running';
    stateMessage = 'Dreams flowing...';
  } else if (comfyuiRunning && dreamgenRunning) {
    overallState = 'starting';
    stateMessage = 'Pods running, waiting for connection...';
  } else if (comfyuiRunning || dreamgenRunning) {
    overallState = 'partial';
    stateMessage = 'One pod running';
  } else if (hasPods) {
    overallState = 'idle';
    stateMessage = 'Dream machine sleeping...';
  } else {
    overallState = 'idle';
    stateMessage = 'Ready to create pods';
  }
  
  // Calculate costs
  const comfyuiUptime = comfyuiPod?.runtime?.uptimeInSeconds || 0;
  const dreamgenUptime = dreamgenPod?.runtime?.uptimeInSeconds || 0;
  const comfyuiCostRate = POD_TEMPLATES.comfyui?.estimatedCostPerHour || config.COMFYUI_COST_PER_HOUR || 0.44;
  const dreamgenCostRate = POD_TEMPLATES.dreamgen?.estimatedCostPerHour || config.DREAMGEN_COST_PER_HOUR || 0.20;
  const comfyuiCost = (comfyuiUptime / 3600) * comfyuiCostRate;
  const dreamgenCost = (dreamgenUptime / 3600) * dreamgenCostRate;
  
  return {
    // Configuration
    configured: canAutoCreate || hasPods,
    hasApiKey: !!config.RUNPOD_API_KEY,
    
    // Discovery info
    discovery: {
      enabled: true,
      comfyuiDiscovered: !!discovered.comfyui,
      dreamgenDiscovered: !!discovered.dreamgen,
      comfyuiName: discovered.comfyui?.name || POD_TEMPLATES.comfyui.name,
      dreamgenName: discovered.dreamgen?.name || POD_TEMPLATES.dreamgen.name,
    },
    
    config: {
      comfyuiPodId: comfyuiPodId ? `${comfyuiPodId.slice(0, 8)}...` : null,
      dreamgenPodId: dreamgenPodId ? `${dreamgenPodId.slice(0, 8)}...` : null,
      aetheraUrl: config.AETHERA_API_URL,
      // Include full IDs for internal use
      _comfyuiPodId: comfyuiPodId,
      _dreamgenPodId: dreamgenPodId,
    },
    
    // Overall state
    overallState,
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
        gpuType: comfyuiPod.machine?.gpuType?.displayName || null,
        publicIp: comfyuiPod.publicIp,
      } : null,
      dreamgen: dreamgenPod ? {
        id: dreamgenPod.id,
        name: dreamgenPod.name,
        status: dreamgenPod.desiredStatus,
        uptime: dreamgenUptime,
        uptimeFormatted: formatUptime(dreamgenUptime),
        gpu: dreamgenPod.runtime?.gpus?.[0] || null,
        gpuType: dreamgenPod.machine?.gpuType?.displayName || null,
        publicIp: dreamgenPod.publicIp,
      } : null,
    },
    
    // Pod templates (for creation info)
    templates: {
      comfyui: {
        name: POD_TEMPLATES.comfyui.name,
        gpuTypes: POD_TEMPLATES.comfyui.gpuTypeIds,
        image: POD_TEMPLATES.comfyui.imageName,
        estimatedCost: POD_TEMPLATES.comfyui.estimatedCostPerHour,
      },
      dreamgen: {
        name: POD_TEMPLATES.dreamgen.name,
        gpuTypes: POD_TEMPLATES.dreamgen.gpuTypeIds,
        image: POD_TEMPLATES.dreamgen.imageName,
        estimatedCost: POD_TEMPLATES.dreamgen.estimatedCostPerHour,
      },
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
    savedState: stateInfo,
    
    // Cost tracking
    cost: {
      comfyui: {
        uptime: comfyuiUptime,
        hourlyRate: comfyuiCostRate,
        sessionCost: Math.round(comfyuiCost * 100) / 100,
      },
      dreamgen: {
        uptime: dreamgenUptime,
        hourlyRate: dreamgenCostRate,
        sessionCost: Math.round(dreamgenCost * 100) / 100,
      },
      total: Math.round((comfyuiCost + dreamgenCost) * 100) / 100,
    },
    
    // Last errors (for frontend display)
    errors: getErrors(),
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
  terminatePod,
  updatePod,
  
  // Error tracking
  getErrors,
  clearError,
  
  // Two-pod orchestration
  startDreams,
  stopDreams,
  getDreamsStatus,
  
  // ComfyUI registry
  getComfyUIRegistryStatus,
  unregisterComfyUI,
  
  // Proactive ComfyUI registration (admin-side)
  getRunPodProxyUrl,
  registerComfyUIFromAdmin,
  waitForComfyUIHealthy,
  
  // State management
  getStateInfo,
  clearState,
  
  // Billing
  getPodBilling,
  getDreamsBilling,
  
  // Helpers
  formatUptime,
  GPU_COST_PER_HOUR,
  
  // === Pod Lifecycle Management (new) ===
  
  // Pod discovery
  listPods,
  discoverPodByName,
  discoverDreamPods,
  getCurrentPodIds,
  
  // Pod creation
  createPod,
  createPodFromTemplate,
  
  // Lifecycle management
  ensurePod,
  
  // Templates
  POD_TEMPLATES,
  getPodTemplates,
  
  // Data center configuration
  US_DATACENTERS_BY_DISTANCE_FROM_SF,
  
  // Secret management
  getPodSecrets,
  getSecretConfigStatus,
};

