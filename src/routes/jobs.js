'use strict';
/*
 * Jobs and proposals.
 *
 *   GET   /api/jobs                       ?q&category&minBudget&maxBudget&verified&safepay&sort=new|high|low&page&limit
 *   GET   /api/jobs/mine                  jobs I posted (with proposal counts)
 *   GET   /api/jobs/:id                   one job (+ isOwner, hasApplied when signed in)
 *   POST  /api/jobs                       post a job
 *   PATCH /api/jobs/:id                   { status: 'open' | 'closed' }  (owner)
 *   POST  /api/jobs/:id/proposals         apply { coverLetter?, bidAmount? }
 *   GET   /api/jobs/:id/proposals         proposals on my job (owner)
 *   GET   /api/proposals/mine             my applications
 *   POST  /api/proposals/:id/withdraw     (specialist)
 *   POST  /api/proposals/:id/decline     (client)
 *   POST  /api/proposals/:id/hire        (client) → creates a contract with the job's milestones
 */
const express = require('express');
const db = require('../db');
const { E, h } = require('../lib/errors');
const { Check, idParam } = require('../lib/validate');
const present = require('../lib/present');
const { requireAuth, requireReady } = require('../middleware/auth');
const { notify } = require('../services/notify');

const router = express.Router();

const CATEGORIES = ['Development', 'Design', 'Marketing', 'Writing', 'Video', 'AI & Data', 'Business & Support'];
const TYPES = ['Fixed price', 'Monthly', 'Hourly'];

async function milestonesFor(jobIds) {
  if (!jobIds.length) return {};
  const rows = await db('job_milestones').whereIn('job_id', jobIds).orderBy(['job_id', 'position']);
  const map = {};
  rows.forEach((m) => { (map[m.job_id] = map[m.job_id] || []).push(m); });
  return map;
}

const like = (s) => '%' + String(s).toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c) + '%';

router.get('/jobs', h(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);

  const base = db('jobs').where({ status: 'open' });
  if (req.query.category && req.query.category !== 'all') base.where({ category: String(req.query.category) });
  if (Number(req.query.minBudget) > 0) base.where('budget', '>=', Number(req.query.minBudget));
  if (Number(req.query.maxBudget) > 0) base.where('budget', '<=', Number(req.query.maxBudget));
  if (req.query.verified === 'true' || req.query.verified === '1') base.where({ client_verified: true });
  if (req.query.safepay === 'true' || req.query.safepay === '1') base.where({ safepay: true });
  if (q) {
    for (const word of q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
      const w = like(word);
      base.where((b) => {
        for (const col of ['title', 'description', 'city', 'client_label', 'category', 'skills']) {
          b.orWhereRaw(`lower(${col}) like ? escape '\\'`, [w]);
        }
      });
    }
  }
  const total = await db.count(base.clone());
  const sort = req.query.sort;
  const rows = await base
    .clone()
    .orderBy(sort === 'high' ? [{ column: 'budget', order: 'desc' }, { column: 'id', order: 'asc' }]
      : sort === 'low' ? [{ column: 'budget', order: 'asc' }, { column: 'id', order: 'asc' }]
      // newest first; seeded samples keep their original order
      : [{ column: 'is_sample', order: 'asc' }, { column: 'created_at', order: 'desc' }, { column: 'id', order: 'asc' }])
    .limit(limit)
    .offset((page - 1) * limit);
  const ms = await milestonesFor(rows.map((r) => r.id));
  res.json({ jobs: rows.map((j) => present.job(j, ms[j.id])), total, page, limit });
}));

