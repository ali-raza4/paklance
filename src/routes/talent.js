'use strict';
/*
 * Specialist profiles.
 *
 *   GET /api/talent                ?q&category&available=now&maxRate&page&limit
 *   GET /api/talent/:id
 *   GET /api/talent/:id            → { talent, page }   page = ratings, reviews, stats, photo and video for real
 *                                    profiles (null for the sample profiles, whose page data is built into the site)
 *   GET /api/me/profile            my public profile (null if not created yet) + my profile sections + page data
 *        → { profile, items: [{ id, kind, title, subtitle, url, amount, startYear, endYear, description }],
 *            video, rating, reviews, seller, buyer, delivery }
 *   PUT /api/me/profile            create / update my public profile (the tracker's "Update introduction")
 *        { headline, city, category, hourlyRate, availability, bio, published? }
 *        Name and skills come from the account (PATCH /api/me).
 *
 *   Profile sections (the dashboard's profile-completion tracker)
 *   POST   /api/me/profile/items      { kind, …fields }  → 201 { item }
 *          kind = portfolio    { title, url?, description? }
 *                 services     { title, amount (starting price, PKR), description? }
 *                 education    { title (degree), subtitle (institution), startYear, endYear }
 *                 experience   { title (role), subtitle (company), startYear, endYear? (empty = current), description? }
 *                 certificates { title, subtitle (issuer), endYear (year issued), url? }
 *   DELETE /api/me/profile/items/:id                    → { ok: true }
 */
const express = require('express');
const db = require('../db');
const { E, h } = require('../lib/errors');
const { Check } = require('../lib/validate');
const present = require('../lib/present');
const { requireAuth, requireReady } = require('../middleware/auth');
const { CATEGORIES } = require('./jobs');
const { profilePage, ratings, summary } = require('../services/profilePage');

const router = express.Router();
const AVAILABILITY = ['Available now', 'Dedicated', 'Open to opportunities', 'Busy'];

const like = (s) => '%' + String(s).toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c) + '%';

// Delivery record for real profiles, computed from contracts. null = not enough history yet.
async function computedStats(userId) {
  if (!userId) return null;
  const contracts = await db('contracts').where({ freelancer_id: userId, is_sample: false }).select('status', 'client_id');
  const finished = contracts.filter((c) => c.status === 'completed' || c.status === 'cancelled');
  const completed = contracts.filter((c) => c.status === 'completed').length;
  const perClient = {};
  contracts.forEach((c) => { perClient[c.client_id] = (perClient[c.client_id] || 0) + 1; });
  const clients = Object.keys(perClient).length;
  return {
    completion: finished.length ? Math.round((completed / finished.length) * 100) : null,
    onTime: null, // needs milestone due dates, which aren't collected yet
    repeatClients: clients ? Math.round((Object.values(perClient).filter((n) => n > 1).length / clients) * 100) : null
  };
}

router.get(['/talent', '/profiles/search'], h(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);
  const base = db('talent_profiles').where({ published: true });
  if (req.query.category) base.where({ category: String(req.query.category) });
  if (req.query.available === 'now') base.where({ availability: 'Available now' });
  if (Number(req.query.maxRate) > 0) base.where('hourly_rate', '<=', Number(req.query.maxRate));
  if (q) {
    for (const word of q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
      const w = like(word);
      base.where((b) => {
        for (const col of ['name', 'headline', 'city', 'category', 'skills']) b.orWhereRaw(`lower(${col}) like ? escape '\\'`, [w]);
      });
    }
  }
  const total = await db.count(base.clone());
  const rows = await base.clone().orderBy([{ column: 'is_sample', order: 'asc' }, { column: 'created_at', order: 'desc' }, { column: 'id', order: 'asc' }])
    .limit(limit).offset((page - 1) * limit);
  const out = [];
  const userIds = rows.map((t) => t.user_id).filter(Boolean);
  const photos = {};
  if (userIds.length) (await db('users').whereIn('id', userIds).select('id', 'photo_url')).forEach((u) => { photos[u.id] = u.photo_url || null; });
  const stars = await ratings(userIds);
  for (const t of rows) {
    const extra = t.user_id ? { photo: photos[t.user_id] || null, rating: summary((stars[t.user_id] || {}).freelancer) } : undefined;
    out.push(present.talent(t, t.stats ? null : await computedStats(t.user_id), extra));
  }
  res.json({ talent: out, total, page, limit });
}));

