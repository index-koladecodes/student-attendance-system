'use strict';
// JSON API: administrator-only account management.
const express = require('express');
const users = require('../services/users.service');
const { requireAuth, requireRole } = require('../middleware/auth');

module.exports = function userRoutes() {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  router.get('/', async (req, res) => res.json({ users: await users.list(req.query.role) }));
  router.post('/', async (req, res) => res.status(201).json({ user: await users.create(req.body || {}) }));
  router.delete('/:id', async (req, res) => { await users.remove(req.user, req.params.id); res.json({ ok: true }); });

  return router;
};
