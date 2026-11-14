'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { connect, disconnect, listen, client } = require('./helpers');
const { createApp } = require('../src/app');
const { User, Course, Student, Enrollment } = require('../src/models');
const { todayString } = require('../src/validate');

let server, base;
const ctx = {};
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return todayString(d).split('-').reverse().join('-'); };
const login = async (email) => {
  const c = client(base);
  assert.equal((await c.post('/api/auth/login', { email, password: 'Passw0rd!!' })).status, 200);
  return c;
};
// mark('CSC', date, { A: 'present', B: 'late' }) -> saves a register through the API
const mark = async (courseId, date, byStudent) => {
  const records = Object.entries(byStudent).map(([key, status]) => ({ studentId: ctx[key], status }));
  const r = await ctx.lec.post(`/api/courses/${courseId}/attendance`, { date, records });
  assert.equal(r.status, 201, JSON.stringify(r.body));
};

before(async () => {
  await connect('attendance_test_reports');
  const hash = await bcrypt.hash('Passw0rd!!', 4);
  const [, lec, other, adaUser] = await User.create([
    { name: 'Admin', email: 'admin@test.edu', role: 'admin', passwordHash: hash },
    { name: 'Dr Lec', email: 'lec@test.edu', role: 'lecturer', passwordHash: hash },
    { name: 'Dr Other', email: 'other@test.edu', role: 'lecturer', passwordHash: hash },
    { name: 'Ada Obi', email: 'ada@test.edu', role: 'student', passwordHash: hash },
  ]);
  const [a, b, c, d, e, f] = await Student.create([
    { user: adaUser._id, matricNo: 'M001', fullName: 'Ada Obi' },
    { matricNo: 'M002', fullName: 'Bola Ade' },
    { matricNo: 'M003', fullName: 'Chi Eze' },
    { matricNo: 'M004', fullName: 'Dayo Bello' },   // marked in the first session only
    { matricNo: 'M005', fullName: 'Emeka Zed' },    // never marked
    { matricNo: 'M006', fullName: 'Funmi Ola' },
  ]);
  const csc = await Course.create({ code: 'CSC 301', title: 'Data Structures', lecturer: lec._id });
  const gst = await Course.create({ code: 'GST 101', title: 'Use of English', lecturer: lec._id });
  const empty = await Course.create({ code: 'PHY 101', title: 'Physics', lecturer: lec._id });
  await Course.create({ code: 'MTH 201', title: 'Linear Algebra', lecturer: other._id });
  await Enrollment.create([a, b, c, d, e].map((s) => ({ course: csc._id, student: s._id })));
  await Enrollment.create({ course: gst._id, student: f._id });
  await Enrollment.create({ course: empty._id, student: f._id });

  Object.assign(ctx, { A: String(a._id), B: String(b._id), C: String(c._id), D: String(d._id), E: String(e._id), F: String(f._id),
    csc: String(csc._id), gst: String(gst._id), empty: String(empty._id) });
  ({ server, base } = await listen(createApp({ rateLimiting: false })));
  ctx.admin = await login('admin@test.edu');
  ctx.lec = await login('lec@test.edu');
  ctx.other = await login('other@test.edu');
  ctx.ada = await login('ada@test.edu');

  // CSC 301: four sessions (hand-calculated expectations below)
  await mark(ctx.csc, daysAgo(28), { A: 'present', B: 'present', C: 'absent',  D: 'present' });
  await mark(ctx.csc, daysAgo(21), { A: 'present', B: 'late',    C: 'absent' });
  await mark(ctx.csc, daysAgo(14), { A: 'present', B: 'absent',  C: 'present' });
  await mark(ctx.csc, daysAgo(7),  { A: 'present', B: 'present', C: 'absent' });
  // GST 101: three sessions, Funmi attends 2 of 3
  await mark(ctx.gst, daysAgo(14), { F: 'present' });
  await mark(ctx.gst, daysAgo(7),  { F: 'present' });
  await mark(ctx.gst, daysAgo(1),  { F: 'absent' });
});
after(async () => { server.close(); await disconnect(); });

test('only the admin or the assigned lecturer can open a course report', async () => {
  const url = `/api/courses/${ctx.csc}/report`;
  assert.equal((await client(base).get(url)).status, 401);
  assert.equal((await ctx.ada.get(url)).status, 403, 'students cannot see course reports');
  assert.equal((await ctx.other.get(url)).status, 403, "another lecturer's course");
  assert.equal((await ctx.lec.get(url)).status, 200);
  assert.equal((await ctx.admin.get(url)).status, 200);
  assert.equal((await ctx.other.get(`${url}.csv`)).status, 403, 'the CSV is protected the same way');
  assert.equal((await ctx.lec.get('/api/courses/not-an-id/report')).status, 400);
});

