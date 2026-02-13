// Integration tests for store API routes using supertest.
// Mocks provisioner (no real Helm/kubectl calls) and uses in-memory SQLite.

jest.mock('../../src/config', () => ({
  port: 0,
  nodeEnv: 'test',
  dbPath: ':memory:',
  helmChartPath: '/app/charts/woocommerce-chart',
  kubeconfig: '',
  baseDomain: '127.0.0.1.nip.io',
  maxStores: 3,
  provisionTimeoutMs: 60000,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 100,
  rateLimitMaxCreates: 100,
  rateLimitMaxCreates: 50,
  wpAdminUser: 'admin',
  wpAdminEmail: 'admin@test.com',
}));

jest.mock('../../src/services/provisioner', () => ({
  provisionStore: jest.fn().mockResolvedValue(undefined),
  deleteStore: jest.fn().mockResolvedValue(undefined),
  getEngine: jest.fn().mockReturnValue({
    validate: () => ({ valid: true }),
  }),
  getOperationStatus: jest.fn().mockReturnValue(null),
  recoverOnStartup: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');

let app;

beforeAll(() => {
  app = require('../../src/index');
});

describe('GET /api/health', () => {
  it('returns healthy status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('POST /api/stores', () => {
  it('creates a store with valid input', async () => {
    const res = await request(app)
      .post('/api/stores')
      .send({ name: 'My Test Store' });

    expect(res.status).toBe(201);
    expect(res.body.store).toBeDefined();
    expect(res.body.store.name).toBe('My Test Store');
    expect(res.body.store.status).toBe('queued');
    expect(res.body.store.engine).toBe('woocommerce');
  });

  it('rejects missing name', async () => {
    const res = await request(app)
      .post('/api/stores')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_STORE_NAME');
  });

  it('rejects empty name', async () => {
    const res = await request(app)
      .post('/api/stores')
      .send({ name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_STORE_NAME');
  });

  it('rejects name that is too short', async () => {
    const res = await request(app)
      .post('/api/stores')
      .send({ name: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STORE_NAME');
  });

  it('rejects invalid engine', async () => {
    const res = await request(app)
      .post('/api/stores')
      .send({ name: 'Test', engine: 'shopify' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ENGINE');
  });

  it('enforces store quota', async () => {
    // Create stores up to the quota (maxStores = 3, 1 already created)
    await request(app).post('/api/stores').send({ name: 'Store Two' });
    await request(app).post('/api/stores').send({ name: 'Store Three' });

    const res = await request(app)
      .post('/api/stores')
      .send({ name: 'Over Quota' });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
  });
});

describe('GET /api/stores', () => {
  it('lists all stores', async () => {
    const res = await request(app).get('/api/stores');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.stores)).toBe(true);
    expect(res.body.stores.length).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/stores/:id', () => {
  it('returns 404 for non-existent store', async () => {
    const res = await request(app).get('/api/stores/store-nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/stores/:id/retry', () => {
  it('rejects retry on non-failed store', async () => {
    const storesRes = await request(app).get('/api/stores');
    const storeId = storesRes.body.stores[0].id;

    const res = await request(app).post(`/api/stores/${storeId}/retry`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});

describe('DELETE /api/stores/:id', () => {
  it('returns 404 for non-existent store', async () => {
    const res = await request(app).delete('/api/stores/store-nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/audit', () => {
  it('returns audit log', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.audit)).toBe(true);
  });
});

describe('GET /api/metrics', () => {
  it('returns structured metrics', async () => {
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stores');
    expect(res.body).toHaveProperty('provisioning');
    expect(res.body).toHaveProperty('recentFailures');
  });
});

describe('error responses', () => {
  it('returns structured error for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/stores')
      .set('Content-Type', 'application/json')
      .send('{{invalid json');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});
