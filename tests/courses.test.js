'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { connect, disconnect, listen, client } = require('./helpers');
const { createApp } = require('../src/app');
const { User, Attendance, Enrollment, Student } = require('../src/models');

let server, base;
const ctx = {};
const login = async (email, password) => {
  const c = client(base);
  const r = await c.post('/api/auth/login', { email, password });
  assert.equal(r.status, 200, `login failed for ${email}`);
  return c;
};

before(async () => {
  await connect('attendance_test_courses');
  const hash = await bcrypt.hash('Passw0rd!!', 4);
  await User.create([
    { name: 'Admin', email: 'admin@test.edu', role: 'admin', passwordHash: hash },
    { name: 'Dr Lec', email: 'lec@test.edu', role: 'lecturer', passwordHash: hash },
    { name: 'Dr Other', email: 'other@test.edu', role: 'lecturer', passwordHash: hash },
  ]);
  ({ server, base } = await listen(createApp({ rateLimiting: false })));
  ctx.admin = await login('admin@test.edu', 'Passw0rd!!');
  ctx.lec = await login('lec@test.edu', 'Passw0rd!!');
  ctx.other = await login('other@test.edu', 'Passw0rd!!');
  ctx.lecId = (await User.findOne({ email: 'lec@test.edu' }))._id.toString();
  ctx.otherId = (await User.findOne({ email: 'other@test.edu' }))._id.toString();
});
after(async () => { server.close(); await disconnect(); });

test('anonymous users and students are kept out of management routes', async () => {
  assert.equal((await client(base).get('/api/courses')).status, 401);
  assert.equal((await client(base).get('/api/students')).status, 401);
  const stu = client(base);
  await stu.post('/api/auth/register', { name: 'Ada Obi', email: 'ada@test.edu', password: 'longenough1', matricNo: 'M001' });
  ctx.ada = stu;
  assert.equal((await stu.post('/api/courses', { code: 'X 1', title: 'X' })).status, 403);
  assert.equal((await stu.get('/api/students')).status, 403);
  assert.equal((await stu.post('/api/students', { matricNo: 'M9', fullName: 'X' })).status, 403);
  assert.equal((await ctx.lec.post('/api/courses', { code: 'X 1', title: 'X' })).status, 403, 'lecturers cannot create courses');
});

test('admin can create courses; codes are unique and lecturers must be real lecturers', async () => {
  let r = await ctx.admin.post('/api/courses', { code: ' csc 301 ', title: 'Data Structures', lecturerId: ctx.lecId });
  assert.equal(r.status, 201);
  assert.equal(r.body.course.code, 'CSC 301');
  assert.equal(r.body.course.lecturerName, 'Dr Lec');
  ctx.courseId = r.body.course.id;

  assert.equal((await ctx.admin.post('/api/courses', { code: 'CSC 301', title: 'Dup' })).status, 409);
  assert.equal((await ctx.admin.post('/api/courses', { title: 'No code' })).status, 400);
  const studentUser = await User.findOne({ email: 'ada@test.edu' });
  assert.equal((await ctx.admin.post('/api/courses', { code: 'A 1', title: 'A', lecturerId: String(studentUser._id) })).status, 400, 'a student cannot be a lecturer');
  assert.equal((await ctx.admin.post('/api/courses', { code: 'A 1', title: 'A', lecturerId: 'aaaaaaaaaaaaaaaaaaaaaaaa' })).status, 400, 'unknown lecturer');
  assert.equal((await ctx.admin.post('/api/courses', { code: 'A 1', title: 'A', lecturerId: 'nonsense' })).status, 400, 'malformed id');

  r = await ctx.admin.post('/api/courses', { code: 'MTH 201', title: 'Linear Algebra', lecturerId: ctx.otherId });
  ctx.otherCourseId = r.body.course.id;
  r = await ctx.admin.post('/api/courses', { code: 'GST 101', title: 'Use of English' }); // no lecturer yet
  assert.equal(r.status, 201);
  assert.equal(r.body.course.lecturerId, null);
  ctx.unassignedId = r.body.course.id;
});