router.get('/talent/:id', h(async (req, res) => {
  const t = await db('talent_profiles').where({ id: String(req.params.id) }).first();
  if (!t || (!db.bool(t.published) && !(req.user && req.user.id === t.user_id))) throw E.notFound('This profile isn’t available.');
  const isSample = db.bool(t.is_sample);
  const page = (!isSample && t.user_id) ? await profilePage(t.user_id, computedStats) : null;
  const extra = page ? { photo: page.photo, rating: summary(page.rating.freelancer) } : undefined;
  res.json({ talent: present.talent(t, t.stats ? null : await computedStats(t.user_id), extra), page });
}));

router.get('/me/profile', requireAuth, h(async (req, res) => {
  const t = await db('talent_profiles').where({ user_id: req.user.id }).first();
  const items = await db('profile_items').where({ user_id: req.user.id }).orderBy([{ column: 'created_at', order: 'asc' }, { column: 'id', order: 'asc' }]);
  const page = await profilePage(req.user, computedStats);
  res.json({
    profile: t ? present.talent(t, await computedStats(req.user.id)) : null,
    items: items.map(presentItem),
    video: page.video, rating: page.rating, reviews: page.reviews, seller: page.seller, buyer: page.buyer, delivery: page.delivery
  });
}));

/* ---------- profile sections ---------- */
const MAX_PER_SECTION = 20;
const thisYear = () => new Date().getUTCFullYear();

function presentItem(r) {
  return {
    id: String(r.id),
    kind: r.kind,
    title: r.title,
    subtitle: r.subtitle || null,
    url: r.url || null,
    amount: r.amount == null ? null : Number(r.amount),
    startYear: r.start_year == null ? null : Number(r.start_year),
    endYear: r.end_year == null ? null : Number(r.end_year),
    description: r.description || null
  };
}

