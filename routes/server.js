// routes/server.js - Server monitoring and management routes
// Provides system metrics, log management, and network diagnostics

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/require-auth');
const server = require('../lib/services/server');
const aethera = require('../lib/services/aethera');
const chapterx = require('../lib/services/chapterx');
const systemd = require('../lib/systemd');

// All routes require authentication
router.use(requireAuth);

// ============================================================================
// SYSTEM METRICS
// ============================================================================

/**
 * GET /api/server/metrics
 * Get all system metrics (CPU, memory, disk, load)
 */
router.get('/metrics', async (req, res) => {
  try {
    const metrics = await server.getAllMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('Error getting server metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/server/cpu
 * Get CPU usage
 */
router.get('/cpu', (req, res) => {
  try {
    const cpu = server.getCpuUsage();
    res.json(cpu);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/server/memory
 * Get memory usage
 */
router.get('/memory', (req, res) => {
  try {
    const memory = server.getMemoryUsage();
    res.json(memory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/server/disk
 * Get disk usage
 */
router.get('/disk', async (req, res) => {
  try {
    const disk = await server.getDiskUsage();
    res.json({ disks: disk });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/server/load
 * Get load average
 */
router.get('/load', (req, res) => {
  try {
    const load = server.getLoadAverage();
    res.json(load);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/server/uptime
 * Get system uptime
 */
router.get('/uptime', (req, res) => {
  try {
    const uptime = server.getUptime();
    res.json(uptime);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// NETWORK DIAGNOSTICS
// ============================================================================

/**
 * GET /api/server/network
 * Check network connectivity status
 */
router.get('/network', async (req, res) => {
  try {
    const status = await server.checkNetworkStatus();
    res.json(status);
  } catch (error) {
    console.error('Error checking network:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/server/ping
 * Ping a specific host
 */
router.post('/ping', async (req, res) => {
  try {
    const { host = '8.8.8.8' } = req.body;
    
    // Validate host (prevent injection)
    if (!/^[\w.-]+$/.test(host)) {
      return res.status(400).json({ error: 'Invalid host format' });
    }
    
    const result = await server.pingHost(host);
    res.json(result);
  } catch (error) {
    console.error('Error pinging host:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// LOG MANAGEMENT
// ============================================================================

/**
 * GET /api/server/logs/sizes
 * Get log sizes (journal, docker)
 */
router.get('/logs/sizes', async (req, res) => {
  try {
    const [journal, docker] = await Promise.all([
      server.getJournalSize(),
      server.getDockerDiskUsage(),
    ]);
    
    res.json({
      journal,
      docker,
    });
  } catch (error) {
    console.error('Error getting log sizes:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/server/logs/trim/journal
 * Vacuum journalctl logs
 */
router.post('/logs/trim/journal', async (req, res) => {
  try {
    const { size = '500M', time } = req.body;
    
    // Validate size format
    if (size && !/^\d+[KMGT]?$/i.test(size)) {
      return res.status(400).json({ error: 'Invalid size format (e.g., 500M, 1G)' });
    }
    
    // Validate time format
    if (time && !/^\d+[smhdw]$/i.test(time)) {
      return res.status(400).json({ error: 'Invalid time format (e.g., 7d, 2w)' });
    }
    
    console.log(`Vacuuming journal logs (size: ${size}, time: ${time || 'not set'})...`);
    const result = await server.vacuumJournalLogs({ size, time });
    
    res.json(result);
  } catch (error) {
    console.error('Error vacuuming journal:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/server/logs/trim/docker
 * Prune Docker system
 */
router.post('/logs/trim/docker', async (req, res) => {
  try {
    console.log('Pruning Docker system...');
    const result = await server.pruneDocker();
    
    res.json(result);
  } catch (error) {
    console.error('Error pruning Docker:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SERVICE HEALTH OVERVIEW
// ============================================================================

/**
 * GET /api/server/services
 * Get health status of all services
 */
router.get('/services', async (req, res) => {
  try {
    // Get aethera status
    let aetheraStatus = null;
    try {
      aetheraStatus = await aethera.getStatus();
      const health = await aethera.checkHealth();
      aetheraStatus.health = health.healthy ? 'healthy' : 'unhealthy';
    } catch (e) {
      aetheraStatus = { error: e.message };
    }
    
    // Get bot statuses
    let bots = [];
    try {
      bots = await chapterx.listBots();
    } catch (e) {
      console.error('Error listing bots:', e);
    }
    
    // Get systemd info
    const systemdAvailable = await systemd.isSystemdAvailable();
    
    // Get admin service status (self)
    const adminStatus = {
      name: 'aethera-admin',
      type: 'node',
      running: true, // We're running if we're responding
      pid: process.pid,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
    
    res.json({
      admin: adminStatus,
      aethera: aetheraStatus,
      bots: {
        total: bots.length,
        running: bots.filter(b => b.running).length,
        list: bots.map(b => ({
          name: b.name,
          running: b.running,
          slot: b.slot,
          state: b.state,
        })),
      },
      systemd: {
        available: systemdAvailable,
      },
    });
  } catch (error) {
    console.error('Error getting service statuses:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

