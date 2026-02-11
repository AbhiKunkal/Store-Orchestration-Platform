/**
 * Centralized Error Handler Middleware
 * 
 * Intercepts all errors, formats them into a standard JSON structure,
 * and hides implementation details in production.
 */

const { ApiError } = require('../utils/apiError');

function errorHandler(err, req, res, next) {
  // Log the error for debugging
  console.error(`[error] ${req.method} ${req.path}:`, err.stack || err.message);

  // Handle SyntaxError (JSON parsing failed)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Invalid JSON payload provided',
      },
    });
  }

  // Handle known API errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json(err.toJSON());
  }

  // Handle unhandled errors (500)
  // In production, we don't leak stack traces
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isProduction ? 'An unexpected error occurred' : err.message,
      ...(isProduction ? {} : { stack: err.stack }),
    },
  });
}

module.exports = errorHandler;
