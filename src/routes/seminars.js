'use strict';
/*
 * Free seminars on recording a video introduction (the "Prefer help in person?" part of the video card).
 *
 *   GET    /api/seminars                    upcoming seminars → { seminars: [{ id, title, mode, place, about, startsAt,
 *                                           minutes, seats, taken, seatsLeft, sample, registered }] }
 *   POST   /api/seminars/:id/register       signed in → { seminar }; emails the joining link / venue details
 *   DELETE /api/seminars/:id/register       cancel my place → { seminar }
 *
 * Admin (see routes/admin.js for the rest of the operations API):
 *   GET    /api/admin/seminars              all seminars with registration counts
 *   POST   /api/admin/seminars              { title, mode: 'Online'|'In person', place, about, details?, startsAt, minutes, seats }
 *   PATCH  /api/admin/seminars/:id          any of the fields above, or { status: 'cancelled' }
 *   GET    /api/admin/seminars/:id/registrations
 *
 * Sample seminars (is_sample) show the feature before real dates exist. People can't register for them.
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const { E, h } = require('../lib/errors');
const { Check } = require('../lib/validate');
const sec = require('../lib/security');
const mailer = require('../lib/mailer');
const emails = require('../lib/emails');
const { notify } = require('../services/notify');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const MODES = ['Online', 'In person'];

async function takenBy(ids) {
  const out = {};
  if (!ids.length) return out;
  const rows = await db('seminar_registrations').whereIn('seminar_id', ids).groupBy('seminar_id').select('seminar_id').count({ n: '*' });
  rows.forEach((r) => { out[r.seminar_id] = Number(r.n); });
  return out;
}

function presentSeminar(s, taken, registered) {
  return {
    id: s.id,
    title: s.title,
    mode: s.mode,
    place: s.place,
    about: s.about,
    startsAt: s.starts_at,
    minutes: s.minutes,
    seats: s.seats,
    taken,
    seatsLeft: Math.max(0, s.seats - taken),
    status: s.status,
    sample: db.bool(s.is_sample),
    registered: !!registered
  };
}

async function one(id, userId) {
  const s = await db('seminars').where({ id }).first();
  if (!s) return null;
  const taken = (await takenBy([id]))[id] || 0;
  const mine = userId ? await db('seminar_registrations').where({ seminar_id: id, user_id: userId }).first() : null;
  return { row: s, out: presentSeminar(s, taken, mine) };
}

router.get('/seminars', h(async (req, res) => {
  // Still listed until it has finished.
  const rows = await db('seminars').where({ status: 'scheduled' }).orderBy('starts_at', 'asc').limit(40);
  const now = Date.now();
  const upcoming = rows.filter((s) => Date.parse(s.starts_at) + s.minutes * 60000 > now).slice(0, 12);
  const taken = await takenBy(upcoming.map((s) => s.id));
  const mine = new Set(req.user ? (await db('seminar_registrations').where({ user_id: req.user.id }).select('seminar_id')).map((r) => r.seminar_id) : []);
  res.json({ seminars: upcoming.map((s) => presentSeminar(s, taken[s.id] || 0, mine.has(s.id))) });
}));

router.post('/seminars/:id/register', requireAuth, h(async (req, res) => {
  const id = String(req.params.id);
  const found = await one(id, req.user.id);
  if (!found || found.row.status !== 'scheduled') throw E.notFound('This seminar isn’t available any more.');
  const s = found.row;
  if (db.bool(s.is_sample)) throw E.sample('This is a sample date to show how seminars work. Real dates will be listed here soon.');
  if (found.out.registered) return res.json({ seminar: found.out });
  if (Date.parse(s.starts_at) <= Date.now()) throw E.conflict('SEMINAR_STARTED', 'This seminar has already started. Please choose another date.');
  await db.transaction(async (trx) => {
    const n = await db.count(trx('seminar_registrations').where({ seminar_id: id }));
    if (n >= s.seats) throw E.conflict('FULL', 'This seminar is full. Please choose another date.');
    await trx('seminar_registrations').insert({ seminar_id: id, user_id: req.user.id, created_at: db.now() });
    await notify(trx, req.user.id, { type: 'seminar_registered', title: 'You’re registered for a seminar', meta: s.title, link: '#dashboard' });
  });
  await mailer.send({ to: req.user.email, ...emails.seminarRegistered(s, req.user.full_name) });
  res.status(201).json({ seminar: (await one(id, req.user.id)).out });
}));

router.delete('/seminars/:id/register', requireAuth, h(async (req, res) => {
  const id = String(req.params.id);
  const found = await one(id, req.user.id);
  if (!found) throw E.notFound('This seminar isn’t available any more.');
  await db('seminar_registrations').where({ seminar_id: id, user_id: req.user.id }).del();
  res.json({ seminar: (await one(id, req.user.id)).out });
}));

/* ---------- admin ---------- */

