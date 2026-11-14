'use strict';
// Page: a student's own attendance.
const express = require('express');
const students = require('../services/students.service');
const { requireRole } = require('../middleware/auth');

module.exports = function myPages() {
  const router = express.Router();

  router.get('/my', requireRole('student'), async (req, res) => {
    const student = await students.forUser(req.user._id);
    const data = student ? await students.attendanceFor(req.user, student.id) : null;
    res.render('my', { nav: 'my', student, data });
  });

  return router;
};
