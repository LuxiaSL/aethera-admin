// config.js - Configuration for aethera-admin
// Centralized settings with environment variable overrides

require('dotenv').config();
const path = require('path');

// ============================================================================
// BASE PATHS
// ============================================================================

// Base path - parent of admin/ directory
const BASE_PATH = process.env.BASE_PATH || '/opt/aethera-server';

// Data directory for admin's own state (sessions, user, etc.)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// ============================================================================
// SIBLING DIRECTORIES
// ============================================================================

const CORE_PATH = process.env.CORE_PATH || path.join(BASE_PATH, 'core');
const BOTS_PATH = process.env.BOTS_PATH || path.join(BASE_PATH, 'bots');
const CHAPTERX_PATH = process.env.CHAPTERX_PATH || path.join(BASE_PATH, 'chapterx');

// ChapterX deployment slots - dynamically scanned
/**
 * Scan CHAPTERX_PATH for deployment slot directories
 * A valid slot is a directory containing a .git folder
 * @returns {Object} Map of slot name to path
 */
function scanChapterXSlots() {
  const fs = require('fs');
  const slots = {};
  
  if (!fs.existsSync(CHAPTERX_PATH)) {
    return slots;
  }
  
  const entries = fs.readdirSync(CHAPTERX_PATH, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // Skip hidden dirs
    
    const slotPath = path.join(CHAPTERX_PATH, entry.name);
    const gitDir = path.join(slotPath, '.git');
    
    // Valid slot if it contains a .git directory (is a git repo)
    if (fs.existsSync(gitDir)) {
      slots[entry.name] = slotPath;
    }
  }
  
  return slots;
}

// Cache for slots (refreshed on each access via getter)
let _cachedSlots = null;
let _cacheTime = 0;
const CACHE_TTL = 5000; // 5 second cache

/**
 * Get ChapterX slots with short-term caching
 * @returns {Object} Map of slot name to path
 */
function getChapterXSlots() {
  const now = Date.now();
  if (!_cachedSlots || (now - _cacheTime) > CACHE_TTL) {
    _cachedSlots = scanChapterXSlots();
    _cacheTime = now;
  }
  return _cachedSlots;
}

// For backwards compatibility, provide static reference (scanned once at startup)
const CHAPTERX_SLOTS = scanChapterXSlots();

// ============================================================================
// AETHERA (CORE) INTEGRATION
// ============================================================================

const AETHERA_API_URL = process.env.AETHERA_API_URL || 'http://localhost:8000';
const AETHERA_DB_PATH = process.env.AETHERA_DB_PATH || path.join(CORE_PATH, 'data');

// SQLite database paths
const BLOG_DB = path.join(AETHERA_DB_PATH, 'blog.sqlite');
const IRC_DB = path.join(AETHERA_DB_PATH, 'irc.sqlite');

// ============================================================================
// DREAMS / RUNPOD
// ============================================================================

// API credentials
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || '';

// Legacy serverless endpoint (for backwards compatibility)
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID || '';
const RUNPOD_API_URL = 'https://api.runpod.ai/v2';

// Two-pod architecture pod IDs
// NOTE: These are now OPTIONAL - pods can be discovered by name automatically
// If set, they act as fallbacks when discovery fails
const RUNPOD_COMFYUI_POD_ID = process.env.RUNPOD_COMFYUI_POD_ID || '';
const RUNPOD_DREAMGEN_POD_ID = process.env.RUNPOD_DREAMGEN_POD_ID || '';

// Cost tracking (approximate hourly rates - updated for 4090/A4000)
const COMFYUI_COST_PER_HOUR = parseFloat(process.env.COMFYUI_COST_PER_HOUR || '0.44');
const DREAMGEN_COST_PER_HOUR = parseFloat(process.env.DREAMGEN_COST_PER_HOUR || '0.20');

// ============================================================================
// POD SECRETS (for automatic pod creation)
// ============================================================================
// These secrets are injected into pods when created via lifecycle management

