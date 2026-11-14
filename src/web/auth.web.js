'use strict';
// Pages: sign in, sign up, sign out.
const express = require('express');
const auth = require('../services/auth.service');
const { authenticate, setAuthCookie, clearAuthCookie } = require('../middleware/auth');
const { homePath } = require('./format');
const { formError } = require('./helpers');

module.exports = function authPages({ limiter }) {
  const router = express.Router();

  // Signed-in visitors skip the sign-in pages.
  const redirectIfSignedIn = async (req, res, next) => {
    try { return res.redirect(homePath(await authenticate(req))); } catch { return next(); }
  };

  router.get('/', redirectIfSignedIn, (req, res) => res.redirect('/login'));

  router.get('/login', redirectIfSignedIn, (req, res) => res.render('login', { error: null, values: {} }));
  router.post('/login', limiter, async (req, res) => {
    const body = req.body || {};
    try {
      const user = await auth.login(body);
      setAuthCookie(res, user);
      res.redirect(homePath(user));
    } catch (err) {
      formError(res, 'login', err, { values: { email: typeof body.email === 'string' ? body.email : '' } });
    }
  });

  router.get('/register', redirectIfSignedIn, (req, res) => res.render('register', { error: null, values: {} }));
  router.post('/register', limiter, async (req, res) => {
    const body = req.body || {};
    try {
      const user = await auth.register(body);
      setAuthCookie(res, user);
      res.flash('ok', 'Your account was created. Welcome!');
      res.redirect(homePath(user));
    } catch (err) {
      const keep = {};
      for (const k of ['name', 'email', 'matricNo', 'department', 'level']) keep[k] = typeof body[k] === 'string' ? body[k] : ''; // never the password
      formError(res, 'register', err, { values: keep });
    }
  });

  router.post('/logout', (req, res) => {
    clearAuthCookie(res);
    res.flash('ok', 'You have been signed out.');
    res.redirect('/login');
  });

  return router;
};
