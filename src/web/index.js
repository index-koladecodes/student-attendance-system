'use strict';
// All the server-rendered pages. Routes -> services -> models -> EJS views.
const express = require('express');
const csrf = require('../middleware/csrf');
const flash = require('../middleware/flash');
const { authenticate, clearAuthCookie, COOKIE_NAME } = require('../middleware/auth');
const { ROLE, STATUS } = require('./format');

module.exports = function webRoutes({ limiter }) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store'); // never let the browser re-show a private page after sign-out
    res.locals.ROLE = ROLE;
    res.locals.STATUS = STATUS;
    next();
  });
  router.use(csrf, flash);

  // Public pages (sign in / sign up / sign out)
  router.use(require('./auth.web')({ limiter }));

  // Everything below needs a signed-in user; otherwise go to the sign-in page.
  router.use(async (req, res, next) => {
    try {
      req.user = await authenticate(req);
      res.locals.user = req.user;
      next();
    } catch (err) {
      if (err.status !== 401) throw err;
      if (req.cookies && req.cookies[COOKIE_NAME]) { // had a session, but it is no longer valid
        clearAuthCookie(res);
        res.flash('error', err.message);
      }
      res.redirect('/login');
    }
  });

  router.use(require('./courses.web')());
  router.use(require('./students.web')());
  router.use(require('./accounts.web')());
  router.use(require('./my.web')());

  return router;
};
