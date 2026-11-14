'use strict';
require('dotenv').config();
const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProduction) {
    console.error('FATAL: JWT_SECRET must be set when NODE_ENV=production.');
    process.exit(1);
  }
  jwtSecret = crypto.randomBytes(48).toString('hex');
  console.warn('[config] JWT_SECRET not set - using a temporary secret for this run.');
}

module.exports = {
  isProduction,
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/attendance',
  jwtSecret,
  jwtExpiresIn: '8h',
  cookieMaxAgeMs: 8 * 60 * 60 * 1000,
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
  attendanceThreshold: Number(process.env.ATTENDANCE_THRESHOLD) || 75,
};
