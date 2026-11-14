'use strict';
// Pages: courses, the attendance register, enrolment and reports.
const express = require('express');
const courses = require('../services/courses.service');
const students = require('../services/students.service');
const users = require('../services/users.service');
const attendance = require('../services/attendance.service');
const v = require('../validate');
const { requireRole } = require('../middleware/auth');
const fmt = require('./format');
const { formError, flashAndRedirect } = require('./helpers');

module.exports = function coursePages() {
  const router = express.Router();
  const staff = requireRole('admin', 'lecturer');
  const admin = requireRole('admin');
  router.use('/courses', staff);

  // ---- list and course admin ------------------------------------------------
  router.get('/courses', async (req, res) => {
    res.render('courses/index', { nav: 'courses', courses: await courses.list(req.user) });
  });

  const courseForm = async (course) => ({ nav: 'courses', course, lecturers: await users.list('lecturer'), error: null, values: null });

  router.get('/courses/new', admin, async (req, res) => res.render('courses/form', await courseForm(null)));
  router.post('/courses', admin, async (req, res) => {
    try {
      const course = await courses.create(req.body || {});
      res.flash('ok', `Course ${course.code} created.`);
      res.redirect('/courses');
    } catch (err) {
      formError(res, 'courses/form', err, { ...(await courseForm(null)), values: req.body || {} });
    }
  });

  router.get('/courses/:id/edit', admin, async (req, res) => {
    res.render('courses/form', await courseForm(await courses.get(req.user, req.params.id)));
  });
  router.post('/courses/:id/edit', admin, async (req, res) => {
    try {
      const course = await courses.update(req.params.id, req.body || {});
      res.flash('ok', `${course.code} updated.`);
      res.redirect('/courses');
    } catch (err) {
      formError(res, 'courses/form', err, { ...(await courseForm(await courses.get(req.user, req.params.id))), values: req.body || {} });
    }
  });

  router.get('/courses/:id/delete', admin, async (req, res) => {
    const course = await courses.get(req.user, req.params.id);
    res.render('confirm', {
      nav: 'courses', heading: `Delete ${course.code}?`, confirmLabel: 'Delete course',
      message: `${course.code} - ${course.title} will be removed together with its enrolments and every attendance record for it. This cannot be undone.`,
      action: `/courses/${course.id}/delete`, cancelUrl: '/courses',
    });
  });
  router.post('/courses/:id/delete', admin, async (req, res) => {
    const course = await courses.get(req.user, req.params.id);
    await courses.remove(req.params.id);
    res.flash('ok', `${course.code} deleted.`);
    res.redirect('/courses');
  });

  router.get('/courses/:id', (req, res) => res.redirect(`/courses/${encodeURIComponent(req.params.id)}/register`));

  // ---- the register (marking attendance) -----------------------------------
  router.get('/courses/:id/register', async (req, res) => {
    const id = req.params.id;
    const bare = `/courses/${encodeURIComponent(id)}/register`;
    const dateText = typeof req.query.date === 'string' && req.query.date ? req.query.date : undefined;
    if (dateText) {
      // A mistyped date is the one fixable problem here: say so and show today's register instead.
      // (Checked on its own so that a bad course id can never cause a redirect back to itself.)
      try { v.date(dateText, { allowFuture: true }); } catch (err) { return flashAndRedirect(res, err, bare); }
    }
    const register = await attendance.getRegister(req.user, id, dateText);
    const [course, { sessions }] = await Promise.all([courses.get(req.user, id), attendance.sessions(req.user, id)]);
    const count = (s) => register.records.filter((r) => r.status === s).length;
    const today = fmt.today();
    res.render('courses/register', {
      nav: 'courses', course, tab: 'register', register, sessions,
      tally: { present: count('present'), late: count('late'), absent: count('absent'), none: register.records.filter((r) => !r.status).length },
      prevDate: fmt.shift(register.date, -1), nextDate: fmt.shift(register.date, 1),
      isToday: register.date === today, today, weekday: fmt.weekday(register.date),
    });
  });

  router.post('/courses/:id/register', async (req, res) => {
    const id = req.params.id;
    const body = req.body || {};
    const dateText = typeof body.date === 'string' ? body.date : '';
    const back = (d) => `/courses/${encodeURIComponent(id)}/register${d ? `?date=${encodeURIComponent(d)}` : ''}`;
    try {
      try { v.date(dateText, { allowFuture: true }); } catch (err) { return flashAndRedirect(res, err, back('')); } // unreadable date: start over at today
      const register = await attendance.getRegister(req.user, id, dateText);
      const fillRest = body.intent === 'fill'; // "save and mark everyone else present"
      const records = [];
      for (const r of register.records) {
        const chosen = body[`status_${r.studentId}`];
        if (chosen !== undefined && chosen !== '') records.push({ studentId: r.studentId, status: chosen }); // validated by the service
        else if (fillRest) records.push({ studentId: r.studentId, status: 'present' });
      }
      if (!records.length) {
        res.flash('error', 'Mark at least one student before saving.');
        return res.redirect(back(dateText));
      }
      const result = await attendance.saveRegister(req.user, id, { date: dateText, records });
      res.flash('ok', `Saved ${result.saved} record${result.saved === 1 ? '' : 's'} for ${result.date}.`);
      return res.redirect(back(result.date));
    } catch (err) {
      return flashAndRedirect(res, err, back(dateText));
    }
  });

  // ---- students enrolled in a course ----------------------------------------
  router.get('/courses/:id/students', async (req, res) => {
    const { course, students: enrolled } = await courses.enrolledStudents(req.user, req.params.id);
    const everyone = await students.list('');
    const taken = new Set(enrolled.map((s) => s.id));
    res.render('courses/students', {
      nav: 'courses', tab: 'students', course: await courses.get(req.user, course.id), enrolled,
      candidates: everyone.filter((s) => !taken.has(s.id)),
    });
  });
  router.post('/courses/:id/students', async (req, res) => {
    const back = `/courses/${encodeURIComponent(req.params.id)}/students`;
    try {
      await courses.enroll(req.user, req.params.id, (req.body || {}).studentId);
      res.flash('ok', 'Student enrolled.');
      res.redirect(back);
    } catch (err) { flashAndRedirect(res, err, back); }
  });
  router.post('/courses/:id/students/:studentId/remove', async (req, res) => {
    const back = `/courses/${encodeURIComponent(req.params.id)}/students`;
    try {
      await courses.unenroll(req.user, req.params.id, req.params.studentId);
      res.flash('ok', 'Student removed from the course. Their past attendance is kept.');
      res.redirect(back);
    } catch (err) { flashAndRedirect(res, err, back); }
  });

  // ---- report ----------------------------------------------------------------
  router.get('/courses/:id/report', async (req, res) => {
    const report = await attendance.report(req.user, req.params.id);
    const rated = report.rows.filter((r) => r.rate !== null);
    res.render('courses/report', {
      nav: 'courses', tab: 'report', course: await courses.get(req.user, req.params.id), report,
      average: rated.length ? Math.round((rated.reduce((a, r) => a + r.rate, 0) / rated.length) * 10) / 10 : null,
      flagged: report.rows.filter((r) => r.belowThreshold).length,
    });
  });
  router.get('/courses/:id/report.csv', async (req, res) => {
    const { filename, body } = attendance.reportCsv(await attendance.report(req.user, req.params.id));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  });

  return router;
};
