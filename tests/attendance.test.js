'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { connect, disconnect, listen, client } = require('./helpers');
const { createApp } = require('../src/app');
const { User, Course, Student, Enrollment, Attendance } = require('../src/models');
const { todayString } = require('../src/validate');

let server, base;
const ctx = {};
const isoDaysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return todayString(d); };
const toDmy = (iso) => iso.split('-').reverse().join('-');
const toIso = (dmy) => dmy.split('-').reverse().join('-');
const daysAgo = (n) => toDmy(isoDaysAgo(n)); // what the API uses: DD-MM-YYYY
const login = async (email, password = 'Passw0rd!!') => {
  const c = client(base);
  assert.equal((await c.post('/api/auth/login', { email, password })).status, 200);
  return c;
};
const rec = (studentId, status) => ({ studentId, status });

before(async () => {
  await connect('attendance_test_attendance');
  const hash = await bcrypt.hash('Passw0rd!!', 4);
  const [, lec, other, stuUser] = await User.create([
    { name: 'Admin', email: 'admin@test.edu', role: 'admin', passwordHash: hash },
    { name: 'Dr Lec', email: 'lec@test.edu', role: 'lecturer', passwordHash: hash },
    { name: 'Dr Other', email: 'other@test.edu', role: 'lecturer', passwordHash: hash },
    { name: 'Ada Obi', email: 'ada@test.edu', role: 'student', passwordHash: hash },
  ]);
  const [ada, bola, chi, outsider] = await Student.create([
    { user: stuUser._id, matricNo: 'M001', fullName: 'Ada Obi' },
    { matricNo: 'M002', fullName: 'Bola Ade' },
    { matricNo: 'M003', fullName: 'Chi Eze' },
    { matricNo: 'M004', fullName: 'Not Enrolled' },
  ]);
  const course = await Course.create({ code: 'CSC 301', title: 'Data Structures', lecturer: lec._id });
  await Course.create({ code: 'MTH 201', title: 'Linear Algebra', lecturer: other._id });
  await Enrollment.create([ada, bola, chi].map((s) => ({ course: course._id, student: s._id })));

  Object.assign(ctx, {
    courseId: String(course._id), ada: String(ada._id), bola: String(bola._id), chi: String(chi._id),
    outsider: String(outsider._id), lecUserId: String(lec._id),
  });
  ({ server, base } = await listen(createApp({ rateLimiting: false })));
  ctx.admin = await login('admin@test.edu');
  ctx.lec = await login('lec@test.edu');
  ctx.other = await login('other@test.edu');
  ctx.student = await login('ada@test.edu');
  ctx.url = `/api/courses/${ctx.courseId}/attendance`;
});
after(async () => { server.close(); await disconnect(); });

test('only the admin or the assigned lecturer can open or save a register', async () => {
  const body = { date: daysAgo(1), records: [rec(ctx.bola, 'present')] };
  assert.equal((await client(base).get(ctx.url)).status, 401);
  assert.equal((await client(base).post(ctx.url, body)).status, 401);
  assert.equal((await ctx.student.get(ctx.url)).status, 403, 'students cannot view the register');
  assert.equal((await ctx.student.post(ctx.url, body)).status, 403, 'students cannot mark attendance');
  assert.equal((await ctx.other.get(ctx.url)).status, 403, "another lecturer's course");
  assert.equal((await ctx.other.post(ctx.url, body)).status, 403);
  assert.equal(await Attendance.countDocuments(), 0, 'nothing was saved by refused requests');
});

test('dates are validated: format, existence and no future dates', async () => {
  const records = [rec(ctx.bola, 'present')];
  for (const date of [
    '01-01-2999', toDmy(todayString(new Date(Date.now() + 2 * 86400000))), // future
    '30-02-2024', '31-04-2026', '05-13-2026',                                // do not exist
    '05/01/2026', '5-1-2026', '05-01-26', '2026-01-05',                      // wrong format (incl. the old year-first form)
    '', 12345, undefined,
  ]) {
    const r = await ctx.lec.post(ctx.url, { date, records });
    assert.equal(r.status, 400, `date ${JSON.stringify(date)} should be rejected`);
  }
  assert.equal((await ctx.lec.get(`${ctx.url}?date=garbage`)).status, 400);
  assert.equal(await Attendance.countDocuments(), 0);
});

test('records are validated: shape, status, enrolment and duplicates', async () => {
  const date = daysAgo(1);
  const bad = async (records, why) => assert.equal((await ctx.lec.post(ctx.url, { date, records })).status, 400, why);
  await bad(undefined, 'missing records');
  await bad('present', 'records not an array');
  await bad([], 'empty records');
  await bad([null], 'null record');
  await bad([rec(ctx.bola, 'maybe')], 'unknown status');
  await bad([rec(ctx.bola, undefined)], 'missing status');
  await bad([rec('junk', 'present')], 'malformed id');
  await bad([rec(undefined, 'present')], 'missing id');
  await bad([rec('aaaaaaaaaaaaaaaaaaaaaaaa', 'present')], 'unknown student');
  await bad([rec(ctx.outsider, 'present')], 'real student who is not enrolled in this course');
  await bad([rec(ctx.bola, 'present'), rec(ctx.bola, 'absent')], 'same student twice');
  await bad(Array.from({ length: 1001 }, () => rec(ctx.bola, 'present')), 'more than 1000 records');
  await bad([{ studentId: { $ne: null }, status: 'present' }], 'object instead of an id (NoSQL operator)');
  assert.equal(await Attendance.countDocuments(), 0);
});

test('one bad entry means nothing at all is saved', async () => {
  const r = await ctx.lec.post(ctx.url, { date: daysAgo(1), records: [rec(ctx.ada, 'present'), rec(ctx.bola, 'present'), rec(ctx.outsider, 'present')] });
  assert.equal(r.status, 400);
  assert.equal(await Attendance.countDocuments(), 0, 'no half-saved register');
});

