// lib/stream/aggregators.js - Domain data aggregators for SSE
// These functions gather data from various services for live streaming

const chapterx = require('../services/chapterx');
const aethera = require('../services/aethera');
const dreams = require('../services/dreams');
const server = require('../services/server');
const blog = require('../content/blog');

// ============================================================================
// DASHBOARD AGGREGATOR
// ============================================================================

/**
 * Dashboard: Aggregate overview data from all services
 * Used by the main dashboard page for at-a-glance status
 * @returns {Promise<Object>}
 */
async function getDashboardData() {
  // Fetch all data in parallel for speed
  const [botsResult, aetheraStatus, aetheraHealth, dreamsStatus, blogStats] = await Promise.allSettled([
    chapterx.listBots(),
    aethera.getStatus(),
    aethera.checkHealth(),
    dreams.getStatus(),
    safeGetBlogStats(),
  ]);
  
  // Extract values with fallbacks
  const bots = botsResult.status === 'fulfilled' ? (botsResult.value || []) : [];
  const aetheraData = aetheraStatus.status === 'fulfilled' ? aetheraStatus.value : { running: false };
  const aetheraHealthData = aetheraHealth.status === 'fulfilled' ? aetheraHealth.value : { healthy: false };
  const dreamsData = dreamsStatus.status === 'fulfilled' ? dreamsStatus.value : { state: 'unknown' };
  const blogData = blogStats.status === 'fulfilled' ? blogStats.value : { total: 0 };
  
  const runningBots = bots.filter(b => b.running);
  
  return {
    bots: {
      total: bots.length,
      running: runningBots.length,
      // Top 5 bots for quick overview
      list: bots.slice(0, 5).map(b => ({
        name: b.name,
        running: b.running,
        slot: b.slot,
      })),
    },
    services: {
      aethera: {
        running: aetheraData.running || false,
        health: aetheraHealthData.healthy ? 'healthy' : 'unhealthy',
      },
    },
    dreams: {
      state: dreamsData.state || 'unknown',
      stateMessage: dreamsData.stateMessage || '',
    },
    blog: {
      total: blogData.total || 0,
    },
    timestamp: Date.now(),
  };
}

// ============================================================================
// BOTS AGGREGATOR
// ============================================================================

/**
 * Bots: Full bot listing with slots and systemd status
 * @returns {Promise<Object>}
 */
async function getBotsData() {
  const [bots, systemdAvailable, slots] = await Promise.all([
    chapterx.listBots(),
    chapterx.isSystemdAvailable(),
    chapterx.getAllSlotsStatus(),
  ]);
  
  const systemdInfo = chapterx.getSystemdInfo();
  
  // Add running bots info to each slot
  for (const slotName of Object.keys(slots)) {
    const runningBots = bots
      .filter(b => b.running && b.slot === slotName)
      .map(b => b.name);
    slots[slotName].runningBots = runningBots;
  }
  
  return {
    bots,
    slots,
    count: bots.length,
    running: bots.filter(b => b.running).length,
    systemd: {
      available: systemdAvailable,
      ...systemdInfo,
    },
    timestamp: Date.now(),
  };
}

// ============================================================================
// SERVICES AGGREGATOR
// ============================================================================

/**
 * Services: Aethera container + deployment slots status
 * @returns {Promise<Object>}
 */
async function getServicesData() {
  const [aetheraStatus, aetheraHealth, slots, bots] = await Promise.all([
    aethera.getStatus(),
    aethera.checkHealth(),
    chapterx.getAllSlotsStatus(),
    chapterx.listBots(),
  ]);
  
  // Add running bots info to each slot
  for (const slotName of Object.keys(slots)) {
    const runningBots = bots
      .filter(b => b.running && b.slot === slotName)
      .map(b => b.name);
    slots[slotName].runningBots = runningBots;
  }
  
  return {
    aethera: {
      ...aetheraStatus,
      health: aetheraHealth.healthy ? 'healthy' : 'unhealthy',
      healthDetails: aetheraHealth,
    },
    slots,
    timestamp: Date.now(),
  };
}

// ============================================================================
// DREAMS AGGREGATOR
// ============================================================================

/**
 * Dreams: GPU status, viewer counts, generation metrics
 * @returns {Promise<Object>}
 */
async function getDreamsData() {
  const status = await dreams.getStatus();
  return {
    ...status,
    timestamp: Date.now(),
  };
}

// ============================================================================
// SERVER AGGREGATOR
// ============================================================================

/**
 * Server: System metrics (CPU, memory, disk, load, uptime)
 * @returns {Promise<Object>}
 */
async function getServerData() {
  const metrics = await server.getAllMetrics();
  return {
    ...metrics,
    timestamp: Date.now(),
  };
}

// ============================================================================
// BLOG AGGREGATOR
// ============================================================================

/**
 * Blog: Post statistics (low frequency updates)
 * @returns {Promise<Object>}
 */
async function getBlogData() {
  const available = blog.isDatabaseAvailable();
  
  if (!available) {
    return {
      available: false,
      stats: { total: 0, published: 0, drafts: 0 },
      timestamp: Date.now(),
    };
  }
  
  const stats = blog.getStats();
  
  return {
    available: true,
    stats,
    timestamp: Date.now(),
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Safely get blog stats (handles database not being available)
 * @returns {Promise<Object>}
 */
async function safeGetBlogStats() {
  try {
    if (!blog.isDatabaseAvailable()) {
      return { total: 0, published: 0, drafts: 0 };
    }
    return blog.getStats();
  } catch (e) {
    console.error('Error getting blog stats:', e.message);
    return { total: 0, published: 0, drafts: 0 };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  getDashboardData,
  getBotsData,
  getServicesData,
  getDreamsData,
  getServerData,
  getBlogData,
};