test('admin can edit, reassign and unassign courses', async () => {
  let r = await ctx.admin.put(`/api/courses/${ctx.unassignedId}`, { code: 'GST 101', title: 'Use of English I', lecturerId: ctx.lecId });
  assert.equal(r.status, 200);
  assert.equal(r.body.course.title, 'Use of English I');
  assert.equal(r.body.course.lecturerName, 'Dr Lec');
  r = await ctx.admin.put(`/api/courses/${ctx.unassignedId}`, { code: 'GST 101', title: 'Use of English I' });
  assert.equal(r.body.course.lecturerId, null, 'omitting the lecturer unassigns it');
  assert.equal((await ctx.admin.put(`/api/courses/${ctx.unassignedId}`, { code: 'CSC 301', title: 'Clash' })).status, 409);
  assert.equal((await ctx.admin.put('/api/courses/aaaaaaaaaaaaaaaaaaaaaaaa', { code: 'Z 1', title: 'Z' })).status, 404);
  assert.equal((await ctx.admin.put('/api/courses/bad-id', { code: 'Z 1', title: 'Z' })).status, 400);
});

test('admin can add, edit and search students', async () => {
  let r = await ctx.admin.post('/api/students', { matricNo: 'm002', fullName: 'Bola Ade', department: 'CS', level: '300' });
  assert.equal(r.status, 201);
  assert.equal(r.body.student.matricNo, 'M002');
  ctx.bola = r.body.student.id;
  r = await ctx.admin.post('/api/students', { matricNo: 'M003', fullName: 'Chi Eze' });
  ctx.chi = r.body.student.id;

  assert.equal((await ctx.admin.post('/api/students', { matricNo: 'M002', fullName: 'Dup' })).status, 409);
  assert.equal((await ctx.admin.post('/api/students', { matricNo: 'M004' })).status, 400);

  r = await ctx.admin.put(`/api/students/${ctx.bola}`, { matricNo: 'M002', fullName: 'Bola Adeyemi', department: 'Software Eng', level: '400' });
  assert.equal(r.status, 200);
  assert.equal(r.body.student.fullName, 'Bola Adeyemi');
  assert.equal(r.body.student.level, '400');
  assert.equal((await ctx.admin.put(`/api/students/${ctx.bola}`, { matricNo: 'M003', fullName: 'Clash' })).status, 409);

  assert.equal((await ctx.admin.get('/api/students?q=adeyemi')).body.students.length, 1);
  assert.equal((await ctx.admin.get('/api/students?q=m00')).body.students.length, 3);
  assert.equal((await ctx.admin.get('/api/students?q=.*')).body.students.length, 0, 'search text is not treated as a regex');
  assert.equal((await ctx.lec.get('/api/students')).status, 200, 'lecturers can look students up to enrol them');
});

test('a student record can be linked to a login account', async () => {
  // A login with no student record yet (created by an administrator).
  const made = await ctx.admin.post('/api/users', { name: 'Bola', email: 'bola@test.edu', password: 'longenough1', role: 'student' });
  assert.equal(made.status, 201);
  const link = (accountEmail, id = ctx.bola, matricNo = 'M002') =>
    ctx.admin.put(`/api/students/${id}`, { matricNo, fullName: 'Bola Adeyemi', accountEmail });

  assert.equal((await link('nobody@test.edu')).status, 400, 'unknown email');
  assert.equal((await link('lec@test.edu')).status, 400, 'only student accounts can be linked');
  assert.equal((await link('ada@test.edu')).status, 409, 'that login already owns another student record');

  let r = await link('bola@test.edu');
  assert.equal(r.status, 200);
  assert.equal(r.body.student.accountEmail, 'bola@test.edu');

  r = await link('bola@test.edu', ctx.chi, 'M003');
  assert.equal(r.status, 409, 'one account cannot belong to two records');

  // The linked student can now sign in and is recognised as that record.
  const bola = client(base);
  assert.equal((await bola.post('/api/auth/login', { email: 'bola@test.edu', password: 'longenough1' })).status, 200);
  const me = await bola.get('/api/auth/me');
  assert.equal(me.body.user.student.matricNo, 'M002');
});

