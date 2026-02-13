const { ApiError } = require('../../src/utils/apiError');

function createMockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; return res; },
  };
  return res;
}

function createMockReq(overrides = {}) {
  return { method: 'GET', path: '/test', ...overrides };
}

describe('errorHandler (development)', () => {
  let errorHandler;

  beforeAll(() => {
    jest.mock('../../src/config', () => ({ nodeEnv: 'development' }));
    errorHandler = require('../../src/middleware/errorHandler');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('serializes ApiError with correct status and body', () => {
    const err = new ApiError(409, 'CONFLICT', 'already exists');
    const req = createMockReq();
    const res = createMockRes();

    errorHandler(err, req, res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'CONFLICT', message: 'already exists' },
    });
  });

  it('handles SyntaxError from malformed JSON', () => {
    const err = new SyntaxError('Unexpected token');
    err.status = 400;
    err.body = '{{bad json';
    const req = createMockReq({ method: 'POST' });
    const res = createMockRes();

    errorHandler(err, req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 500 for unknown errors and includes message in dev', () => {
    const err = new Error('something broke');
    const req = createMockReq();
    const res = createMockRes();

    errorHandler(err, req, res, jest.fn());

    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(res.body.error.message).toBe('something broke');
    expect(res.body.error.stack).toBeDefined();
  });
});

describe('errorHandler (production)', () => {
  let errorHandler;

  beforeAll(() => {
    jest.resetModules();
    jest.mock('../../src/config', () => ({ nodeEnv: 'production' }));
    errorHandler = require('../../src/middleware/errorHandler');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('hides error details in production', () => {
    const err = new Error('secret details');
    const req = createMockReq();
    const res = createMockRes();

    errorHandler(err, req, res, jest.fn());

    expect(res.statusCode).toBe(500);
    expect(res.body.error.message).toBe('An unexpected error occurred');
    expect(res.body.error.stack).toBeUndefined();
  });
});