// ComfyUI authentication (nginx basic auth)
const COMFYUI_AUTH_USER = process.env.COMFYUI_AUTH_USER || 'dreamgen';
const COMFYUI_AUTH_PASS = process.env.COMFYUI_AUTH_PASS || '';

// Shared auth token between DreamGen pods and VPS
const DREAM_GEN_AUTH_TOKEN = process.env.DREAM_GEN_AUTH_TOKEN || '';

// VPS URLs for pod configuration
const VPS_BASE_URL = process.env.VPS_BASE_URL || 'https://aetherawi.red';
const VPS_WEBSOCKET_URL = process.env.VPS_WEBSOCKET_URL || 'wss://aetherawi.red/ws/gpu';
const VPS_REGISTER_URL = process.env.VPS_REGISTER_URL || `${VPS_BASE_URL}/api/dreams/comfyui/register`;

// Pod secret bootstrap token (optional - for pods to retrieve secrets from admin)
// If set, pods can call GET /api/dreams/secrets?token=<this> to get their secrets
const POD_BOOTSTRAP_TOKEN = process.env.POD_BOOTSTRAP_TOKEN || '';

// ============================================================================
// SERVER
// ============================================================================

const PORT = parseInt(process.env.PORT || '1717', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ============================================================================
// AUTHENTICATION
// ============================================================================

const SESSION_MAX_AGE = parseInt(process.env.SESSION_MAX_AGE || String(7 * 24 * 60 * 60 * 1000), 10); // 7 days
const SESSION_COOKIE_NAME = 'aethera_session';
const BCRYPT_ROUNDS = 12;

// ============================================================================
// FILE PATHS
// ============================================================================

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SLOTS_FILE = path.join(DATA_DIR, 'slots.json');

// ============================================================================
// DOCKER (for aethera container)
// ============================================================================

const AETHERA_CONTAINER_NAME = process.env.AETHERA_CONTAINER_NAME || 'aethera';

// ============================================================================
// RATE LIMITING
// ============================================================================

const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 100; // requests per window
const LOGIN_RATE_LIMIT_MAX = 5; // stricter for login attempts

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Base paths
  BASE_PATH,
  DATA_DIR,
  
  // Sibling directories
  CORE_PATH,
  BOTS_PATH,
  CHAPTERX_PATH,
  CHAPTERX_SLOTS,
  getChapterXSlots,  // Dynamic slot getter (recommended)
  scanChapterXSlots, // Force rescan
  
  // Aethera integration
  AETHERA_API_URL,
  AETHERA_DB_PATH,
  BLOG_DB,
  IRC_DB,
  
  // RunPod (legacy serverless)
  RUNPOD_API_KEY,
  RUNPOD_ENDPOINT_ID,
  RUNPOD_API_URL,
  
  // RunPod (two-pod architecture)
  RUNPOD_COMFYUI_POD_ID,
  RUNPOD_DREAMGEN_POD_ID,
  COMFYUI_COST_PER_HOUR,
  DREAMGEN_COST_PER_HOUR,
  
  // Pod secrets (for lifecycle management)
  COMFYUI_AUTH_USER,
  COMFYUI_AUTH_PASS,
  DREAM_GEN_AUTH_TOKEN,
  VPS_BASE_URL,
  VPS_WEBSOCKET_URL,
  VPS_REGISTER_URL,
  POD_BOOTSTRAP_TOKEN,
  
  // Server
  PORT,
  HOST,
  
  // Auth
  SESSION_MAX_AGE,
  SESSION_COOKIE_NAME,
  BCRYPT_ROUNDS,
  
  // Files
  USERS_FILE,
  SESSIONS_FILE,
  SLOTS_FILE,
  
  // Docker
  AETHERA_CONTAINER_NAME,
  
  // Rate limiting
  RATE_LIMIT_WINDOW,
  RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_MAX,
};

