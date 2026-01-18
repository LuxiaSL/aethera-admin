// routes/bots.js - ChapterX bot management routes

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/require-auth');
const chapterx = require('../lib/services/chapterx');

// All routes require authentication
router.use(requireAuth);

// ============================================================================
// BOT LISTING
// ============================================================================

/**
 * GET /api/bots
 * List all bots with their statuses
 */
router.get('/', async (req, res) => {
  try {
    const bots = await chapterx.listBots();
    const slots = chapterx.getSlotInfo();
    const systemdAvailable = await chapterx.isSystemdAvailable();
    const systemdInfo = chapterx.getSystemdInfo();
    
    res.json({ 
      bots,
      slots,
      count: bots.length,
      running: bots.filter(b => b.running).length,
      systemd: {
        available: systemdAvailable,
        ...systemdInfo,
      },
    });
  } catch (error) {
    console.error('Error listing bots:', error);
    res.status(500).json({ error: 'Failed to list bots' });
  }
});

/**
 * POST /api/bots/rescan
 * Force rescan of bots directory
 */
router.post('/rescan', async (req, res) => {
  try {
    const bots = await chapterx.listBots();
    res.json({ 
      success: true, 
      bots,
      count: bots.length,
    });
  } catch (error) {
    console.error('Error rescanning bots:', error);
    res.status(500).json({ error: 'Failed to rescan bots' });
  }
});

// ============================================================================
// SINGLE BOT OPERATIONS
// ============================================================================

/**
 * GET /api/bots/:name
 * Get status of a specific bot
 */
router.get('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const status = await chapterx.getBotStatus(name);
    res.json(status);
  } catch (error) {
    console.error('Error getting bot status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/bots/:name/start
 * Start a bot
 */
router.post('/:name/start', async (req, res) => {
  try {
    const { name } = req.params;
    const { slot = 'main' } = req.body;
    
    console.log(`Starting bot '${name}' in slot '${slot}'`);
    const result = await chapterx.startBot(name, slot);
    
    res.json(result);
  } catch (error) {
    console.error('Error starting bot:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/bots/:name/stop
 * Stop a bot
 */
router.post('/:name/stop', async (req, res) => {
  try {
    const { name } = req.params;
    const { force = false } = req.body;
    
    console.log(`Stopping bot '${name}'${force ? ' (force)' : ''}`);
    const result = await chapterx.stopBot(name, force);
    
    res.json(result);
  } catch (error) {
    console.error('Error stopping bot:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/bots/:name/restart
 * Restart a bot
 */
router.post('/:name/restart', async (req, res) => {
  try {
    const { name } = req.params;
    const { slot } = req.body; // Optional: change slot on restart
    
    console.log(`Restarting bot '${name}'${slot ? ` in slot '${slot}'` : ''}`);
    const result = await chapterx.restartBot(name, slot);
    
    res.json(result);
  } catch (error) {
    console.error('Error restarting bot:', error);
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// LOGS & CONFIG
// ============================================================================

/**
 * GET /api/bots/:name/logs
 * Get bot logs from screen session
 */
router.get('/:name/logs', async (req, res) => {
  try {
    const { name } = req.params;
    const { lines = 200 } = req.query;
    
    const logs = await chapterx.getBotLogs(name, parseInt(lines));
    
    res.json({ 
      name,
      logs,
      lines: parseInt(lines),
    });
  } catch (error) {
    console.error('Error getting bot logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/bots/:name/config
 * Get bot configuration
 */
router.get('/:name/config', async (req, res) => {
  try {
    const { name } = req.params;
    const config = await chapterx.getBotConfig(name);
    
    res.json({ 
      name,
      config,
    });
  } catch (error) {
    console.error('Error getting bot config:', error);
    res.status(404).json({ error: error.message });
  }
});

/**
 * POST /api/bots/:name/config
 * Save bot configuration
 */
router.post('/:name/config', async (req, res) => {
  try {
    const { name } = req.params;
    const { config } = req.body;
    
    if (!config || typeof config !== 'string') {
      return res.status(400).json({ error: 'Config content required' });
    }
    
    await chapterx.setBotConfig(name, config);
    console.log(`Updated config for bot '${name}'`);
    
    res.json({ 
      success: true,
      name,
    });
  } catch (error) {
    console.error('Error saving bot config:', error);
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// DEPLOY SLOTS
// ============================================================================

/**
 * GET /api/bots/slots
 * Get deployment slot information
 */
router.get('/slots/info', async (req, res) => {
  try {
    const slots = chapterx.getSlotInfo();
    res.json({ slots });
  } catch (error) {
    console.error('Error getting slot info:', error);
    res.status(500).json({ error: 'Failed to get slot info' });
  }
});

/**
 * POST /api/bots/:name/slot
 * Set preferred slot for a bot (persists selection before starting)
 */
router.post('/:name/slot', async (req, res) => {
  try {
    const { name } = req.params;
    const { slot } = req.body;
    
    if (!slot) {
      return res.status(400).json({ error: 'Slot is required' });
    }
    
    console.log(`Setting preferred slot for '${name}' to '${slot}'`);
    await chapterx.setPreferredSlot(name, slot);
    
    res.json({ 
      success: true,
      name,
      slot,
    });
  } catch (error) {
    console.error('Error setting preferred slot:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;

