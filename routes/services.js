// routes/services.js - Service management routes
// Handles aethera (Docker) container management

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/require-auth');
const aethera = require('../lib/services/aethera');

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
// SERVICE OVERVIEW
// ============================================================================

/**
 * GET /api/services
 * List all services with their statuses
 */
router.get('/', async (req, res) => {
  try {
    const aetheraStatus = await aethera.getStatus();
    const aetheraHealth = await aethera.checkHealth();
    
    res.json({
      services: [
        {
          name: 'aethera',
          type: 'docker',
          description: 'Blog platform (FastAPI)',
          ...aetheraStatus,
          health: aetheraHealth.healthy ? 'healthy' : 'unhealthy',
        },
      ],
    });
  } catch (error) {
    console.error('Error listing services:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


