// Centralized error handler — formats all errors into { error: { code, message } }.

const { ApiError } = require('../utils/apiError');
const config = require('../config');

function errorHandler(err, req, res, next) {
  console.error(`[error] ${req.method} ${req.path}:`, err.stack || err.message);

  // Malformed JSON body
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Invalid JSON payload provided',
      },
    });
  }

  // Known operational errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json(err.toJSON());
  }

  // Unhandled errors — hide internals in production
  const isProduction = config.nodeEnv === 'production';

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isProduction ? 'An unexpected error occurred' : err.message,
      ...(isProduction ? {} : { stack: err.stack }),
    },
  });
}

module.exports = errorHandler;
