import { env } from '../config/env.js';

export const notFound = (req, _res, next) => {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.statusCode = 404;
  next(err);
};

export const errorHandler = (err, _req, res, _next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';

  if (err.name === 'CastError') { statusCode = 400; message = `Invalid ${err.path}`; }
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `Duplicate value for ${field}`;
  }

  const payload = { success: false, message };
  if (err.details) payload.details = err.details;
  if (!env.isProd && statusCode === 500) payload.stack = err.stack;

  res.status(statusCode).json(payload);
};

