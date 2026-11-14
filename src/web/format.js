'use strict';
// Small helpers for dates (DD-MM-YYYY) and labels used by the page controllers and templates.
const v = require('../validate');

const pad = (n) => String(n).padStart(2, '0');
const toUtc = (dmy) => { const [d, m, y] = dmy.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fromUtc = (date) => `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}`;

const today = () => v.formatDate(v.todayString());
const shift = (dmy, days) => { const d = toUtc(dmy); d.setUTCDate(d.getUTCDate() + days); return fromUtc(d); };
const weekday = (dmy) => toUtc(dmy).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });

const ROLE = { admin: 'Administrator', lecturer: 'Lecturer', student: 'Student' };
const STATUS = { present: 'Present', late: 'Late', absent: 'Absent' };

// Where each kind of user lands after signing in.
const homePath = (user) => (user.role === 'student' ? '/my' : '/courses');

module.exports = { today, shift, weekday, ROLE, STATUS, homePath };
