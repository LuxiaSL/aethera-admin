// routes/dreams.js - Dream Window health monitoring endpoints

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/require-auth');
const dreams = require('../lib/services/dreams');

router.use(requireAuth);

router.get('/status', (req, res) => {
  try {
    res.json(dreams.getFullStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/health-windows', (req, res) => {
  try {
    res.json(dreams.getHealthWindows());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
