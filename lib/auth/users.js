// lib/auth/users.js - User management
// Single-user system for personal admin panel

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const config = require('../../config');
const { deleteSessionsForUser } = require('./sessions');

// ============================================================================
// USER MANAGEMENT
// ============================================================================

/**
 * Ensure data directory exists
 */
function ensureDataDir() {
  const dir = path.dirname(config.USER_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load user from file
 * @returns {Object|null} User object or null if no user exists
 */
function loadUser() {
  try {
    if (fs.existsSync(config.USER_FILE)) {
      return JSON.parse(fs.readFileSync(config.USER_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading user:', e.message);
  }
  return null;
}

/**
 * Save user to file
 * @param {Object} user - User object to save
 */
function saveUser(user) {
  ensureDataDir();
  fs.writeFileSync(config.USER_FILE, JSON.stringify(user, null, 2));
  // Set restrictive permissions
  try {
    fs.chmodSync(config.USER_FILE, 0o600);
  } catch (e) {
    // Might fail on some systems, that's okay
  }
}

/**
 * Check if a user exists
 * @returns {boolean} True if user exists
 */
function userExists() {
  return loadUser() !== null;
}

/**
 * Create the admin user (first-time setup)
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Object} Created user (without password hash)
 */
async function createUser(username, password) {
  if (userExists()) {
    throw new Error('User already exists. Use changePassword to update.');
  }
  
  // Validate username
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    throw new Error('Username must be 3-32 characters, alphanumeric with _ or -');
  }
  
  // Validate password
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  
  const hash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  const user = {
    username,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };
  
  saveUser(user);
  return { username: user.username, createdAt: user.createdAt };
}

/**
 * Verify user credentials
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Object|null} User object (without hash) or null if invalid
 */
async function verifyUser(username, password) {
  const user = loadUser();
  
  if (!user) {
    // Prevent timing attacks by still doing bcrypt work
    await bcrypt.hash(password, config.BCRYPT_ROUNDS);
    return null;
  }
  
  if (user.username !== username) {
    // Prevent timing attacks
    await bcrypt.hash(password, config.BCRYPT_ROUNDS);
    return null;
  }
  
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  
  return { username: user.username };
}

/**
 * Change password
 * @param {string} oldPassword - Current password
 * @param {string} newPassword - New password
 * @returns {boolean} True if successful
 */
async function changePassword(oldPassword, newPassword) {
  const user = loadUser();
  
  if (!user) {
    throw new Error('No user exists');
  }
  
  // Verify old password
  const valid = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!valid) {
    throw new Error('Current password is incorrect');
  }
  
  // Validate new password
  if (newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters');
  }
  
  // Update password
  user.passwordHash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
  user.passwordChangedAt = new Date().toISOString();
  
  saveUser(user);
  
  // Invalidate all existing sessions
  deleteSessionsForUser(user.username);
  
  return true;
}

/**
 * Get user info (without sensitive data)
 * @returns {Object|null} User info or null
 */
function getUserInfo() {
  const user = loadUser();
  if (!user) return null;
  
  return {
    username: user.username,
    createdAt: user.createdAt,
    passwordChangedAt: user.passwordChangedAt,
  };
}

module.exports = {
  loadUser,
  userExists,
  createUser,
  verifyUser,
  changePassword,
  getUserInfo,
};

