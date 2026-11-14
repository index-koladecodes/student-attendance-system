'use strict';
// JSON API: accounts and sign-in. The rules live in services/auth.service.js.
const express = require('express');
const auth = require('../services/auth.service');
const { requireAuth, setAuthCookie, clearAuthCookie } = require('../middleware/auth');

module.exports = function authRoutes({ limiter }) {
  const router = express.Router();

  router.post('/register', limiter, async (req, res) => {
    const user = await auth.register(req.body || {});
    setAuthCookie(res, user);
    res.status(201).json({ user: await auth.publicUser(user) });
  });

  router.post('/login', limiter, async (req, res) => {
    const user = await auth.login(req.body || {});
    setAuthCookie(res, user);
    res.json({ user: await auth.publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, async (req, res) => {
    res.json({ user: await auth.publicUser(req.user) });
  });

  return router;
};