// Links must be http(s); "behance.net/x" is accepted and saved as "https://behance.net/x".
function link(c, field, label) {
  const v = c.text(field, { max: 300, label, optional: true });
  if (!v) return null;
  const s = /^https?:\/\//i.test(v) ? v : 'https://' + v;
  let ok = !/\s/.test(s) && /^https?:\/\/[^/?#]+\.[^/?#]{2,}/i.test(s) && s.length <= 300;
  if (ok) { try { new URL(s); } catch (e) { ok = false; } }
  return ok ? s : c.fail(field, 'Enter a valid link, like https://example.com.');
}
function year(c, field, { label, optional = false, max = thisYear() }) {
  const v = c.body[field];
  if (v === undefined || v === null || v === '') return optional ? null : c.fail(field, `Enter the ${label.toLowerCase()}.`);
  const n = Number(typeof v === 'string' ? v.trim() : v);
  if (!Number.isInteger(n) || n < 1960 || n > max) return c.fail(field, `Enter a year from 1960 to ${max}.`);
  return n;
}
const description = (c) => c.text('description', { max: 500, label: 'Description', optional: true, multiline: true });

// Same rules as the tracker's forms (PaklanceProfile in the auth module), so the UI and API always agree.
const SECTIONS = {
  portfolio: (c) => ({
    title: c.text('title', { min: 3, max: 100, label: 'Project title' }),
    url: link(c, 'url', 'Link'),
    description: description(c)
  }),
  services: (c) => ({
    title: c.text('title', { min: 3, max: 100, label: 'Service' }),
    amount: c.int('amount', { min: 500, max: 10000000, label: 'Starting price' }),
    description: description(c)
  }),
  education: (c) => ({
    title: c.text('title', { min: 2, max: 100, label: 'Degree or course' }),
    subtitle: c.text('subtitle', { min: 2, max: 120, label: 'Institution' }),
    start_year: year(c, 'startYear', { label: 'Start year' }),
    end_year: year(c, 'endYear', { label: 'End year', max: thisYear() + 7 })
  }),
  experience: (c) => ({
    title: c.text('title', { min: 2, max: 100, label: 'Role' }),
    subtitle: c.text('subtitle', { min: 2, max: 120, label: 'Company' }),
    start_year: year(c, 'startYear', { label: 'Start year' }),
    end_year: year(c, 'endYear', { label: 'End year', optional: true }),
    description: description(c)
  }),
  certificates: (c) => ({
    title: c.text('title', { min: 2, max: 120, label: 'Certificate' }),
    subtitle: c.text('subtitle', { min: 2, max: 120, label: 'Issued by' }),
    end_year: year(c, 'endYear', { label: 'Year issued' }),
    url: link(c, 'url', 'Credential link')
  })
};

router.post('/me/profile/items', requireReady, h(async (req, res) => {
  const c = new Check(req.body);
  const kind = c.oneOf('kind', Object.keys(SECTIONS), { label: 'Section' });
  c.done();
  const data = SECTIONS[kind](c);
  if (data.start_year && data.end_year && data.end_year < data.start_year) c.fail('endYear', 'The end year can’t be before the start year.');
  c.done();
  const count = await db.count(db('profile_items').where({ user_id: req.user.id, kind }));
  if (count >= MAX_PER_SECTION) throw E.validation({ kind: `You can add up to ${MAX_PER_SECTION} here. Remove one to add another.` });
  const id = await db.insertId(db('profile_items').insert({ user_id: req.user.id, kind, ...data, created_at: db.now() }));
  res.status(201).json({ item: presentItem(await db('profile_items').where({ id }).first()) });
}));

router.delete('/me/profile/items/:id', requireAuth, h(async (req, res) => {
  const id = Number(req.params.id);
  const row = Number.isInteger(id) && id > 0 && (await db('profile_items').where({ id, user_id: req.user.id }).first());
  if (!row) throw E.notFound('We couldn’t find that item.');
  await db('profile_items').where({ id }).del();
  res.json({ ok: true });
}));

function slugify(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'specialist';
}

router.put('/me/profile', requireReady, h(async (req, res) => {
  const c = new Check(req.body);
  const data = {
    headline: c.text('headline', { min: 5, max: 100, label: 'Headline' }),
    city: c.text('city', { min: 2, max: 60, label: 'City' }),
    category: c.oneOf('category', CATEGORIES, { label: 'Category' }),
    hourly_rate: c.int('hourlyRate', { min: 300, max: 100000, label: 'Hourly rate' }),
    availability: c.oneOf('availability', AVAILABILITY, { label: 'Availability', fallback: 'Available now' }),
    bio: c.text('bio', { min: 30, max: 2000, label: 'Bio', multiline: true }),
    published: c.bool('published', true)
  };
  c.done();
  const now = db.now();
  const base = {
    ...data,
    name: req.user.full_name,
    initials: present.initialsOf(req.user.full_name),
    skills: req.user.skills,
    verified: db.bool(req.user.identity_verified),
    updated_at: now
  };
  const existing = await db('talent_profiles').where({ user_id: req.user.id }).first();
  let id;
  if (existing) {
    id = existing.id;
    await db('talent_profiles').where({ id }).update(base);
  } else {
    const root = slugify(req.user.full_name);
    id = root;
    for (let n = 2; await db('talent_profiles').where({ id }).first(); n++) id = `${root}-${n}`;
    await db('talent_profiles').insert({ id, user_id: req.user.id, ...base, stats: null, is_sample: false, created_at: now });
  }
  const t = await db('talent_profiles').where({ id }).first();
  res.status(existing ? 200 : 201).json({ profile: present.talent(t, await computedStats(req.user.id)) });
}));

module.exports = router;
module.exports.computedStats = computedStats;