router.get('/jobs/mine', requireAuth, h(async (req, res) => {
  const rows = await db('jobs').where({ client_id: req.user.id }).orderBy('created_at', 'desc');
  const ms = await milestonesFor(rows.map((r) => r.id));
  const counts = rows.length
    ? await db('proposals').whereIn('job_id', rows.map((r) => r.id)).whereNot({ status: 'withdrawn' }).select('job_id').count({ n: '*' }).groupBy('job_id')
    : [];
  const byJob = {};
  counts.forEach((c) => { byJob[c.job_id] = Number(c.n); });
  res.json({ jobs: rows.map((j) => present.job(j, ms[j.id], { proposals: byJob[j.id] || 0 })) });
}));

router.get('/jobs/:id', h(async (req, res) => {
  const id = idParam(req.params.id);
  const j = id && (await db('jobs').where({ id }).first());
  const isOwner = !!(j && req.user && j.client_id === req.user.id);
  if (!j || (j.status !== 'open' && !isOwner)) throw E.notFound('This job isn’t available.');
  const ms = await milestonesFor([j.id]);
  let hasApplied = false;
  if (req.user && !isOwner) hasApplied = !!(await db('proposals').where({ job_id: j.id, freelancer_id: req.user.id }).first());
  res.json({ job: present.job(j, ms[j.id], { isOwner, hasApplied }) });
}));

function readJob(body) {
  const c = new Check(body);
  const out = {
    title: c.text('title', { min: 10, max: 140, label: 'Job title' }),
    clientLabel: c.text('clientLabel', { min: 2, max: 80, label: 'Client description', optional: true }),
    city: c.text('city', { min: 2, max: 60, label: 'City' }),
    category: c.oneOf('category', CATEGORIES, { label: 'Category' }),
    type: c.oneOf('type', TYPES, { label: 'Budget type', fallback: 'Fixed price' }),
    budget: c.int('budget', { min: 1000, max: 50000000, label: 'Budget' }),
    skills: c.list('skills', { min: 1, max: 10, label: 'Skills' }),
    description: c.text('description', { min: 30, max: 5000, label: 'Description', multiline: true }),
    safepay: c.bool('safepay', true)
  };
  let ms = Array.isArray(body.milestones) ? body.milestones : [];
  if (!ms.length && out.budget) ms = [{ title: 'Complete project', amount: out.budget }];
  if (ms.length > 10) c.fail('milestones', 'Use up to 10 milestones.');
  out.milestones = ms.slice(0, 10).map((m, i) => {
    const mc = new Check(m);
    const title = mc.text('title', { min: 3, max: 120, label: `Milestone ${i + 1} title` });
    const amount = mc.int('amount', { min: 500, max: 50000000, label: `Milestone ${i + 1} amount` });
    Object.values(mc.errors).forEach((e) => c.fail('milestones', e));
    return { title, amount };
  });
  if (out.budget && !c.errors.milestones) {
    const sum = out.milestones.reduce((s, m) => s + (m.amount || 0), 0);
    if (sum !== out.budget) c.fail('milestones', `Milestone amounts add up to PKR ${sum.toLocaleString('en-US')}, but the budget is PKR ${out.budget.toLocaleString('en-US')}.`);
  }
  c.done();
  return out;
}

router.post('/jobs', requireReady, h(async (req, res) => {
  const j = readJob(req.body || {});
  const now = db.now();
  const id = await db.transaction(async (trx) => {
    const jobId = await db.insertId(trx('jobs').insert({
      client_id: req.user.id,
      title: j.title,
      client_label: j.clientLabel || 'Private client',
      city: j.city,
      category: j.category,
      budget: j.budget,
      type: j.type,
      safepay: j.safepay,
      client_verified: db.bool(req.user.identity_verified),
      skills: JSON.stringify(j.skills),
      description: j.description,
      status: 'open',
      is_sample: false,
      created_at: now,
      updated_at: now
    }));
    await trx('job_milestones').insert(j.milestones.map((m, i) => ({ job_id: jobId, position: i + 1, title: m.title, amount: m.amount })));
    return jobId;
  });
  const row = await db('jobs').where({ id }).first();
  const ms = await milestonesFor([id]);
  res.status(201).json({ job: present.job(row, ms[id], { isOwner: true, hasApplied: false }) });
}));

