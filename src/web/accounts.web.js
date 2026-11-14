'use strict';
// Pages: administrator-only account management.
const express = require('express');
const users = require('../services/users.service');
const { requireRole } = require('../middleware/auth');
const { formError, flashAndRedirect } = require('./helpers');

module.exports = function accountPages() {
  const router = express.Router();
  router.use('/accounts', requireRole('admin'));

  router.get('/accounts', async (req, res) => res.render('accounts/index', { nav: 'accounts', accounts: await users.list() }));

  router.get('/accounts/new', (req, res) => res.render('accounts/form', { nav: 'accounts', error: null, values: { role: 'lecturer' } }));
  router.post('/accounts', async (req, res) => {
    try {
      const u = await users.create(req.body || {});
      res.flash('ok', `Account created for ${u.name}.`);
      res.redirect('/accounts');
    } catch (err) {
      const { password, ...keep } = req.body || {}; // never send the password back to the page
      formError(res, 'accounts/form', err, { nav: 'accounts', values: keep });
    }
  });

  router.get('/accounts/:id/delete', async (req, res) => {
    const u = await users.get(req.params.id);
    res.render('confirm', {
      nav: 'accounts', heading: `Delete the account for ${u.name}?`, confirmLabel: 'Delete account',
      message: `${u.email} will be signed out immediately and will no longer be able to sign in.`,
      action: `/accounts/${u.id}/delete`, cancelUrl: '/accounts',
    });
  });
  router.post('/accounts/:id/delete', async (req, res) => {
    try {
      const u = await users.get(req.params.id);
      await users.remove(req.user, req.params.id);
      res.flash('ok', `Account for ${u.name} deleted.`);
      res.redirect('/accounts');
    } catch (err) { flashAndRedirect(res, err, '/accounts'); }
  });

  return router;
};
