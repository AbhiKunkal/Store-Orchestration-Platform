const Database = require('better-sqlite3');
const path = require('path');

// Override config BEFORE requiring db module
jest.mock('../../src/config', () => ({
  dbPath: ':memory:',
}));

let store, audit, metrics, db;

beforeAll(() => {
  const dbModule = require('../../src/db');
  store = dbModule.store;
  audit = dbModule.audit;
  metrics = dbModule.metrics;
  db = dbModule.db;
});

afterAll(() => {
  db.close();
});

describe('store operations', () => {
  const testStore = {
    id: 'store-test1',
    name: 'Test Store',
    engine: 'woocommerce',
    namespace: 'store-test1',
    helmRelease: 'store-test1',
  };

  it('creates a store and returns it', () => {
    const result = store.create(testStore);
    expect(result).toBeDefined();
    expect(result.id).toBe('store-test1');
    expect(result.name).toBe('Test Store');
    expect(result.status).toBe('queued');
    expect(result.engine).toBe('woocommerce');
  });

  it('retrieves store by ID', () => {
    const result = store.getById('store-test1');
    expect(result).toBeDefined();
    expect(result.name).toBe('Test Store');
  });

  it('returns undefined for non-existent store', () => {
    const result = store.getById('store-nonexistent');
    expect(result).toBeUndefined();
  });

  it('lists all stores', () => {
    const all = store.getAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all[0].id).toBe('store-test1');
  });

  it('updates store status', () => {
    store.updateStatus('store-test1', 'provisioning');
    const result = store.getById('store-test1');
    expect(result.status).toBe('provisioning');
  });

  it('marks store as ready with URLs', () => {
    store.markReady('store-test1', 'http://test.localhost', 'http://test.localhost/wp-admin');
    const result = store.getById('store-test1');
    expect(result.status).toBe('ready');
    expect(result.store_url).toBe('http://test.localhost');
    expect(result.admin_url).toBe('http://test.localhost/wp-admin');
  });

  it('marks store as deleted', () => {
    store.markDeleted('store-test1');
    const result = store.getById('store-test1');
    expect(result.status).toBe('deleted');
  });

  it('counts active stores excluding deleted and failed', () => {
    // store-test1 is 'deleted', so count should be 0
    const count = store.getActiveCount();
    expect(count).toBe(0);
  });
});

describe('audit operations', () => {
  it('logs an audit entry', () => {
    audit.log('store-test1', 'test_action', { key: 'value' });
    const logs = audit.getAll(10);
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('retrieves audit by store ID', () => {
    const logs = audit.getByStoreId('store-test1');
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].store_id).toBe('store-test1');
  });
});

describe('metrics operations', () => {
  it('returns structured metrics', () => {
    const data = metrics.getAll();
    expect(data).toHaveProperty('stores');
    expect(data).toHaveProperty('provisioning');
    expect(data).toHaveProperty('recentFailures');
    expect(data.stores).toHaveProperty('total');
    expect(data.stores).toHaveProperty('byStatus');
    expect(typeof data.provisioning.totalProvisioned).toBe('number');
  });
});
