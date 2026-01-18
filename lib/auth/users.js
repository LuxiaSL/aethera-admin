// lib/auth/users.js - User management
// Multi-user system for admin panel

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
  const dir = path.dirname(config.USERS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load all users from file
 * @returns {Array} Array of user objects
 */
function loadUsers() {
  try {
    if (fs.existsSync(config.USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(config.USERS_FILE, 'utf8'));
      // Handle migration from old single-user format
      if (data && !Array.isArray(data) && data.username) {
        // Old format: single object -> convert to array
        return [data];
      }
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {
    console.error('Error loading users:', e.message);
  }
  return [];
}

/**
 * Save users to file
 * @param {Array} users - Array of user objects to save
 */
function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(config.USERS_FILE, JSON.stringify(users, null, 2));
  // Set restrictive permissions
  try {
    fs.chmodSync(config.USERS_FILE, 0o600);
  } catch (e) {
    // Might fail on some systems, that's okay
  }
}

/**
 * Find a user by username
 * @param {string} username - Username to find
 * @returns {Object|null} User object or null
 */
function findUser(username) {
  const users = loadUsers();
  return users.find(u => u.username === username) || null;
}

/**
 * Check if any user exists
 * @returns {boolean} True if at least one user exists
 */
function userExists() {
  return loadUsers().length > 0;
}

/**
 * Check if a specific username is taken
 * @param {string} username - Username to check
 * @returns {boolean} True if username exists
 */
function usernameExists(username) {
  return findUser(username) !== null;
}

/**
 * Create a new user
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Object} Created user (without password hash)
 */
async function createUser(username, password) {
  // Validate username
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    throw new Error('Username must be 3-32 characters, alphanumeric with _ or -');
  }
  
  // Check if username already exists
  if (usernameExists(username)) {
    throw new Error('Username already exists');
  }
  
  // Validate password
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  
  const hash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  const newUser = {
    username,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };
  
  const users = loadUsers();
  users.push(newUser);
  saveUsers(users);
  
  return { username: newUser.username, createdAt: newUser.createdAt };
}

/**
 * Verify user credentials
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Object|null} User object (without hash) or null if invalid
 */
async function verifyUser(username, password) {
  const user = findUser(username);
  
  if (!user) {
    // Prevent timing attacks by still doing bcrypt work
    await bcrypt.hash(password, config.BCRYPT_ROUNDS);
    return null;
  }
  
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  
  return { username: user.username };
}

/**
 * Change password for a user
 * @param {string} username - Username whose password to change
 * @param {string} oldPassword - Current password
 * @param {string} newPassword - New password
 * @returns {boolean} True if successful
 */
async function changePassword(username, oldPassword, newPassword) {
  const users = loadUsers();
  const userIndex = users.findIndex(u => u.username === username);
  
  if (userIndex === -1) {
    throw new Error('User not found');
  }
  
  const user = users[userIndex];
  
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
  
  users[userIndex] = user;
  saveUsers(users);
  
  // Invalidate all existing sessions for this user
  deleteSessionsForUser(username);
  
  return true;
}

/**
 * Get user info (without sensitive data)
 * @param {string} username - Username to get info for
 * @returns {Object|null} User info or null
 */
function getUserInfo(username) {
  const user = findUser(username);
  if (!user) return null;
  
  return {
    username: user.username,
    createdAt: user.createdAt,
    passwordChangedAt: user.passwordChangedAt,
  };
}

/**
 * List all users (without sensitive data)
 * @returns {Array} Array of user info objects
 */
function listUsers() {
  return loadUsers().map(u => ({
    username: u.username,
    createdAt: u.createdAt,
    passwordChangedAt: u.passwordChangedAt,
  }));
}

/**
 * Delete a user
 * @param {string} username - Username to delete
 * @returns {boolean} True if deleted
 */
function deleteUser(username) {
  const users = loadUsers();
  const filtered = users.filter(u => u.username !== username);
  
  if (filtered.length === users.length) {
    return false; // User not found
  }
  
  // Don't allow deleting the last user
  if (filtered.length === 0) {
    throw new Error('Cannot delete the last user');
  }
  
  saveUsers(filtered);
  deleteSessionsForUser(username);
  return true;
}

module.exports = {
  loadUsers,
  findUser,
  userExists,
  usernameExists,
  createUser,
  verifyUser,
  changePassword,
  getUserInfo,
  listUsers,
  deleteUser,
};
