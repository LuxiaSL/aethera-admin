// routes/slots.js - ChapterX deployment slot management
// Git operations for updating ChapterX code

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/require-auth');
const chapterx = require('../lib/services/chapterx');

// All routes require authentication
router.use(requireAuth);

// ============================================================================
// SLOT LISTING & STATUS
// ============================================================================

/**
 * GET /api/slots
 * Get all slots with their git status
 */
router.get('/', async (req, res) => {
  try {
    const slots = await chapterx.getAllSlotsStatus();
    
    res.json({ slots });
  } catch (error) {
    console.error('Error getting slots:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/slots/:slot/status
 * Get detailed git status for a specific slot
 */
router.get('/:slot/status', async (req, res) => {
  try {
    const { slot } = req.params;
    const status = await chapterx.getSlotGitStatus(slot);
    
    // Get bots running on this slot
    const runningBots = await chapterx.getBotsOnSlot(slot);
    
    res.json({
      ...status,
      runningBots,
    });
  } catch (error) {
    console.error('Error getting slot status:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GIT OPERATIONS
// ============================================================================

/**
 * POST /api/slots/:slot/fetch
 * Git fetch origin for a slot
 */
router.post('/:slot/fetch', async (req, res) => {
  try {
    const { slot } = req.params;
    
    console.log(`Git fetch for slot '${slot}'...`);
    const result = await chapterx.gitFetch(slot);
    
    // Get updated status
    const status = await chapterx.getSlotGitStatus(slot);
    
    res.json({
      ...result,
      status,
    });
  } catch (error) {
    console.error('Error fetching slot:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/slots/:slot/pull
 * Git pull for a slot
 */
router.post('/:slot/pull', async (req, res) => {
  try {
    const { slot } = req.params;
    const { autoRestart = false } = req.body;
    
    console.log(`Git pull for slot '${slot}'...`);
    const result = await chapterx.gitPull(slot);
    
    // Auto-restart bots if code changed and requested
    let restartResults = null;
    if (result.codeChanged && autoRestart) {
      console.log(`Code changed, restarting bots on slot '${slot}'...`);
      restartResults = await chapterx.restartBotsOnSlot(slot);
    }
    
    // Get updated status
    const status = await chapterx.getSlotGitStatus(slot);
    
    res.json({
      ...result,
      status,
      restartResults,
    });
  } catch (error) {
    console.error('Error pulling slot:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/slots/:slot/checkout
 * Git checkout branch for a slot
 */
router.post('/:slot/checkout', async (req, res) => {
  try {
    const { slot } = req.params;
    const { branch, autoRestart = false } = req.body;
    
    if (!branch) {
      return res.status(400).json({ error: 'Branch name required' });
    }
    
    console.log(`Git checkout '${branch}' for slot '${slot}'...`);
    const result = await chapterx.gitCheckout(slot, branch);
    
    // Auto-restart bots if code changed and requested
    let restartResults = null;
    if (result.codeChanged && autoRestart) {
      console.log(`Code changed, restarting bots on slot '${slot}'...`);
      restartResults = await chapterx.restartBotsOnSlot(slot);
    }
    
    // Get updated status
    const status = await chapterx.getSlotGitStatus(slot);
    
    res.json({
      ...result,
      status,
      restartResults,
    });
  } catch (error) {
    console.error('Error checking out slot:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/slots/:slot/restart-bots
 * Restart all bots running on a slot
 */
router.post('/:slot/restart-bots', async (req, res) => {
  try {
    const { slot } = req.params;
    
    console.log(`Restarting all bots on slot '${slot}'...`);
    const results = await chapterx.restartBotsOnSlot(slot);
    
    // Get updated bot list
    const bots = await chapterx.listBots();
    const runningOnSlot = bots.filter(b => b.running && b.slot === slot);
    
    res.json({
      success: true,
      results,
      runningBots: runningOnSlot.map(b => b.name),
    });
  } catch (error) {
    console.error('Error restarting bots on slot:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/slots/:slot/bots
 * Get bots running on a specific slot
 */
router.get('/:slot/bots', async (req, res) => {
  try {
    const { slot } = req.params;
    const botNames = await chapterx.getBotsOnSlot(slot);
    
    res.json({
      slot,
      bots: botNames,
      count: botNames.length,
    });
  } catch (error) {
    console.error('Error getting bots on slot:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/slots/:slot/npm-install
 * Run npm install for a slot
 */
router.post('/:slot/npm-install', async (req, res) => {
  try {
    const { slot } = req.params;
    
    console.log(`Running npm install for slot '${slot}'...`);
    const result = await chapterx.npmInstall(slot);
    
    res.json({
      slot,
      ...result,
    });
  } catch (error) {
    console.error('Error running npm install:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/slots/:slot/diff
 * Get git diff for a slot (modified files and their changes)
 */
router.get('/:slot/diff', async (req, res) => {
  try {
    const { slot } = req.params;
    
    const diff = await chapterx.gitDiff(slot);
    res.json(diff);
  } catch (error) {
    console.error('Error getting slot diff:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/slots/:slot/discard
 * Discard all local changes in a slot
 */
router.post('/:slot/discard', async (req, res) => {
  try {
    const { slot } = req.params;
    
    console.log(`Discarding changes for slot '${slot}'...`);
    const result = await chapterx.gitDiscardChanges(slot);
    
    // Get updated status
    const status = await chapterx.getSlotGitStatus(slot);
    
    res.json({
      ...result,
      status,
    });
  } catch (error) {
    console.error('Error discarding changes:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GIT DEPENDENCIES
// ============================================================================

/**
 * GET /api/slots/:slot/deps
 * Get git dependencies status for a slot (current vs latest commits)
 */
router.get('/:slot/deps', async (req, res) => {
  try {
    const { slot } = req.params;
    
    const status = await chapterx.getGitDepsStatus(slot);
    
    res.json(status);
  } catch (error) {
    console.error('Error getting git deps status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/slots/:slot/update-deps
 * Update git dependencies to latest commits
 */
router.post('/:slot/update-deps', async (req, res) => {
  try {
    const { slot } = req.params;
    const { package: packageName = 'all', autoRestart = false } = req.body;
    
    console.log(`Updating git dependencies for slot '${slot}' (package: ${packageName})...`);
    const result = await chapterx.updateGitDep(slot, packageName);
    
    // Auto-restart bots if requested and update was successful
    let restartResults = null;
    if (result.success && !result.skipped && autoRestart) {
      console.log(`Dependencies updated, restarting bots on slot '${slot}'...`);
      restartResults = await chapterx.restartBotsOnSlot(slot);
    }
    
    // Get updated slot status
    const status = await chapterx.getSlotGitStatus(slot);
    
    res.json({
      ...result,
      status,
      restartResults,
    });
  } catch (error) {
    console.error('Error updating git deps:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


