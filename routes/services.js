// routes/services.js - Service management routes
// Handles aethera (Docker) container management and membrane-api (systemd)

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/require-auth');
const aethera = require('../lib/services/aethera');
const membraneApi = require('../lib/services/membrane-api');

// All routes require authentication
router.use(requireAuth);

// ============================================================================
// AETHERA (DOCKER) ROUTES
// ============================================================================

/**
 * GET /api/services/aethera/status
 * Get aethera container status
 */
router.get('/aethera/status', async (req, res) => {
  try {
    const status = await aethera.getStatus();
    const health = await aethera.checkHealth();
    
    res.json({
      ...status,
      health: health.healthy ? 'healthy' : 'unhealthy',
      healthDetails: health,
    });
  } catch (error) {
    console.error('Error getting aethera status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/services/aethera/logs
 * Get aethera container logs
 */
router.get('/aethera/logs', async (req, res) => {
  try {
    const { lines = 200, timestamps = true } = req.query;
    const logs = await aethera.getLogs(
      parseInt(lines, 10),
      timestamps === 'true' || timestamps === true
    );
    
    res.json({
      logs,
      lines: parseInt(lines, 10),
    });
  } catch (error) {
    console.error('Error getting aethera logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/services/aethera/restart
 * Restart aethera container
 */
router.post('/aethera/restart', async (req, res) => {
  try {
    console.log('Restarting aethera container...');
    const result = await aethera.restart();
    console.log('Aethera restart result:', result);
    
    res.json(result);
  } catch (error) {
    console.error('Error restarting aethera:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/services/aethera/start
 * Start aethera container
 */
router.post('/aethera/start', async (req, res) => {
  try {
    console.log('Starting aethera container...');
    const result = await aethera.start();
    
    res.json(result);
  } catch (error) {
    console.error('Error starting aethera:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/services/aethera/stop
 * Stop aethera container
 */
router.post('/aethera/stop', async (req, res) => {
  try {
    console.log('Stopping aethera container...');
    const result = await aethera.stop();
    
    res.json(result);
  } catch (error) {
    console.error('Error stopping aethera:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/services/aethera/health
 * Check aethera health endpoint
 */
router.get('/aethera/health', async (req, res) => {
  try {
    const health = await aethera.checkHealth();
    res.json(health);
  } catch (error) {
    console.error('Error checking aethera health:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// MEMBRANE-API (SYSTEMD) ROUTES
// ============================================================================

/**
 * GET /api/services/membrane-api/status
 * Get membrane-api service status
 */
router.get('/membrane-api/status', async (req, res) => {
  try {
    const status = await membraneApi.getStatus();
    const health = await membraneApi.checkHealth();
    
    res.json({
      ...status,
      health: health.healthy ? 'healthy' : 'unhealthy',
      healthDetails: health,
    });
  } catch (error) {
    console.error('Error getting membrane-api status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/services/membrane-api/logs
 * Get membrane-api service logs
 */
router.get('/membrane-api/logs', async (req, res) => {
  try {
    const { lines = 200 } = req.query;
    const logs = await membraneApi.getLogs(parseInt(lines, 10));
    
    res.json({
      logs,
      lines: parseInt(lines, 10),
    });
  } catch (error) {
    console.error('Error getting membrane-api logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/services/membrane-api/restart
 * Restart membrane-api service
 */
router.post('/membrane-api/restart', async (req, res) => {
  try {
    console.log('Restarting membrane-api service...');
    const result = await membraneApi.restart();
    console.log('Membrane-api restart result:', result);
    
    res.json(result);
  } catch (error) {
    console.error('Error restarting membrane-api:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/services/membrane-api/start
 * Start membrane-api service
 */
router.post('/membrane-api/start', async (req, res) => {
  try {
    console.log('Starting membrane-api service...');
    const result = await membraneApi.start();
    
    res.json(result);
  } catch (error) {
    console.error('Error starting membrane-api:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/services/membrane-api/stop
 * Stop membrane-api service
 */
router.post('/membrane-api/stop', async (req, res) => {
  try {
    console.log('Stopping membrane-api service...');
    const result = await membraneApi.stop();
    
    res.json(result);
  } catch (error) {
    console.error('Error stopping membrane-api:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/services/membrane-api/health
 * Check membrane-api health endpoint
 */
router.get('/membrane-api/health', async (req, res) => {
  try {
    const health = await membraneApi.checkHealth();
    res.json(health);
  } catch (error) {
    console.error('Error checking membrane-api health:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/services/membrane-api/stats
 * Get membrane-api stats (sessions, providers)
 */
router.get('/membrane-api/stats', async (req, res) => {
  try {
    const stats = await membraneApi.getStats();
    res.json(stats || { error: 'Stats unavailable' });
  } catch (error) {
    console.error('Error getting membrane-api stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/services/membrane-api/models
 * Get available models from membrane-api
 */
router.get('/membrane-api/models', async (req, res) => {
  try {
    const models = await membraneApi.getModels();
    res.json(models || { error: 'Models unavailable' });
  } catch (error) {
    console.error('Error getting membrane-api models:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SERVICE OVERVIEW
// ============================================================================

/**
 * GET /api/services
 * List all services with their statuses
 */
router.get('/', async (req, res) => {
  try {
    const [aetheraStatus, aetheraHealth, membraneStatus, membraneHealth] = await Promise.all([
      aethera.getStatus(),
      aethera.checkHealth(),
      membraneApi.getStatus(),
      membraneApi.checkHealth(),
    ]);
    
    res.json({
      services: [
        {
          name: 'aethera',
          type: 'docker',
          description: 'Blog platform (FastAPI)',
          ...aetheraStatus,
          health: aetheraHealth.healthy ? 'healthy' : 'unhealthy',
        },
        {
          name: 'membrane-api',
          type: 'systemd',
          description: 'LLM middleware service',
          ...membraneStatus,
          health: membraneHealth.healthy ? 'healthy' : 'unhealthy',
        },
      ],
    });
  } catch (error) {
    console.error('Error listing services:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


