'use strict';
/*
 * Contracts, milestones and SafePay™ escrow.
 *
 *   GET  /api/contracts                                      my contracts (as client or specialist)
 *   GET  /api/contracts/:id
 *   POST /api/contracts/:id/milestones/:mid/fund             client  { method: 'bank_transfer' | 'raast' }
 *        → transfer instructions + reference. JazzCash/Easypaisa → 409 GATEWAY_COMING_SOON.
 *        The milestone becomes "funded" only after the transfer is confirmed (admin / bank webhook).
 *   POST /api/contracts/:id/milestones/:mid/cancel-funding   client (while the transfer is still pending)
 *   POST /api/contracts/:id/milestones/:mid/submit           specialist { note? }
 *   POST /api/contracts/:id/milestones/:mid/request-changes  client { note }
 *   POST /api/contracts/:id/milestones/:mid/approve          client → releases the money to the specialist's wallet
 *   POST /api/contracts/:id/review                           either side, once the contract is completed
 *        { stars: 1–5, text }  The client rates the specialist ("as a freelancer"); the specialist rates the client
 *        ("as a client"). One review each, shown on the other person's profile.
 *   Every contract includes review: { canReview, mine, theirs } for the viewer.
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const { E, h } = require('../lib/errors');
const { Check, idParam } = require('../lib/validate');
const present = require('../lib/present');
const sec = require('../lib/security');
const mailer = require('../lib/mailer');
const emails = require('../lib/emails');
const pay = require('../lib/payments');
const money = require('../services/money');
const { notify } = require('../services/notify');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use('/contracts', requireAuth);

async function names(c) {
  const users = await db('users').whereIn('id', [c.client_id, c.freelancer_id]).select('id', 'full_name', 'identity_verified');
  const by = {};
  users.forEach((u) => { by[u.id] = u; });
  const cl = by[c.client_id] || {};
  const fr = by[c.freelancer_id] || {};
  return {
    client: c.client_label || cl.full_name,
    clientVerified: db.bool(cl.identity_verified),
    freelancer: fr.full_name,
    freelancerVerified: db.bool(fr.identity_verified)
  };
}

async function full(c, viewerId) {
  const ms = await db('milestones').where({ contract_id: c.id }).orderBy('position');
  const out = present.contract(c, ms, viewerId, await names(c));
  const pending = await db('payments').where({ contract_id: c.id, status: 'pending' }).select('milestone_id', 'reference', 'total', 'method');
  out.pendingPayments = pending.map((p) => ({ milestoneId: p.milestone_id, reference: p.reference, total: p.total, method: p.method }));
  out.openDisputes = await db.count(db('disputes').where({ contract_id: c.id }).whereNot({ status: 'resolved' }));
  const rv = await db('reviews').where({ contract_id: c.id }).select('reviewer_id', 'stars', 'text', 'created_at');
  const pick = (r) => (r ? { stars: Number(r.stars), text: r.text, createdAt: r.created_at } : null);
  const mine = rv.find((r) => r.reviewer_id === viewerId);
  const party = viewerId === c.client_id || viewerId === c.freelancer_id;
  out.review = {
    canReview: party && c.status === 'completed' && !db.bool(c.is_sample) && !mine,
    mine: pick(mine),
    theirs: party ? pick(rv.find((r) => r.reviewer_id !== viewerId)) : null
  };
  return out;
}

async function loadContract(req) {
  const id = idParam(req.params.id);
  const c = id && (await db('contracts').where({ id }).first());
  if (!c || (c.client_id !== req.user.id && c.freelancer_id !== req.user.id && !req.user.isAdmin)) throw E.notFound('Contract not found.');
  return c;
}

async function loadMilestone(req, c) {
  const mid = idParam(req.params.mid);
  const m = mid && (await db('milestones').where({ id: mid, contract_id: c.id }).first());
  if (!m) throw E.notFound('Milestone not found.');
  return m;
}

function mustBe(cond, message) { if (!cond) throw E.conflict('INVALID_STATE', message); }

router.get('/contracts', h(async (req, res) => {
  const rows = await db('contracts')
    .where((b) => b.where({ client_id: req.user.id }).orWhere({ freelancer_id: req.user.id }))
    .orderByRaw("case when status = 'active' then 0 else 1 end")
    .orderBy('created_at', 'desc');
  const out = [];
  for (const c of rows) out.push(await full(c, req.user.id));
  res.json({ contracts: out });
}));

router.get('/contracts/:id', h(async (req, res) => {
  const c = await loadContract(req);
  res.json({ contract: await full(c, req.user.id) });
}));

router.post('/contracts/:id/milestones/:mid/fund', h(async (req, res) => {
  const c = await loadContract(req);
  if (c.client_id !== req.user.id) throw E.forbidden('Only the client can fund milestones.');
  if (db.bool(c.is_sample)) throw E.sample('This is a sample contract, so checkout is turned off.');
  mustBe(c.status === 'active', 'This contract isn’t active.');
  const method = pay.fundingMethod(req.body && req.body.method);
  const bank = pay.escrowAccount();
  const m = await loadMilestone(req, c);

  let payment = await db('payments').where({ milestone_id: m.id, status: 'pending' }).first();
  if (!payment) {
    mustBe(m.status === 'unfunded', m.status === 'funding_pending' ? 'This milestone is already waiting for a transfer.' : 'This milestone is already funded.');
    const fee = pay.clientFee(m.amount);
    const now = db.now();
    await db.transaction(async (trx) => {
      let ref;
      for (let i = 0; i < 5; i++) { ref = sec.reference('PLF'); if (!(await trx('payments').where({ reference: ref }).first())) break; }
      await trx('payments').insert({
        contract_id: c.id, milestone_id: m.id, payer_id: req.user.id, method, amount: m.amount, fee, total: m.amount + fee,
        reference: ref, status: 'pending', created_at: now, updated_at: now
      });
      await trx('milestones').where({ id: m.id }).update({ status: 'funding_pending', updated_at: now });
    });
    payment = await db('payments').where({ milestone_id: m.id, status: 'pending' }).first();
    await mailer.send({
      to: req.user.email,
      ...emails.fundingInstructions({ reference: payment.reference, method, amount: payment.amount, fee: payment.fee, total: payment.total, milestoneTitle: m.title, contractTitle: c.title, bank })
    });
  }
  res.status(201).json({
    payment: { id: payment.id, reference: payment.reference, method: payment.method, amount: payment.amount, fee: payment.fee, total: payment.total, status: payment.status },
    instructions: {
      accountTitle: bank.accountTitle,
      bankName: bank.bankName || null,
      iban: bank.iban,
      raastId: bank.raastId || null,
      reference: payment.reference,
      note: 'Put the reference in the transfer description. The milestone shows as funded once the transfer is confirmed.'
    },
    feePercent: config.fees.clientPercent
  });
}));

router.post('/contracts/:id/milestones/:mid/cancel-funding', h(async (req, res) => {
  const c = await loadContract(req);
  if (c.client_id !== req.user.id) throw E.forbidden('Only the client can do this.');
  const m = await loadMilestone(req, c);
  const p = await db('payments').where({ milestone_id: m.id, status: 'pending' }).first();
  if (!p) throw E.conflict('INVALID_STATE', 'There’s no pending transfer for this milestone.');
  await db.transaction((trx) => money.cancelPayment(trx, p.id));
  res.json({ contract: await full(c, req.user.id) });
}));

router.post('/contracts/:id/milestones/:mid/submit', h(async (req, res) => {
  const c = await loadContract(req);
  if (c.freelancer_id !== req.user.id) throw E.forbidden('Only the specialist can submit work.');
  mustBe(c.status === 'active', 'This contract isn’t active.');
  const m = await loadMilestone(req, c);
  mustBe(m.status === 'funded' || m.status === 'changes_requested', m.status === 'unfunded' || m.status === 'funding_pending'
    ? 'Wait until the client has funded this milestone.' : 'This milestone can’t be submitted now.');
  const ck = new Check(req.body);
  const note = ck.text('note', { min: 1, max: 2000, label: 'Note', optional: true, multiline: true });
  ck.done();
  const now = db.now();
  await db.transaction(async (trx) => {
    await trx('milestones').where({ id: m.id }).update({ status: 'submitted', submission_note: note, submitted_at: now, updated_at: now });
    await notify(trx, c.client_id, { type: 'milestone_submitted', title: `Milestone ${m.position} submitted`, meta: `${m.title} · ${c.code}` });
  });
  res.json({ contract: await full(await db('contracts').where({ id: c.id }).first(), req.user.id) });
}));

router.post('/contracts/:id/milestones/:mid/request-changes', h(async (req, res) => {
  const c = await loadContract(req);
  if (c.client_id !== req.user.id) throw E.forbidden('Only the client can request changes.');
  const m = await loadMilestone(req, c);
  mustBe(m.status === 'submitted', 'You can request changes after work is submitted.');
  const ck = new Check(req.body);
  const note = ck.text('note', { min: 5, max: 2000, label: 'What needs changing', multiline: true });
  ck.done();
  const now = db.now();
  await db.transaction(async (trx) => {
    await trx('milestones').where({ id: m.id }).update({ status: 'changes_requested', client_note: note, updated_at: now });
    await notify(trx, c.freelancer_id, { type: 'changes_requested', title: 'Changes requested', meta: `${m.title} · ${c.code}` });
  });
  res.json({ contract: await full(c, req.user.id) });
}));

router.post('/contracts/:id/review', h(async (req, res) => {
  const c = await loadContract(req);
  const asClient = c.client_id === req.user.id;
  if (!asClient && c.freelancer_id !== req.user.id) throw E.forbidden('Only the client and the specialist can review this contract.');
  if (db.bool(c.is_sample)) throw E.sample('This is a sample contract, so reviews are turned off.');
  mustBe(c.status === 'completed', 'You can leave a review once every milestone has been released.');
  if (await db('reviews').where({ contract_id: c.id, reviewer_id: req.user.id }).first()) throw E.conflict('ALREADY_REVIEWED', 'You’ve already reviewed this contract.');
  const ch = new Check(req.body);
  const stars = ch.int('stars', { min: 1, max: 5, label: 'Rating' });
  const text = ch.text('text', { min: 10, max: 1000, label: 'Review', multiline: true });
  ch.done();
  const revieweeId = asClient ? c.freelancer_id : c.client_id;
  await db.transaction(async (trx) => {
    await trx('reviews').insert({
      contract_id: c.id, reviewer_id: req.user.id, reviewee_id: revieweeId, role: asClient ? 'freelancer' : 'client',
      stars, text, project: c.title, created_at: db.now()
    });
    await notify(trx, revieweeId, { type: 'review_received', title: `New ${stars}-star review`, meta: `${c.title} · ${c.code}`, link: '#profile' });
  });
  res.status(201).json({ contract: await full(c, req.user.id) });
}));

router.post('/contracts/:id/milestones/:mid/approve', h(async (req, res) => {
  const c = await loadContract(req);
  if (c.client_id !== req.user.id) throw E.forbidden('Only the client can approve work.');
  mustBe(c.status === 'active', 'This contract isn’t active.');
  const m = await loadMilestone(req, c);
  mustBe(m.status === 'submitted', 'You can approve a milestone after the work is submitted.');
  await db.transaction(async (trx) => {
    const fresh = await db.lockRow(trx, 'milestones', m.id);
    mustBe(fresh.status === 'submitted', 'This milestone has already been handled.');
    await money.releaseMilestone(trx, c, fresh);
  });
  res.json({ contract: await full(await db('contracts').where({ id: c.id }).first(), req.user.id) });
}));

module.exports = router;
