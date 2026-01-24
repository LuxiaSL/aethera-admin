// routes/dreams.js - Dreams/RunPod API routes
// Provides admin control over Dream Window GPU lifecycle

const express = require('express');
const router = express.Router();
const dreams = require('../lib/services/dreams');

// ============================================================================
// STATUS ENDPOINTS
// ============================================================================

/**
 * GET /api/dreams/status
 * Get comprehensive status from aethera + RunPod
 */
router.get('/status', async (req, res) => {
  try {
    const status = await dreams.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Dreams status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/dreams/config
 * Get dreams configuration status (no secrets)
 */
router.get('/config', async (req, res) => {
  try {
    const config = dreams.getConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/dreams/aethera
 * Get status directly from aethera's dreams API
 */
router.get('/aethera', async (req, res) => {
  try {
    const status = await dreams.getAetheraStatus();
    res.json(status);
  } catch (error) {
    console.error('Aethera status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/dreams/runpod
 * Get RunPod endpoint health/status
 */
router.get('/runpod', async (req, res) => {
  try {
    const health = await dreams.getEndpointHealth();
    res.json(health);
  } catch (error) {
    console.error('RunPod health error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/dreams/jobs/:jobId
 * Get status of a specific RunPod job
 */
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const status = await dreams.getJobStatus(req.params.jobId);
    res.json(status);
  } catch (error) {
    console.error('Job status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GPU CONTROL ENDPOINTS
// ============================================================================

/**
 * POST /api/dreams/start
 * Force start the GPU (admin override)
 * Submits a job to RunPod, bypassing presence detection
 */
router.post('/start', async (req, res) => {
  try {
    // First check if already running
    const status = await dreams.getStatus();
    if (status.state === 'running') {
      return res.json({
        success: true,
        alreadyRunning: true,
        message: 'GPU is already running',
      });
    }
    
    if (status.state === 'starting') {
      return res.json({
        success: true,
        alreadyStarting: true,
        message: 'GPU is already starting',
      });
    }
    
    // Start the GPU
    const result = await dreams.startGpu();
    
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('GPU start error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/dreams/stop
 * Force stop the GPU (admin override)
 * Immediately cancels RunPod jobs, no grace period
 * 
 * Optional body:
 * - jobId: Specific job ID to cancel (if not provided, cancels all known jobs)
 */
router.post('/stop', async (req, res) => {
  try {
    // req.body might be undefined if no JSON body sent
    const jobId = req.body?.jobId || null;
    
    // Stop the GPU (forceStopGpu is called if no specific jobId)
    const result = await dreams.stopGpu(jobId);
    
    res.json(result);
  } catch (error) {
    console.error('GPU stop error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/dreams/restart
 * Restart the GPU (stop then start)
 */
router.post('/restart', async (req, res) => {
  try {
    // Stop any running jobs
    try {
      await dreams.forceStopGpu();
    } catch (e) {
      // Ignore stop errors - might not be running
      console.log('Stop during restart (may be expected):', e.message);
    }
    
    // Wait a moment for cleanup
    await new Promise(r => setTimeout(r, 2000));
    
    // Start fresh
    const result = await dreams.startGpu();
    
    res.json({
      success: true,
      message: 'GPU restart initiated',
      ...result,
    });
  } catch (error) {
    console.error('GPU restart error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/dreams/cancel/:jobId
 * Cancel a specific job by ID
 */
router.post('/cancel/:jobId', async (req, res) => {
  try {
    const result = await dreams.cancelJob(req.params.jobId);
    res.json(result);
  } catch (error) {
    console.error('Job cancel error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/dreams/tracked-jobs
 * Get list of job IDs tracked by this admin session
 * (Jobs started from this admin panel that we can cancel)
 */
router.get('/tracked-jobs', async (req, res) => {
  try {
    const jobIds = dreams.getTrackedJobIds();
    res.json({
      trackedJobs: jobIds,
      count: jobIds.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// TWO-POD ARCHITECTURE ENDPOINTS
// ============================================================================
// These endpoints manage the ComfyUI + DreamGen pod pair

/**
 * GET /api/dreams/pods/status
 * Get comprehensive two-pod status (ComfyUI + DreamGen + Aethera + Registry)
 */
router.get('/pods/status', async (req, res) => {
  try {
    const status = await dreams.getDreamsStatus();
    res.json(status);
  } catch (error) {
    console.error('Two-pod status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/dreams/pods/start
 * Start both pods in sequence (ComfyUI first, wait for registration, then DreamGen)
 */
router.post('/pods/start', async (req, res) => {
  try {
    // Check current state
    const currentStatus = await dreams.getDreamsStatus();
    if (currentStatus.state === 'running') {
      return res.json({
        success: true,
        alreadyRunning: true,
        message: 'Dreams system is already running',
      });
    }
    
    // Start the two-pod system
    const result = await dreams.startDreams();
    res.json(result);
  } catch (error) {
    console.error('Two-pod start error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/dreams/pods/stop
 * Stop both pods (DreamGen first, unregister, then ComfyUI)
 */
router.post('/pods/stop', async (req, res) => {
  try {
    const result = await dreams.stopDreams();
    res.json(result);
  } catch (error) {
    console.error('Two-pod stop error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
    });
  }
});

/**
 * Helper to get pod ID by type (uses discovery, falls back to config)
 */
async function getPodIdByType(podType) {
  const config = require('../config');
  
  try {
    const podIds = await dreams.getCurrentPodIds();
    if (podType === 'comfyui' && podIds.comfyuiPodId) {
      return podIds.comfyuiPodId;
    }
    if (podType === 'dreamgen' && podIds.dreamgenPodId) {
      return podIds.dreamgenPodId;
    }
  } catch (e) {
    console.warn(`Pod discovery failed for ${podType}:`, e.message);
  }
  
  // Fall back to config
  if (podType === 'comfyui') return config.RUNPOD_COMFYUI_POD_ID;
  if (podType === 'dreamgen') return config.RUNPOD_DREAMGEN_POD_ID;
  return null;
}

/**
 * GET /api/dreams/pods/comfyui
 * Get ComfyUI pod status only
 */
router.get('/pods/comfyui', async (req, res) => {
  try {
    const podId = await getPodIdByType('comfyui');
    if (!podId) {
      return res.json({ configured: false, error: 'ComfyUI pod not found (not discovered or configured)' });
    }
    
    const status = await dreams.getPodStatus(podId);
    res.json({
      configured: true,
      podId: podId,
      pod: status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/dreams/pods/dreamgen
 * Get DreamGen pod status only
 */
router.get('/pods/dreamgen', async (req, res) => {
  try {
    const podId = await getPodIdByType('dreamgen');
    if (!podId) {
      return res.json({ configured: false, error: 'DreamGen pod not found (not discovered or configured)' });
    }
    
    const status = await dreams.getPodStatus(podId);
    res.json({
      configured: true,
      podId: podId,
      pod: status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/dreams/pods/comfyui/start
 * Start ComfyUI pod only (for manual control)
 */
router.post('/pods/comfyui/start', async (req, res) => {
  try {
    const podId = await getPodIdByType('comfyui');
    if (!podId) {
      return res.status(400).json({ error: 'ComfyUI pod not found - use "Ensure" to create one' });
    }
    
    const result = await dreams.startPod(podId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dreams/pods/comfyui/stop
 * Stop ComfyUI pod only (for manual control)
 */
router.post('/pods/comfyui/stop', async (req, res) => {
  try {
    const podId = await getPodIdByType('comfyui');
    if (!podId) {
      return res.status(400).json({ error: 'ComfyUI pod not found' });
    }
    
    // Unregister first
    await dreams.unregisterComfyUI();
    
    const result = await dreams.stopPod(podId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dreams/pods/dreamgen/start
 * Start DreamGen pod only (for manual control)
 */
router.post('/pods/dreamgen/start', async (req, res) => {
  try {
    const podId = await getPodIdByType('dreamgen');
    if (!podId) {
      return res.status(400).json({ error: 'DreamGen pod not found - use "Ensure" to create one' });
    }
    
    const result = await dreams.startPod(podId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dreams/pods/dreamgen/stop
 * Stop DreamGen pod only (for manual control)
 */
router.post('/pods/dreamgen/stop', async (req, res) => {
  try {
    const podId = await getPodIdByType('dreamgen');
    if (!podId) {
      return res.status(400).json({ error: 'DreamGen pod not found' });
    }
    
    const result = await dreams.stopPod(podId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// POD UPDATE ENDPOINTS (Pull latest Docker images)
// Reference: https://docs.runpod.io/api-reference/pods/PATCH/pods/podId
// ============================================================================

/**
 * POST /api/dreams/pods/update
 * Update both pods (triggers reset and pulls latest images)
 * Stops pods first, then updates sequentially
 */
router.post('/pods/update', async (req, res) => {
  try {
    const results = {
      success: true,
      updates: [],
      warnings: [],
    };
    
    // Stop both pods first to ensure clean update
    console.log('Stopping pods before update...');
    try {
      await dreams.stopDreams();
    } catch (e) {
      results.warnings.push(`Stop failed (may be expected): ${e.message}`);
    }
    
    // Wait for pods to stop
    await new Promise(r => setTimeout(r, 3000));
    
    // Get pod IDs via discovery
    const comfyuiPodId = await getPodIdByType('comfyui');
    const dreamgenPodId = await getPodIdByType('dreamgen');
    
    // Update ComfyUI pod
    if (comfyuiPodId) {
      try {
        const result = await dreams.updatePod(comfyuiPodId, {});
        results.updates.push({ pod: 'comfyui', podId: comfyuiPodId, success: true, ...result });
      } catch (error) {
        results.updates.push({ pod: 'comfyui', success: false, error: error.message });
        results.warnings.push(`ComfyUI update failed: ${error.message}`);
      }
    } else {
      results.warnings.push('ComfyUI pod not found');
    }
    
    // Update DreamGen pod
    if (dreamgenPodId) {
      try {
        const result = await dreams.updatePod(dreamgenPodId, {});
        results.updates.push({ pod: 'dreamgen', podId: dreamgenPodId, success: true, ...result });
      } catch (error) {
        results.updates.push({ pod: 'dreamgen', success: false, error: error.message });
        results.warnings.push(`DreamGen update failed: ${error.message}`);
      }
    } else {
      results.warnings.push('DreamGen pod not found');
    }
    
    results.message = `Updated ${results.updates.filter(u => u.success).length} pod(s). They will pull latest images on next start.`;
    res.json(results);
  } catch (error) {
    console.error('Pods update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dreams/pods/comfyui/update
 * Update ComfyUI pod only (triggers reset and pulls latest image)
 */
router.post('/pods/comfyui/update', async (req, res) => {
  try {
    const podId = await getPodIdByType('comfyui');
    if (!podId) {
      return res.status(400).json({ error: 'ComfyUI pod not found' });
    }
    
    // Optionally stop first
    if (req.body?.stopFirst) {
      try {
        await dreams.unregisterComfyUI();
        await dreams.stopPod(podId);
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.log('Stop before update (may be expected):', e.message);
      }
    }
    
    const result = await dreams.updatePod(podId, req.body?.updates || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dreams/pods/dreamgen/update
 * Update DreamGen pod only (triggers reset and pulls latest image)
 */
router.post('/pods/dreamgen/update', async (req, res) => {
  try {
    const podId = await getPodIdByType('dreamgen');
    if (!podId) {
      return res.status(400).json({ error: 'DreamGen pod not found' });
    }
    
    // Optionally stop first
    if (req.body?.stopFirst) {
      try {
        await dreams.stopPod(podId);
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.log('Stop before update (may be expected):', e.message);
      }
    }
    
    const result = await dreams.updatePod(podId, req.body?.updates || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// POD TERMINATE ENDPOINTS (Delete pods entirely - use with caution!)
// ============================================================================

/**
 * DELETE /api/dreams/pods/comfyui
 * Terminate (delete) the ComfyUI pod entirely
 * WARNING: This deletes the pod - you'll need to recreate it!
 */
router.delete('/pods/comfyui', async (req, res) => {
  try {
    const podId = await getPodIdByType('comfyui');
    if (!podId) {
      return res.status(400).json({ error: 'ComfyUI pod not found' });
    }
    
    // Unregister from VPS first
    try {
      await dreams.unregisterComfyUI();
    } catch (e) {
      console.log('Unregister before terminate (may be expected):', e.message);
    }
    
    const result = await dreams.terminatePod(podId);
    res.json({ ...result, deletedPodId: podId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/dreams/pods/dreamgen
 * Terminate (delete) the DreamGen pod entirely
 * WARNING: This deletes the pod - you'll need to recreate it!
 */
router.delete('/pods/dreamgen', async (req, res) => {
  try {
    const podId = await getPodIdByType('dreamgen');
    if (!podId) {
      return res.status(400).json({ error: 'DreamGen pod not found' });
    }
    
    const result = await dreams.terminatePod(podId);
    res.json({ ...result, deletedPodId: podId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// ERROR MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /api/dreams/errors
 * Get current error states for all pods
 */
router.get('/errors', async (req, res) => {
  try {
    const errors = dreams.getErrors();
    res.json(errors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/dreams/errors/:pod
 * Clear error for a specific pod
 */
router.delete('/errors/:pod', async (req, res) => {
  try {
    const { pod } = req.params;
    if (!['comfyui', 'dreamgen', 'general'].includes(pod)) {
      return res.status(400).json({ error: 'Invalid pod name' });
    }
    dreams.clearError(pod);
    res.json({ success: true, cleared: pod });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/dreams/errors
 * Clear all errors
 */
router.delete('/errors', async (req, res) => {
  try {
    dreams.clearError('comfyui');
    dreams.clearError('dreamgen');
    dreams.clearError('general');
    res.json({ success: true, cleared: 'all' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// REGISTRY & STATE ENDPOINTS
// ============================================================================

/**
 * GET /api/dreams/registry
 * Get ComfyUI registry status from Aethera
 */
router.get('/registry', async (req, res) => {
  try {
    const status = await dreams.getComfyUIRegistryStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/dreams/state
 * Get saved generation state info
 */
router.get('/state', async (req, res) => {
  try {
    const info = await dreams.getStateInfo();
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/dreams/state
 * Clear saved generation state (fresh start)
 */
router.delete('/state', async (req, res) => {
  try {
    const result = await dreams.clearState();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// BILLING ENDPOINTS
// Reference: https://docs.runpod.io/api-reference/billing/GET/billing/pods
// ============================================================================

/**
 * GET /api/dreams/billing
 * Get billing info for dream pods
 * Query params:
 *   - period: 'day', 'week', 'month' (default: 'day')
 */
router.get('/billing', async (req, res) => {
  try {
    const period = req.query.period || 'day';
    const billing = await dreams.getDreamsBilling(period);
    res.json(billing);
  } catch (error) {
    console.error('Billing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// LIFECYCLE MANAGEMENT ENDPOINTS (NEW)
// ============================================================================
// These endpoints support automatic pod discovery and creation

/**
 * GET /api/dreams/lifecycle/pods
 * List all RunPod pods in the account
 */
router.get('/lifecycle/pods', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const pods = await dreams.listPods(forceRefresh);
    res.json({
      count: pods.length,
      pods: pods.map(pod => ({
        id: pod.id,
        name: pod.name,
        status: pod.desiredStatus,
        gpuType: pod.machine?.gpuType?.displayName || null,
        imageName: pod.imageName,
        createdAt: pod.createdAt,
      })),
    });
  } catch (error) {
    console.error('List pods error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/dreams/lifecycle/discover
 * Discover ComfyUI and DreamGen pods by name
 */
router.get('/lifecycle/discover', async (req, res) => {
  try {
    const discovered = await dreams.discoverDreamPods();
    const podIds = await dreams.getCurrentPodIds();
    
    res.json({
      comfyui: discovered.comfyui ? {
        id: discovered.comfyui.id,
        name: discovered.comfyui.name,
        status: discovered.comfyui.desiredStatus,
        gpuType: discovered.comfyui.machine?.gpuType?.displayName,
      } : null,
      dreamgen: discovered.dreamgen ? {
        id: discovered.dreamgen.id,
        name: discovered.dreamgen.name,
        status: discovered.dreamgen.desiredStatus,
        gpuType: discovered.dreamgen.machine?.gpuType?.displayName,
      } : null,
      currentIds: podIds,
      totalPods: discovered.allPods.length,
    });
  } catch (error) {
    console.error('Discover pods error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/dreams/lifecycle/templates
 * Get pod configuration templates
 */
router.get('/lifecycle/templates', async (req, res) => {
  try {
    const templates = dreams.getPodTemplates();
    
    // Redact sensitive info
    const redacted = {};
    for (const [key, template] of Object.entries(templates)) {
      redacted[key] = {
        ...template,
        env: Object.fromEntries(
          Object.entries(template.env || {}).map(([k, v]) => [
            k,
            k.toLowerCase().includes('pass') || k.toLowerCase().includes('token') || k.toLowerCase().includes('secret')
              ? '***'
              : v,
          ])
        ),
      };
    }
    
    res.json(redacted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/dreams/lifecycle/ensure/:podType
 * Ensure a pod exists and is running (create if needed)
 * 
 * This is the main lifecycle management endpoint:
 * 1. Discovers existing pod by name
 * 2. Starts if exists, creates if not
 * 3. Handles GPU unavailability by recreating
 */
router.post('/lifecycle/ensure/:podType', async (req, res) => {
  try {
    const { podType } = req.params;
    
    if (!['comfyui', 'dreamgen'].includes(podType)) {
      return res.status(400).json({ error: 'Invalid pod type. Use "comfyui" or "dreamgen"' });
    }
    
    const options = {
      secretOverrides: req.body?.secretOverrides || {},
      maxRecreateAttempts: req.body?.maxRecreateAttempts || 2,
      waitForRunning: req.body?.waitForRunning || false,
    };
    
    const result = await dreams.ensurePod(podType, options);
    res.json(result);
  } catch (error) {
    console.error('Ensure pod error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dreams/lifecycle/create/:podType
 * Create a new pod from template (force creation, no discovery)
 */
router.post('/lifecycle/create/:podType', async (req, res) => {
  try {
    const { podType } = req.params;
    
    if (!['comfyui', 'dreamgen'].includes(podType)) {
      return res.status(400).json({ error: 'Invalid pod type. Use "comfyui" or "dreamgen"' });
    }
    
    const secretOverrides = req.body?.secretOverrides || {};
    const result = await dreams.createPodFromTemplate(podType, secretOverrides);
    res.json({ success: true, pod: result });
  } catch (error) {
    console.error('Create pod error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// SECRETS ENDPOINT (for pods to retrieve credentials)
// ============================================================================

/**
 * GET /api/dreams/secrets/:podType
 * Get secrets for a pod type (used by pods during startup)
 * 
 * Query params:
 *   - token: Bootstrap token for authentication
 * 
 * NOTE: This endpoint is protected by a bootstrap token.
 * The token should be passed to pods via a minimal env var,
 * and they use it to retrieve full secrets from the admin server.
 */
router.get('/secrets/:podType', async (req, res) => {
  try {
    const { podType } = req.params;
    const token = req.query.token || req.headers['x-bootstrap-token'];
    
    if (!['comfyui', 'dreamgen'].includes(podType)) {
      return res.status(400).json({ error: 'Invalid pod type' });
    }
    
    const secrets = dreams.getPodSecrets(podType, token);
    
    if (secrets === null) {
      // Invalid or missing token
      return res.status(401).json({ error: 'Unauthorized - invalid or missing bootstrap token' });
    }
    
    res.json(secrets);
  } catch (error) {
    console.error('Get secrets error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/dreams/secrets/status
 * Get secret configuration status (no actual secrets)
 * Useful for checking if secrets are properly configured
 */
router.get('/secrets-status', async (req, res) => {
  try {
    const status = dreams.getSecretConfigStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = router;

