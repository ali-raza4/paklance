'use strict';
/*
 * Every error response has the same JSON shape the frontend expects:
 *   { "code": "SOME_CODE", "message": "Plain-English message shown to the user", "fields"?: { field: message } }
 */

class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    if (extra) Object.assign(this, { extra });
  }
}

const E = {
  validation: (fields) => {
    const first = Object.values(fields)[0] || 'Please check the highlighted fields.';
    return new ApiError(400, 'VALIDATION_ERROR', first, { fields });
  },
  bad: (code, message) => new ApiError(400, code, message),
  unauthenticated: () => new ApiError(401, 'UNAUTHENTICATED', 'Your session has ended. Please log in again.'),
  forbidden: (message = 'You don’t have access to this.', code = 'FORBIDDEN') => new ApiError(403, code, message),
  notFound: (message = 'We couldn’t find that.') => new ApiError(404, 'NOT_FOUND', message),
  conflict: (code, message) => new ApiError(409, code, message),
  rateLimited: (message = 'Too many attempts. Please wait a moment and try again.') => new ApiError(429, 'RATE_LIMITED', message),
  unavailable: (code, message) => new ApiError(503, code, message),
  sample: (message = 'This is sample content, so this action isn’t available.') => new ApiError(409, 'SAMPLE_CONTENT', message)
};

// Wrap async route handlers so rejected promises reach the error handler (Express 4).
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err instanceof ApiError) {
      const body = { code: err.code, message: err.message };
      if (err.extra && err.extra.fields) body.fields = err.extra.fields;
      if (err.extra && err.extra.retryAfter) {
        body.retryAfter = err.extra.retryAfter;
        res.set('Retry-After', String(err.extra.retryAfter));
      }
      return res.status(err.status).json(body);
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ code: 'BAD_JSON', message: 'The request body isn’t valid JSON.' });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ code: 'TOO_LARGE', message: 'That request is too large.' });
    }
    logger.error('[error]', req.method, req.originalUrl, err && err.stack ? err.stack : err);
    res.status(500).json({ code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
  };
}

module.exports = { ApiError, E, h, errorHandler };
