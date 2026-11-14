'use strict';
const { Course, Student, Enrollment } = require('./models');
const { notFound, forbidden } = require('./errors');

// Shape a course document for API responses.
function courseOut(c) {
  return {
    id: String(c._id),
    code: c.code,
    title: c.title,
    lecturerId: c.lecturer && c.lecturer._id ? String(c.lecturer._id) : null,
    lecturerName: c.lecturer && c.lecturer.name ? c.lecturer.name : null,
  };
}

async function loadCourse(id) {
  const course = await Course.findById(id).populate('lecturer', 'name').lean();
  if (!course) throw notFound('Course not found.');
  return courseOut(course);
}

// Administrators manage every course; a lecturer manages only the courses assigned to them.
const canManage = (user, course) =>
  user.role === 'admin' || (user.role === 'lecturer' && course.lecturerId === user.id);

function assertManage(user, course) {
  if (!canManage(user, course)) throw forbidden('You do not manage this course.');
}

// Viewing is allowed for managers and for students enrolled in the course.
async function assertView(user, course) {
  if (canManage(user, course)) return;
  if (user.role === 'student') {
    const student = await Student.findOne({ user: user._id }).select('_id').lean();
    if (student && (await Enrollment.exists({ course: course.id, student: student._id }))) return;
  }
  throw forbidden('You do not have access to this course.');
}

module.exports = { courseOut, loadCourse, canManage, assertManage, assertView };
