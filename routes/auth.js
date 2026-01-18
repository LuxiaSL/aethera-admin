// routes/auth.js - Authentication routes

const express = require('express');
const router = express.Router();
const config = require('../config');
const { createSession, deleteSession } = require('../lib/auth/sessions');
const { verifyUser, changePassword, getUserInfo, userExists, createUser, listUsers } = require('../lib/auth/users');
const { requireAuth } = require('../middleware/require-auth');
const { loginLimiter, actionLimiter } = require('../lib/security/rate-limit');

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/auth/login
 * Login with username and password
 * Rate limited: 5 attempts per 15 minutes per IP
 */
router.post('/login', loginLimiter.middleware(), async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = await verifyUser(username, password);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Successful login - reset rate limit for this IP
    loginLimiter.reset(ip);
    
    // Create session
    const token = createSession(user.username);
    
    // Set cookie
    res.cookie(config.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: config.SESSION_MAX_AGE,
    });
    
    res.json({ success: true, username: user.username });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/logout
 * Logout and clear session
 */
router.post('/logout', (req, res) => {
  const token = req.cookies[config.SESSION_COOKIE_NAME];
  
  if (token) {
    deleteSession(token);
  }
  
  res.clearCookie(config.SESSION_COOKIE_NAME);
  res.json({ success: true });
});

/**
 * GET /api/auth/check
 * Check if currently authenticated
 */
router.get('/check', (req, res) => {
  const token = req.cookies[config.SESSION_COOKIE_NAME];
  
  if (!token) {
    return res.json({ authenticated: false });
  }
  
  const { getSession } = require('../lib/auth/sessions');
  const session = getSession(token);
  
  if (!session) {
    res.clearCookie(config.SESSION_COOKIE_NAME);
    return res.json({ authenticated: false });
  }
  
  res.json({ 
    authenticated: true, 
    username: session.username,
  });
});

/**
 * GET /api/auth/status
 * Check if user exists (for first-time setup detection)
 */
router.get('/status', (req, res) => {
  res.json({
    userExists: userExists(),
  });
});

/**
 * POST /api/auth/change-password
 * Change password (requires auth)
 * Rate limited: 10 attempts per 5 minutes
 */
router.post('/change-password', requireAuth, actionLimiter.middleware(), async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Old and new password required' });
    }
    
    await changePassword(req.username, oldPassword, newPassword);
    
    // Clear current session cookie (user will need to log in again)
    res.clearCookie(config.SESSION_COOKIE_NAME);
    
    res.json({ success: true, message: 'Password changed. Please log in again.' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * GET /api/auth/user
 * Get current user info
 */
router.get('/user', requireAuth, (req, res) => {
  const info = getUserInfo(req.username);
  res.json(info);
});

/**
 * GET /api/auth/users
 * List all users (requires auth)
 */
router.get('/users', requireAuth, (req, res) => {
  res.json(listUsers());
});

/**
 * POST /api/auth/users
 * Create a new user (requires auth)
 * Only existing users can create new users
 */
router.post('/users', requireAuth, actionLimiter.middleware(), async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = await createUser(username, password);
    res.json({ success: true, user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;

