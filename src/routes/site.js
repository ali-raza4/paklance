'use strict';
/*
 *   GET /api/health      → { ok: true }
 *   GET /api/config      public settings the frontend needs (Google client id, fees, payment methods)
 *   GET /api/dashboard   signed-in summary: counts, wallet balance, jobs that match my skills
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const { h } = require('../lib/errors');
const present = require('../lib/present');
const pay = require('../lib/payments');
const money = require('../services/money');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/health', h(async (req, res) => {
  await db.raw('select 1');
  res.json({ ok: true });
}));

router.get('/config', (req, res) => {
  res.json({
    // Only offered when the server can finish the sign-in (client id + secret).
    googleClientId: config.google.clientId && config.google.clientSecret ? config.google.clientId : null,
    currency: 'PKR',
    fees: { clientPercent: config.fees.clientPercent, specialistPercent: config.fees.specialistPercent },
    minWithdrawal: config.payments.minWithdrawal,
    uploads: {
      photoMaxMb: Math.round(config.uploads.photoMaxBytes / 1048576),
      videoMaxMb: Math.round(config.uploads.videoMaxBytes / 1048576),
      videoMaxSeconds: config.uploads.videoMaxSeconds
    },
    paymentMethods: pay.METHODS
  });
});

router.get('/dashboard', requireAuth, h(async (req, res) => {
  const uid = req.user.id;
  const skills = db.json(req.user.skills, []).map((s) => s.toLowerCase());
  const open = await db('jobs').where({ status: 'open' }).where((b) => b.whereNull('client_id').orWhereNot({ client_id: uid })).orderBy('created_at', 'desc').limit(200);
  const scored = open
    .map((j) => {
      const hay = (j.title + ' ' + j.category + ' ' + j.skills).toLowerCase();
      return { j, s: skills.filter((w) => hay.includes(w)).length };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.j);
  const ms = scored.length ? await db('job_milestones').whereIn('job_id', scored.map((j) => j.id)).orderBy('position') : [];
  const wallet = await money.balances(uid);
  res.json({
    user: present.user(req.user),
    counts: {
      activeContracts: await db.count(db('contracts').where({ status: 'active' }).where((b) => b.where({ client_id: uid }).orWhere({ freelancer_id: uid }))),
      openProposals: await db.count(db('proposals').where({ freelancer_id: uid, status: 'submitted' })),
      postedJobs: await db.count(db('jobs').where({ client_id: uid, status: 'open' })),
      unreadNotifications: await db.count(db('notifications').where({ user_id: uid }).whereNull('read_at'))
    },
    wallet: { available: wallet.available, locked: wallet.locked },
    hasProfile: !!(await db('talent_profiles').where({ user_id: uid }).first()),
    matchedJobs: scored.map((j) => present.job(j, ms.filter((m) => m.job_id === j.id)))
  });
}));

module.exports = router;
