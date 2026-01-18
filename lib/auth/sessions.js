// lib/auth/sessions.js - Session management
// In-memory session store backed by file for persistence across restarts

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../../config');

// ============================================================================
// SESSION STORE
// ============================================================================

let sessions = new Map();

/**
 * Ensure data directory exists
 */
function ensureDataDir() {
  const dir = path.dirname(config.SESSIONS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load sessions from file
 */
function loadSessions() {
  try {
    if (fs.existsSync(config.SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(config.SESSIONS_FILE, 'utf8'));
      sessions = new Map(Object.entries(data));
      
      // Clean expired sessions
      const now = Date.now();
      let cleaned = 0;
      for (const [token, session] of sessions) {
        if (session.expiresAt < now) {
          sessions.delete(token);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        saveSessions();
        console.log(`Cleaned ${cleaned} expired session(s)`);
      }
    }
  } catch (e) {
    console.error('Error loading sessions:', e.message);
    sessions = new Map();
  }
}

/**
 * Save sessions to file
 */
function saveSessions() {
  try {
    ensureDataDir();
    const data = Object.fromEntries(sessions);
    fs.writeFileSync(config.SESSIONS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error saving sessions:', e.message);
  }
}

/**
 * Create a new session
 * @param {string} username - Username for the session
 * @returns {string} Session token
 */
function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    username,
    createdAt: Date.now(),
    expiresAt: Date.now() + config.SESSION_MAX_AGE,
  };
  sessions.set(token, session);
  saveSessions();
  return token;
}

/**
 * Get session by token
 * @param {string} token - Session token
 * @returns {Object|null} Session object or null if invalid/expired
 */
function getSession(token) {
  if (!token) return null;
  
  const session = sessions.get(token);
  if (!session) return null;
  
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    saveSessions();
    return null;
  }
  
  return session;
}

/**
 * Delete a session
 * @param {string} token - Session token to delete
 */
function deleteSession(token) {
  if (sessions.has(token)) {
    sessions.delete(token);
    saveSessions();
  }
}

/**
 * Delete all sessions for a user
 * @param {string} username - Username whose sessions to delete
 */
function deleteSessionsForUser(username) {
  let deleted = 0;
  for (const [token, session] of sessions) {
    if (session.username === username) {
      sessions.delete(token);
      deleted++;
    }
  }
  if (deleted > 0) {
    saveSessions();
  }
  return deleted;
}

/**
 * Get count of active sessions
 * @returns {number} Number of active sessions
 */
function getSessionCount() {
  return sessions.size;
}

module.exports = {
  loadSessions,
  saveSessions,
  createSession,
  getSession,
  deleteSession,
  deleteSessionsForUser,
  getSessionCount,
};

