'use strict';
const config = require('../config');
const v = require('../validate');
const { Student, User, Course, Enrollment, Attendance } = require('../models');
const { conflict, notFound, badRequest, forbidden } = require('../errors');
const { attendanceRate } = require('../stats');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const out = (s) => ({
  id: String(s._id),
  matricNo: s.matricNo,
  fullName: s.fullName,
  department: s.department ?? null,
  level: s.level ?? null,
  accountEmail: s.user && s.user.email ? s.user.email : null,
});

const findOne = (id) => Student.findById(id).populate('user', 'email').lean();

async function list(query) {
  const q = typeof query === 'string' ? query.trim().slice(0, 60) : '';
  const filter = q
    ? { $or: [{ fullName: new RegExp(escapeRegex(q), 'i') }, { matricNo: new RegExp(escapeRegex(q), 'i') }] }
    : {};
  const students = await Student.find(filter).sort({ fullName: 1 }).limit(1000).populate('user', 'email').lean();
  return students.map(out);
}

async function get(rawId) {
  const student = await findOne(v.id(rawId));
  if (!student) throw notFound('Student not found.');
  return out(student);
}

// The student record that belongs to a login account (null if none yet).
async function forUser(userId) {
  const s = await Student.findOne({ user: userId }).populate('user', 'email').lean();
  return s ? out(s) : null;
}

async function create(input = {}) {
  const matricNo = v.str(input.matricNo, 'Matric number', { max: 40 }).toUpperCase();
  const fullName = v.str(input.fullName, 'Full name');
  const department = v.str(input.department, 'Department', { optional: true });
  const level = v.str(input.level, 'Level', { optional: true, max: 20 });
  if (await Student.exists({ matricNo })) throw conflict('A student with that matric number already exists.');
  const student = await Student.create({ matricNo, fullName, department, level });
  return out(await findOne(student._id));
}

async function update(rawId, input = {}) {
  const id = v.id(rawId);
  const student = await Student.findById(id);
  if (!student) throw notFound('Student not found.');
  const matricNo = v.str(input.matricNo, 'Matric number', { max: 40 }).toUpperCase();
  const fullName = v.str(input.fullName, 'Full name');
  const department = v.str(input.department, 'Department', { optional: true });
  const level = v.str(input.level, 'Level', { optional: true, max: 20 });

  if (await Student.exists({ matricNo, _id: { $ne: id } })) {
    throw conflict('Another student already uses that matric number.');
  }

  // Optionally link this record to an existing student login (by email).
  if (typeof input.accountEmail === 'string' && input.accountEmail.trim()) {
    const account = await User.findOne({ email: input.accountEmail.trim().toLowerCase() }).lean();
    if (!account || account.role !== 'student') throw badRequest('No student account was found with that email.');
    if (await Student.exists({ user: account._id, _id: { $ne: id } })) {
      throw conflict('That account is already linked to another student record.');
    }
    student.user = account._id;
  }

  Object.assign(student, { matricNo, fullName, department, level });
  await student.save();
  return out(await findOne(id));
}

async function remove(rawId) {
  const id = v.id(rawId);
  const { deletedCount } = await Student.deleteOne({ _id: id });
  if (!deletedCount) throw notFound('Student not found.');
  // MongoDB has no cascading deletes: remove the student's enrollments and attendance too.
  await Enrollment.deleteMany({ student: id });
  await Attendance.deleteMany({ student: id });
}

// One student's attendance in each course they are enrolled in: counts, rate and daily records.
// Students may open only their own; a lecturer sees only the courses they teach.
async function attendanceFor(actor, rawId) {
  const id = v.id(rawId);
  const student = await findOne(id);
  if (!student) throw notFound('Student not found.');
  if (actor.role === 'student' && String(student.user && student.user._id) !== actor.id) throw forbidden();

  const enrolments = await Enrollment.find({ student: id }).lean();
  const courseFilter = { _id: { $in: enrolments.map((e) => e.course) } };
  if (actor.role === 'lecturer') courseFilter.lecturer = actor._id;
  const courses = await Course.find(courseFilter).sort({ code: 1 }).lean();

  const result = await Promise.all(
    courses.map(async (c) => {
      const [mine, sessionDates] = await Promise.all([
        Attendance.find({ course: c._id, student: id }).select('date status').lean(),
        Attendance.distinct('date', { course: c._id }),
      ]);
      const count = (status) => mine.filter((r) => r.status === status).length;
      const present = count('present');
      const late = count('late');
      const rate = attendanceRate(present, late, sessionDates.length);
      return {
        id: String(c._id),
        code: c.code,
        title: c.title,
        sessions: sessionDates.length,
        present,
        late,
        absent: count('absent'),
        rate,
        belowThreshold: rate !== null && rate < config.attendanceThreshold,
        records: mine
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((r) => ({ date: v.formatDate(r.date), status: r.status })),
      };
    })
  );
  return { student: out(student), threshold: config.attendanceThreshold, courses: result };
}

module.exports = { list, get, forUser, create, update, remove, attendanceFor };
