'use strict';
// Verifies the database design rules from Chapter 4.2.2 against a live MongoDB.
// Safe to run: it uses its own scratch database ("attendance_schema_check") and drops it afterwards.
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const config = require('../src/config');
const { User, Student, Course, Enrollment, Attendance } = require('../src/models');

const results = [];
async function check(name, fn) {
  try { await fn(); results.push([true, name]); }
  catch (err) { results.push([false, `${name} -> ${err.message.split('\n')[0]}`]); }
}
async function rejects(promise, matcher) {
  try { await promise; } catch (err) { if (matcher) assert.match(String(err.code || err.message), matcher); return; }
  assert.fail('expected the operation to be rejected');
}
const DUP = /11000|duplicate|E11000/i;

(async () => {
  await mongoose.connect(config.mongoUri, { dbName: 'attendance_schema_check', serverSelectionTimeoutMS: 8000 });
  await mongoose.connection.dropDatabase();
  for (const M of [User, Student, Course, Enrollment, Attendance]) await M.syncIndexes();

  const lecturer = await User.create({ name: 'Dr Lec', email: 'Lec@Test.edu', passwordHash: 'x', role: 'lecturer' });
  const course = await Course.create({ code: 'csc 301', title: 'Data Structures', lecturer: lecturer._id });
  const s1 = await Student.create({ matricNo: 'm001', fullName: 'Ada' });

  await check('email is stored lowercase', async () => assert.equal(lecturer.email, 'lec@test.edu'));
  await check('course code and matric number are stored uppercase', async () => {
    assert.equal(course.code, 'CSC 301'); assert.equal(s1.matricNo, 'M001');
  });
  await check('duplicate email is rejected', () => rejects(User.create({ name: 'B', email: 'lec@test.edu', passwordHash: 'x', role: 'admin' }), DUP));
  await check('duplicate course code is rejected', () => rejects(Course.create({ code: 'CSC 301', title: 'Dup' }), DUP));
  await check('duplicate matric number is rejected', () => rejects(Student.create({ matricNo: 'M001', fullName: 'Other' }), DUP));
  await check('unknown role is rejected', () => rejects(User.create({ name: 'B', email: 'b@test.edu', passwordHash: 'x', role: 'wizard' }), /role|validation/i));
  await check('password hash is hidden by default', async () => {
    const u = await User.findById(lecturer._id); assert.equal(u.passwordHash, undefined);
    const withHash = await User.findById(lecturer._id).select('+passwordHash'); assert.equal(withHash.passwordHash, 'x');
  });

  await check('several students may exist without a login account', async () => {
    await Student.create({ matricNo: 'M010', fullName: 'No Login 1' });
    await Student.create({ matricNo: 'M011', fullName: 'No Login 2' });
  });
  await check('one login account cannot own two student records', async () => {
    const u = await User.create({ name: 'Stu', email: 'stu@test.edu', passwordHash: 'x', role: 'student' });
    await Student.create({ user: u._id, matricNo: 'M020', fullName: 'Stu' });
    await rejects(Student.create({ user: u._id, matricNo: 'M021', fullName: 'Stu again' }), DUP);
  });

  await check('a student cannot be enrolled in the same course twice', async () => {
    await Enrollment.create({ course: course._id, student: s1._id });
    await rejects(Enrollment.create({ course: course._id, student: s1._id }), DUP);
  });

  await check('attendance status and date format are validated', async () => {
    await rejects(Attendance.create({ course: course._id, student: s1._id, date: '2026-01-05', status: 'maybe' }), /status|validation/i);
    await rejects(Attendance.create({ course: course._id, student: s1._id, date: '05/01/2026', status: 'present' }), /date|validation/i);
  });
  await check('only one attendance record per student, course and day', async () => {
    await Attendance.create({ course: course._id, student: s1._id, date: '2026-01-05', status: 'present' });
    await rejects(Attendance.create({ course: course._id, student: s1._id, date: '2026-01-05', status: 'absent' }), DUP);
  });
  await check('re-marking a day updates the record (upsert) instead of duplicating it', async () => {
    const op = (status) => ({ updateOne: { filter: { course: course._id, student: s1._id, date: '2026-01-06' },
      update: { $set: { status } }, upsert: true } });
    await Attendance.bulkWrite([op('present')]);
    await Attendance.bulkWrite([op('late')]);
    const rows = await Attendance.find({ course: course._id, student: s1._id, date: '2026-01-06' });
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'late');
  });

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();

  let failed = 0;
  for (const [ok, name] of results) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('Could not run checks:', err.message); process.exit(2); });
