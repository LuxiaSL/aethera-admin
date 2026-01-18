// routes/auth.js - Authentication routes

const express = require('express');
const router = express.Router();
const config = require('../config');
const { createSession, deleteSession } = require('../lib/auth/sessions');
const { verifyUser, changePassword, getUserInfo, userExists } = require('../lib/auth/users');
const { requireAuth } = require('../middleware/require-auth');

// Rate limiting for login attempts (simple in-memory)
const loginAttempts = new Map();

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip) || [];
  
  // Clean old attempts
  const recent = attempts.filter(t => now - t < config.RATE_LIMIT_WINDOW);
  loginAttempts.set(ip, recent);
  
  return recent.length < config.LOGIN_RATE_LIMIT_MAX;
}

function recordLoginAttempt(ip) {
  const attempts = loginAttempts.get(ip) || [];
  attempts.push(Date.now());
  loginAttempts.set(ip, attempts);
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/auth/login
 * Login with username and password
 */
router.post('/login', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    
    // Check rate limit
    if (!checkLoginRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }
    
    const { username, password } = req.body;
    
    if (!username || !password) {
      recordLoginAttempt(ip);
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = await verifyUser(username, password);
    
    if (!user) {
      recordLoginAttempt(ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
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
 */
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Old and new password required' });
    }
    
    await changePassword(oldPassword, newPassword);
    
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
  const info = getUserInfo();
  res.json(info);
});

module.exports = router;

