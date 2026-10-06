'use strict';
/*
 * Paklance Match™ and Global Hiring requirements.
 *
 *   POST /api/match-requests     { role, engagement, seniority, timezone, budgetModel, skills }  (signed in or not)
 *        → { request: { id }, shortlist: [ { id, name, initials, headline, city, tags, fit, matchedSkills, isSample } ] }
 *   GET  /api/match-requests     my requests
 *   POST /api/global-requests    { role, engagement, timezone, duration, startWindow, skills, protections: { nda, ip, replacement } }
 *   GET  /api/global-requests    my private requirements
 *
 * Fit = share of the requested skills a specialist has (85%) + availability (15%). It is an explainable
 * indicator, returned together with the matched skills; it is not a hidden reputation score.
 */
const express = require('express');
const db = require('../db');
const { h } = require('../lib/errors');
const { Check } = require('../lib/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const ENGAGEMENT = ['Dedicated resource', 'Project specialist', 'Curated project team'];
const SENIORITY = ['Senior', 'Mid-level', 'Lead / Principal'];
const MATCH_TZ = ['4+ hours with UK / Europe', '4+ hours with Gulf', '4+ hours with North America', 'Flexible / asynchronous'];
const BUDGET = ['Monthly engagement', 'Fixed project budget', 'Hourly'];
const GLOBAL_TZ = ['UK / Europe', 'Gulf', 'North America', 'Asia Pacific'];
const DURATION = ['6 months+', '3–6 months', '1–3 months', 'Defined project'];
const START = ['Within 2 weeks', 'Within 1 month', 'Flexible'];

const AVAIL_SCORE = { 'Available now': 1, Dedicated: 1, 'Open to opportunities': 0.6, Busy: 0.2 };
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9+#]+/g, '');

function skillMatches(wanted, have) {
  const w = norm(wanted);
  return have.some((h) => { const x = norm(h); return x && w && (x === w || (w.length > 3 && x.includes(w)) || (x.length > 3 && w.includes(x))); });
}

async function shortlist(skills) {
  const profiles = await db('talent_profiles').where({ published: true });
  return profiles
    .map((t) => {
      const have = db.json(t.skills, []);
      const matched = skills.filter((s) => skillMatches(s, have));
      const coverage = matched.length / skills.length;
      const fit = Math.round(85 * coverage + 15 * (AVAIL_SCORE[t.availability] ?? 0.5));
      return { t, matched, fit };
    })
    .filter((x) => x.matched.length > 0)
    .sort((a, b) => b.fit - a.fit || a.t.name.localeCompare(b.t.name))
    .slice(0, 5)
    .map(({ t, matched, fit }) => ({
      id: t.id,
      name: t.name,
      initials: t.initials,
      headline: t.headline,
      city: t.city,
      tags: [...matched.slice(0, 2), t.availability],
      matchedSkills: matched,
      fit,
      isSample: db.bool(t.is_sample)
    }));
}

router.post('/match-requests', h(async (req, res) => {
  const c = new Check(req.body);
  const r = {
    role: c.text('role', { min: 3, max: 140, label: 'Role or outcome' }),
    engagement: c.oneOf('engagement', ENGAGEMENT, { label: 'Engagement' }),
    seniority: c.oneOf('seniority', SENIORITY, { label: 'Seniority' }),
    timezone: c.oneOf('timezone', MATCH_TZ, { label: 'Time-zone overlap' }),
    budget_model: c.oneOf('budgetModel', BUDGET, { label: 'Budget model' }),
    skills: c.list('skills', { min: 1, max: 15, label: 'Primary skills' })
  };
  c.done();
  const id = await db.insertId(db('match_requests').insert({
    ...r, skills: JSON.stringify(r.skills), user_id: req.user ? req.user.id : null, status: 'new', created_at: db.now()
  }));
  res.status(201).json({ request: { id }, shortlist: await shortlist(r.skills) });
}));

router.get('/match-requests', requireAuth, h(async (req, res) => {
  const rows = await db('match_requests').where({ user_id: req.user.id }).orderBy('id', 'desc');
  res.json({ requests: rows.map((r) => ({ id: r.id, role: r.role, engagement: r.engagement, seniority: r.seniority, timezone: r.timezone, budgetModel: r.budget_model, skills: db.json(r.skills, []), status: r.status, createdAt: r.created_at })) });
}));

const globalOut = (r) => ({
  id: r.id, role: r.role, engagement: r.engagement, timezone: r.timezone, duration: r.duration, startWindow: r.start_window,
  skills: db.json(r.skills, []), protections: db.json(r.protections, {}), status: r.status, createdAt: r.created_at
});

router.post('/global-requests', requireAuth, h(async (req, res) => {
  const c = new Check(req.body);
  const r = {
    role: c.text('role', { min: 3, max: 140, label: 'Role / team' }),
    engagement: c.oneOf('engagement', ENGAGEMENT, { label: 'Engagement' }),
    timezone: c.oneOf('timezone', GLOBAL_TZ, { label: 'Company time zone' }),
    duration: c.oneOf('duration', DURATION, { label: 'Duration' }),
    start_window: c.oneOf('startWindow', START, { label: 'Start window' }),
    skills: c.list('skills', { min: 1, max: 15, label: 'Required skills' })
  };
  c.done();
  const p = (req.body && req.body.protections) || {};
  const protections = { nda: !!p.nda, ip: !!p.ip, replacement: !!p.replacement };
  const now = db.now();
  const id = await db.insertId(db('global_requests').insert({
    ...r, skills: JSON.stringify(r.skills), protections: JSON.stringify(protections), user_id: req.user.id, status: 'draft', created_at: now, updated_at: now
  }));
  res.status(201).json({ request: globalOut(await db('global_requests').where({ id }).first()) });
}));

router.get('/global-requests', requireAuth, h(async (req, res) => {
  const rows = await db('global_requests').where({ user_id: req.user.id }).orderBy('id', 'desc');
  res.json({ requests: rows.map(globalOut) });
}));

module.exports = router;
