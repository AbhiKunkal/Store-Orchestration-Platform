/**
 * Database layer using SQLite (via better-sqlite3).
 * 
 * WHY SQLite?
 * - Platform state is low-volume, single-writer (one API server)
 * - No need for a separate database container for the platform itself
 * - PVC-backed file gives us crash-safe persistence in Kubernetes
 * - In production, could swap to Postgres without changing API logic
 * 
 * TABLES:
 * - stores: tracks each provisioned store's lifecycle
 * - audit_log: immutable log of all actions (create, delete, status changes)
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Ensure the data directory exists
const dbDir = path.dirname(config.dbPath);
if (!dbDir.startsWith('.') || dbDir !== '.') {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema Migration ─────────────────────────────────────────────
// We run migrations on startup. For a small project, this is fine.
// In production, use a proper migration tool (knex, prisma, etc.)

db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    engine TEXT NOT NULL DEFAULT 'woocommerce',
    status TEXT NOT NULL DEFAULT 'queued',
    store_url TEXT,
    admin_url TEXT,
    error_message TEXT,
    namespace TEXT,
    helm_release TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status);
  CREATE INDEX IF NOT EXISTS idx_audit_store_id ON audit_log(store_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`);

// ─── Prepared Statements ──────────────────────────────────────────
// Prepared statements are compiled once and reused → faster + safer

const stmts = {
  // Store operations
  insertStore: db.prepare(`
    INSERT INTO stores (id, name, engine, status, namespace, helm_release)
    VALUES (@id, @name, @engine, @status, @namespace, @helmRelease)
  `),

  getStore: db.prepare('SELECT * FROM stores WHERE id = ?'),
  
  getAllStores: db.prepare('SELECT * FROM stores ORDER BY created_at DESC'),
  
  getActiveStoreCount: db.prepare(
    "SELECT COUNT(*) as count FROM stores WHERE status NOT IN ('deleted', 'failed')"
  ),

  updateStoreStatus: db.prepare(`
    UPDATE stores 
    SET status = @status, error_message = @errorMessage, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `),

  updateStoreUrls: db.prepare(`
    UPDATE stores 
    SET store_url = @storeUrl, admin_url = @adminUrl, 
        status = 'ready', error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `),

  deleteStore: db.prepare(`
    UPDATE stores 
    SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `),

  // Audit log
  insertAudit: db.prepare(`
    INSERT INTO audit_log (store_id, action, details)
    VALUES (@storeId, @action, @details)
  `),

  getAuditLog: db.prepare(
    'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?'
  ),

  getStoreAudit: db.prepare(
    'SELECT * FROM audit_log WHERE store_id = ? ORDER BY created_at DESC'
  ),

  // Metrics
  getStoreCounts: db.prepare(`
    SELECT status, COUNT(*) as count FROM stores GROUP BY status
  `),

  getProvisioningStats: db.prepare(`
    SELECT 
      COUNT(*) as total_provisioned,
      AVG(CAST((julianday(updated_at) - julianday(created_at)) * 86400 AS INTEGER)) as avg_duration_seconds,
      MAX(CAST((julianday(updated_at) - julianday(created_at)) * 86400 AS INTEGER)) as max_duration_seconds,
      MIN(CAST((julianday(updated_at) - julianday(created_at)) * 86400 AS INTEGER)) as min_duration_seconds
    FROM stores WHERE status = 'ready'
  `),

  getRecentFailures: db.prepare(`
    SELECT id, name, error_message, updated_at 
    FROM stores WHERE status = 'failed' 
    ORDER BY updated_at DESC LIMIT 5
  `),
};

// ─── Database API ─────────────────────────────────────────────────

const store = {
  create({ id, name, engine, namespace, helmRelease }) {
    stmts.insertStore.run({
      id,
      name,
      engine,
      status: 'queued',
      namespace,
      helmRelease,
    });
    audit.log(id, 'create', { name, engine });
    return stmts.getStore.get(id);
  },

  getById(id) {
    return stmts.getStore.get(id);
  },

  getAll() {
    return stmts.getAllStores.all();
  },

  getActiveCount() {
    return stmts.getActiveStoreCount.get().count;
  },

  updateStatus(id, status, errorMessage = null) {
    stmts.updateStoreStatus.run({ id, status, errorMessage });
    audit.log(id, 'status_change', { status, errorMessage });
  },

  markReady(id, storeUrl, adminUrl) {
    stmts.updateStoreUrls.run({ id, storeUrl, adminUrl });
    audit.log(id, 'status_change', { status: 'ready', storeUrl, adminUrl });
  },

  markDeleted(id) {
    stmts.deleteStore.run({ id });
    audit.log(id, 'delete', {});
  },
};

const audit = {
  log(storeId, action, details = {}) {
    stmts.insertAudit.run({
      storeId,
      action,
      details: JSON.stringify(details),
    });
  },

  getAll(limit = 100) {
    return stmts.getAuditLog.all(limit);
  },

  getByStoreId(storeId) {
    return stmts.getStoreAudit.all(storeId);
  },
};

const metrics = {
  getAll() {
    const counts = stmts.getStoreCounts.all();
    const provisioning = stmts.getProvisioningStats.get();
    const recentFailures = stmts.getRecentFailures.all();

    // Convert counts array to object
    const statusCounts = {};
    counts.forEach(row => { statusCounts[row.status] = row.count; });

    return {
      stores: {
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        byStatus: statusCounts,
      },
      provisioning: {
        totalProvisioned: provisioning?.total_provisioned || 0,
        avgDurationSeconds: Math.round(provisioning?.avg_duration_seconds || 0),
        maxDurationSeconds: provisioning?.max_duration_seconds || 0,
        minDurationSeconds: provisioning?.min_duration_seconds || 0,
      },
      recentFailures,
    };
  },
};

module.exports = { db, store, audit, metrics };
