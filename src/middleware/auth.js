'use strict';
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const config = require('../config');
const { User } = require('../models');
const { unauthorized, forbidden } = require('../errors');

const COOKIE_NAME = 'token';

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function cookieOptions() {
  return {
    httpOnly: true,               // not readable from browser JavaScript
    sameSite: 'strict',           // not sent on cross-site requests (CSRF defence)
    secure: config.isProduction,  // HTTPS only in production
    maxAge: config.cookieMaxAgeMs,
    path: '/',
  };
}

const setAuthCookie = (res, user) => res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
const clearAuthCookie = (res) => res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });

// Finds the signed-in user from the session cookie, or throws 401. Shared by the API and the web pages.
async function authenticate(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  if (!mongoose.isValidObjectId(payload.sub)) throw unauthorized();
  // Re-load from the database so deleted users and changed roles take effect immediately.
  const user = await User.findById(payload.sub).lean();
  if (!user) throw unauthorized('Your account no longer exists.');
  return { _id: user._id, id: String(user._id), name: user.name, email: user.email, role: user.role };
}

// Guard 1 (JSON API): must carry a valid session for an account that still exists, else 401.
async function requireAuth(req, res, next) {
  req.user = await authenticate(req);
  next();
}

// Guard 2: the signed-in user must hold one of the listed roles.
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) throw forbidden();
  next();
};

module.exports = { authenticate, requireAuth, requireRole, setAuthCookie, clearAuthCookie, signToken, COOKIE_NAME };
