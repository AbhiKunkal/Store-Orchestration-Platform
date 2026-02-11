/**
 * Structured API Errors
 * 
 * Provides a consistent error format for the API:
 * { error: { code: "SOME_CODE", message: "Human readable message" } }
 * 
 * Why a custom error class?
 * - Allows us to attach status codes and error codes to Error objects
 * - Simplifies error handling middleware (just one instanceof check)
 * - Ensures every error response has the same shape (predictable for frontend)
 */

class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // Distinguishes operational errors from programming bugs
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

// Factory functions for common errors
const Errors = {
  badRequest: (message, code = 'BAD_REQUEST') => 
    new ApiError(400, code, message),
  
  notFound: (resource, id) => 
    new ApiError(404, 'NOT_FOUND', `${resource} '${id}' not found`),
  
  conflict: (message, code = 'CONFLICT') => 
    new ApiError(409, code, message),
  
  // Specific business logic errors
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
