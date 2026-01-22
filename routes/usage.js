// routes/usage.js - Token usage tracking API routes

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/require-auth');
const usage = require('../lib/services/usage');

// All routes require authentication
router.use(requireAuth);

// ============================================================================
// SYNC OPERATIONS
// ============================================================================

/**
 * POST /api/usage/sync
 * Sync usage from all slots
 */
router.post('/sync', async (req, res) => {
  try {
    const results = usage.syncAll();
    
    // Calculate totals
    let totalNew = 0;
    let totalFailed = 0;
    for (const [slot, result] of Object.entries(results)) {
      if (result.success) {
        totalNew += result.newRecords || 0;
        totalFailed += result.failed || 0;
      }
    }
    
    res.json({
      success: true,
      slots: results,
      totalNewRecords: totalNew,
      totalFailed,
    });
  } catch (error) {
    console.error('Error syncing usage:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/usage/sync/:slot
 * Sync usage from a specific slot
 */
router.post('/sync/:slot', async (req, res) => {
  try {
    const { slot } = req.params;
    const result = usage.syncFromSlot(slot);
    
    res.json(result);
  } catch (error) {
    console.error('Error syncing usage from slot:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/usage/backfill/:slot
 * Full backfill from a slot (reprocess all traces)
 */
router.post('/backfill/:slot', async (req, res) => {
  try {
    const { slot } = req.params;
    const result = usage.backfillFromSlot(slot);
    
    res.json(result);
  } catch (error) {
    console.error('Error backfilling usage from slot:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/usage/backfill-all
 * Full backfill from all slots (reprocess everything with fresh cost calculations)
 */
router.post('/backfill-all', async (req, res) => {
  try {
    // Clear all existing records to recalculate costs
    usage.clearAllRecords();
    
    // Sync from all slots
    const results = usage.syncAll();
    
    // Calculate totals
    let totalNew = 0;
    let totalFailed = 0;
    for (const [slot, result] of Object.entries(results)) {
      if (result.success) {
        totalNew += result.newRecords || 0;
        totalFailed += result.failed || 0;
      }
    }
    
    res.json({
      success: true,
      message: 'Full backfill complete with recalculated costs',
      slots: results,
      totalNewRecords: totalNew,
      totalFailed,
    });
  } catch (error) {
    console.error('Error during full backfill:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// QUERY OPERATIONS
// ============================================================================

/**
 * GET /api/usage
 * Get overall usage totals
 */
router.get('/', async (req, res) => {
  try {
    const { period = 'all' } = req.query;
    
    const totals = usage.getTotals({ period });
    const byBot = usage.getAllBotsUsage({ period });
    
    res.json({
      period,
      totals,
      byBot,
    });
  } catch (error) {
    console.error('Error getting usage:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/usage/summary
 * Get comprehensive usage summary for all bots (used by UI)
 */
router.get('/summary', async (req, res) => {
  try {
    const { period = 'day' } = req.query;
    
    const totals = usage.getTotals({ period });
    const bots = usage.getAllBotsUsage({ period });
    
    // Calculate cache savings estimate (90% of input cost saved on cache reads)
    const cacheSavingsEstimate = totals.total_cache_read_tokens 
      ? (totals.total_cache_read_tokens * 0.9 / 1000 * 0.003) 
      : 0;
    
    res.json({
      period,
      totals: {
        ...totals,
        total_tokens: (totals.total_input_tokens || 0) + (totals.total_output_tokens || 0),
        cache_savings_estimate: cacheSavingsEstimate,
      },
      bots,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error getting usage summary:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/usage/bot/:botName
 * Get detailed usage for a specific bot (alias for /bots/:name)
 */
router.get('/bot/:botName', async (req, res) => {
  try {
    const { botName } = req.params;
    const { period = 'day' } = req.query;
    
    const botUsage = usage.getBotUsage(botName, { period });
    
    if (!botUsage) {
      return res.status(404).json({ error: `No usage data for bot '${botName}'` });
    }
    
    res.json({
      name: botName,
      period,
      usage: botUsage,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(`Error getting usage for bot ${req.params.botName}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/usage/totals
 * Get just the totals for different time periods
 */
router.get('/totals', async (req, res) => {
  try {
    const periods = ['hour', 'day', 'week', 'month', 'all'];
    const results = {};
    
    for (const period of periods) {
      results[period] = usage.getTotals({ period });
    }
    
    res.json(results);
  } catch (error) {
    console.error('Error getting usage totals:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/usage/bots
 * Get usage for all bots
 */
router.get('/bots', async (req, res) => {
  try {
    const { period = 'all' } = req.query;
    const bots = usage.getAllBotsUsage({ period });
    
    res.json({
      period,
      bots,
      count: bots.length,
    });
  } catch (error) {
    console.error('Error getting bot usage:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/usage/bots/:name
 * Get usage for a specific bot
 */
router.get('/bots/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { period = 'all' } = req.query;
    
    const botUsage = usage.getBotUsage(name, { period });
    
    if (!botUsage) {
      return res.status(404).json({ error: `No usage data for bot '${name}'` });
    }
    
    // Get per-period breakdown
    const periods = {
      day: usage.getBotUsage(name, { period: 'day' }),
      week: usage.getBotUsage(name, { period: 'week' }),
      month: usage.getBotUsage(name, { period: 'month' }),
      all: usage.getBotUsage(name, { period: 'all' }),
    };
    
    res.json({
      name,
      current: botUsage,
      periods,
    });
  } catch (error) {
    console.error('Error getting bot usage:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/usage/recent
 * Get recent usage records
 */
router.get('/recent', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const records = usage.getRecentRecords(parseInt(limit));
    
    res.json({
      records,
      count: records.length,
    });
  } catch (error) {
    console.error('Error getting recent usage:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/usage/pricing
 * Get model pricing info
 */
router.get('/pricing', async (req, res) => {
  try {
    res.json({
      models: usage.MODEL_PRICING,
      note: 'Prices per 1K tokens. Cache multipliers apply to base input price.',
    });
  } catch (error) {
    console.error('Error getting pricing:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

