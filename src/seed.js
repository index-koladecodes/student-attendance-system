'use strict';
// Usage:
//   npm run seed        -> creates the first admin account only
//   npm run seed:demo   -> also loads sample lecturers, students, courses and six weeks of attendance
//                          (all demo accounts share the password below: LOCAL USE ONLY)
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { connectDB, mongoose } = require('./db');
const { User, Student, Course, Enrollment, Attendance } = require('./models');
const { todayString } = require('./validate');

const DEMO_PASSWORD = 'Password123!';
const demo = process.argv.includes('--demo');
const hash = (pw) => bcrypt.hash(pw, config.bcryptRounds);

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@school.edu').toLowerCase();
  if (await User.exists({ email })) return console.log(`Admin ${email} already exists - skipped.`);
  const generated = !process.env.ADMIN_PASSWORD;
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  await User.create({ name: process.env.ADMIN_NAME || 'System Admin', email, role: 'admin', passwordHash: await hash(pw) });
  console.log(`Created admin: ${email}`);
  if (generated) console.log(`Generated password (shown once): ${pw}`);
}

async function seedDemo() {
  if (await User.exists({ email: 'lecturer1@school.edu' })) return console.log('Demo data already loaded - skipped.');
  const passwordHash = await hash(DEMO_PASSWORD);
  const [lec1, lec2, stu1, stu2] = await User.create([
    { name: 'Dr. Ayodele Bankole', email: 'lecturer1@school.edu', role: 'lecturer', passwordHash },
    { name: 'Mrs. Hauwa Garba', email: 'lecturer2@school.edu', role: 'lecturer', passwordHash },
    { name: 'Amina Yusuf', email: 'student1@school.edu', role: 'student', passwordHash },
    { name: 'Chinedu Okafor', email: 'student2@school.edu', role: 'student', passwordHash },
  ]);

  const names = ['Amina Yusuf', 'Chinedu Okafor', 'Fatima Bello', 'Tunde Adeyemi', 'Ngozi Eze', 'Ibrahim Musa',
    'Kemi Balogun', 'Emeka Nwosu', 'Zainab Lawal', 'Segun Ogunleye', 'Halima Abubakar', 'David Okoro'];
  const students = await Student.create(names.map((fullName, i) => ({
    ...(i === 0 ? { user: stu1._id } : i === 1 ? { user: stu2._id } : {}),
    matricNo: `CSC/24/${String(i + 1).padStart(4, '0')}`, fullName, department: 'Computer Science', level: '300',
  })));

  const courses = await Course.create([
    { code: 'CSC 301', title: 'Data Structures and Algorithms', lecturer: lec1._id },
    { code: 'CSC 305', title: 'Database Management Systems', lecturer: lec1._id },
    { code: 'MTH 201', title: 'Linear Algebra', lecturer: lec2._id },
  ]);

  // Deterministic pseudo-random attendance over the last six weekly sessions.
  let seed = 42;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const dates = [6, 5, 4, 3, 2, 1].map((w) => { const d = new Date(); d.setDate(d.getDate() - w * 7); return todayString(d); });

  const enrolments = [];
  const marks = [];
  courses.forEach((course, ci) => {
    const lecturer = ci < 2 ? lec1 : lec2;
    students.forEach((student, si) => {
      if (ci === 2 && si % 3 === 0) return; // not everyone takes every course
      enrolments.push({ course: course._id, student: student._id });
      const reliability = 0.5 + ((si * 7) % 10) / 22; // varied attendance habits
      for (const date of dates) {
        const r = rand();
        const status = r < reliability ? 'present' : r < reliability + 0.1 ? 'late' : 'absent';
        marks.push({ course: course._id, student: student._id, date, status, markedBy: lecturer._id });
      }
    });
  });
  await Enrollment.insertMany(enrolments);
  await Attendance.insertMany(marks);

  console.log('Demo data loaded.');
  console.log(`Demo logins (password for all: ${DEMO_PASSWORD}):`);
  console.log('  lecturer1@school.edu, lecturer2@school.edu, student1@school.edu, student2@school.edu');
}

(async () => {
  await connectDB(config.mongoUri);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await seedAdmin();
  if (demo) await seedDemo();
  await mongoose.disconnect();
})().catch((err) => { console.error('Seeding failed:', err.message); process.exit(1); });
