/**
 * Store API Routes
 * 
 * RESTful API for store lifecycle management.
 * 
 * ENDPOINTS:
 *   GET    /api/health       - Health check
 *   GET    /api/stores       - List all stores
 *   GET    /api/stores/:id   - Get single store details
 *   POST   /api/stores       - Create a new store
 *   DELETE /api/stores/:id   - Delete a store
 *   POST   /api/stores/:id/retry - Retry a failed provisioning
 *   GET    /api/audit        - Get audit log
 *   GET    /api/metrics      - Platform metrics
 * 
 * ERROR SCHEMA:
 *   All errors follow: { error: { code: "ERROR_CODE", message: "..." } }
 *   Success responses are NOT changed — only errors are standardized.
 * 
 * LIFECYCLE STATE MACHINE:
 *   queued → provisioning → ready
 *                        → failed → (retry) → provisioning
 *   any (except deleted) → deleting → deleted
 * 
 * DESIGN NOTES:
 * - Create is async: returns 201 immediately, provisioning runs in background
 * - Delete is async: returns 202, cleanup runs in background
 * - Status polling is how the dashboard tracks progress
 */

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { store, audit, metrics } = require('../db');
const provisioner = require('../services/provisioner');
const config = require('../config');
const { Errors } = require('../utils/apiError');

const router = Router();

// ─── Valid state transitions (Lifecycle State Machine) ─────────
// Used as a guard to prevent invalid operations on stores.
const RETRYABLE_STATES = ['failed'];
const DELETABLE_STATES = ['ready', 'failed', 'queued', 'provisioning'];
const TERMINAL_STATES = ['deleted'];

// ─── GET /api/health ──────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// ─── GET /api/stores ──────────────────────────────────────────────
// Returns all stores sorted by creation date (newest first).
// Dashboard polls this every 5 seconds to update UI.
router.get('/stores', (req, res, next) => {
  try {
    const stores = store.getAll();
    res.json({ stores });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/stores/:id ─────────────────────────────────────────
router.get('/stores/:id', (req, res, next) => {
  try {
    const record = store.getById(req.params.id);
    if (!record) {
      throw Errors.notFound('Store', req.params.id);
    }
    res.json({ store: record });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/stores ─────────────────────────────────────────────
// Creates a new store and starts provisioning in the background.
// Returns 201 immediately with the store record (status: "queued").
router.post('/stores', (req, res, next) => {
  try {
    const { name, engine = 'woocommerce' } = req.body || {};

    // ── Input validation ──
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw Errors.badRequest('Store name is required and must be a non-empty string', 'MISSING_STORE_NAME');
    }

    if (name.trim().length < 2) {
      throw Errors.badRequest('Store name must be at least 2 characters', 'INVALID_STORE_NAME');
    }

    if (!['woocommerce', 'medusa'].includes(engine)) {
      throw Errors.badRequest(
        `Invalid engine: '${engine}'. Must be 'woocommerce' or 'medusa'`,
        'INVALID_ENGINE'
      );
    }

    // ── Engine validation (Strategy Pattern) ──
    // Each engine module implements validate() — checks chart existence, etc.
    const engineModule = provisioner.getEngine(engine);
    const validation = engineModule.validate();
    if (!validation.valid) {
      throw Errors.badRequest(validation.error, 'ENGINE_UNAVAILABLE');
    }

    // ── Quota check (abuse prevention) ──
    const activeCount = store.getActiveCount();
    if (activeCount >= config.maxStores) {
      throw Errors.quotaExceeded(
        `Maximum number of stores (${config.maxStores}) reached. Delete existing stores first.`
      );
    }

    // ── Generate IDs ──
    const shortId = uuidv4().split('-')[0];
    const storeId = `store-${shortId}`;
    const namespace = storeId;
    const helmRelease = storeId;

    const sanitizedName = name.trim().slice(0, 100);

    // ── Create database record ──
    const record = store.create({
      id: storeId,
      name: sanitizedName,
      engine,
      namespace,
      helmRelease,
    });

    // ── Start async provisioning ──
    // Fire-and-forget. Dashboard polls for status updates.
    setImmediate(() => {
      provisioner.provisionStore(storeId).catch(err => {
        console.error(`[api] Background provisioning error for ${storeId}:`, err);
      });
    });

    console.log(`[api] Store ${storeId} created, provisioning started`);
    res.status(201).json({ store: record });

  } catch (error) {
    next(error);
  }
});

// ─── DELETE /api/stores/:id ──────────────────────────────────────
// Starts async deletion of a store and all its resources.
// Returns 202 immediately (deletion runs in background).
router.delete('/stores/:id', (req, res, next) => {
  try {
    const record = store.getById(req.params.id);
    if (!record) {
      throw Errors.notFound('Store', req.params.id);
    }

    // ── Lifecycle state guard ──
    if (TERMINAL_STATES.includes(record.status)) {
      throw Errors.invalidState(record.status, 'delete');
    }

    if (record.status === 'deleting') {
      throw Errors.operationInProgress(req.params.id);
    }

    if (!DELETABLE_STATES.includes(record.status)) {
      throw Errors.invalidState(record.status, 'delete');
    }

    // Start async deletion
    setImmediate(() => {
      provisioner.deleteStore(req.params.id).catch(err => {
        console.error(`[api] Background deletion error for ${req.params.id}:`, err);
      });
    });

    console.log(`[api] Store ${req.params.id} delete initiated`);
    res.status(202).json({ message: 'Store deletion initiated', storeId: req.params.id });

  } catch (error) {
    next(error);
  }
});

// ─── POST /api/stores/:id/retry ──────────────────────────────────
// Retries provisioning for a failed store.
// Lifecycle guard: only 'failed' stores can be retried.
router.post('/stores/:id/retry', (req, res, next) => {
  try {
    const record = store.getById(req.params.id);
    if (!record) {
      throw Errors.notFound('Store', req.params.id);
    }

    // ── Lifecycle state guard ──
    if (!RETRYABLE_STATES.includes(record.status)) {
      throw Errors.invalidState(record.status, 'retry');
    }

    // Check for concurrent operations
    const opStatus = provisioner.getOperationStatus(req.params.id);
    if (opStatus) {
      throw Errors.operationInProgress(req.params.id);
    }

    audit.log(record.id, 'retry', { previousError: record.error_message });

    // Start async provisioning again
    setImmediate(() => {
      provisioner.provisionStore(req.params.id).catch(err => {
        console.error(`[api] Background retry error for ${req.params.id}:`, err);
      });
    });

    console.log(`[api] Store ${req.params.id} retry initiated`);
    res.status(202).json({ message: 'Retry initiated', storeId: req.params.id });

  } catch (error) {
    next(error);
  }
});

// ─── GET /api/audit ──────────────────────────────────────────────
// Returns the audit log (most recent first).
// Provides observability into platform actions.
router.get('/audit', (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || '100', 10) || 100, 1),
      500
    );
    const logs = audit.getAll(limit);
    res.json({ audit: logs });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/metrics ────────────────────────────────────────────
// Returns platform metrics for observability.
// Surfaces: store counts, provisioning duration, recent failures.
router.get('/metrics', (req, res, next) => {
  try {
    const data = metrics.getAll();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
