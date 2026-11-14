'use strict';
// JSON API: courses and enrolment. The rules live in services/courses.service.js.
const express = require('express');
const courses = require('../services/courses.service');
const { requireAuth, requireRole } = require('../middleware/auth');

module.exports = function courseRoutes() {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => res.json({ courses: await courses.list(req.user) }));
  router.post('/', requireRole('admin'), async (req, res) => res.status(201).json({ course: await courses.create(req.body || {}) }));
  router.get('/:id', async (req, res) => res.json({ course: await courses.get(req.user, req.params.id) }));
  router.put('/:id', requireRole('admin'), async (req, res) => res.json({ course: await courses.update(req.params.id, req.body || {}) }));
  router.delete('/:id', requireRole('admin'), async (req, res) => { await courses.remove(req.params.id); res.json({ ok: true }); });

  router.get('/:id/students', async (req, res) => res.json(await courses.enrolledStudents(req.user, req.params.id)));
  router.post('/:id/enroll', async (req, res) => {
    await courses.enroll(req.user, req.params.id, (req.body || {}).studentId);
    res.status(201).json({ ok: true });
  });
  router.delete('/:id/enroll/:studentId', async (req, res) => {
    await courses.unenroll(req.user, req.params.id, req.params.studentId);
    res.json({ ok: true });
  });

  return router;
};