function readSeminar(body, { partial = false } = {}) {
  const c = new Check(body);
  const o = {};
  const opt = { optional: partial };
  if (!partial || c.has('title')) o.title = c.text('title', { min: 5, max: 140, label: 'Title', ...opt });
  if (!partial || c.has('mode')) o.mode = c.oneOf('mode', MODES, { label: 'Mode', ...opt });
  if (!partial || c.has('place')) o.place = c.text('place', { min: 3, max: 200, label: 'Place', ...opt });
  if (!partial || c.has('about')) o.about = c.text('about', { min: 10, max: 600, label: 'About', multiline: true, ...opt });
  if (c.has('details')) o.details = c.text('details', { max: 600, label: 'Details', multiline: true, optional: true });
  if (!partial || c.has('startsAt')) {
    const t = Date.parse(body.startsAt);
    if (!body.startsAt || !Number.isFinite(t)) c.fail('startsAt', 'Use a date and time like 2026-10-10T19:00:00+05:00.');
    else o.starts_at = new Date(t).toISOString();
  }
  if (!partial || c.has('minutes')) o.minutes = c.int('minutes', { min: 15, max: 600, label: 'Length in minutes', ...opt });
  if (!partial || c.has('seats')) o.seats = c.int('seats', { min: 1, max: 5000, label: 'Seats', ...opt });
  if (c.has('status')) o.status = c.oneOf('status', ['scheduled', 'cancelled'], { label: 'Status' });
  c.done();
  return o;
}

const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'seminar';

router.get('/admin/seminars', requireAdmin, h(async (req, res) => {
  const rows = await db('seminars').orderBy('starts_at', 'desc');
  const taken = await takenBy(rows.map((s) => s.id));
  res.json({ seminars: rows.map((s) => ({ ...presentSeminar(s, taken[s.id] || 0, false), details: s.details || null })) });
}));

router.post('/admin/seminars', requireAdmin, h(async (req, res) => {
  const o = readSeminar(req.body || {});
  const id = `${slug(o.title)}-${sec.randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 60);
  const now = db.now();
  await db('seminars').insert({ id, status: 'scheduled', is_sample: false, details: null, ...o, created_at: now, updated_at: now });
  res.status(201).json({ seminar: (await one(id)).out });
}));

router.patch('/admin/seminars/:id', requireAdmin, h(async (req, res) => {
  const id = String(req.params.id);
  if (!(await db('seminars').where({ id }).first())) throw E.notFound('No such seminar.');
  const o = readSeminar(req.body || {}, { partial: true });
  await db('seminars').where({ id }).update({ ...o, updated_at: db.now() });
  res.json({ seminar: (await one(id)).out });
}));

router.get('/admin/seminars/:id/registrations', requireAdmin, h(async (req, res) => {
  const rows = await db('seminar_registrations as r').join('users as u', 'u.id', 'r.user_id')
    .where('r.seminar_id', String(req.params.id)).orderBy('r.created_at', 'asc')
    .select('u.full_name as name', 'u.email', 'r.created_at as registeredAt');
  res.json({ registrations: rows });
}));

// Sample seminars always a few days ahead (times are Pakistan time, UTC+5), as in the preview.
function nextAt(weekday, hourPk, weeksLater = 0) {
  const pk = new Date(Date.now() + 5 * 3600000);
  const d = new Date(Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), pk.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + (((weekday - d.getUTCDay() + 7) % 7) || 7) + 7 * weeksLater);
  return new Date(d.getTime() + (hourPk - 5) * 3600000).toISOString();
}
function sampleSeminars() {
  return [
    { id: 'sample-phone', title: 'Record your video introduction on your phone', mode: 'Online', place: 'Live on Zoom', starts_at: nextAt(6, 19, 0), minutes: 60, seats: 100,
      about: 'Light, sound, framing and a simple script. Bring your phone: you’ll record a practice take during the session.' },
    { id: 'sample-islamabad', title: 'Video introduction workshop: record on the spot', mode: 'In person', place: 'Islamabad · venue details are emailed after you register', starts_at: nextAt(0, 11, 1), minutes: 120, seats: 30,
      about: 'Our team helps you plan what to say and records your video with proper lighting. You leave with a finished clip.' },
    { id: 'sample-script', title: 'Write your 60-second script (English and Urdu)', mode: 'Online', place: 'Live on Google Meet', starts_at: nextAt(3, 20, 1), minutes: 45, seats: 100,
      about: 'Turn your skills and best project into a short, natural script, with examples in both languages.' }
  ];
}

// Keeps the sample seminars in the future while no real seminar is scheduled (runs at start-up).
async function refreshSampleSeminars() {
  const now = db.now();
  const real = await db('seminars').where({ is_sample: false, status: 'scheduled' }).where('starts_at', '>', now).first();
  await db('seminars').where({ is_sample: true }).del();
  if (real) return false;
  await db('seminars').insert(sampleSeminars().map((s) => ({ ...s, status: 'scheduled', is_sample: true, details: null, created_at: now, updated_at: now })));
  return true;
}

module.exports = router;
module.exports.refreshSampleSeminars = refreshSampleSeminars;
module.exports.MODES = MODES;
