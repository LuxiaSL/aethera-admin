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
 * GET /api/dreams/pods/comfyui
 * Get ComfyUI pod status only
 */
router.get('/pods/comfyui', async (req, res) => {
  try {
    const config = require('../config');
    if (!config.RUNPOD_COMFYUI_POD_ID) {
      return res.json({ configured: false, error: 'RUNPOD_COMFYUI_POD_ID not set' });
    }
    
    const status = await dreams.getPodStatus(config.RUNPOD_COMFYUI_POD_ID);
    res.json({
      configured: true,
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
    const config = require('../config');
    if (!config.RUNPOD_DREAMGEN_POD_ID) {
      return res.json({ configured: false, error: 'RUNPOD_DREAMGEN_POD_ID not set' });
    }
    
    const status = await dreams.getPodStatus(config.RUNPOD_DREAMGEN_POD_ID);
    res.json({
      configured: true,
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
    const config = require('../config');
    if (!config.RUNPOD_COMFYUI_POD_ID) {
      return res.status(400).json({ error: 'RUNPOD_COMFYUI_POD_ID not configured' });
    }
    
    const result = await dreams.startPod(config.RUNPOD_COMFYUI_POD_ID);
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
    const config = require('../config');
    if (!config.RUNPOD_COMFYUI_POD_ID) {
      return res.status(400).json({ error: 'RUNPOD_COMFYUI_POD_ID not configured' });
    }
    
    // Unregister first
    await dreams.unregisterComfyUI();
    
    const result = await dreams.stopPod(config.RUNPOD_COMFYUI_POD_ID);
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
    const config = require('../config');
    if (!config.RUNPOD_DREAMGEN_POD_ID) {
      return res.status(400).json({ error: 'RUNPOD_DREAMGEN_POD_ID not configured' });
    }
    
    const result = await dreams.startPod(config.RUNPOD_DREAMGEN_POD_ID);
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
    const config = require('../config');
    if (!config.RUNPOD_DREAMGEN_POD_ID) {
      return res.status(400).json({ error: 'RUNPOD_DREAMGEN_POD_ID not configured' });
    }
    
    const result = await dreams.stopPod(config.RUNPOD_DREAMGEN_POD_ID);
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
    const config = require('../config');
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
    
    // Update ComfyUI pod
    if (config.RUNPOD_COMFYUI_POD_ID) {
      try {
        const result = await dreams.updatePod(config.RUNPOD_COMFYUI_POD_ID, {});
        results.updates.push({ pod: 'comfyui', success: true, ...result });
      } catch (error) {
        results.updates.push({ pod: 'comfyui', success: false, error: error.message });
        results.warnings.push(`ComfyUI update failed: ${error.message}`);
      }
    } else {
      results.warnings.push('RUNPOD_COMFYUI_POD_ID not configured');
    }
    
    // Update DreamGen pod
    if (config.RUNPOD_DREAMGEN_POD_ID) {
      try {
        const result = await dreams.updatePod(config.RUNPOD_DREAMGEN_POD_ID, {});
        results.updates.push({ pod: 'dreamgen', success: true, ...result });
      } catch (error) {
        results.updates.push({ pod: 'dreamgen', success: false, error: error.message });
        results.warnings.push(`DreamGen update failed: ${error.message}`);
      }
    } else {
      results.warnings.push('RUNPOD_DREAMGEN_POD_ID not configured');
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
    const config = require('../config');
    if (!config.RUNPOD_COMFYUI_POD_ID) {
      return res.status(400).json({ error: 'RUNPOD_COMFYUI_POD_ID not configured' });
    }
    
    // Optionally stop first
    if (req.body?.stopFirst) {
      try {
        await dreams.unregisterComfyUI();
        await dreams.stopPod(config.RUNPOD_COMFYUI_POD_ID);
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.log('Stop before update (may be expected):', e.message);
      }
    }
    
    const result = await dreams.updatePod(config.RUNPOD_COMFYUI_POD_ID, req.body?.updates || {});
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
    const config = require('../config');
    if (!config.RUNPOD_DREAMGEN_POD_ID) {
      return res.status(400).json({ error: 'RUNPOD_DREAMGEN_POD_ID not configured' });
    }
    
    // Optionally stop first
    if (req.body?.stopFirst) {
      try {
        await dreams.stopPod(config.RUNPOD_DREAMGEN_POD_ID);
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.log('Stop before update (may be expected):', e.message);
      }
    }
    
    const result = await dreams.updatePod(config.RUNPOD_DREAMGEN_POD_ID, req.body?.updates || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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
// EXPORTS
// ============================================================================

module.exports = router;

