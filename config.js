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
// CONNECTOME (Nin deploy panel)
// ============================================================================

const CONNECTOME_PATH = process.env.CONNECTOME_PATH || '/opt/connectome';

// Declarative manifest of the source-run repos the panel can deploy.
// `build` is the command run after a pull (null = no build step);
// `restarts` lists the systemd services affected by a deploy.
const CONNECTOME_REPOS = [
  { name: 'connectome-host',       build: null,            restarts: ['nin'] },
  { name: 'discord-mcpl',          build: 'npm run build', restarts: ['nin'] },
  { name: 'heartbeat-mcpl',        build: 'npm run build', restarts: ['nin'] },
  { name: 'terminal-sessions-mcp', build: 'npm run build', restarts: ['nin', 'nin-session'] },
];

// Nin runtime state (read-only for the panel — deploys must NEVER touch data/)
const NIN_DATA_DIR = path.join(CONNECTOME_PATH, 'connectome-host', 'data');
const NIN_SESSIONS_FILE = path.join(NIN_DATA_DIR, 'sessions.json');
const NIN_SESSION_DIR = path.join(NIN_DATA_DIR, 'sessions');
const NIN_DISCORD_DEBUG_LOG = path.join(NIN_DATA_DIR, 'discord-mcpl-debug.log');
const NIN_HEARTBEAT_FILE = path.join(NIN_DATA_DIR, 'heartbeat-littleguy.json');

// Laptop-daemon health endpoint (reachability probe)
const LAPTOP_HEALTH_URL = process.env.LAPTOP_HEALTH_URL || 'http://kataletheia:3101/health';

// Absolute bin paths — systemd runs with a minimal PATH (spec §5)
const CONNECTOME_BIN_PATH = '/root/.bun/bin:/usr/local/bin:/usr/bin:/bin';

// ============================================================================
// AETHERA (CORE) INTEGRATION
// ============================================================================

const AETHERA_API_URL = process.env.AETHERA_API_URL || 'http://localhost:8000';
const AETHERA_DB_PATH = process.env.AETHERA_DB_PATH || path.join(CORE_PATH, 'data');

// SQLite database paths
const BLOG_DB = path.join(AETHERA_DB_PATH, 'blog.sqlite');
const IRC_DB = path.join(AETHERA_DB_PATH, 'irc.sqlite');

// ============================================================================
// BLOG PREVIEW
// ============================================================================

// Token for previewing draft posts via iframe
// Must match BLOG_PREVIEW_TOKEN in core's environment
const BLOG_PREVIEW_TOKEN = process.env.BLOG_PREVIEW_TOKEN || '';

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
// MEMBRANE-API (LLM middleware service)
// ============================================================================

const MEMBRANE_API_URL = process.env.MEMBRANE_API_URL || 'http://localhost:3001';
const MEMBRANE_API_SERVICE_NAME = process.env.MEMBRANE_API_SERVICE_NAME || 'membrane-api';

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

  // Connectome
  CONNECTOME_PATH,
  CONNECTOME_REPOS,
  NIN_DATA_DIR,
  NIN_SESSIONS_FILE,
  NIN_SESSION_DIR,
  NIN_DISCORD_DEBUG_LOG,
  NIN_HEARTBEAT_FILE,
  LAPTOP_HEALTH_URL,
  CONNECTOME_BIN_PATH,
  
  // Aethera integration
  AETHERA_API_URL,
  AETHERA_DB_PATH,
  BLOG_DB,
  IRC_DB,
  
  // Blog preview
  BLOG_PREVIEW_TOKEN,
  
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
  
  // Membrane API
  MEMBRANE_API_URL,
  MEMBRANE_API_SERVICE_NAME,
  
  // Rate limiting
  RATE_LIMIT_WINDOW,
  RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_MAX,
};

