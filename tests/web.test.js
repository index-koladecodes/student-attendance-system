'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { connect, disconnect, listen } = require('./helpers');
const { createApp } = require('../src/app');
const { User, Course, Student, Enrollment, Attendance } = require('../src/models');
const { todayString } = require('../src/validate');

let server, base;
const ctx = {};
const dmy = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return todayString(d).split('-').reverse().join('-'); };
const iso = (s) => s.split('-').reverse().join('-');

// A browser tab for HTML pages: keeps cookies, submits forms (with the CSRF token a real form carries).
function browser() {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  async function request(method, path, form, { csrf = true, follow = false } = {}) {
    if (form && csrf && !jar.has('csrf')) await request('GET', '/login'); // a real page load would have set it
    const body = form ? new URLSearchParams({ ...(csrf && jar.has('csrf') ? { _csrf: jar.get('csrf') } : {}), ...form }).toString() : undefined;
    const res = await fetch(base + path, {
      method, redirect: 'manual', body,
      headers: { ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), Cookie: cookieHeader() },
    });
    const setCookies = res.headers.getSetCookie();
    for (const c of setCookies) {
      const [pair, ...attrs] = c.split(';');
      const [name, ...rest] = pair.split('=');
      const value = rest.join('=');
      const expired = /expires=thu, 01 jan 1970/i.test(c) || /max-age=0/i.test(c);
      if (expired || value === '') jar.delete(name); else jar.set(name, value);
      void attrs;
    }
    const text = await res.text();
    const out = { status: res.status, text, location: res.headers.get('location'), headers: res.headers, setCookies };
    if (follow && out.status >= 300 && out.status < 400) return request('GET', out.location, null, { follow: true });
    return out;
  }
  return {
    get: (p, o) => request('GET', p, null, o),
    post: (p, form = {}, o) => request('POST', p, form, o),
    cookie: (name) => jar.get(name),
    setCookie: (name, value) => jar.set(name, value),
  };
}
const signIn = async (email, password = 'Passw0rd!!') => {
  const b = browser();
  const r = await b.post('/login', { email, password });
  assert.equal(r.status, 302, `sign-in failed for ${email}: ${r.status}`);
  return b;
};
const has = (html, text) => html.includes(text);

before(async () => {
  await connect('attendance_test_web');
  const hash = await bcrypt.hash('Passw0rd!!', 4);
  const [, lec, other, adaUser] = await User.create([
    { name: 'Admin', email: 'admin@test.edu', role: 'admin', passwordHash: hash },
    { name: 'Dr Lec', email: 'lec@test.edu', role: 'lecturer', passwordHash: hash },
    { name: 'Dr Other', email: 'other@test.edu', role: 'lecturer', passwordHash: hash },
    { name: 'Ada Obi', email: 'ada@test.edu', role: 'student', passwordHash: hash },
  ]);
  const [ada, bola, chi, outsider] = await Student.create([
    { user: adaUser._id, matricNo: 'M001', fullName: 'Ada Obi' },
    { matricNo: 'M002', fullName: 'Bola Ade' },
    { matricNo: 'M003', fullName: '<img src=x onerror=alert(1)>' }, // hostile name, to prove output is escaped
    { matricNo: 'M004', fullName: 'Not Enrolled' },
  ]);
  const course = await Course.create({ code: 'CSC 301', title: 'Data Structures', lecturer: lec._id });
  const otherCourse = await Course.create({ code: 'MTH 201', title: 'Linear Algebra', lecturer: other._id });
  await Enrollment.create([ada, bola, chi].map((s) => ({ course: course._id, student: s._id })));
  Object.assign(ctx, {
    course: String(course._id), otherCourse: String(otherCourse._id), lecId: String(lec._id),
    ada: String(ada._id), bola: String(bola._id), chi: String(chi._id), outsider: String(outsider._id),
  });
  ({ server, base } = await listen(createApp({ rateLimiting: false })));
  ctx.admin = await signIn('admin@test.edu');
  ctx.lec = await signIn('lec@test.edu');
  ctx.other = await signIn('other@test.edu');
  ctx.student = await signIn('ada@test.edu');
  ctx.reg = `/courses/${ctx.course}/register`;
});
after(async () => { server.close(); await disconnect(); });

