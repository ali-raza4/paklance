'use strict';
/*
 * Operations API for the Paklance team (role admin, or an email listed in ADMIN_EMAILS).
 * The same actions are available from the command line: see scripts/admin.js.
 *
 *   GET  /api/admin/overview
 *   GET  /api/admin/payments?status=pending
 *   POST /api/admin/payments/:id/confirm          { bankReference? }   money seen on the escrow account
 *   POST /api/admin/payments/:id/cancel
 *   GET  /api/admin/withdrawals?status=requested
 *   POST /api/admin/withdrawals/:id/status        { status: 'processing' | 'paid' | 'rejected', note? }
 *   GET  /api/admin/disputes?status=open
 *   POST /api/admin/disputes/:id/resolve          { outcome: 'release' | 'refund' | 'dismiss', note? }
 *   POST /api/admin/users/:id/identity            { verified: true | false }
 *   GET  /api/admin/newsletter                    subscribers
 */
const express = require('express');
const db = require('../db');
const { E, h } = require('../lib/errors');
const { Check, idParam } = require('../lib/validate');
const money = require('../services/money');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use('/admin', requireAdmin);

router.get('/admin/overview', h(async (req, res) => {
  res.json({
    users: await db.count(db('users').where({ is_sample: false })),
    openJobs: await db.count(db('jobs').where({ status: 'open', is_sample: false })),
    activeContracts: await db.count(db('contracts').where({ status: 'active' })),
    pendingPayments: await db.count(db('payments').where({ status: 'pending' })),
    pendingWithdrawals: await db.count(db('withdrawals').whereIn('status', ['requested', 'processing'])),
    openDisputes: await db.count(db('disputes').whereNot({ status: 'resolved' })),
    subscribers: await db.count(db('newsletter_subscribers').where({ status: 'subscribed' }))
  });
}));

router.get('/admin/payments', h(async (req, res) => {
  const rows = await db('payments as p')
    .join('contracts as c', 'c.id', 'p.contract_id')
    .join('milestones as m', 'm.id', 'p.milestone_id')
    .join('users as u', 'u.id', 'p.payer_id')
    .where('p.status', String(req.query.status || 'pending'))
    .orderBy('p.created_at', 'asc')
    .select('p.*', 'c.code', 'm.title as milestone_title', 'u.email as payer_email', 'u.full_name as payer_name');
  res.json({ payments: rows.map((p) => ({ id: p.id, reference: p.reference, method: p.method, amount: p.amount, fee: p.fee, total: p.total, status: p.status, contract: p.code, milestone: p.milestone_title, payer: { email: p.payer_email, name: p.payer_name }, createdAt: p.created_at })) });
}));

router.post('/admin/payments/:id/confirm', h(async (req, res) => {
  const id = idParam(req.params.id);
  const c = new Check(req.body);
  const bankReference = c.text('bankReference', { min: 2, max: 80, label: 'Bank reference', optional: true });
  c.done();
  await db.transaction((trx) => money.confirmPayment(trx, id, { adminId: req.user.id, bankReference }));
  res.json({ ok: true });
}));

router.post('/admin/payments/:id/cancel', h(async (req, res) => {
  await db.transaction((trx) => money.cancelPayment(trx, idParam(req.params.id)));
  res.json({ ok: true });
}));

router.get('/admin/withdrawals', h(async (req, res) => {
  const q = db('withdrawals as w').join('users as u', 'u.id', 'w.user_id').orderBy('w.created_at', 'asc')
    .select('w.*', 'u.email', 'u.full_name');
  if (req.query.status) q.where('w.status', String(req.query.status)); else q.whereIn('w.status', ['requested', 'processing']);
  const rows = await q;
  // Full account numbers are included here because the finance team needs them to make the transfer.
  res.json({ withdrawals: rows.map((w) => ({ id: w.id, user: { email: w.email, name: w.full_name }, channel: w.channel, accountTitle: w.account_title, accountNumber: w.account_number, bankName: w.bank_name, amount: w.amount, status: w.status, note: w.admin_note, createdAt: w.created_at })) });
}));

router.post('/admin/withdrawals/:id/status', h(async (req, res) => {
  const c = new Check(req.body);
  const status = c.oneOf('status', ['processing', 'paid', 'rejected'], { label: 'Status' });
  const note = c.text('note', { min: 2, max: 300, label: 'Note', optional: true });
  c.done();
  await db.transaction((trx) => money.setWithdrawalStatus(trx, idParam(req.params.id), status, note));
  res.json({ ok: true });
}));

router.get('/admin/disputes', h(async (req, res) => {
  const q = db('disputes as d').join('contracts as c', 'c.id', 'd.contract_id').leftJoin('milestones as m', 'm.id', 'd.milestone_id')
    .orderBy('d.created_at', 'asc').select('d.*', 'c.code', 'm.title as milestone_title', 'm.amount as milestone_amount');
  if (req.query.status) q.where('d.status', String(req.query.status)); else q.whereNot('d.status', 'resolved');
  const rows = await q;
  res.json({ disputes: rows.map((d) => ({ id: d.id, contract: d.code, milestone: d.milestone_title, amount: d.milestone_amount, issue: d.issue, description: d.description, status: d.status, outcome: d.outcome, createdAt: d.created_at })) });
}));

router.post('/admin/disputes/:id/resolve', h(async (req, res) => {
  const c = new Check(req.body);
  const outcome = c.oneOf('outcome', ['release', 'refund', 'dismiss'], { label: 'Outcome' });
  const note = c.text('note', { min: 2, max: 2000, label: 'Note', optional: true, multiline: true });
  c.done();
  await db.transaction((trx) => money.resolveDispute(trx, idParam(req.params.id), outcome, note));
  res.json({ ok: true });
}));

router.post('/admin/users/:id/identity', h(async (req, res) => {
  const u = await db('users').where({ id: String(req.params.id) }).first();
  if (!u) throw E.notFound('User not found.');
  const verified = !!(req.body && req.body.verified);
  await db.transaction(async (trx) => {
    await trx('users').where({ id: u.id }).update({ identity_verified: verified, updated_at: db.now() });
    await trx('jobs').where({ client_id: u.id }).update({ client_verified: verified });
    await trx('talent_profiles').where({ user_id: u.id }).update({ verified });
  });
  res.json({ ok: true });
}));

router.get('/admin/newsletter', h(async (req, res) => {
  const rows = await db('newsletter_subscribers').orderBy('created_at', 'desc');
  res.json({ subscribers: rows.map((s) => ({ email: s.email, status: s.status, source: s.source, createdAt: s.created_at })) });
}));

module.exports = router;
