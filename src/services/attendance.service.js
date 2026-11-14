'use strict';
const mongoose = require('mongoose');
const config = require('../config');
const v = require('../validate');
const { Attendance, Enrollment } = require('../models');
const { loadCourse, assertManage } = require('../access');
const { badRequest } = require('../errors');
const { attendanceRate } = require('../stats');

const MAX_RECORDS = 1000;
const oid = (id) => new mongoose.Types.ObjectId(id);
const brief = (c) => ({ id: c.id, code: c.code, title: c.title });

// True when a MongoDB write failed only because of a duplicate-key (unique index) clash.
const isDuplicateKey = (err) =>
  err && (err.code === 11000 || (err.writeErrors || []).some((e) => e.code === 11000 || (e.err && e.err.code === 11000)));

async function managedCourse(actor, rawId) {
  const course = await loadCourse(v.id(rawId));
  assertManage(actor, course);
  return course;
}

// The register for one day: every enrolled student with their status (null = not marked yet).
// `dateText` is DD-MM-YYYY; when omitted the register is for today.
async function getRegister(actor, rawId, dateText) {
  const course = await managedCourse(actor, rawId);
  const date = dateText ? v.date(String(dateText), { allowFuture: true }) : v.todayString();

  const [enrolments, marks] = await Promise.all([
    Enrollment.find({ course: course.id }).populate('student').lean(),
    Attendance.find({ course: course.id, date }).lean(),
  ]);
  const statusByStudent = new Map(marks.map((m) => [String(m.student), m.status]));

  const records = enrolments
    .filter((e) => e.student)
    .map((e) => ({
      studentId: String(e.student._id),
      matricNo: e.student.matricNo,
      fullName: e.student.fullName,
      status: statusByStudent.get(String(e.student._id)) || null,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return { course: brief(course), date: v.formatDate(date), marked: records.some((r) => r.status !== null), records };
}

// Save (or correct) the register for one day. Saving the same date again updates it.
async function saveRegister(actor, rawId, input = {}) {
  const course = await managedCourse(actor, rawId);
  const date = v.date(input.date); // rejects malformed, impossible and future dates

  if (!Array.isArray(input.records) || input.records.length === 0) throw badRequest('Provide at least one attendance record.');
  if (input.records.length > MAX_RECORDS) throw badRequest(`Too many records in one request (max ${MAX_RECORDS}).`);

  const enrolled = new Set((await Enrollment.find({ course: course.id }).lean()).map((e) => String(e.student)));
  const seen = new Set();
  // Validate EVERY record before writing anything, so a bad entry never leaves a half-saved register.
  const clean = input.records.map((r, i) => {
    const rec = r && typeof r === 'object' ? r : {};
    const studentId = v.id(rec.studentId, `records[${i}].studentId`);
    const status = v.status(rec.status);
    if (!enrolled.has(studentId)) throw badRequest(`Student ${studentId} is not enrolled in ${course.code}.`);
    if (seen.has(studentId)) throw badRequest(`Student ${studentId} appears more than once.`);
    seen.add(studentId);
    return { studentId, status };
  });

  const operations = clean.map((r) => ({
    updateOne: {
      filter: { course: oid(course.id), student: oid(r.studentId), date },
      update: { $set: { status: r.status, markedBy: actor._id } },
      upsert: true, // insert if new, update if this student/day already has a record
    },
  }));

  try {
    await Attendance.bulkWrite(operations, { ordered: false });
  } catch (err) {
    // Two simultaneous saves can both try to insert the same new record; the unique index stops the
    // second, so retrying once turns it into a normal update.
    if (!isDuplicateKey(err)) throw err;
    await Attendance.bulkWrite(operations, { ordered: false });
  }
  return { saved: clean.length, date: v.formatDate(date) };
}

// Dates on which attendance was taken, with a headcount for each (newest first).
async function sessions(actor, rawId) {
  const course = await managedCourse(actor, rawId);
  const rows = await Attendance.find({ course: course.id }).select('date status').lean();
  const byDate = new Map();
  for (const r of rows) {
    const day = byDate.get(r.date) || { date: r.date, present: 0, late: 0, absent: 0 };
    day[r.status] += 1;
    byDate.set(r.date, day);
  }
  const list = [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date)) // sort on the stored YYYY-MM-DD form
    .map((s) => ({ ...s, date: v.formatDate(s.date) }));
  return { course: brief(course), sessions: list };
}

// Everyone enrolled, with counts and an attendance rate. A student below the threshold is flagged.
async function report(actor, rawId) {
  const course = await managedCourse(actor, rawId);
  const [enrolments, marks] = await Promise.all([
    Enrollment.find({ course: course.id }).populate('student').lean(),
    Attendance.find({ course: course.id }).select('student date status').lean(),
  ]);
  const sessionCount = new Set(marks.map((m) => m.date)).size;

  const tally = new Map(); // studentId -> { present, late, absent }
  for (const m of marks) {
    const t = tally.get(String(m.student)) || { present: 0, late: 0, absent: 0 };
    t[m.status] += 1;
    tally.set(String(m.student), t);
  }

  const rows = enrolments
    .filter((e) => e.student)
    .map((e) => {
      const t = tally.get(String(e.student._id)) || { present: 0, late: 0, absent: 0 };
      const rate = attendanceRate(t.present, t.late, sessionCount);
      return {
        studentId: String(e.student._id),
        matricNo: e.student.matricNo,
        fullName: e.student.fullName,
        ...t,
        sessions: sessionCount,
        rate,
        belowThreshold: rate !== null && rate < config.attendanceThreshold,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return { course: brief(course), sessions: sessionCount, threshold: config.attendanceThreshold, rows };
}

// Spreadsheet export. Any cell that a spreadsheet could read as a formula is neutralised.
const csvCell = (value) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

function reportCsv(rep) {
  const lines = [
    ['Matric No', 'Name', 'Present', 'Late', 'Absent', 'Sessions', 'Attendance %', 'Below threshold'],
    ...rep.rows.map((r) => [r.matricNo, r.fullName, r.present, r.late, r.absent, r.sessions, r.rate, r.belowThreshold ? 'Yes' : 'No']),
  ].map((cells) => cells.map(csvCell).join(','));
  return {
    filename: `${rep.course.code.replace(/[^A-Za-z0-9_-]+/g, '-')}-attendance.csv`,
    body: lines.join('\r\n') + '\r\n',
  };
}

module.exports = { getRegister, saveRegister, sessions, report, reportCsv };
