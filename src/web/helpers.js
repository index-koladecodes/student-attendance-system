'use strict';
const { HttpError } = require('../errors');

// Re-show a form with the error message and what the user typed. Anything that is not an
// expected HttpError (a real bug) is passed on to the error page instead.
function formError(res, view, err, data = {}) {
  if (!(err instanceof HttpError)) throw err;
  return res.status(err.status).render(view, { ...data, error: err.message });
}

// Redirect back with a one-time message when the action failed for a reason the user can fix
// (bad input, a duplicate, an unknown record). Permission problems (401/403) and real bugs (5xx)
// are re-thrown so they show the error page instead of bouncing the user around.
function flashAndRedirect(res, err, url) {
  if (!(err instanceof HttpError) || err.status >= 500 || err.status === 401 || err.status === 403) throw err;
  res.flash('error', err.message);
  return res.redirect(url);
}

module.exports = { formError, flashAndRedirect };
