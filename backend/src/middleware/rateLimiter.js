/**
 * Rate Limiter Middleware
 * 
 * Two tiers:
 * 1. General API: 30 req/min (reads are cheap)
 * 2. Store creation: 5 req/min (provisioning is expensive)
 * 
 * WHY rate limiting matters for this project:
 * - Each store creation spawns multiple K8s resources
 * - Without limits, a single client could exhaust cluster resources
 * - This is a basic but effective abuse prevention measure
 * 
 * IN PRODUCTION: Use API keys + per-user quotas
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');

// General API rate limit
const generalLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again later.',
  },
});

// Stricter limit for store creation
const createLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxCreates,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Store creation rate limit exceeded. Please wait before creating another store.',
  },
});

module.exports = { generalLimiter, createLimiter };
