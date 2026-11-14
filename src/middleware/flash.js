'use strict';
// One-time messages that survive a redirect ("Course created.") - shown once on the next page, then gone.
const config = require('../config');

const COOKIE = 'flash';
const options = () => ({ httpOnly: true, sameSite: 'strict', secure: config.isProduction, path: '/' });

function flash(req, res, next) {
  res.locals.flash = null;
  const raw = req.cookies && req.cookies[COOKIE];
  if (raw) {
    try {
      const msg = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
      if ((msg.type === 'ok' || msg.type === 'error') && typeof msg.text === 'string') {
        res.locals.flash = { type: msg.type, text: msg.text.slice(0, 300) };
      }
    } catch { /* ignore a damaged cookie */ }
    res.clearCookie(COOKIE, options());
  }
  // type: 'ok' | 'error'. Text is escaped when the page is rendered.
  res.flash = (type, text) => res.cookie(COOKIE, Buffer.from(JSON.stringify({ type, text })).toString('base64url'), { ...options(), maxAge: 60 * 1000 });
  next();
}

module.exports = flash;
