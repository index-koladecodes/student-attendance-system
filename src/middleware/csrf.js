'use strict';
// CSRF protection for the HTML forms ("double-submit cookie").
// Every form carries a hidden _csrf field that must equal the csrf cookie. A page on another site can
// make the browser send our cookies, but it cannot read the cookie to copy its value into the form.
// (The session cookie is also SameSite=Strict, which blocks most cross-site requests outright.)
const crypto = require('crypto');
const config = require('../config');
const { forbidden } = require('../errors');

const COOKIE = 'csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrf(req, res, next) {
  let token = req.cookies && req.cookies[COOKIE];
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config.isProduction, path: '/' });
  }
  res.locals.csrfToken = token;

  if (!SAFE_METHODS.has(req.method)) {
    const sent = req.body && req.body._csrf;
    const ok = typeof sent === 'string' && sent.length === token.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token));
    if (!ok) throw forbidden('This form has expired or is not valid. Go back, refresh the page and try again.');
  }
  next();
}

module.exports = csrf;
