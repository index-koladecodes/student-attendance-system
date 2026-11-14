'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { errorHandler, notFoundHandler, pageNotFound } = require('./errors');
const webRoutes = require('./web');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const studentRoutes = require('./routes/students');
const courseRoutes = require('./routes/courses');
const attendanceRoutes = require('./routes/attendance');

function createApp({ rateLimiting = true } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));                                          // JSON API bodies
  app.use(express.urlencoded({ extended: false, limit: '100kb', parameterLimit: 5000 })); // HTML form posts
  app.use(cookieParser());

  const publicDir = path.join(__dirname, '..', 'public');
  if (fs.existsSync(publicDir)) app.use(express.static(publicDir));                  // CSS

  // Slow down password guessing on the credential endpoints.
  const limiter = rateLimiting
    ? rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many attempts. Try again in a few minutes.' },
      })
    : (req, res, next) => next();

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRoutes({ limiter }));
  app.use('/api/users', userRoutes());
  app.use('/api/students', studentRoutes());
  app.use('/api/courses', courseRoutes());
  app.use('/api/courses', attendanceRoutes());
  app.use('/api', notFoundHandler);

  // Defaults so every template can rely on these existing (the web routes fill them in).
  app.use((req, res, next) => {
    Object.assign(res.locals, { user: null, flash: null, csrfToken: '', nav: '' });
    next();
  });
  app.use('/', webRoutes({ limiter }));
  app.use(pageNotFound);

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
