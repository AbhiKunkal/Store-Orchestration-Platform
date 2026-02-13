// Store API routes — CRUD + retry + audit + metrics.
//
// Lifecycle state machine:
//   queued → provisioning → ready
//                        → failed → (retry) → provisioning
//   any (except deleted) → deleting → deleted

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { store, audit, metrics } = require('../db');
const provisioner = require('../services/provisioner');
const config = require('../config');
const { Errors } = require('../utils/apiError');

const router = Router();

const RETRYABLE_STATES = ['failed'];
const DELETABLE_STATES = ['ready', 'failed', 'queued', 'provisioning'];
const TERMINAL_STATES = ['deleted'];

// ─── Validation ──────────────────────────────────────────────────

function validateCreateStore(body) {
  const { name, engine = 'woocommerce' } = body || {};

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

  return { name: name.trim().slice(0, 100), engine };
}

// ─── Routes ──────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

router.get('/stores', (req, res, next) => {
  try {
    const stores = store.getAll();
    res.json({ stores });
  } catch (error) {
    next(error);
  }
});

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

// Create is async: returns 201 immediately, provisioning runs in background.
router.post('/stores', (req, res, next) => {
  try {
    const { name, engine } = validateCreateStore(req.body);

    // Engine availability check
    const engineModule = provisioner.getEngine(engine);
    const validation = engineModule.validate();
    if (!validation.valid) {
      throw Errors.badRequest(validation.error, 'ENGINE_UNAVAILABLE');
    }

    // Quota check
    const activeCount = store.getActiveCount();
    if (activeCount >= config.maxStores) {
      throw Errors.quotaExceeded(config.maxStores);
    }

    const shortId = uuidv4().split('-')[0];
    const storeId = `store-${shortId}`;
    const namespace = storeId;
    const helmRelease = storeId;

    const record = store.create({
      id: storeId, name, engine, namespace, helmRelease,
    });

    // Fire-and-forget — dashboard polls for status updates
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

// Delete is async: returns 202, cleanup runs in background.
router.delete('/stores/:id', (req, res, next) => {
  try {
    const record = store.getById(req.params.id);
    if (!record) {
      throw Errors.notFound('Store', req.params.id);
    }

    if (TERMINAL_STATES.includes(record.status)) {
      throw Errors.invalidState(record.status, 'delete');
    }

    if (record.status === 'deleting') {
      throw Errors.operationInProgress(req.params.id);
    }

    if (!DELETABLE_STATES.includes(record.status)) {
      throw Errors.invalidState(record.status, 'delete');
    }

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

// Only failed stores can be retried.
router.post('/stores/:id/retry', (req, res, next) => {
  try {
    const record = store.getById(req.params.id);
    if (!record) {
      throw Errors.notFound('Store', req.params.id);
    }

    if (!RETRYABLE_STATES.includes(record.status)) {
      throw Errors.invalidState(record.status, 'retry');
    }

    const opStatus = provisioner.getOperationStatus(req.params.id);
    if (opStatus) {
      throw Errors.operationInProgress(req.params.id);
    }

    audit.log(record.id, 'retry', { previousError: record.error_message });

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

router.get('/metrics', (req, res, next) => {
  try {
    const data = metrics.getAll();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
