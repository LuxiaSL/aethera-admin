/**
 * Simple in-memory rate limiter
 * Tracks requests per IP and blocks excessive attempts
 */

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes default
    this.maxAttempts = options.maxAttempts || 5;
    this.message = options.message || 'Too many requests, please try again later';
    this.keyGenerator = options.keyGenerator || ((req) => req.ip || req.connection.remoteAddress);
    
    // Map of key -> { count, resetTime }
    this.attempts = new Map();
    
    // Clean up expired entries periodically
    this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, data] of this.attempts.entries()) {
      if (now > data.resetTime) {
        this.attempts.delete(key);
      }
    }
  }

  /**
   * Check if request should be allowed
   * @returns {object} { allowed: boolean, remaining: number, resetTime: number }
   */
  check(key) {
    const now = Date.now();
    const data = this.attempts.get(key);

    if (!data || now > data.resetTime) {
      // First attempt or window expired
      this.attempts.set(key, {
        count: 1,
        resetTime: now + this.windowMs
      });
      return { allowed: true, remaining: this.maxAttempts - 1, resetTime: now + this.windowMs };
    }

    if (data.count >= this.maxAttempts) {
      // Rate limited
      return { allowed: false, remaining: 0, resetTime: data.resetTime };
    }

    // Increment counter
    data.count++;
    return { allowed: true, remaining: this.maxAttempts - data.count, resetTime: data.resetTime };
  }

  /**
   * Reset attempts for a key (e.g., after successful login)
   */
  reset(key) {
    this.attempts.delete(key);
  }

  /**
   * Express middleware
   */
  middleware() {
    return (req, res, next) => {
      const key = this.keyGenerator(req);
      const result = this.check(key);

      // Set rate limit headers
      res.set('X-RateLimit-Limit', this.maxAttempts);
      res.set('X-RateLimit-Remaining', result.remaining);
      res.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

      if (!result.allowed) {
        res.set('Retry-After', Math.ceil((result.resetTime - Date.now()) / 1000));
        return res.status(429).json({ 
          error: this.message,
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
        });
      }

      next();
    };
  }

  /**
   * Destroy the limiter (cleanup interval)
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// Pre-configured limiters for common use cases

/**
 * Strict limiter for login attempts
 * 5 attempts per 15 minutes per IP
 */
const loginLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxAttempts: 5,
  message: 'Too many login attempts. Please try again in 15 minutes.'
});

/**
 * General API limiter
 * 100 requests per minute per IP
 */
const apiLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxAttempts: 100,
  message: 'Too many requests. Please slow down.'
});

/**
 * Sensitive action limiter (restart services, etc.)
 * 10 attempts per 5 minutes per IP
 */
const actionLimiter = new RateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxAttempts: 10,
  message: 'Too many actions. Please wait before trying again.'
});

module.exports = {
  RateLimiter,
  loginLimiter,
  apiLimiter,
  actionLimiter
};