test('enrollment: admin and the assigned lecturer only', async () => {
  const url = `/api/courses/${ctx.courseId}`;
  const adaStudent = await Student.findOne({ matricNo: 'M001' });
  ctx.adaStudentId = String(adaStudent._id);

  assert.equal((await ctx.admin.post(`${url}/enroll`, { studentId: ctx.bola })).status, 201);
  assert.equal((await ctx.lec.post(`${url}/enroll`, { studentId: ctx.chi })).status, 201);
  assert.equal((await ctx.lec.post(`${url}/enroll`, { studentId: ctx.adaStudentId })).status, 201);
  assert.equal((await ctx.lec.post(`${url}/enroll`, { studentId: ctx.chi })).status, 409, 'no double enrolment');
  assert.equal((await ctx.lec.post(`${url}/enroll`, { studentId: 'aaaaaaaaaaaaaaaaaaaaaaaa' })).status, 404);
  assert.equal((await ctx.lec.post(`${url}/enroll`, { studentId: 'junk' })).status, 400);
  assert.equal((await ctx.lec.post(`${url}/enroll`, {})).status, 400);
  assert.equal(await Enrollment.countDocuments({ course: ctx.courseId }), 3);

  assert.equal((await ctx.other.post(`${url}/enroll`, { studentId: ctx.bola })).status, 403, 'another lecturer');
  assert.equal((await ctx.ada.post(`${url}/enroll`, { studentId: ctx.bola })).status, 403, 'a student');
  assert.equal((await ctx.other.get(`${url}/students`)).status, 403);

  const list = await ctx.lec.get(`${url}/students`);
  assert.deepEqual(list.body.students.map((s) => s.matricNo), ['M001', 'M002', 'M003'].sort());
});

test('removing a student from a course works and reports unknowns', async () => {
  const url = `/api/courses/${ctx.courseId}`;
  assert.equal((await ctx.other.del(`${url}/enroll/${ctx.chi}`)).status, 403);
  assert.equal((await ctx.lec.del(`${url}/enroll/${ctx.chi}`)).status, 200);
  assert.equal((await ctx.lec.del(`${url}/enroll/${ctx.chi}`)).status, 404, 'already removed');
  assert.equal((await ctx.lec.del(`${url}/enroll/bad`)).status, 400);
  assert.equal((await ctx.lec.get(`${url}/students`)).body.students.length, 2);
});

test('each role sees only the courses it should', async () => {
  await Attendance.create({ course: ctx.courseId, student: ctx.bola, date: '2026-01-05', status: 'present' });
  await Attendance.create({ course: ctx.courseId, student: ctx.bola, date: '2026-01-12', status: 'late' });

  const all = await ctx.admin.get('/api/courses');
  assert.deepEqual(all.body.courses.map((c) => c.code), ['CSC 301', 'GST 101', 'MTH 201']);
  const csc = all.body.courses.find((c) => c.code === 'CSC 301');
  assert.equal(csc.enrolledCount, 2);
  assert.equal(csc.sessions, 2);

  assert.deepEqual((await ctx.lec.get('/api/courses')).body.courses.map((c) => c.code), ['CSC 301']);
  assert.deepEqual((await ctx.other.get('/api/courses')).body.courses.map((c) => c.code), ['MTH 201']);
  assert.deepEqual((await ctx.ada.get('/api/courses')).body.courses.map((c) => c.code), ['CSC 301'], 'a student sees enrolled courses');

  assert.equal((await ctx.ada.get(`/api/courses/${ctx.courseId}`)).status, 200);
  assert.equal((await ctx.ada.get(`/api/courses/${ctx.otherCourseId}`)).status, 403, 'not enrolled');
  assert.equal((await ctx.other.get(`/api/courses/${ctx.courseId}`)).status, 403, "another lecturer's course");
  assert.equal((await ctx.admin.get('/api/courses/aaaaaaaaaaaaaaaaaaaaaaaa')).status, 404);
});

test('deleting a student also removes their enrolments and attendance', async () => {
  assert.equal((await ctx.admin.del(`/api/students/${ctx.bola}`)).status, 200);
  assert.equal(await Enrollment.countDocuments({ student: ctx.bola }), 0);
  assert.equal(await Attendance.countDocuments({ student: ctx.bola }), 0);
  assert.equal((await ctx.admin.del(`/api/students/${ctx.bola}`)).status, 404);
  assert.equal((await ctx.lec.del(`/api/students/${ctx.chi}`)).status, 403, 'lecturers cannot delete students');
});

test('deleting a course also removes its enrolments and attendance', async () => {
  await Attendance.create({ course: ctx.courseId, student: ctx.adaStudentId, date: '2026-01-05', status: 'absent' });
  assert.equal((await ctx.lec.del(`/api/courses/${ctx.courseId}`)).status, 403, 'only admins delete courses');
  assert.equal((await ctx.admin.del(`/api/courses/${ctx.courseId}`)).status, 200);
  assert.equal(await Enrollment.countDocuments({ course: ctx.courseId }), 0);
  assert.equal(await Attendance.countDocuments({ course: ctx.courseId }), 0);
  assert.ok(await Student.exists({ matricNo: 'M001' }), 'students themselves are kept');
  assert.equal((await ctx.admin.del(`/api/courses/${ctx.courseId}`)).status, 404);
});
