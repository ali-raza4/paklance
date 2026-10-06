'use strict';
/*
 * Resolution Centre.
 *
 *   POST /api/disputes        { contractId, milestoneId?, issue, description }
 *   GET  /api/disputes        cases on my contracts
 *   GET  /api/disputes/:id
 *   (Admins resolve cases: POST /api/admin/disputes/:id/resolve)
 */
const express = require('express');
const db = require('../db');
const { E, h } = require('../lib/errors');
const { Check, idParam } = require('../lib/validate');
const { notify } = require('../services/notify');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use('/disputes', requireAuth);

const ISSUES = ['Deliverable does not match agreed scope', 'Missed deadline', 'Revision disagreement', 'Payment / release issue', 'Other'];

const out = (d, c, m) => ({
  id: d.id,
  contractId: d.contract_id,
  contractCode: c ? c.code : undefined,
  milestoneId: d.milestone_id,
  milestoneTitle: m ? m.title : undefined,
  issue: d.issue,
  description: d.description,
  status: d.status,
  outcome: d.outcome || null,
  resolutionNote: d.resolution_note || null,
  openedByMe: undefined,
  createdAt: d.created_at,
  resolvedAt: d.resolved_at || null
});

router.post('/disputes', h(async (req, res) => {
  const c0 = new Check(req.body);
  const contractId = c0.int('contractId', { min: 1, label: 'Contract' });
  const milestoneId = c0.int('milestoneId', { min: 1, label: 'Milestone', optional: true });
  const issue = c0.oneOf('issue', ISSUES, { label: 'Issue' });
  const description = c0.text('description', { min: 20, max: 5000, label: 'What happened', multiline: true });
  c0.done();

  const c = await db('contracts').where({ id: contractId }).first();
  if (!c || (c.client_id !== req.user.id && c.freelancer_id !== req.user.id)) throw E.notFound('Contract not found.');
  if (db.bool(c.is_sample)) throw E.sample('This is a sample contract, so cases can’t be submitted.');

  let m = null;
  if (milestoneId) {
    m = await db('milestones').where({ id: milestoneId, contract_id: c.id }).first();
    if (!m) throw E.notFound('Milestone not found.');
    if (['released', 'refunded', 'disputed'].includes(m.status)) {
      throw E.conflict('INVALID_STATE', m.status === 'disputed' ? 'There’s already an open case for this milestone.' : 'This milestone is already settled.');
    }
  } else {
    const open = await db('disputes').where({ contract_id: c.id }).whereNot({ status: 'resolved' }).whereNull('milestone_id').first();
    if (open) throw E.conflict('INVALID_STATE', 'There’s already an open case for this contract.');
  }

  const now = db.now();
  const id = await db.transaction(async (trx) => {
    const did = await db.insertId(trx('disputes').insert({
      contract_id: c.id, milestone_id: m ? m.id : null, milestone_prev_status: m ? m.status : null, opened_by: req.user.id,
      issue, description, status: 'open', created_at: now, updated_at: now
    }));
    // A funded milestone is frozen while the case is open, so it can't be released or refunded by one side.
    if (m) await trx('milestones').where({ id: m.id }).update({ status: 'disputed', updated_at: now });
    const other = req.user.id === c.client_id ? c.freelancer_id : c.client_id;
    await notify(trx, other, { type: 'dispute_opened', title: 'A case was opened on your contract', meta: `${c.code} · ${issue}` });
    return did;
  });
  const d = await db('disputes').where({ id }).first();
  res.status(201).json({ dispute: { ...out(d, c, m), openedByMe: true } });
}));

router.get('/disputes', h(async (req, res) => {
  const rows = await db('disputes as d')
    .join('contracts as c', 'c.id', 'd.contract_id')
    .leftJoin('milestones as m', 'm.id', 'd.milestone_id')
    .where((b) => b.where('c.client_id', req.user.id).orWhere('c.freelancer_id', req.user.id))
    .orderBy('d.created_at', 'desc')
    .select('d.*', 'c.code', 'm.title as milestone_title');
  res.json({ disputes: rows.map((r) => ({ ...out(r, { code: r.code }, r.milestone_title ? { title: r.milestone_title } : null), openedByMe: r.opened_by === req.user.id })) });
}));

router.get('/disputes/:id', h(async (req, res) => {
  const id = idParam(req.params.id);
  const d = id && (await db('disputes').where({ id }).first());
  const c = d && (await db('contracts').where({ id: d.contract_id }).first());
  if (!d || !c || (c.client_id !== req.user.id && c.freelancer_id !== req.user.id && !req.user.isAdmin)) throw E.notFound('Case not found.');
  const m = d.milestone_id ? await db('milestones').where({ id: d.milestone_id }).first() : null;
  res.json({ dispute: { ...out(d, c, m), openedByMe: d.opened_by === req.user.id } });
}));

module.exports = router;
module.exports.ISSUES = ISSUES;
