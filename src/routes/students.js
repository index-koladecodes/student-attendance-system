'use strict';
// JSON API: students. The rules live in services/students.service.js.
const express = require('express');
const students = require('../services/students.service');
const { requireAuth, requireRole } = require('../middleware/auth');

module.exports = function studentRoutes() {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', requireRole('admin', 'lecturer'), async (req, res) => res.json({ students: await students.list(req.query.q) }));
  router.post('/', requireRole('admin'), async (req, res) => res.status(201).json({ student: await students.create(req.body || {}) }));
  router.put('/:id', requireRole('admin'), async (req, res) => res.json({ student: await students.update(req.params.id, req.body || {}) }));
  router.delete('/:id', requireRole('admin'), async (req, res) => { await students.remove(req.params.id); res.json({ ok: true }); });
  router.get('/:id/attendance', async (req, res) => res.json(await students.attendanceFor(req.user, req.params.id)));

  return router;
};
