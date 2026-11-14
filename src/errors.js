'use strict';

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const unauthorized = (msg = 'Please sign in to continue.') => new HttpError(401, msg);
const forbidden = (msg = 'You do not have permission to do that.') => new HttpError(403, msg);
const notFound = (msg = 'Not found.') => new HttpError(404, msg);
const conflict = (msg) => new HttpError(409, msg);

const TITLES = { 400: 'That did not work', 401: 'Please sign in', 403: 'Not allowed', 404: 'Page not found', 409: 'Already exists', 413: 'Too large' };

// Express error-handling middleware (must keep 4 arguments).
// JSON for the API; a friendly HTML page for everything else.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let message = 'Something went wrong on the server.';

  if (err instanceof HttpError) {
    status = err.status; message = err.message;
  } else if (err && err.type === 'entity.parse.failed') {
    status = 400; message = 'Request body is not valid JSON.';
  } else if (err && err.type === 'entity.too.large') {
    status = 413; message = 'Request body is too large.';
  } else if (err && err.code === 11000) {            // MongoDB duplicate-key error (a unique index was violated)
    status = 409; message = 'That value is already in use.';
  } else if (err && err.name === 'ValidationError') {
    status = 400; message = Object.values(err.errors).map((e) => e.message).join(' ');
  } else if (err && err.name === 'CastError') {
    status = 400; message = 'One of the values sent has the wrong format.';
  } else {
    console.error(err);                              // a real bug: log it, but do not leak details
  }

  if (req.originalUrl.startsWith('/api')) {
    return res.status(status).json({ error: message, details: err instanceof HttpError ? err.details : undefined });
  }
  try {
    return res.status(status).render('error', { status, title: TITLES[status] || 'Something went wrong', message });
  } catch (renderErr) {
    console.error(renderErr);
    return res.status(status).type('text').send(message);
  }
}

// Unknown /api paths get JSON; unknown pages get the HTML 404 page.
function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Route not found.' });
}
function pageNotFound(req, res) {
  res.status(404).render('error', { status: 404, title: TITLES[404], message: 'There is no page at this address.' });
}

module.exports = {
  HttpError, badRequest, unauthorized, forbidden, notFound, conflict,
  errorHandler, notFoundHandler, pageNotFound,
};
