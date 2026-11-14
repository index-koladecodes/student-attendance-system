'use strict';
const v = require('../validate');
const { Course, Student, User, Enrollment, Attendance } = require('../models');
const { courseOut, loadCourse, assertManage, assertView } = require('../access');
const { conflict, notFound, badRequest } = require('../errors');

// A lecturer id is optional, but if given it must belong to a lecturer account.
async function lecturerOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const id = v.id(value, 'lecturerId');
  if (!(await User.exists({ _id: id, role: 'lecturer' }))) throw badRequest('Choose a valid lecturer.');
  return id;
}

async function withCounts(courses) {
  return Promise.all(
    courses.map(async (c) => ({
      ...courseOut(c),
      enrolledCount: await Enrollment.countDocuments({ course: c._id }),
      sessions: (await Attendance.distinct('date', { course: c._id })).length,
    }))
  );
}

// Admin sees all courses, a lecturer their own, a student the ones they are enrolled in.
async function list(actor) {
  let filter = {};
  if (actor.role === 'lecturer') {
    filter = { lecturer: actor._id };
  } else if (actor.role === 'student') {
    const student = await Student.findOne({ user: actor._id }).select('_id').lean();
    const ids = student ? (await Enrollment.find({ student: student._id }).lean()).map((e) => e.course) : [];
    filter = { _id: { $in: ids } };
  }
  const courses = await Course.find(filter).sort({ code: 1 }).populate('lecturer', 'name').lean();
  return withCounts(courses);
}

async function create(input = {}) {
  const code = v.str(input.code, 'Course code', { max: 20 }).toUpperCase();
  const title = v.str(input.title, 'Course title', { max: 160 });
  const lecturer = await lecturerOrNull(input.lecturerId);
  if (await Course.exists({ code })) throw conflict('A course with that code already exists.');
  const course = await Course.create({ code, title, lecturer: lecturer || undefined });
  return loadCourse(course._id);
}

async function get(actor, rawId) {
  const course = await loadCourse(v.id(rawId));
  await assertView(actor, course);
  return course;
}

async function update(rawId, input = {}) {
  const id = v.id(rawId);
  const course = await Course.findById(id);
  if (!course) throw notFound('Course not found.');
  const code = v.str(input.code, 'Course code', { max: 20 }).toUpperCase();
  const title = v.str(input.title, 'Course title', { max: 160 });
  const lecturer = await lecturerOrNull(input.lecturerId);
  if (await Course.exists({ code, _id: { $ne: id } })) throw conflict('Another course already uses that code.');
  course.code = code;
  course.title = title;
  course.lecturer = lecturer || undefined; // undefined removes the assignment
  await course.save();
  return loadCourse(id);
}

async function remove(rawId) {
  const id = v.id(rawId);
  const { deletedCount } = await Course.deleteOne({ _id: id });
  if (!deletedCount) throw notFound('Course not found.');
  await Enrollment.deleteMany({ course: id });
  await Attendance.deleteMany({ course: id });
}

// ---- Enrollment ------------------------------------------------------------
async function enrolledStudents(actor, rawId) {
  const course = await loadCourse(v.id(rawId));
  assertManage(actor, course);
  const rows = await Enrollment.find({ course: course.id }).populate('student').lean();
  const students = rows
    .filter((r) => r.student)
    .map((r) => ({
      id: String(r.student._id),
      matricNo: r.student.matricNo,
      fullName: r.student.fullName,
      department: r.student.department ?? null,
      level: r.student.level ?? null,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { course, students };
}

async function enroll(actor, rawId, rawStudentId) {
  const course = await loadCourse(v.id(rawId));
  assertManage(actor, course);
  const studentId = v.id(rawStudentId, 'studentId');
  if (!(await Student.exists({ _id: studentId }))) throw notFound('Student not found.');
  if (await Enrollment.exists({ course: course.id, student: studentId })) throw conflict('Student is already enrolled.');
  try {
    await Enrollment.create({ course: course.id, student: studentId });
  } catch (err) {
    if (err.code === 11000) throw conflict('Student is already enrolled.'); // lost a race with another request
    throw err;
  }
}

// Un-enrolling keeps past attendance records, so history is not lost if the student is re-enrolled.
async function unenroll(actor, rawId, rawStudentId) {
  const course = await loadCourse(v.id(rawId));
  assertManage(actor, course);
  const { deletedCount } = await Enrollment.deleteOne({
    course: course.id,
    student: v.id(rawStudentId, 'studentId'),
  });
  if (!deletedCount) throw notFound('That student is not enrolled in this course.');
}

module.exports = { list, create, get, update, remove, enrolledStudents, enroll, unenroll };
