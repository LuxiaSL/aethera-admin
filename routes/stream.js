// routes/stream.js - Server-Sent Events for live dashboard updates
// Provides real-time data streams for the admin dashboard

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/require-auth');
const aggregators = require('../lib/stream/aggregators');

// ============================================================================
// DOMAIN CONFIGURATION
// ============================================================================

/**
 * Configuration for each streamable domain
 * - interval: How often to push updates (ms)
 * - aggregator: Function name in aggregators module
 */
const DOMAIN_CONFIG = {
  dashboard: { interval: 5000, aggregator: 'getDashboardData' },
  bots:      { interval: 5000, aggregator: 'getBotsData' },
  services:  { interval: 5000, aggregator: 'getServicesData' },
  dreams:    { interval: 5000, aggregator: 'getDreamsData' },
  server:    { interval: 3000, aggregator: 'getServerData' },
  blog:      { interval: 30000, aggregator: 'getBlogData' },
  usage:     { interval: 10000, aggregator: 'getUsageData' },  // Sync + update every 10s
};

// Track active connections for debugging/monitoring
const activeConnections = new Map();

// ============================================================================
// MANAGEMENT ENDPOINTS (defined first to avoid being caught by /:domain)
// ============================================================================

/**
 * GET /api/stream/health
 * Health check and info about the stream service (public endpoint)
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    domains: Object.entries(DOMAIN_CONFIG).map(([name, config]) => ({
      name,
      interval: config.interval,
    })),
    activeConnections: activeConnections.size,
  });
});

/**
 * GET /api/stream/connections
 * List active connections (for debugging)
 * Requires auth
 */
router.get('/connections', requireAuth, (req, res) => {
  const connections = [];
  
  for (const [id, info] of activeConnections) {
    connections.push({
      id,
      domain: info.domain,
      user: info.user,
      startedAt: info.startedAt.toISOString(),
      duration: Math.round((Date.now() - info.startedAt.getTime()) / 1000),
    });
  }
  
  res.json({
    count: connections.length,
    connections,
  });
});

// ============================================================================
// SSE ENDPOINT
// ============================================================================

/**
 * GET /api/stream/:domain
 * Server-Sent Events endpoint for live data streaming
 * 
 * Domains: dashboard, bots, services, dreams, server, blog
 * 
 * The client connects via EventSource and receives JSON data at regular intervals.
 * Connection is kept alive until the client disconnects.
 */
router.get('/:domain', requireAuth, async (req, res) => {
  const { domain } = req.params;
  const config = DOMAIN_CONFIG[domain];
  
  if (!config) {
    return res.status(404).json({ 
      error: `Unknown stream domain: ${domain}`,
      available: Object.keys(DOMAIN_CONFIG),
    });
  }
  
  // Generate connection ID for tracking
  const connectionId = `${domain}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable Nginx/Caddy buffering
    'Access-Control-Allow-Origin': '*', // Allow cross-origin if needed
  });
  
  // Track this connection
  activeConnections.set(connectionId, {
    domain,
    user: req.username,
    startedAt: new Date(),
  });
  
  console.log(`[Stream] Connected: ${connectionId} (${req.username})`);
  
  /**
   * Send data to the client
   * @param {Object} data - Data to send
   * @param {string} [eventType] - Optional event type (defaults to 'message')
   */
  const sendData = (data, eventType = null) => {
    try {
      if (eventType) {
        res.write(`event: ${eventType}\n`);
      }
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      console.error(`[Stream] Write error on ${connectionId}:`, e.message);
    }
  };
  
  /**
   * Fetch and send domain data
   */
  const pushUpdate = async () => {
    try {
      const data = await aggregators[config.aggregator]();
      sendData(data);
    } catch (error) {
      console.error(`[Stream] Error fetching ${domain} data:`, error.message);
      sendData({ 
        error: error.message,
        timestamp: Date.now(),
      }, 'error');
    }
  };
  
  // Send initial data immediately
  await pushUpdate();
  
  // Set up interval for regular updates
  const interval = setInterval(pushUpdate, config.interval);
  
  // Send keepalive comments every 30 seconds to prevent connection timeout
  const keepalive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (e) {
      // Connection probably closed
    }
  }, 30000);
  
  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(interval);
    clearInterval(keepalive);
    activeConnections.delete(connectionId);
    console.log(`[Stream] Disconnected: ${connectionId}`);
  });
  
  // Handle errors
  req.on('error', (err) => {
    console.error(`[Stream] Request error on ${connectionId}:`, err.message);
    clearInterval(interval);
    clearInterval(keepalive);
    activeConnections.delete(connectionId);
  });
});

module.exports = router;
