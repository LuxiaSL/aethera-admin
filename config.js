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

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || '';
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID || '';
const RUNPOD_API_URL = 'https://api.runpod.ai/v2';

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

const USER_FILE = path.join(DATA_DIR, 'user.json');
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
  
  // RunPod
  RUNPOD_API_KEY,
  RUNPOD_ENDPOINT_ID,
  RUNPOD_API_URL,
  
  // Server
  PORT,
  HOST,
  
  // Auth
  SESSION_MAX_AGE,
  SESSION_COOKIE_NAME,
  BCRYPT_ROUNDS,
  
  // Files
  USER_FILE,
  SESSIONS_FILE,
  SLOTS_FILE,
  
  // Docker
  AETHERA_CONTAINER_NAME,
  
  // Rate limiting
  RATE_LIMIT_WINDOW,
  RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_MAX,
};