test('an unmarked day shows every enrolled student with no status', async () => {
  const r = await ctx.lec.get(`${ctx.url}?date=${daysAgo(3)}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.marked, false);
  assert.deepEqual(r.body.records.map((x) => x.matricNo), ['M001', 'M002', 'M003']);
  assert.ok(r.body.records.every((x) => x.status === null));
  const today = await ctx.lec.get(ctx.url);
  assert.equal(today.body.date, toDmy(todayString()), 'defaults to today, shown as DD-MM-YYYY');
});

test('a register can be saved and read back, and records who marked it', async () => {
  const day = daysAgo(2);
  const r = await ctx.lec.post(ctx.url, { date: day, records: [rec(ctx.ada, 'present'), rec(ctx.bola, 'late'), rec(ctx.chi, 'absent')] });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.saved, r.body.date], [3, day]);

  const back = await ctx.lec.get(`${ctx.url}?date=${day}`);
  assert.equal(back.body.marked, true);
  const statuses = Object.fromEntries(back.body.records.map((x) => [x.matricNo, x.status]));
  assert.deepEqual(statuses, { M001: 'present', M002: 'late', M003: 'absent' });

  const saved = await Attendance.findOne({ course: ctx.courseId, student: ctx.ada, date: toIso(day) }).lean();
  assert.equal(String(saved.markedBy), ctx.lecUserId);
  assert.equal(await Attendance.countDocuments(), 3);
});

test('saving the same date again corrects the records instead of duplicating them', async () => {
  const day = daysAgo(2);
  // Chi was marked absent by mistake: correct to present, and mark Bola absent
  const r = await ctx.admin.post(ctx.url, { date: day, records: [rec(ctx.chi, 'present'), rec(ctx.bola, 'absent')] });
  assert.equal(r.status, 201);
  assert.equal(await Attendance.countDocuments({ course: ctx.courseId, date: toIso(day) }), 3, 'still one record per student');
  const back = await ctx.lec.get(`${ctx.url}?date=${day}`);
  const statuses = Object.fromEntries(back.body.records.map((x) => [x.matricNo, x.status]));
  assert.deepEqual(statuses, { M001: 'present', M002: 'absent', M003: 'present' }, 'Ada untouched, others corrected');
});

test('a partial register is allowed; unlisted students stay unmarked', async () => {
  const day = daysAgo(5);
  assert.equal((await ctx.lec.post(ctx.url, { date: day, records: [rec(ctx.ada, 'present')] })).status, 201);
  const back = await ctx.lec.get(`${ctx.url}?date=${day}`);
  assert.deepEqual(back.body.records.map((x) => x.status), ['present', null, null]);
});

test('simultaneous saves of the same day never create duplicates', async () => {
  const day = daysAgo(7);
  const body = { date: day, records: [rec(ctx.ada, 'present'), rec(ctx.bola, 'late'), rec(ctx.chi, 'absent')] };
  const results = await Promise.all(Array.from({ length: 6 }, () => ctx.lec.post(ctx.url, body)));
  assert.ok(results.every((r) => r.status === 201), `statuses: ${results.map((r) => r.status)}`);
  assert.equal(await Attendance.countDocuments({ course: ctx.courseId, date: toIso(day) }), 3);
});

test('the session list shows each day with a headcount, newest first', async () => {
  const r = await ctx.lec.get(`/api/courses/${ctx.courseId}/sessions`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.sessions.map((s) => s.date), [daysAgo(2), daysAgo(5), daysAgo(7)]);
  assert.deepEqual(r.body.sessions[0], { date: daysAgo(2), present: 2, late: 0, absent: 1 });
  assert.equal((await ctx.other.get(`/api/courses/${ctx.courseId}/sessions`)).status, 403);
});

test('removing a student from the course hides them from the register but keeps their history', async () => {
  await ctx.admin.del(`/api/courses/${ctx.courseId}/enroll/${ctx.chi}`);
  const day = daysAgo(2);
  let back = await ctx.lec.get(`${ctx.url}?date=${day}`);
  assert.deepEqual(back.body.records.map((x) => x.matricNo), ['M001', 'M002']);
  assert.equal((await ctx.lec.post(ctx.url, { date: day, records: [rec(ctx.chi, 'present')] })).status, 400, 'cannot mark a removed student');

  await ctx.admin.post(`/api/courses/${ctx.courseId}/enroll`, { studentId: ctx.chi });
  back = await ctx.lec.get(`${ctx.url}?date=${day}`);
  assert.equal(back.body.records.find((x) => x.matricNo === 'M003').status, 'present', 'history is back after re-enrolling');
});

test('dates are shown as DD-MM-YYYY but stored so that they sort chronologically', async () => {
  // Across a year boundary: as plain DD-MM-YYYY text, "31-12-2025" would wrongly sort after "01-01-2026".
  for (const date of ['31-12-2025', '01-01-2026']) {
    assert.equal((await ctx.lec.post(ctx.url, { date, records: [rec(ctx.ada, 'present')] })).status, 201);
  }
  assert.ok(await Attendance.exists({ course: ctx.courseId, date: '2025-12-31' }), 'stored year-first');

  const r = await ctx.lec.get(`/api/courses/${ctx.courseId}/sessions`);
  const dates = r.body.sessions.map((s) => s.date);
  assert.ok(dates.every((d) => /^\d{2}-\d{2}-\d{4}$/.test(d)), 'every date is DD-MM-YYYY');
  assert.deepEqual(dates.slice(-2), ['01-01-2026', '31-12-2025'], 'newest first across the year boundary');
});