router.patch('/jobs/:id', requireAuth, h(async (req, res) => {
  const id = idParam(req.params.id);
  const j = id && (await db('jobs').where({ id }).first());
  if (!j || j.client_id !== req.user.id) throw E.notFound('Job not found.');
  const c = new Check(req.body);
  const status = c.oneOf('status', ['open', 'closed'], { label: 'Status' });
  c.done();
  await db('jobs').where({ id }).update({ status, updated_at: db.now() });
  const row = await db('jobs').where({ id }).first();
  const ms = await milestonesFor([id]);
  res.json({ job: present.job(row, ms[id], { isOwner: true }) });
}));

/* ---------- proposals ---------- */

router.post('/jobs/:id/proposals', requireReady, h(async (req, res) => {
  const id = idParam(req.params.id);
  const j = id && (await db('jobs').where({ id }).first());
  if (!j || j.status !== 'open') throw E.notFound('This job isn’t accepting applications.');
  if (db.bool(j.is_sample)) throw E.sample('This is a sample listing, so applications aren’t open.');
  if (j.client_id === req.user.id) throw E.forbidden('You can’t apply to your own job.', 'OWN_JOB');

  const c = new Check(req.body);
  const coverLetter = c.text('coverLetter', { min: 20, max: 5000, label: 'Cover letter', optional: true, multiline: true });
  const bid = c.int('bidAmount', { min: 500, max: 50000000, label: 'Bid amount', optional: true });
  c.done();

  const already = await db('proposals').where({ job_id: j.id, freelancer_id: req.user.id }).first();
  if (already && already.status !== 'withdrawn') throw E.conflict('ALREADY_APPLIED', 'You’ve already applied to this job.');

  const now = db.now();
  let proposalId;
  await db.transaction(async (trx) => {
    if (already) {
      await trx('proposals').where({ id: already.id }).update({ status: 'submitted', cover_letter: coverLetter, bid_amount: bid || j.budget, updated_at: now });
      proposalId = already.id;
    } else {
      proposalId = await db.insertId(trx('proposals').insert({
        job_id: j.id, freelancer_id: req.user.id, cover_letter: coverLetter, bid_amount: bid || j.budget, status: 'submitted', created_at: now, updated_at: now
      }));
    }
    await notify(trx, j.client_id, { type: 'proposal_received', title: 'New proposal received', meta: `${req.user.full_name} · ${j.title}`, link: `#job/${j.id}` });
  });
  const p = await db('proposals').where({ id: proposalId }).first();
  res.status(201).json({ proposal: proposalOut(p, j) });
}));

function proposalOut(p, j, freelancer) {
  return {
    id: p.id,
    jobId: p.job_id,
    jobTitle: j ? j.title : undefined,
    coverLetter: p.cover_letter || null,
    bidAmount: p.bid_amount,
    status: p.status,
    createdAt: p.created_at,
    freelancer: freelancer || undefined
  };
}

router.get('/jobs/:id/proposals', requireAuth, h(async (req, res) => {
  const id = idParam(req.params.id);
  const j = id && (await db('jobs').where({ id }).first());
  if (!j || j.client_id !== req.user.id) throw E.notFound('Job not found.');
  const rows = await db('proposals as p')
    .join('users as u', 'u.id', 'p.freelancer_id')
    .leftJoin('talent_profiles as t', 't.user_id', 'u.id')
    .where('p.job_id', j.id)
    .whereNot('p.status', 'withdrawn')
    .orderBy('p.created_at', 'desc')
    .select('p.*', 'u.full_name', 'u.skills as user_skills', 'u.identity_verified', 't.id as profile_id', 't.headline');
  res.json({
    proposals: rows.map((r) => proposalOut(r, j, {
      id: r.freelancer_id, name: r.full_name, skills: db.json(r.user_skills, []), verified: db.bool(r.identity_verified), profileId: r.profile_id || null, headline: r.headline || null
    }))
  });
}));

