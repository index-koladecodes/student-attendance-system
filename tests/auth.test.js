'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { connect, disconnect, listen, client } = require('./helpers');
const { createApp } = require('../src/app');
const { User, Student } = require('../src/models');

let server, base;
const ctx = {};

before(async () => {
  await connect('attendance_test_auth');
  await User.create({ name: 'Admin', email: 'admin@test.edu', role: 'admin', passwordHash: await bcrypt.hash('AdminPass123', 4) });
  ({ server, base } = await listen(createApp({ rateLimiting: false })));
});
after(async () => { server.close(); await disconnect(); });

test('health check responds', async () => {
  const r = await client(base).get('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
});

test('registration validates input', async () => {
  const c = client(base);
  const good = { name: 'Ada Obi', email: 'ada@test.edu', password: 'longenough1', matricNo: 'M001' };
  assert.equal((await c.post('/api/auth/register', { ...good, email: 'not-an-email' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...good, password: 'short' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...good, password: 'x'.repeat(73) })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...good, name: '' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...good, matricNo: undefined })).status, 400);
  assert.equal((await c.post('/api/auth/register', { ...good, name: { $gt: '' } })).status, 400, 'object (NoSQL operator) input is refused');
});

test('registration creates a student account and signs the user in', async () => {
  const c = client(base);
  const r = await c.post('/api/auth/register', {
    name: 'Ada Obi', email: 'Ada@Test.edu', password: 'longenough1', matricNo: 'm001', department: 'CS', level: '300',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, 'student');
  assert.equal(r.body.user.email, 'ada@test.edu');
  assert.equal(r.body.user.student.matricNo, 'M001');
  assert.ok(!JSON.stringify(r.body).toLowerCase().includes('password'), 'no password data in the response');

  // The session cookie must be httpOnly and SameSite=Strict
  const cookie = r.setCookies.find((c) => c.startsWith('token='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);

  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.student.matricNo, 'M001');
  ctx.ada = c;
});

test('passwords are stored as bcrypt hashes, never as plain text', async () => {
  const u = await User.findOne({ email: 'ada@test.edu' }).select('+passwordHash').lean();
  assert.match(u.passwordHash, /^\$2[aby]\$/);
  assert.notEqual(u.passwordHash, 'longenough1');
  assert.ok(await bcrypt.compare('longenough1', u.passwordHash));
});

test('a "role" sent during registration cannot make someone an admin', async () => {
  const c = client(base);
  const r = await c.post('/api/auth/register', {
    name: 'Sneaky', email: 'sneaky@test.edu', password: 'longenough1', matricNo: 'M666', role: 'admin',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, 'student');
  assert.equal((await c.get('/api/users')).status, 403);
});

test('duplicate email or matric number is rejected', async () => {
  const c = client(base);
  const base_ = { name: 'X', password: 'longenough1' };
  assert.equal((await c.post('/api/auth/register', { ...base_, email: 'ADA@test.edu', matricNo: 'M777' })).status, 409);
  assert.equal((await c.post('/api/auth/register', { ...base_, email: 'x@test.edu', matricNo: 'm001' })).status, 409);
  assert.equal(await User.countDocuments({ email: 'x@test.edu' }), 0, 'no orphan account left behind');
});

test('login rejects bad credentials with the same message', async () => {
  const c = client(base);
  const wrongPw = await c.post('/api/auth/login', { email: 'ada@test.edu', password: 'wrong-password' });
  const noUser = await c.post('/api/auth/login', { email: 'nobody@test.edu', password: 'whatever123' });
  assert.equal(wrongPw.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(wrongPw.body.error, noUser.body.error, 'does not reveal which emails exist');
  const injection = await c.post('/api/auth/login', { email: { $ne: null }, password: { $ne: null } });
  assert.equal(injection.status, 401, 'NoSQL injection attempt does not log in');
});

test('login, session and logout work end to end', async () => {
  const c = client(base);
  const r = await c.post('/api/auth/login', { email: 'ADA@test.edu ', password: 'longenough1' });
  assert.equal(r.status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 200);
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).status, 401);
});

test('protected routes need a valid token', async () => {
  const c = client(base);
  assert.equal((await c.get('/api/auth/me')).status, 401, 'no token');
  c.setToken('not.a.jwt');
  assert.equal((await c.get('/api/auth/me')).status, 401, 'garbage token');
  const user = await User.findOne({ email: 'ada@test.edu' });
  c.setToken(jwt.sign({ sub: String(user._id), role: 'admin' }, 'a-different-secret'));
  assert.equal((await c.get('/api/auth/me')).status, 401, 'token signed with the wrong secret');
  c.setToken(jwt.sign({ sub: String(user._id), role: 'student' }, process.env.JWT_SECRET, { expiresIn: -10 }));
  assert.equal((await c.get('/api/auth/me')).status, 401, 'expired token');
});

test('a token cannot claim a higher role than the database says', async () => {
  const user = await User.findOne({ email: 'ada@test.edu' });
  const c = client(base);
  c.setToken(jwt.sign({ sub: String(user._id), role: 'admin' }, process.env.JWT_SECRET)); // validly signed, but lies
  assert.equal((await c.get('/api/users')).status, 403);
});

test('role-based access: only administrators manage accounts', async () => {
  assert.equal((await ctx.ada.get('/api/users')).status, 403);
  assert.equal((await ctx.ada.post('/api/users', { name: 'L', email: 'l@test.edu', password: 'LecturerPass1', role: 'lecturer' })).status, 403);

  const admin = client(base);
  assert.equal((await admin.post('/api/auth/login', { email: 'admin@test.edu', password: 'AdminPass123' })).status, 200);
  ctx.admin = admin;

  const created = await admin.post('/api/users', { name: 'Dr Lec', email: 'lec@test.edu', password: 'LecturerPass1', role: 'lecturer' });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.role, 'lecturer');
  ctx.lecId = created.body.user.id;

  assert.equal((await admin.post('/api/users', { name: 'D', email: 'lec@test.edu', password: 'LecturerPass1', role: 'lecturer' })).status, 409);
  assert.equal((await admin.post('/api/users', { name: 'D', email: 'd@test.edu', password: 'LecturerPass1', role: 'superuser' })).status, 400);

  const list = await admin.get('/api/users?role=lecturer');
  assert.deepEqual(list.body.users.map((u) => u.email), ['lec@test.edu']);
  assert.ok(!JSON.stringify(list.body).toLowerCase().includes('password'));

  const lec = client(base);
  assert.equal((await lec.post('/api/auth/login', { email: 'lec@test.edu', password: 'LecturerPass1' })).status, 200);
  assert.equal((await lec.get('/api/users')).status, 403, 'lecturers cannot manage accounts either');
  ctx.lec = lec;
});

