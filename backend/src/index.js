// Store Platform API — Express server entry point.

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const storeRoutes = require('./routes/stores');
const errorHandler = require('./middleware/errorHandler');
const { generalLimiter, createLimiter } = require('./middleware/rateLimiter');

const app = express();

// ─── Middleware ────────────────────────────────────────────────────

app.use(helmet());

app.use(cors({
  origin: config.nodeEnv === 'production'
    ? [`http://dashboard.${config.baseDomain}`]
    : '*',
  methods: ['GET', 'POST', 'DELETE'],
}));

app.use(generalLimiter);
app.use(express.json({ limit: '1mb' }));

// ─── Routes ───────────────────────────────────────────────────────

// Stricter rate limit on store creation (provisioning is expensive)
app.use('/api/stores', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/') {
    return createLimiter(req, res, next);
  }
  next();
});

app.use('/api', storeRoutes);

// ─── Error Handling ───────────────────────────────────────────────

app.use(errorHandler);

// ─── Server Startup ──────────────────────────────────────────────
// Only start listening when run directly (not when imported by tests).

if (require.main === module) {
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

  // ─── Graceful Shutdown ──────────────────────────────────────────

  function shutdown(signal) {
    console.log(`\n[server] ${signal} received, shutting down...`);
    server.close(() => {
      const { db } = require('./db');
      db.close();
      console.log('[server] Shutdown complete');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[server] Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
