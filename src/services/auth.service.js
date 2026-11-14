'use strict';
// Business rules for accounts and sign-in. Used by both the web pages and the JSON API.
const bcrypt = require('bcryptjs');
const config = require('../config');
const v = require('../validate');
const { User, Student } = require('../models');
const { conflict, unauthorized } = require('../errors');

// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

async function publicUser(user) {
  const out = { id: String(user._id), name: user.name, email: user.email, role: user.role };
  if (user.role === 'student') {
    const s = await Student.findOne({ user: user._id }).lean();
    out.student = s ? { id: String(s._id), matricNo: s.matricNo, department: s.department, level: s.level } : null;
  }
  return out;
}

// Self-registration creates STUDENT accounts only; any "role" in the input is ignored.
async function register(input = {}) {
  const name = v.str(input.name, 'Name');
  const email = v.email(input.email);
  const pw = v.password(input.password);
  const matric = v.str(input.matricNo, 'Matric number', { max: 40 }).toUpperCase();
  const department = v.str(input.department, 'Department', { optional: true });
  const level = v.str(input.level, 'Level', { optional: true, max: 20 });

  if (await User.exists({ email })) throw conflict('That email is already registered.');
  if (await Student.exists({ matricNo: matric })) {
    throw conflict('That matric number is already on record. Ask an administrator to link it to your account.');
  }

  const user = await User.create({ name, email, role: 'student', passwordHash: await bcrypt.hash(pw, config.bcryptRounds) });
  try {
    await Student.create({ user: user._id, matricNo: matric, fullName: name, department, level });
  } catch (err) {
    await User.deleteOne({ _id: user._id }); // keep the two collections consistent
    throw err;
  }
  return user;
}

async function login(input = {}) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const pw = typeof input.password === 'string' ? input.password : '';
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = await bcrypt.compare(pw, user ? user.passwordHash : DUMMY_HASH);
  // Same message for "no such user" and "wrong password".
  if (!user || !ok) throw unauthorized('Incorrect email or password.');
  return user;
}

module.exports = { publicUser, register, login };
