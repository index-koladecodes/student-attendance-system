'use strict';
// Administrator-only account management.
const bcrypt = require('bcryptjs');
const config = require('../config');
const v = require('../validate');
const { User, Student, Course } = require('../models');
const { conflict, notFound, badRequest } = require('../errors');

const out = (u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, createdAt: u.createdAt });

async function list(role) {
  const filter = role ? { role: v.role(String(role)) } : {};
  const users = await User.find(filter).sort({ role: 1, name: 1 }).lean();
  return users.map(out);
}

async function create(input = {}) {
  const name = v.str(input.name, 'Name');
  const email = v.email(input.email);
  const pw = v.password(input.password);
  const role = v.role(input.role);
  if (await User.exists({ email })) throw conflict('That email is already registered.');
  const user = await User.create({ name, email, role, passwordHash: await bcrypt.hash(pw, config.bcryptRounds) });
  return out(user);
}

async function remove(actor, rawId) {
  const id = v.id(rawId);
  if (id === actor.id) throw badRequest('You cannot delete your own account.');
  const { deletedCount } = await User.deleteOne({ _id: id });
  if (!deletedCount) throw notFound('User not found.');
  // MongoDB has no cascading deletes, so tidy the references here.
  await Course.updateMany({ lecturer: id }, { $unset: { lecturer: 1 } });
  await Student.updateMany({ user: id }, { $unset: { user: 1 } });
}

async function get(rawId) {
  const id = v.id(rawId);
  const user = await User.findById(id).lean();
  if (!user) throw notFound('User not found.');
  return out(user);
}

module.exports = { list, create, remove, get };
