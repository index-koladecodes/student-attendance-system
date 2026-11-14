'use strict';
// Pages: student records (administrators manage, lecturers can look up).
const express = require('express');
const students = require('../services/students.service');
const { requireRole } = require('../middleware/auth');
const { formError } = require('./helpers');

module.exports = function studentPages() {
  const router = express.Router();
  const staff = requireRole('admin', 'lecturer');
  const admin = requireRole('admin');

  router.get('/students', staff, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    res.render('students/index', { nav: 'students', q, students: await students.list(q) });
  });

  router.get('/students/new', admin, (req, res) => res.render('students/form', { nav: 'students', student: null, error: null, values: null }));
  router.post('/students', admin, async (req, res) => {
    try {
      const s = await students.create(req.body || {});
      res.flash('ok', `${s.fullName} added.`);
      res.redirect('/students');
    } catch (err) { formError(res, 'students/form', err, { nav: 'students', student: null, values: req.body || {} }); }
  });

  router.get('/students/:id/edit', admin, async (req, res) => {
    res.render('students/form', { nav: 'students', student: await students.get(req.params.id), error: null, values: null });
  });
  router.post('/students/:id/edit', admin, async (req, res) => {
    try {
      const s = await students.update(req.params.id, req.body || {});
      res.flash('ok', `${s.fullName} updated.`);
      res.redirect('/students');
    } catch (err) {
      formError(res, 'students/form', err, { nav: 'students', student: await students.get(req.params.id), values: req.body || {} });
    }
  });

  router.get('/students/:id/delete', admin, async (req, res) => {
    const s = await students.get(req.params.id);
    res.render('confirm', {
      nav: 'students', heading: `Delete ${s.fullName}?`, confirmLabel: 'Delete student',
      message: `${s.fullName} (${s.matricNo}) will be removed together with their enrolments and attendance records. This cannot be undone.`,
      action: `/students/${s.id}/delete`, cancelUrl: '/students',
    });
  });
  router.post('/students/:id/delete', admin, async (req, res) => {
    const s = await students.get(req.params.id);
    await students.remove(req.params.id);
    res.flash('ok', `${s.fullName} deleted.`);
    res.redirect('/students');
  });

  return router;
};
