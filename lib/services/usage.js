// lib/services/usage.js - Token usage tracking service
// Monitors ChapterX trace files and aggregates usage per bot

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../../config');

// ============================================================================
// DATABASE SETUP
// ============================================================================

const DB_PATH = path.join(config.DATA_DIR, 'usage.sqlite');

let db = null;

/**
 * Initialize the database and create tables
 */
function initDB() {
  if (db) return db;
  
  db = new Database(DB_PATH);
  
  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  
  // Create usage records table
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_name TEXT NOT NULL,
      trace_id TEXT UNIQUE NOT NULL,
      timestamp TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      llm_call_count INTEGER DEFAULT 1,
      success INTEGER DEFAULT 1,
      estimated_cost_usd REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_usage_bot_time 
      ON usage_records(bot_name, timestamp);
    
    CREATE INDEX IF NOT EXISTS idx_usage_timestamp 
      ON usage_records(timestamp);
  `);
  
  // Create tracking table for last processed position
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      slot TEXT NOT NULL,
      last_line_count INTEGER DEFAULT 0,
      last_processed_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  console.log('[usage] Database initialized at', DB_PATH);
  return db;
}

// ============================================================================
// MODEL PRICING
// ============================================================================

// Pricing per 1K tokens (input, output, cache_write_multiplier, cache_read_multiplier)
// Cache write = input_cost * multiplier, Cache read = input_cost * multiplier
// Source: https://platform.claude.com/docs/en/about-claude/pricing
const MODEL_PRICING = {
  // Claude 4.5 family (prices per 1K tokens)
  // Opus 4.5: $5/MTok input, $25/MTok output
  'claude-opus-4-5-20251101': { input: 0.005, output: 0.025, cacheWriteMult: 1.25, cacheReadMult: 0.1 },
  // Sonnet 4.5: $3/MTok input, $15/MTok output
  'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015, cacheWriteMult: 1.25, cacheReadMult: 0.1 },
  // Haiku 4.5: $1/MTok input, $5/MTok output
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005, cacheWriteMult: 1.25, cacheReadMult: 0.1 },
  
  // Claude 4.0 family
  'claude-opus-4-20250514': { input: 0.015, output: 0.075, cacheWriteMult: 1.25, cacheReadMult: 0.1 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015, cacheWriteMult: 1.25, cacheReadMult: 0.1 },
  
  // Claude 3.5 family
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015, cacheWriteMult: 1.25, cacheReadMult: 0.1 },
  'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004, cacheWriteMult: 1.25, cacheReadMult: 0.1 },
  
  // OpenAI via OpenRouter
  // O3: $2/MTok input, $8/MTok output, $0.5/MTok cache read
  'openai/o3': { input: 0.002, output: 0.008, cacheWriteMult: 0, cacheReadMult: 0.25 },
  'openai/o3-mini': { input: 0.0011, output: 0.0044, cacheWriteMult: 0, cacheReadMult: 0.5 },
  'openai/gpt-4o': { input: 0.0025, output: 0.01, cacheWriteMult: 0, cacheReadMult: 0.5 },
  'openai/gpt-4o-mini': { input: 0.00015, output: 0.0006, cacheWriteMult: 0, cacheReadMult: 0.5 },
  
  // Moonshot Kimi K2 via OpenRouter: $0.50/MTok input, $2.40/MTok output
  'moonshotai/kimi-k2': { input: 0.0005, output: 0.0024, cacheWriteMult: 0, cacheReadMult: 0 },
  
  // Local models (self-hosted, no API cost)
  'local': { input: 0, output: 0, cacheWriteMult: 0, cacheReadMult: 0 },
  'NousResearch/K3-HF-BF16': { input: 0, output: 0, cacheWriteMult: 0, cacheReadMult: 0 },
  
  // DeepSeek
  'deepseek/deepseek-chat': { input: 0.00014, output: 0.00028, cacheWriteMult: 0, cacheReadMult: 0 },
};

/**
 * Calculate estimated cost for a usage record
 * 
 * IMPORTANT: Token semantics differ by provider!
 * 
 * Anthropic (Claude models):
 * - inputTokens = NEW input tokens (uncached)
 * - cacheReadTokens = tokens read from cache (SEPARATE from input)
 * - Total context = inputTokens + cacheReadTokens
 * 
 * OpenRouter (O3, K2, etc):
 * - inputTokens = TOTAL input tokens (includes cached portion)
 * - cacheReadTokens = cached portion (SUBSET of inputTokens)
 * - Uncached = inputTokens - cacheReadTokens
 */
function calculateCost(model, inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0) {
  // Try exact match, then prefix match
  let pricing = MODEL_PRICING[model];
  
  if (!pricing) {
    // Try prefix matching
    for (const [prefix, p] of Object.entries(MODEL_PRICING)) {
      if (model && model.startsWith(prefix.split('-')[0])) {
        pricing = p;
        break;
      }
    }
  }
  
  // Default to Sonnet pricing if unknown
  if (!pricing) {
    pricing = { input: 0.003, output: 0.015, cacheWriteMult: 1.25, cacheReadMult: 0.1 };
  }
  
  // Determine if this is an Anthropic model (different token semantics)
  const isAnthropic = model && (
    model.startsWith('claude-') || 
    model.includes('claude') ||
    model.includes('anthropic')
  );
  
  // Calculate costs based on provider semantics
  let inputCost;
  if (isAnthropic) {
    // Anthropic: inputTokens is already uncached, cacheRead is separate
    inputCost = (inputTokens / 1000) * pricing.input;
  } else {
    // OpenRouter/others: inputTokens includes cached, subtract cacheRead
    const uncachedInput = Math.max(0, inputTokens - cacheReadTokens);
    inputCost = (uncachedInput / 1000) * pricing.input;
  }
  
  const outputCost = (outputTokens / 1000) * pricing.output;
  const cacheWriteCost = (cacheWriteTokens / 1000) * pricing.input * pricing.cacheWriteMult;
  const cacheReadCost = (cacheReadTokens / 1000) * pricing.input * pricing.cacheReadMult;
  
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

// ============================================================================
// TRACE PARSING
// ============================================================================

/**
 * Parse a single trace file and extract usage data
 */
function parseTraceFile(tracePath) {
  try {
    const content = fs.readFileSync(tracePath, 'utf8');
    const trace = JSON.parse(content);
    
    // Aggregate all LLM calls in this trace
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalDuration = 0;
    let model = null;
    
    for (const call of (trace.llmCalls || [])) {
      const usage = call.tokenUsage || {};
      totalInput += usage.inputTokens || 0;
      totalOutput += usage.outputTokens || 0;
      totalCacheRead += usage.cacheReadTokens || 0;
      totalCacheWrite += usage.cacheCreationTokens || 0;
      totalDuration += call.durationMs || 0;
      
      // Use the model from the first call (they should all be the same per bot)
      if (!model && call.model) {
        model = call.model;
      }
    }
    
    return {
      botName: trace.botId,
      traceId: trace.traceId,
      timestamp: trace.timestamp,
      model,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheWrite,
      durationMs: totalDuration,
      llmCallCount: (trace.llmCalls || []).length,
      success: trace.outcome?.success ?? true,
    };
  } catch (error) {
    console.error('[usage] Error parsing trace file:', tracePath, error.message);
    return null;
  }
}

/**
 * Parse an index line and find the corresponding trace file
 */
function parseIndexLine(line, slot) {
  try {
    const index = JSON.parse(line);
    const slots = config.getChapterXSlots();
    const slotPath = slots[slot];
    
    if (!slotPath) return null;
    
    // Build path to trace file
    // Traces are stored in: {slot}/logs/traces/{botName}/{filename}
    const tracePath = path.join(slotPath, 'logs', 'traces', index.botName, index.filename);
    
    if (!fs.existsSync(tracePath)) {
      console.warn('[usage] Trace file not found:', tracePath);
      return null;
    }
    
    return parseTraceFile(tracePath);
  } catch (error) {
    console.error('[usage] Error parsing index line:', error.message);
    return null;
  }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Insert a usage record into the database
 */
function insertUsageRecord(record) {
  const db = initDB();
  
  const cost = calculateCost(
    record.model,
    record.inputTokens,
    record.outputTokens,
    record.cacheReadTokens,
    record.cacheWriteTokens
  );
  
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO usage_records 
    (bot_name, trace_id, timestamp, model, input_tokens, output_tokens, 
     cache_read_tokens, cache_write_tokens, duration_ms, llm_call_count, 
     success, estimated_cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  try {
    stmt.run(
      record.botName,
      record.traceId,
      record.timestamp,
      record.model,
      record.inputTokens,
      record.outputTokens,
      record.cacheReadTokens,
      record.cacheWriteTokens,
      record.durationMs,
      record.llmCallCount,
      record.success ? 1 : 0,
      cost
    );
    return true;
  } catch (error) {
    if (!error.message.includes('UNIQUE constraint')) {
      console.error('[usage] Error inserting record:', error.message);
    }
    return false;
  }
}

/**
 * Get sync state for a slot
 */
function getSyncState(slot) {
  const db = initDB();
  const stmt = db.prepare('SELECT * FROM usage_sync_state WHERE slot = ?');
  return stmt.get(slot);
}

/**
 * Update sync state for a slot
 */
function updateSyncState(slot, lineCount) {
  const db = initDB();
  const stmt = db.prepare(`
    INSERT INTO usage_sync_state (id, slot, last_line_count, last_processed_at, updated_at)
    VALUES (1, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      slot = excluded.slot,
      last_line_count = excluded.last_line_count,
      last_processed_at = datetime('now'),
      updated_at = datetime('now')
  `);
  stmt.run(slot, lineCount);
}

// ============================================================================
// SYNC OPERATIONS
// ============================================================================

/**
 * Sync usage from a slot's index file
 * @param {string} slot - Slot name (e.g., 'dev', 'main')
 * @returns {Object} Sync result
 */
function syncFromSlot(slot) {
  const db = initDB();
  const slots = config.getChapterXSlots();
  const slotPath = slots[slot];
  
  if (!slotPath || !fs.existsSync(slotPath)) {
    return { success: false, error: `Slot '${slot}' not found` };
  }
  
  const indexPath = path.join(slotPath, 'logs', 'traces', 'index.jsonl');
  
  if (!fs.existsSync(indexPath)) {
    return { success: false, error: 'Index file not found', path: indexPath };
  }
  
  // Read current sync state
  const syncState = getSyncState(slot);
  const lastLineCount = syncState?.last_line_count || 0;
  
  // Read index file
  const lines = fs.readFileSync(indexPath, 'utf8').split('\n').filter(Boolean);
  const currentLineCount = lines.length;
  
  if (currentLineCount <= lastLineCount) {
    return { 
      success: true, 
      newRecords: 0, 
      message: 'Already up to date',
      totalLines: currentLineCount,
    };
  }
  
  // Process new lines
  const newLines = lines.slice(lastLineCount);
  let inserted = 0;
  let failed = 0;
  
  for (const line of newLines) {
    const record = parseIndexLine(line, slot);
    if (record) {
      if (insertUsageRecord(record)) {
        inserted++;
      }
    } else {
      failed++;
    }
  }
  
  // Update sync state
  updateSyncState(slot, currentLineCount);
  
  console.log(`[usage] Synced ${inserted} new records from slot '${slot}'`);
  
  return {
    success: true,
    newRecords: inserted,
    failed,
    totalLines: currentLineCount,
    previousLines: lastLineCount,
  };
}

/**
 * Full backfill from a slot (reprocess all traces)
 */
function backfillFromSlot(slot) {
  const db = initDB();
  
  // Reset sync state for this slot
  const stmt = db.prepare('DELETE FROM usage_sync_state WHERE slot = ?');
  stmt.run(slot);
  
  return syncFromSlot(slot);
}

/**
 * Sync from all available slots
 */
function syncAll() {
  const slots = config.getChapterXSlots();
  const results = {};
  
  for (const slot of Object.keys(slots)) {
    results[slot] = syncFromSlot(slot);
  }
  
  return results;
}

// ============================================================================
// QUERY OPERATIONS
// ============================================================================

/**
 * Get usage summary for a bot
 * @param {string} botName - Bot name
 * @param {Object} options - Query options
 */
function getBotUsage(botName, options = {}) {
  const db = initDB();
  const { period = 'all', since } = options;
  
  let whereClause = 'WHERE bot_name = ?';
  const params = [botName];
  
  // Add time filter
  if (since) {
    whereClause += ' AND timestamp >= ?';
    params.push(since);
  } else if (period !== 'all') {
    const periodMap = {
      hour: "datetime('now', '-1 hour')",
      day: "datetime('now', '-1 day')",
      week: "datetime('now', '-7 days')",
      month: "datetime('now', '-30 days')",
    };
    if (periodMap[period]) {
      whereClause += ` AND timestamp >= ${periodMap[period]}`;
    }
  }
  
  const stmt = db.prepare(`
    SELECT 
      bot_name,
      COUNT(*) as request_count,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      SUM(cache_read_tokens) as total_cache_read_tokens,
      SUM(cache_write_tokens) as total_cache_write_tokens,
      SUM(estimated_cost_usd) as total_cost_usd,
      SUM(duration_ms) as total_duration_ms,
      AVG(duration_ms) as avg_duration_ms,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_requests,
      MIN(timestamp) as first_request,
      MAX(timestamp) as last_request,
      model
    FROM usage_records
    ${whereClause}
    GROUP BY bot_name
  `);
  
  const result = stmt.get(...params);
  
  if (!result) {
    return null;
  }
  
  // Calculate cache hit ratio
  // inputTokens already includes cacheReadTokens (cache is a subset of input)
  const cacheHitRatio = result.total_input_tokens > 0 
    ? (result.total_cache_read_tokens || 0) / result.total_input_tokens 
    : 0;
  
  return {
    ...result,
    cache_hit_ratio: cacheHitRatio,
    cache_savings_estimate: (result.total_cache_read_tokens || 0) * 0.9 / 1000 * 0.003, // 90% savings on cached reads
  };
}

/**
 * Get usage summary for all bots
 */
function getAllBotsUsage(options = {}) {
  const db = initDB();
  const { period = 'all' } = options;
  
  let whereClause = '';
  
  if (period !== 'all') {
    const periodMap = {
      hour: "datetime('now', '-1 hour')",
      day: "datetime('now', '-1 day')",
      week: "datetime('now', '-7 days')",
      month: "datetime('now', '-30 days')",
    };
    if (periodMap[period]) {
      whereClause = `WHERE timestamp >= ${periodMap[period]}`;
    }
  }
  
  const stmt = db.prepare(`
    SELECT 
      bot_name,
      COUNT(*) as request_count,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      SUM(cache_read_tokens) as total_cache_read_tokens,
      SUM(cache_write_tokens) as total_cache_write_tokens,
      SUM(estimated_cost_usd) as total_cost_usd,
      SUM(duration_ms) as total_duration_ms,
      AVG(duration_ms) as avg_duration_ms,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_requests,
      MIN(timestamp) as first_request,
      MAX(timestamp) as last_request,
      model
    FROM usage_records
    ${whereClause}
    GROUP BY bot_name
    ORDER BY total_cost_usd DESC
  `);
  
  const results = stmt.all();
  
  return results.map(r => ({
    ...r,
    // inputTokens already includes cacheReadTokens (cache is a subset of input)
    cache_hit_ratio: r.total_input_tokens > 0 
      ? (r.total_cache_read_tokens || 0) / r.total_input_tokens 
      : 0,
  }));
}

/**
 * Get overall usage totals
 */
function getTotals(options = {}) {
  const db = initDB();
  const { period = 'all' } = options;
  
  let whereClause = '';
  
  if (period !== 'all') {
    const periodMap = {
      hour: "datetime('now', '-1 hour')",
      day: "datetime('now', '-1 day')",
      week: "datetime('now', '-7 days')",
      month: "datetime('now', '-30 days')",
    };
    if (periodMap[period]) {
      whereClause = `WHERE timestamp >= ${periodMap[period]}`;
    }
  }
  
  const stmt = db.prepare(`
    SELECT 
      COUNT(DISTINCT bot_name) as bot_count,
      COUNT(*) as total_requests,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      SUM(cache_read_tokens) as total_cache_read_tokens,
      SUM(cache_write_tokens) as total_cache_write_tokens,
      SUM(estimated_cost_usd) as total_cost_usd,
      SUM(duration_ms) as total_duration_ms,
      AVG(duration_ms) as avg_duration_ms,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_requests
    FROM usage_records
    ${whereClause}
  `);
  
  const result = stmt.get();
  
  return {
    ...result,
    // inputTokens already includes cacheReadTokens (cache is a subset of input)
    cache_hit_ratio: result.total_input_tokens > 0 
      ? (result.total_cache_read_tokens || 0) / result.total_input_tokens 
      : 0,
  };
}

/**
 * Get recent usage records
 */
function getRecentRecords(limit = 50) {
  const db = initDB();
  
  const stmt = db.prepare(`
    SELECT * FROM usage_records
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  
  return stmt.all(limit);
}

/**
 * Clear all usage records and sync state
 * Useful when recalculating costs after pricing/formula fixes
 */
function clearAllRecords() {
  const db = initDB();
  
  db.exec('DELETE FROM usage_records');
  db.exec('DELETE FROM usage_sync_state');
  
  console.log('[usage] Cleared all records and sync state for fresh backfill');
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Database
  initDB,
  clearAllRecords,
  
  // Sync
  syncFromSlot,
  syncAll,
  backfillFromSlot,
  
  // Queries
  getBotUsage,
  getAllBotsUsage,
  getTotals,
  getRecentRecords,
  
  // Utilities
  calculateCost,
  parseTraceFile,
  
  // Constants
  MODEL_PRICING,
};

