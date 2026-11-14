'use strict';
// JSON API: registers, sessions and reports. The rules live in services/attendance.service.js.
const express = require('express');
const attendance = require('../services/attendance.service');
const { requireAuth } = require('../middleware/auth');

// Mounted on /api/courses next to the course routes.
module.exports = function attendanceRoutes() {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/:id/attendance', async (req, res) => {
    res.json(await attendance.getRegister(req.user, req.params.id, req.query.date ? String(req.query.date) : undefined));
  });
  router.post('/:id/attendance', async (req, res) => {
    res.status(201).json(await attendance.saveRegister(req.user, req.params.id, req.body || {}));
  });
  router.get('/:id/sessions', async (req, res) => res.json(await attendance.sessions(req.user, req.params.id)));
  router.get('/:id/report', async (req, res) => res.json(await attendance.report(req.user, req.params.id)));
  router.get('/:id/report.csv', async (req, res) => {
    const { filename, body } = attendance.reportCsv(await attendance.report(req.user, req.params.id));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  });

  return router;
};
