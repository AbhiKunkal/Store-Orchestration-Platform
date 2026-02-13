// Rate limiting — two tiers: general (30 req/min) and store creation (5 req/min).

const rateLimit = require('express-rate-limit');
const config = require('../config');

const generalLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  keyGenerator: (req) => req.ip,
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.',
    },
  },
});

const createLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxCreates,
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  keyGenerator: (req) => req.ip,
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Store creation rate limit exceeded. Please wait before creating another store.',
    },
  },
});

module.exports = { generalLimiter, createLimiter };
