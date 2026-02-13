const { ApiError, Errors } = require('../../src/utils/apiError');

describe('ApiError', () => {
  it('creates error with correct properties', () => {
    const err = new ApiError(400, 'BAD_REQUEST', 'invalid input');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.message).toBe('invalid input');
    expect(err.isOperational).toBe(true);
  });

  it('serializes to structured JSON', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'missing');
    const json = err.toJSON();
    expect(json).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'missing',
      },
    });
  });
});

describe('Errors factory', () => {
  it('badRequest returns 400 with default code', () => {
    const err = Errors.badRequest('bad');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
  });

  it('badRequest accepts custom code', () => {
    const err = Errors.badRequest('bad', 'CUSTOM');
    expect(err.code).toBe('CUSTOM');
  });

  it('notFound formats resource and id', () => {
    const err = Errors.notFound('Store', 'abc-123');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("Store 'abc-123' not found");
  });

  it('conflict returns 409', () => {
    const err = Errors.conflict('already exists');
    expect(err.statusCode).toBe(409);
  });

  it('invalidState formats state and action', () => {
    const err = Errors.invalidState('deleted', 'retry');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('INVALID_STATE_TRANSITION');
    expect(err.message).toContain('deleted');
    expect(err.message).toContain('retry');
  });

  it('operationInProgress includes storeId', () => {
    const err = Errors.operationInProgress('store-xyz');
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('store-xyz');
  });

  it('quotaExceeded returns 429 with max value', () => {
    const err = Errors.quotaExceeded(10);
    expect(err.statusCode).toBe(429);
    expect(err.message).toContain('10');
  });
});