test('the report counts and rates match the hand-calculated figures', async () => {
  const r = await ctx.lec.get(`/api/courses/${ctx.csc}/report`);
  assert.equal(r.body.sessions, 4);
  assert.equal(r.body.threshold, 75);
  assert.deepEqual(r.body.rows.map((x) => x.fullName), ['Ada Obi', 'Bola Ade', 'Chi Eze', 'Dayo Bello', 'Emeka Zed']);
  const pick = (x) => [x.present, x.late, x.absent, x.rate, x.belowThreshold];
  const row = (m) => pick(r.body.rows.find((x) => x.matricNo === m));
  assert.deepEqual(row('M001'), [4, 0, 0, 100, false], 'always present');
  assert.deepEqual(row('M002'), [2, 1, 1, 75, false], 'exactly 75% is NOT below the 75% threshold');
  assert.deepEqual(row('M003'), [1, 0, 3, 25, true], 'mostly absent');
  assert.deepEqual(row('M004'), [1, 0, 0, 25, true], 'sessions where they were not marked count against them');
  assert.deepEqual(row('M005'), [0, 0, 0, 0, true], 'never marked');
});

test('rates are rounded to one decimal place', async () => {
  const r = await ctx.lec.get(`/api/courses/${ctx.gst}/report`);
  assert.deepEqual([r.body.sessions, r.body.rows[0].rate], [3, 66.7], '2 of 3 sessions = 66.7%');
  assert.equal(r.body.rows[0].belowThreshold, true);
});

test('a course with no sessions yet has no rate and nobody is flagged', async () => {
  const r = await ctx.lec.get(`/api/courses/${ctx.empty}/report`);
  assert.equal(r.body.sessions, 0);
  assert.deepEqual([r.body.rows[0].rate, r.body.rows[0].belowThreshold], [null, false]);
});

test("a student sees their own attendance, course by course, with dates as DD-MM-YYYY", async () => {
  const r = await ctx.ada.get(`/api/students/${ctx.A}/attendance`);
  assert.equal(r.status, 200);
  assert.equal(r.body.courses.length, 1);
  const c = r.body.courses[0];
  assert.deepEqual([c.code, c.sessions, c.present, c.late, c.absent, c.rate], ['CSC 301', 4, 4, 0, 0, 100]);
  assert.deepEqual([r.body.threshold, c.belowThreshold], [75, false]);
  assert.deepEqual(c.records.map((x) => x.date), [daysAgo(7), daysAgo(14), daysAgo(21), daysAgo(28)], 'newest first');
  assert.ok(c.records.every((x) => /^\d{2}-\d{2}-\d{4}$/.test(x.date) && x.status === 'present'));
});

test('students cannot view anyone else; lecturers see only their own courses', async () => {
  assert.equal((await ctx.ada.get(`/api/students/${ctx.B}/attendance`)).status, 403, 'another student');
  assert.equal((await ctx.ada.get(`/api/students/${ctx.D}/attendance`)).status, 403, 'a record with no login');
  assert.equal((await client(base).get(`/api/students/${ctx.A}/attendance`)).status, 401);
  assert.equal((await ctx.admin.get('/api/students/aaaaaaaaaaaaaaaaaaaaaaaa/attendance')).status, 404);
  assert.equal((await ctx.admin.get('/api/students/junk/attendance')).status, 400);

  const asLec = await ctx.lec.get(`/api/students/${ctx.B}/attendance`);
  assert.deepEqual(asLec.body.courses.map((c) => c.code), ['CSC 301']);
  const asOther = await ctx.other.get(`/api/students/${ctx.B}/attendance`);
  assert.deepEqual(asOther.body.courses, [], 'no course in common, so nothing to see');
});

test("a student's own figures agree with the course report", async () => {
  const [report, own] = await Promise.all([
    ctx.admin.get(`/api/courses/${ctx.csc}/report`),
    ctx.admin.get(`/api/students/${ctx.B}/attendance`),
  ]);
  const row = report.body.rows.find((x) => x.studentId === ctx.B);
  const c = own.body.courses[0];
  assert.deepEqual([c.present, c.late, c.absent, c.rate], [row.present, row.late, row.absent, row.rate]);
  assert.deepEqual([c.present, c.late, c.absent, c.rate], [2, 1, 1, 75]);
});

test('the CSV export is well formed and cannot carry spreadsheet formulas', async () => {
  // Two awkward names: a formula and a name with a comma and quotes
  for (const [matricNo, fullName] of [['M900', '=HYPERLINK("http://evil.example")'], ['M901', 'Okoro, Pat "PJ"']]) {
    const s = await ctx.admin.post('/api/students', { matricNo, fullName });
    assert.equal(s.status, 201);
    assert.equal((await ctx.admin.post(`/api/courses/${ctx.csc}/enroll`, { studentId: s.body.student.id })).status, 201);
  }
  const r = await ctx.lec.get(`/api/courses/${ctx.csc}/report.csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="CSC-301-attendance\.csv"/);

  const lines = r.text.trimEnd().split('\r\n');
  assert.equal(lines[0], '"Matric No","Name","Present","Late","Absent","Sessions","Attendance %","Below threshold"');
  assert.equal(lines.length, 1 + 7, 'header + 7 enrolled students');
  assert.ok(lines.includes('"M001","Ada Obi","4","0","0","4","100","No"'));
  assert.ok(lines.includes('"M002","Bola Ade","2","1","1","4","75","No"'));
  assert.ok(lines.includes('"M003","Chi Eze","1","0","3","4","25","Yes"'));
  assert.ok(lines.some((l) => l.includes(`"'=HYPERLINK(""http://evil.example"")"`)), 'formula is defused with a leading apostrophe');
  assert.ok(lines.some((l) => l.includes('"Okoro, Pat ""PJ"""')), 'commas and quotes are escaped');
});
