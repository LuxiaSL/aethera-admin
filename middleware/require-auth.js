// middleware/require-auth.js - Authentication middleware

const config = require('../config');
const { getSession } = require('../lib/auth/sessions');

/**
 * Middleware that requires a valid session
 * Checks for session cookie and validates it
 */
function requireAuth(req, res, next) {
  const token = req.cookies[config.SESSION_COOKIE_NAME];
  
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const session = getSession(token);
  
  if (!session) {
    // Clear invalid cookie
    res.clearCookie(config.SESSION_COOKIE_NAME);
    return res.status(401).json({ error: 'Session expired' });
  }
  
  // Attach session to request for use in routes
  req.session = session;
  req.username = session.username;
  
  next();
}

/**
 * Middleware that optionally attaches session if present
 * Doesn't block the request if no session
 */
function optionalAuth(req, res, next) {
  const token = req.cookies[config.SESSION_COOKIE_NAME];
  
  if (token) {
    const session = getSession(token);
    if (session) {
      req.session = session;
      req.username = session.username;
    }
  }
  
  next();
}

module.exports = {
  requireAuth,
  optionalAuth,
};

