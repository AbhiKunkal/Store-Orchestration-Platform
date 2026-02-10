/**
 * Store Platform API — Main Entry Point
 * 
 * Express server that serves the REST API for store management.
 * 
 * MIDDLEWARE STACK:
 * 1. Helmet — HTTP security headers
 * 2. CORS — allow dashboard to call API
 * 3. Rate limiter — prevent abuse
 * 4. JSON parser — parse request bodies
 * 5. Routes — API endpoints
 * 6. Error handler — catch-all for unhandled errors
 * 
 * STARTUP:
 * - Database is initialized on import (db.js runs migrations)
 * - Server listens on PORT (default 3001)
 * - Graceful shutdown on SIGTERM/SIGINT
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const storeRoutes = require('./routes/stores');
const errorHandler = require('./middleware/errorHandler');
const { generalLimiter, createLimiter } = require('./middleware/rateLimiter');

const app = express();

// ─── Middleware ────────────────────────────────────────────────────

// Security headers (XSS protection, content-type sniffing, etc.)
app.use(helmet());

// CORS — allow the dashboard to call the API
// In production, lock this down to specific origins
app.use(cors({
  origin: config.nodeEnv === 'production'
    ? [`http://dashboard.${config.baseDomain}`]
    : '*',
  methods: ['GET', 'POST', 'DELETE'],
}));

// General rate limiter
app.use(generalLimiter);

// JSON body parser
app.use(express.json({ limit: '1mb' }));

// ─── Routes ───────────────────────────────────────────────────────

// Stricter rate limit on store creation
app.use('/api/stores', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/') {
    return createLimiter(req, res, next);
  }
  next();
});

// All API routes
app.use('/api', storeRoutes);

// ─── Error handling ───────────────────────────────────────────────
app.use(errorHandler);

// ─── Start server ─────────────────────────────────────────────────
const server = app.listen(config.port, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   Store Platform API                      ║
  ║   Running on port ${config.port}                    ║
  ║   Environment: ${config.nodeEnv.padEnd(24)}  ║
  ║   Domain: ${config.baseDomain.padEnd(29)}  ║
  ║   Max stores: ${String(config.maxStores).padEnd(26)}  ║
  ╚═══════════════════════════════════════════╝
  `);

  // Recover stores stuck in 'provisioning' from a previous crash
  const provisioner = require('./services/provisioner');
  provisioner.recoverOnStartup().catch(err => {
    console.error('[server] Startup recovery failed:', err.message);
  });
});

// ─── Graceful Shutdown ────────────────────────────────────────────
// In Kubernetes, pods get SIGTERM before being killed.
// We close the HTTP server and DB connection cleanly.

function shutdown(signal) {
  console.log(`\n[server] ${signal} received, shutting down gracefully...`);
  server.close(() => {
    const { db } = require('./db');
    db.close();
    console.log('[server] Shutdown complete');
    process.exit(0);
  });
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