test('visitors are sent to the sign-in page; pages carry security headers', async () => {
  const b = browser();
  for (const path of ['/courses', '/students', '/accounts', '/my', `/courses/${ctx.course}/register`]) {
    const r = await b.get(path);
    assert.deepEqual([r.status, r.location], [302, '/login'], `${path} should redirect`);
  }
  const page = await b.get('/login');
  assert.equal(page.status, 200);
  assert.ok(has(page.text, 'name="_csrf"'), 'sign-in form has a CSRF token');
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(page.headers.get('cache-control'), /no-store/);
  assert.ok(!/<script/i.test(page.text), 'the pages need no JavaScript at all');
});

test('forms without a valid CSRF token are refused', async () => {
  const b = browser();
  await b.get('/login');
  let r = await b.post('/login', { email: 'lec@test.edu', password: 'Passw0rd!!' }, { csrf: false });
  assert.equal(r.status, 403);
  assert.ok(has(r.text, 'Not allowed') && has(r.text, 'expired'), 'friendly HTML error page');
  b.setCookie('csrf', 'a'.repeat(64)); // token no longer matches what the form sends
  r = await b.post('/login', { email: 'lec@test.edu', password: 'Passw0rd!!', _csrf: 'f'.repeat(64) }, { csrf: false });
  assert.equal(r.status, 403);
  // a signed-in user's state-changing form is protected as well
  r = await ctx.admin.post('/courses', { code: 'X 1', title: 'X' }, { csrf: false });
  assert.equal(r.status, 403);
  assert.equal(await Course.countDocuments({ code: 'X 1' }), 0);
});

test('sign-in: wrong credentials re-show the form without echoing the password', async () => {
  const b = browser();
  const r = await b.post('/login', { email: 'lec@test.edu', password: 'wrong-password' });
  assert.equal(r.status, 401);
  assert.ok(has(r.text, 'Incorrect email or password.'));
  assert.ok(has(r.text, 'value="lec@test.edu"'), 'email is kept');
  assert.ok(!has(r.text, 'wrong-password'), 'password is never sent back');
  const unknown = await b.post('/login', { email: 'nobody@test.edu', password: 'whatever123' });
  assert.ok(has(unknown.text, 'Incorrect email or password.'), 'same message for unknown emails');
});

