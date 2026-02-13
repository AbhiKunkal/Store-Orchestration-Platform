// Structured API error class with factory functions for common error types.

class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}

const Errors = {
  badRequest: (message, code = 'BAD_REQUEST') =>
    new ApiError(400, code, message),

  notFound: (resource, id) =>
    new ApiError(404, 'NOT_FOUND', `${resource} '${id}' not found`),

  conflict: (message, code = 'CONFLICT') =>
    new ApiError(409, code, message),

  invalidState: (currentState, attemptedAction) =>
    new ApiError(409, 'INVALID_STATE_TRANSITION',
      `Cannot ${attemptedAction} a store in '${currentState}' state`),

  operationInProgress: (storeId) =>
    new ApiError(409, 'OPERATION_IN_PROGRESS',
      `An operation is already in progress for store '${storeId}'`),

  quotaExceeded: (max) =>
    new ApiError(429, 'QUOTA_EXCEEDED',
      `Store limit reached (max: ${max}). Delete existing stores to create new ones.`),
};

module.exports = { ApiError, Errors };
