// routes/connectome.js - Connectome (Nin) deploy panel API
// Mirrors routes/slots.js. All routes behind session auth.

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/require-auth');
const connectome = require('../lib/services/connectome');

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/connectome
 * Full status: repos, nin services, runtime readouts, deploy state
 */
router.get('/', async (req, res) => {
  try {
    const status = await connectome.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting connectome status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/connectome/repos/:repo/fetch
 * Git fetch origin for one repo ("Check" button)
 */
router.post('/repos/:repo/fetch', async (req, res) => {
  try {
    const { repo } = req.params;
    console.log(`[connectome] Git fetch for '${repo}'...`);
    const result = await connectome.gitFetch(repo);
    connectome.invalidateCache();
    const status = await connectome.getRepoGitStatus(repo);
    res.json({ ...result, status });
  } catch (error) {
    console.error('Error fetching connectome repo:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/connectome/repos/:repo/deploy
 * Deploy one repo: pull → build → restart affected services
 * Body: { autoRestart = true }
 */
router.post('/repos/:repo/deploy', async (req, res) => {
  try {
    const { repo } = req.params;
    const { autoRestart = true } = req.body || {};
    console.log(`[connectome] Deploy '${repo}' (autoRestart=${autoRestart})...`);
    const result = await connectome.deploy(repo, { autoRestart });
    connectome.invalidateCache();
    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    // deploy() returns structured failures; a throw here is the lock or bad repo name
    console.error('Error deploying connectome repo:', error);
    res.status(409).json({ error: error.message });
  }
});

/**
 * POST /api/connectome/deploy-all
 * Deploy every repo behind origin/main. Body: { onlyBehind = true }
 */
router.post('/deploy-all', async (req, res) => {
  try {
    const { onlyBehind = true } = req.body || {};
    console.log(`[connectome] Deploy all (onlyBehind=${onlyBehind})...`);
    const result = await connectome.deployAll({ onlyBehind });
    connectome.invalidateCache();
    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error('Error in deploy-all:', error);
    res.status(409).json({ error: error.message });
  }
});

/**
 * POST /api/connectome/nin/restart — restart nin.service only
 */
router.post('/nin/restart', async (req, res) => {
  try {
    console.log('[connectome] Restarting nin.service...');
    const result = await connectome.restartNin();
    connectome.invalidateCache();
    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error('Error restarting nin:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/connectome/nin/restart-full — restart nin + nin-session
 */
router.post('/nin/restart-full', async (req, res) => {
  try {
    console.log('[connectome] Restarting nin + nin-session...');
    const result = await connectome.restartNinFull();
    connectome.invalidateCache();
    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error('Error restarting nin (full):', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/connectome/session/restart — restart nin-session.service only
 */
router.post('/session/restart', async (req, res) => {
  try {
    console.log('[connectome] Restarting nin-session.service...');
    const result = await connectome.restartSession();
    connectome.invalidateCache();
    res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    console.error('Error restarting nin-session:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/connectome/logs?lines=200 — journalctl for nin.service
 */
router.get('/logs', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines, 10) || 200;
    const result = await connectome.getLogs(lines);
    res.json(result);
  } catch (error) {
    console.error('Error getting nin logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/connectome/cost — run the cost report script
 */
router.post('/cost', async (req, res) => {
  try {
    console.log('[connectome] Running cost report...');
    const result = await connectome.runCostReport();
    connectome.invalidateCache();
    res.json(result);
  } catch (error) {
    console.error('Error running cost report:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