router.get('/proposals/mine', requireAuth, h(async (req, res) => {
  const rows = await db('proposals as p').join('jobs as j', 'j.id', 'p.job_id').where('p.freelancer_id', req.user.id)
    .orderBy('p.created_at', 'desc').select('p.*', 'j.title');
  res.json({ proposals: rows.map((r) => proposalOut(r, { title: r.title })) });
}));

async function loadProposal(req) {
  const id = idParam(req.params.id);
  const p = id && (await db('proposals').where({ id }).first());
  if (!p) throw E.notFound('Proposal not found.');
  const j = await db('jobs').where({ id: p.job_id }).first();
  return { p, j };
}

router.post('/proposals/:id/withdraw', requireAuth, h(async (req, res) => {
  const { p, j } = await loadProposal(req);
  if (p.freelancer_id !== req.user.id) throw E.notFound('Proposal not found.');
  if (p.status !== 'submitted') throw E.conflict('INVALID_STATE', 'This proposal can’t be withdrawn now.');
  await db('proposals').where({ id: p.id }).update({ status: 'withdrawn', updated_at: db.now() });
  res.json({ proposal: proposalOut({ ...p, status: 'withdrawn' }, j) });
}));

router.post('/proposals/:id/decline', requireAuth, h(async (req, res) => {
  const { p, j } = await loadProposal(req);
  if (j.client_id !== req.user.id) throw E.notFound('Proposal not found.');
  if (p.status !== 'submitted') throw E.conflict('INVALID_STATE', 'This proposal can’t be declined now.');
  await db('proposals').where({ id: p.id }).update({ status: 'declined', updated_at: db.now() });
  res.json({ proposal: proposalOut({ ...p, status: 'declined' }, j) });
}));

router.post('/proposals/:id/hire', requireReady, h(async (req, res) => {
  const { p, j } = await loadProposal(req);
  if (j.client_id !== req.user.id) throw E.notFound('Proposal not found.');
  if (p.status !== 'submitted') throw E.conflict('INVALID_STATE', 'Only a submitted proposal can be hired.');
  const closeJob = req.body && req.body.closeJob === false ? false : true;

  const jobMs = await db('job_milestones').where({ job_id: j.id }).orderBy('position');
  // Scale the job's milestones to the agreed bid (the last milestone absorbs rounding).
  const ratio = p.bid_amount / j.budget;
  let used = 0;
  const plan = jobMs.map((m, i) => {
    const amount = i === jobMs.length - 1 ? p.bid_amount - used : Math.round(m.amount * ratio);
    used += amount;
    return { title: m.title, amount };
  });

  const now = db.now();
  const contractId = await db.transaction(async (trx) => {
    const cid = await db.insertId(trx('contracts').insert({
      job_id: j.id, proposal_id: p.id, client_id: j.client_id, freelancer_id: p.freelancer_id, title: j.title,
      client_label: req.user.full_name, total_amount: p.bid_amount, status: 'active', is_sample: false, created_at: now, updated_at: now
    }));
    await trx('contracts').where({ id: cid }).update({ code: 'PK-' + (10000 + cid) });
    await trx('milestones').insert(plan.map((m, i) => ({ contract_id: cid, position: i + 1, title: m.title, amount: m.amount, status: 'unfunded', created_at: now, updated_at: now })));
    await trx('proposals').where({ id: p.id }).update({ status: 'hired', updated_at: now });
    if (closeJob) await trx('jobs').where({ id: j.id }).update({ status: 'closed', updated_at: now });
    await notify(trx, p.freelancer_id, { type: 'hired', title: 'You’ve been hired', meta: `${j.title} · ${req.user.full_name}` });
    return cid;
  });
  res.status(201).json({ contractId, code: 'PK-' + (10000 + contractId) });
}));

module.exports = router;
module.exports.CATEGORIES = CATEGORIES;