test('deleting an account ends its session immediately and tidies references', async () => {
  const { Course } = require('../src/models');
  await Course.create({ code: 'CSC 301', title: 'Data Structures', lecturer: ctx.lecId });

  const me = await ctx.admin.get('/api/auth/me');
  assert.equal((await ctx.admin.del(`/api/users/${me.body.user.id}`)).status, 400, 'cannot delete yourself');
  assert.equal((await ctx.admin.del('/api/users/not-an-id')).status, 400);
  assert.equal((await ctx.admin.del('/api/users/aaaaaaaaaaaaaaaaaaaaaaaa')).status, 404);

  assert.equal((await ctx.admin.del(`/api/users/${ctx.lecId}`)).status, 200);
  assert.equal((await ctx.lec.get('/api/auth/me')).status, 401, 'deleted user is signed out at once');
  const course = await Course.findOne({ code: 'CSC 301' }).lean();
  assert.equal(course.lecturer, undefined, 'course no longer points at the deleted lecturer');

  // A deleted student login leaves the student record in place, unlinked.
  const ada = await User.findOne({ email: 'ada@test.edu' });
  assert.equal((await ctx.admin.del(`/api/users/${ada._id}`)).status, 200);
  const rec = await Student.findOne({ matricNo: 'M001' }).lean();
  assert.ok(rec, 'student record kept');
  assert.equal(rec.user, undefined, 'and unlinked from the deleted account');
});

test('malformed requests are handled cleanly', async () => {
  const c = client(base);
  assert.equal((await c.raw('/api/auth/login', '{not json')).status, 400);
  assert.equal((await c.get('/api/nope')).status, 404);
});

test('login attempts are rate limited', async () => {
  const limited = await listen(createApp({ rateLimiting: true }));
  try {
    const c = client(limited.base);
    let last;
    for (let i = 0; i < 32; i++) last = await c.post('/api/auth/login', { email: 'nobody@test.edu', password: 'whatever123' });
    assert.equal(last.status, 429);
    assert.match(last.body.error, /Too many attempts/);
  } finally { limited.server.close(); }
});