test('sign-in sets a safe session cookie and lands each role on its own page', async () => {
  const b = browser();
  const r = await b.post('/login', { email: 'lec@test.edu', password: 'Passw0rd!!' });
  assert.deepEqual([r.status, r.location], [302, '/courses']);
  const cookie = r.setCookies.find((c) => c.startsWith('token='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  const s = await browser().post('/login', { email: 'ada@test.edu', password: 'Passw0rd!!' });
  assert.equal(s.location, '/my');
  assert.equal((await b.get('/login')).location, '/courses', 'signed-in users skip the sign-in page');
});

test('student sign-up: errors keep what was typed; success signs in and shows a one-time welcome', async () => {
  const b = browser();
  const bad = await b.post('/register', { name: 'Eze Obi', email: 'eze@test.edu', password: 'short', matricNo: 'M777' });
  assert.equal(bad.status, 400);
  assert.ok(has(bad.text, 'Password must be at least 8 characters.'));
  assert.ok(has(bad.text, 'value="Eze Obi"') && has(bad.text, 'value="M777"'), 'typed values are kept');
  const dup = await b.post('/register', { name: 'X', email: 'ada@test.edu', password: 'longenough1', matricNo: 'M778' });
  assert.equal(dup.status, 409);

  const ok = await b.post('/register', { name: 'Eze Obi', email: 'eze@test.edu', password: 'longenough1', matricNo: 'm777', role: 'admin' });
  assert.deepEqual([ok.status, ok.location], [302, '/my']);
  const page = await b.get('/my');
  assert.ok(has(page.text, 'Your account was created'), 'welcome message shown once');
  assert.ok(has(page.text, 'not linked to a student record') === false, 'new sign-up is linked to its own record');
  assert.ok(!has((await b.get('/my')).text, 'Your account was created'), 'and not shown again');
  assert.equal((await b.get('/accounts')).status, 403, 'a "role" field in the form did not make them an admin');
});

test('role guards show a "Not allowed" page instead of the real page', async () => {
  for (const [who, path] of [[ctx.student, '/courses'], [ctx.student, '/students'], [ctx.student, '/accounts'], [ctx.student, `/courses/${ctx.course}/register`],
    [ctx.student, `/courses/${ctx.course}/report`], [ctx.lec, '/accounts'], [ctx.lec, '/courses/new'], [ctx.lec, '/students/new'], [ctx.admin, '/my']]) {
    const r = await who.get(path);
    assert.equal(r.status, 403, `${path}`);
    assert.ok(has(r.text, 'Not allowed'));
  }
  assert.equal((await ctx.student.post('/courses', { code: 'S 1', title: 'S' })).status, 403);
  assert.equal((await ctx.lec.post('/courses', { code: 'L 1', title: 'L' })).status, 403);
  assert.equal((await ctx.other.get(ctx.reg)).status, 403, "another lecturer's register: error page, no redirect loop");
  assert.equal((await ctx.other.post(ctx.reg, { date: dmy(1), [`status_${ctx.bola}`]: 'present' })).status, 403);
  assert.equal(await Attendance.countDocuments(), 0, 'nothing saved by refused requests');
});

test('courses: admin creates, edits and deletes through forms and confirmation pages', async () => {
  const list = await ctx.admin.get('/courses');
  assert.ok(has(list.text, 'CSC 301') && has(list.text, 'MTH 201'));
  assert.deepEqual((await ctx.lec.get('/courses')).text.includes('MTH 201'), false, 'lecturers see only their own courses');

  const form = await ctx.admin.get('/courses/new');
  assert.ok(has(form.text, 'Dr Lec'), 'lecturer drop-down is filled');
  let r = await ctx.admin.post('/courses', { code: ' phy 101 ', title: 'General Physics', lecturerId: ctx.lecId });
  assert.deepEqual([r.status, r.location], [302, '/courses']);
  r = await ctx.admin.get('/courses');
  assert.ok(has(r.text, 'Course PHY 101 created.') && has(r.text, 'General Physics'));

  r = await ctx.admin.post('/courses', { code: 'PHY 101', title: 'Dup' });
  assert.equal(r.status, 409);
  assert.ok(has(r.text, 'A course with that code already exists.') && has(r.text, 'value="Dup"'), 'error shown, input kept');
  r = await ctx.admin.post('/courses', { code: 'ZZ 1', title: 'Bad', lecturerId: ctx.ada });
  assert.equal(r.status, 400, 'a student record id is not a lecturer');

  const phy = await Course.findOne({ code: 'PHY 101' });
  r = await ctx.admin.post(`/courses/${phy._id}/edit`, { code: 'PHY 101', title: 'Physics I', lecturerId: '' });
  assert.equal(r.status, 302);
  assert.ok(has((await ctx.admin.get('/courses')).text, 'Physics I'));

  await Enrollment.create({ course: phy._id, student: ctx.bola });
  await Attendance.create({ course: phy._id, student: ctx.bola, date: '2026-01-05', status: 'present' });
  const confirm = await ctx.admin.get(`/courses/${phy._id}/delete`);
  assert.ok(has(confirm.text, 'Delete PHY 101?') && has(confirm.text, 'cannot be undone'));
  assert.equal((await ctx.lec.get(`/courses/${phy._id}/delete`)).status, 403);
  assert.equal(await Course.countDocuments({ code: 'PHY 101' }), 1, 'viewing the confirmation page deletes nothing');
  r = await ctx.admin.post(`/courses/${phy._id}/delete`, {}, { follow: true });
  assert.ok(has(r.text, 'PHY 101 deleted.'));
  assert.equal(await Enrollment.countDocuments({ course: phy._id }) + await Attendance.countDocuments({ course: phy._id }), 0);
});

test('the register page lists enrolled students and escapes hostile names', async () => {
  const r = await ctx.lec.get(ctx.reg);
  assert.equal(r.status, 200);
  assert.ok(has(r.text, 'Ada Obi') && has(r.text, 'Bola Ade'));
  assert.ok(!has(r.text, 'Not Enrolled'), 'only enrolled students are listed');
  assert.ok(!has(r.text, '<img src=x'), 'the hostile name is not rendered as HTML');
  assert.ok(has(r.text, '&lt;img src=x onerror=alert(1)&gt;'), 'it is shown as harmless text');
  assert.ok(has(r.text, `value="${dmy(0)}"`), 'date shown as DD-MM-YYYY');
  assert.ok(has(r.text, 'Not marked yet for this date.'));
  assert.equal((r.text.match(/type="radio"/g) || []).length, 9, '3 students x 3 statuses');
});

test('saving a register stores it, shows it back, and rejects bad input without saving', async () => {
  const day = dmy(2);
  const post = (form) => ctx.lec.post(ctx.reg, { date: day, intent: 'save', ...form });
  const flash = async (r) => (await ctx.lec.get(r.location)).text;

  // refusals: nothing may be saved
  let r = await post({});
  assert.ok(has(await flash(r), 'Mark at least one student before saving.'));
  r = await post({ [`status_${ctx.bola}`]: 'maybe' });
  assert.ok(has(await flash(r), 'Status must be one of'));
  r = await ctx.lec.post(ctx.reg, { date: '01-01-2999', [`status_${ctx.bola}`]: 'present' });
  assert.ok(has(await flash(r), 'future date'));
  r = await ctx.lec.post(ctx.reg, { date: '2026-01-05', [`status_${ctx.bola}`]: 'present' });
  assert.ok(has(await flash(r), 'DD-MM-YYYY'), 'the old year-first format is refused');
  assert.equal(await Attendance.countDocuments(), 0);

  // a real save
  r = await post({ [`status_${ctx.ada}`]: 'present', [`status_${ctx.bola}`]: 'late', [`status_${ctx.chi}`]: 'absent' });
  assert.deepEqual([r.status, r.location], [302, `${ctx.reg}?date=${day}`]);
  const page = await ctx.lec.get(r.location);
  assert.ok(has(page.text, `Saved 3 records for ${day}.`));
  assert.ok(has(page.text, 'already saved'));
  assert.ok(has(page.text, 'Update register'));
  assert.ok(new RegExp(`id="st-${ctx.bola}-late"[^>]* checked`).test(page.text), 'Bola shows as Late');
  assert.ok(!new RegExp(`id="st-${ctx.bola}-present"[^>]* checked`).test(page.text));
  const rec = await Attendance.findOne({ student: ctx.bola, date: iso(day) });
  assert.equal(rec.status, 'late');
  assert.equal(String(rec.markedBy), ctx.lecId);

  // correcting the same date updates the record; nobody else is touched
  r = await post({ [`status_${ctx.bola}`]: 'present' });
  assert.ok(has(await flash(r), 'Saved 1 record for'));
  assert.equal(await Attendance.countDocuments({ course: ctx.course, date: iso(day) }), 3, 'still one record per student');
  assert.equal((await Attendance.findOne({ student: ctx.bola, date: iso(day) })).status, 'present');
  assert.equal((await Attendance.findOne({ student: ctx.chi, date: iso(day) })).status, 'absent');
});

test('"save and mark everyone else present" fills only the unmarked students', async () => {
  const day = dmy(3);
  const r = await ctx.lec.post(ctx.reg, { date: day, intent: 'fill', [`status_${ctx.chi}`]: 'absent' });
  assert.equal(r.status, 302);
  const rows = Object.fromEntries((await Attendance.find({ course: ctx.course, date: iso(day) }).lean()).map((a) => [String(a.student), a.status]));
  assert.deepEqual(rows, { [ctx.ada]: 'present', [ctx.bola]: 'present', [ctx.chi]: 'absent' });
});

test('date navigation: previous/next links, typed dates, and bad dates', async () => {
  const day = dmy(2);
  const page = await ctx.lec.get(`${ctx.reg}?date=${day}`);
  assert.ok(has(page.text, `href="${ctx.reg}?date=${dmy(3)}"`), 'previous-day link');
  assert.ok(has(page.text, `href="${ctx.reg}?date=${dmy(1)}"`), 'next-day link');
  assert.ok(has(page.text, 'Today'));
  const today = await ctx.lec.get(ctx.reg);
  assert.ok(has(today.text, 'is-disabled'), 'cannot step past today');
  for (const [bad, message] of [['garbage', 'DD-MM-YYYY'], ['2026-01-05', 'DD-MM-YYYY'], ['31-02-2026', 'does not exist']]) {
    const r = await ctx.lec.get(`${ctx.reg}?date=${bad}`);
    assert.deepEqual([r.status, r.location], [302, ctx.reg], `${bad} bounces to today's register`);
    const shown = await ctx.lec.get(r.location);
    assert.equal(shown.status, 200, 'and that page loads (no redirect loop)');
    assert.ok(has(shown.text, message), `${bad} explains the problem: ${message}`);
  }
  const sessions = await ctx.lec.get(ctx.reg);
  assert.ok(has(sessions.text, dmy(2)) && has(sessions.text, dmy(3)), 'earlier sessions are listed as links');
});

test('enrolling and removing students through forms', async () => {
  const url = `/courses/${ctx.course}/students`;
  let r = await ctx.lec.get(url);
  assert.ok(has(r.text, 'Not Enrolled'), 'candidates drop-down offers students who are not enrolled');
  r = await ctx.lec.post(url, { studentId: ctx.outsider });
  assert.ok(has((await ctx.lec.get(r.location)).text, 'Student enrolled.'));
  r = await ctx.lec.post(url, { studentId: ctx.outsider });
  assert.ok(has((await ctx.lec.get(r.location)).text, 'already enrolled'), 'duplicate gives a message, not a crash');
  assert.equal((await ctx.other.post(url, { studentId: ctx.bola })).status, 403);
  r = await ctx.lec.post(`${url}/${ctx.outsider}/remove`, {});
  assert.ok(has((await ctx.lec.get(r.location)).text, 'past attendance is kept'));
  assert.equal(await Enrollment.countDocuments({ course: ctx.course, student: ctx.outsider }), 0);
});

test('the report page shows figures and the CSV download is safe', async () => {
  const r = await ctx.lec.get(`/courses/${ctx.course}/report`);
  assert.equal(r.status, 200);
  assert.ok(has(r.text, 'Sessions held') && has(r.text, 'Below 75%'));
  assert.ok(has(r.text, 'On track'), 'Ada: 2 of 2 sessions');
  assert.ok(has(r.text, 'Below 75%</span>'), 'a flagged student is marked');

  await Student.updateOne({ _id: ctx.bola }, { fullName: '=HYPERLINK("http://evil.example")' });
  const csv = await ctx.lec.get(`/courses/${ctx.course}/report.csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="CSC-301-attendance\.csv"/);
  assert.ok(csv.text.startsWith('"Matric No","Name","Present"'));
  assert.ok(csv.text.includes(`"'=HYPERLINK(""http://evil.example"")"`), 'formula neutralised');
  assert.equal((await ctx.other.get(`/courses/${ctx.course}/report.csv`)).status, 403);
  assert.equal((await ctx.student.get(`/courses/${ctx.course}/report.csv`)).status, 403);
});

test('students: lecturers look up, administrators manage', async () => {
  let r = await ctx.lec.get('/students?q=ada');
  assert.ok(has(r.text, 'Ada Obi') && !has(r.text, 'Not Enrolled'));
  assert.ok(has((await ctx.lec.get('/students?q=.*')).text, 'No matches'), 'search text is not treated as a pattern');
  assert.ok(has((await ctx.lec.get('/students?q=%3Cscript%3E')).text, '&lt;script&gt;'), 'search box echoes text escaped');
  assert.ok(!has(r.text, '/students/new'), 'lecturers get no add button');

  r = await ctx.admin.post('/students', { matricNo: 'm050', fullName: 'Dayo Bello', department: 'CS', level: '300' });
  assert.equal(r.status, 302);
  assert.ok(has((await ctx.admin.get('/students')).text, 'Dayo Bello added.'));
  r = await ctx.admin.post('/students', { matricNo: 'M050', fullName: 'Dup' });
  assert.equal(r.status, 409);
  const dayo = await Student.findOne({ matricNo: 'M050' });
  r = await ctx.admin.post(`/students/${dayo._id}/edit`, { matricNo: 'M050', fullName: 'Dayo Bello-Ade', department: 'SWE', level: '400' });
  assert.equal(r.status, 302);
  assert.equal((await Student.findById(dayo._id)).fullName, 'Dayo Bello-Ade');
  r = await ctx.admin.post(`/students/${dayo._id}/edit`, { matricNo: 'M050', fullName: 'X', accountEmail: 'nobody@test.edu' });
  assert.equal(r.status, 400);
  assert.ok(has(r.text, 'No student account was found'));
  assert.ok(has((await ctx.admin.get(`/students/${dayo._id}/delete`)).text, 'Delete Dayo Bello-Ade?'));
  assert.equal((await ctx.admin.post(`/students/${dayo._id}/delete`, {})).status, 302);
  assert.equal(await Student.countDocuments({ matricNo: 'M050' }), 0);
});

test('accounts: administrators create and delete logins; passwords are never echoed', async () => {
  let r = await ctx.admin.post('/accounts', { name: 'New Lec', email: 'newlec@test.edu', password: 'short', role: 'lecturer' });
  assert.equal(r.status, 400);
  assert.ok(has(r.text, 'value="newlec@test.edu"') && !has(r.text, 'value="short"'), 'values kept, password not');
  r = await ctx.admin.post('/accounts', { name: 'New Lec', email: 'newlec@test.edu', password: 'LecturerPass1', role: 'lecturer' });
  assert.equal(r.status, 302);
  assert.ok(has((await ctx.admin.get('/accounts')).text, 'Account created for New Lec.'));
  assert.equal((await ctx.admin.post('/accounts', { name: 'N', email: 'n@test.edu', password: 'LecturerPass1', role: 'superuser' })).status, 400);

  const me = await User.findOne({ email: 'admin@test.edu' });
  r = await ctx.admin.post(`/accounts/${me._id}/delete`, {}, { follow: true });
  assert.ok(has(r.text, 'You cannot delete your own account.'));
  const target = await User.findOne({ email: 'newlec@test.edu' });
  assert.ok(has((await ctx.admin.get(`/accounts/${target._id}/delete`)).text, 'signed out immediately'));
  assert.equal((await ctx.admin.post(`/accounts/${target._id}/delete`, {})).status, 302);
  assert.equal(await User.countDocuments({ email: 'newlec@test.edu' }), 0);
});

test('students see only their own attendance page', async () => {
  const r = await ctx.student.get('/my');
  assert.equal(r.status, 200);
  assert.ok(has(r.text, 'CSC 301') && has(r.text, 'Ada Obi') && has(r.text, 'Daily record'));
  assert.ok(!has(r.text, 'Bola Ade'), "nobody else's data is on the page");
  assert.ok(new RegExp(`\\d{2}-\\d{2}-\\d{4}`).test(r.text), 'dates shown as DD-MM-YYYY');

  const unlinked = await User.create({ name: 'No Record', email: 'norecord@test.edu', role: 'student', passwordHash: await bcrypt.hash('Passw0rd!!', 4) });
  const b = await signIn('norecord@test.edu');
  assert.ok(has((await b.get('/my')).text, 'not linked to a student record'));
  void unlinked;
});

test('signing out ends the session; a deleted user is signed out on the next click', async () => {
  const b = await signIn('lec@test.edu');
  assert.equal((await b.get('/courses')).status, 200);
  assert.equal((await b.get('/logout')).status, 404, 'signing out needs a POST, never a link');
  let r = await b.post('/logout', {}, { follow: true });
  assert.ok(has(r.text, 'You have been signed out.'));
  assert.deepEqual([(await b.get('/courses')).status, (await b.get('/courses')).location], [302, '/login']);

  const victim = await User.create({ name: 'Temp Lec', email: 'temp@test.edu', role: 'lecturer', passwordHash: await bcrypt.hash('Passw0rd!!', 4) });
  const t = await signIn('temp@test.edu');
  assert.equal((await t.get('/courses')).status, 200);
  await User.deleteOne({ _id: victim._id });
  r = await t.get('/courses', { follow: true });
  assert.ok(has(r.text, 'no longer exists'), 'sent to the sign-in page with an explanation');
  assert.equal((await t.get('/courses')).status, 302, 'and the stale cookie was cleared');
});

test('error pages are HTML for people and JSON for the API', async () => {
  let r = await ctx.lec.get('/no-such-page');
  assert.equal(r.status, 404);
  assert.ok(has(r.text, 'Page not found') && has(r.text, '<!doctype html>'));
  r = await ctx.lec.get('/courses/not-an-id/register');
  assert.equal(r.status, 400);
  assert.ok(has(r.text, 'not a valid id'));
  r = await ctx.lec.get('/courses/aaaaaaaaaaaaaaaaaaaaaaaa/register');
  assert.equal(r.status, 404);
  const api = await fetch(`${base}/api/nope`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-type'), /json/);
});
