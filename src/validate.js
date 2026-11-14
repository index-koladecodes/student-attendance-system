'use strict';
const mongoose = require('mongoose');
const { badRequest } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUSES = ['present', 'late', 'absent'];
const ROLES = ['admin', 'lecturer', 'student'];

function str(value, field, { min = 1, max = 120, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw badRequest(`${field} is required.`);
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  const v = value.trim();
  if (v.length < min) throw badRequest(`${field} must be at least ${min} character(s).`);
  if (v.length > max) throw badRequest(`${field} must be at most ${max} characters.`);
  return v;
}

function email(value) {
  const v = str(value, 'Email', { max: 160 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw badRequest('Enter a valid email address.');
  return v;
}

function password(value) {
  if (typeof value !== 'string' || value.length < 8) {
    throw badRequest('Password must be at least 8 characters.');
  }
  if (value.length > 72) throw badRequest('Password must be at most 72 characters.'); // bcrypt limit
  return value;
}

// MongoDB ObjectId as a 24-character hex string
function id(value, field = 'id') {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{24}$/.test(value) || !mongoose.isValidObjectId(value)) {
    throw badRequest(`${field} is not a valid id.`);
  }
  return value;
}

function role(value) {
  if (!ROLES.includes(value)) throw badRequest(`Role must be one of: ${ROLES.join(', ')}.`);
  return value;
}

function status(value) {
  if (!STATUSES.includes(value)) throw badRequest(`Status must be one of: ${STATUSES.join(', ')}.`);
  return value;
}

// Local calendar date as YYYY-MM-DD
function todayString(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DISPLAY_DATE_RE = /^(\d{2})-(\d{2})-(\d{4})$/;

// Accepts a date typed as DD-MM-YYYY and returns the stored form, YYYY-MM-DD.
// (Stored year-first so that text order = calendar order for sorting and reports.)
function date(value, { allowFuture = false } = {}) {
  const m = typeof value === 'string' ? DISPLAY_DATE_RE.exec(value) : null;
  if (!m) throw badRequest('Date must be in DD-MM-YYYY format (for example 05-01-2026).');
  const [, dd, mm, yyyy] = m;
  const parsed = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (
    parsed.getUTCFullYear() !== Number(yyyy) ||
    parsed.getUTCMonth() !== Number(mm) - 1 ||
    parsed.getUTCDate() !== Number(dd)
  ) {
    throw badRequest('That date does not exist.');
  }
  const stored = `${yyyy}-${mm}-${dd}`;
  if (!allowFuture && stored > todayString()) {
    throw badRequest('Attendance cannot be recorded for a future date.');
  }
  return stored;
}

// Stored YYYY-MM-DD -> DD-MM-YYYY for display in responses.
function formatDate(stored) {
  const [y, m, d] = String(stored).split('-');
  return `${d}-${m}-${y}`;
}

module.exports = { str, email, password, id, role, status, date, formatDate, todayString, STATUSES, ROLES };
