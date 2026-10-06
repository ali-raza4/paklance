'use strict';
/*
 * Blog + newsletter.
 *
 *   GET    /api/blog/categories
 *   GET    /api/blog/articles                ?category&q&page&limit&full=1   (published only, newest first)
 *   GET    /api/blog/articles/:slug          → { article, related }
 *   POST   /api/blog/articles/:slug/feedback { vote: 'yes' | 'no', comment? } → { ok: true }   "Was this helpful?"
 *          One answer per reader per article; answering again replaces it. "Not really" sends the vote first,
 *          then the same vote with the comment when the reader sends it.
 *   POST   /api/newsletter/subscribe         { email, source? } → { ok: true }
 *   GET    /newsletter/unsubscribe?token=…   (link in every newsletter email)
 *
 * Admin (role admin or ADMIN_EMAILS):
 *   GET    /api/admin/blog/articles          (drafts included)
 *   POST   /api/admin/blog/articles          create
 *   PATCH  /api/admin/blog/articles/:slug    update
 *   DELETE /api/admin/blog/articles/:slug
 *   GET    /api/admin/blog/feedback          per article: yes / no counts and the latest comments
 *
 * Article body uses the same blocks as the frontend:
 *   ['p',text] ['h2',text] ['h3',text] ['ul',[items]] ['ol',[items],start?] ['tip',title,text]
 *   ['quote',text] ['table',[head],[[row]]] ['img',caption] ['video',caption,url?]
 *   ['checklist',title,[items],doneMessage?]                       (**bold** allowed in text)
 * Optional per article: takeaways [3–6 short points] and cta { title, text, button, action | href }
 *   action: 'profile' | 'video' | 'signup'   href: an on-site link such as '#jobs' or '#pricing'
 */
const express = require('express');
const db = require('../db');
const { E, h } = require('../lib/errors');
const { Check, normEmail } = require('../lib/validate');
const present = require('../lib/present');
const sec = require('../lib/security');
const mailer = require('../lib/mailer');
const emails = require('../lib/emails');
const config = require('../config');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const CATEGORIES = ['All', 'Freelancing', 'Career & Skills', 'Hiring', 'Global Hiring', 'Remote Work', 'Business', 'Productivity', 'Technology', 'Finance & Payments', 'Talent Management', 'Paklance Updates'];
const like = (s) => '%' + String(s).toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c) + '%';

router.get('/blog/categories', (req, res) => res.json({ categories: CATEGORIES }));

router.get('/blog/articles', h(async (req, res) => {
  const full = req.query.full === '1' || req.query.full === 'true';
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);
  const base = db('blog_articles').where({ status: 'published' });
  if (req.query.category && req.query.category !== 'All') base.where({ category: String(req.query.category) });
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q) {
    for (const word of q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
      const w = like(word);
      base.where((b) => { for (const col of ['title', 'excerpt', 'category', 'tags']) b.orWhereRaw(`lower(${col}) like ? escape '\\'`, [w]); });
    }
  }
  const total = await db.count(base.clone());
  const rows = await base.clone().orderBy([{ column: 'published_on', order: 'desc' }, { column: 'id', order: 'asc' }]).limit(limit).offset((page - 1) * limit);
  res.json({ articles: rows.map((a) => present.article(a, { full })), total, page, limit });
}));

router.get('/blog/articles/:slug', h(async (req, res) => {
  const a = await db('blog_articles').where({ slug: String(req.params.slug), status: 'published' }).first();
  if (!a) throw E.notFound('Article not found.');
  const others = await db('blog_articles').where({ status: 'published' }).whereNot({ id: a.id }).select('slug', 'title', 'excerpt', 'category', 'tags', 'published_on', 'updated_on', 'is_demo', 'featured', 'popular');
  const tags = db.json(a.tags, []);
  const related = others
    .map((x) => ({ x, s: (x.category === a.category ? 3 : 0) + db.json(x.tags, []).filter((t) => tags.includes(t)).length }))
    .sort((p, q) => q.s - p.s || (p.x.published_on < q.x.published_on ? 1 : -1))
    .slice(0, 3)
    .map((p) => present.article(p.x, { full: false }));
  res.json({ article: present.article(a), related });
}));

/* ---------- newsletter ---------- */

router.post('/newsletter/subscribe', h(async (req, res) => {
  const email = normEmail(req.body && req.body.email);
  if (!email) throw E.validation({ email: 'Enter a valid email address, like name@example.com.' });
  const source = String((req.body && req.body.source) || 'blog').slice(0, 40);
  const now = db.now();
  const existing = await db('newsletter_subscribers').where({ email }).first();
  let token;
  if (!existing) {
    token = sec.randomToken(24);
    await db('newsletter_subscribers').insert({ email, status: 'subscribed', source, unsubscribe_token: token, created_at: now, updated_at: now });
  } else if (existing.status !== 'subscribed') {
    token = existing.unsubscribe_token;
    await db('newsletter_subscribers').where({ id: existing.id }).update({ status: 'subscribed', source, updated_at: now });
  }
  if (token) {
    await mailer.send({ to: email, ...emails.newsletterWelcome(`${config.appUrl}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`) });
  }
  // Same answer for new and existing subscribers.
  res.json({ ok: true });
}));

const unsubscribePage = express.Router();
unsubscribePage.get('/newsletter/unsubscribe', h(async (req, res) => {
  const token = String(req.query.token || '');
  const row = token ? await db('newsletter_subscribers').where({ unsubscribe_token: token }).first() : null;
  if (row && row.status !== 'unsubscribed') {
    await db('newsletter_subscribers').where({ id: row.id }).update({ status: 'unsubscribed', updated_at: db.now() });
  }
  const ok = !!row;
  res.status(ok ? 200 : 404).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Newsletter · Paklance</title>
<link rel="stylesheet" href="/assets/css/site.css"></head><body><main class="wrap" style="padding:64px 16px;max-width:560px">
<div class="card"><span class="eyebrow">Newsletter</span><h1 style="font-size:24px;margin-top:8px">${ok ? 'You’ve been unsubscribed.' : 'This link isn’t valid.'}</h1>
<p class="muted" style="margin-top:10px">${ok ? 'You won’t get any more newsletter emails from Paklance.' : 'The unsubscribe link may be incomplete. Copy the full link from the email and try again.'}</p>
<a class="btn btn-primary" href="/#blog" style="margin-top:18px">Back to the blog</a></div></main></body></html>`);
}));

/* ---------- admin ---------- */

const BLOCKS = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'tip', 'quote', 'table', 'img', 'video', 'checklist']);
function validBody(body) {
  if (!Array.isArray(body) || !body.length || body.length > 300) return false;
  const str = (s) => typeof s === 'string' && s.length <= 5000;
  const strs = (a) => Array.isArray(a) && a.length <= 100 && a.every(str);
  return body.every((b) => {
    if (!Array.isArray(b) || !BLOCKS.has(b[0])) return false;
    switch (b[0]) {
      case 'ul': return strs(b[1]);
      case 'ol': return strs(b[1]) && (b[2] === undefined || Number.isInteger(b[2]));
      case 'tip': return str(b[1]) && str(b[2]);
      case 'table': return strs(b[1]) && Array.isArray(b[2]) && b[2].length <= 100 && b[2].every(strs);
      case 'video': return str(b[1]) && (b[2] === undefined || b[2] === '' || (str(b[2]) && /^https:\/\//.test(b[2])));
      case 'checklist': return str(b[1]) && strs(b[2]) && b[2].length >= 1 && b[2].length <= 12 && (b[3] === undefined || str(b[3]));
      default: return str(b[1]);
    }
  });
}

function readArticle(body, { partial = false } = {}) {
  const c = new Check(body);
  const o = {};
  const opt = { optional: partial };
  if (!partial || c.has('title')) o.title = c.text('title', { min: 5, max: 200, label: 'Title', ...opt });
  if (!partial || c.has('excerpt')) o.excerpt = c.text('excerpt', { min: 20, max: 400, label: 'Excerpt', ...opt });
  if (!partial || c.has('category')) o.category = c.oneOf('category', CATEGORIES.slice(1), { label: 'Category', ...opt });
  if (!partial || c.has('tags')) o.tags = JSON.stringify(c.list('tags', { min: 0, max: 20, itemMax: 40, label: 'Tags' }) || []);
  if (!partial || c.has('date')) {
    const d = body.date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) c.fail('date', 'Use a date like 2026-09-24.'); else o.published_on = d;
  }
  if (c.has('updated')) { if (!/^\d{4}-\d{2}-\d{2}$/.test(body.updated)) c.fail('updated', 'Use a date like 2026-09-24.'); else o.updated_on = body.updated; }
  if (!partial || body.body !== undefined) { if (!validBody(body.body)) c.fail('body', 'The article body isn’t in the expected block format.'); else o.body = JSON.stringify(body.body); }
  if (body.featured !== undefined) o.featured = c.bool('featured');
  if (body.popular !== undefined) o.popular = c.bool('popular');
  if (body.status !== undefined) o.status = c.oneOf('status', ['published', 'draft'], { label: 'Status' });
  if (body.demo !== undefined) o.is_demo = c.bool('demo');
  if (body.takeaways !== undefined) {
    const t = body.takeaways;
    if (t === null || (Array.isArray(t) && !t.length)) o.takeaways = null;
    else if (!Array.isArray(t) || t.length > 6 || !t.every((x) => typeof x === 'string' && x.trim().length >= 5 && x.length <= 240)) c.fail('takeaways', 'Add up to 6 key takeaways of 5–240 characters each.');
    else o.takeaways = JSON.stringify(t.map((x) => x.trim()));
  }
  if (body.cta !== undefined) {
    const v = body.cta;
    const txt = (x, max) => typeof x === 'string' && x.trim().length >= 2 && x.length <= max;
    if (v === null) o.cta = null;
    else if (!v || typeof v !== 'object' || !txt(v.title, 80) || !txt(v.text, 200) || !txt(v.button, 40) ||
      !((v.action && CTA_ACTIONS.includes(v.action)) || (typeof v.href === 'string' && /^#[a-z0-9/-]{1,80}$/.test(v.href)))) {
      c.fail('cta', 'The next-step button needs a title, text, button label and an action (profile, video or signup) or an on-site link like #jobs.');
    } else o.cta = JSON.stringify({ title: v.title.trim(), text: v.text.trim(), button: v.button.trim(), ...(v.action ? { action: v.action } : { href: v.href }) });
  }
  c.done();
  return o;
}

const CTA_ACTIONS = ['profile', 'video', 'signup'];

/* ---------- "Was this helpful?" ---------- */

router.post('/blog/articles/:slug/feedback', h(async (req, res) => {
  const a = await db('blog_articles').where({ slug: String(req.params.slug), status: 'published' }).first();
  if (!a) throw E.notFound('Article not found.');
  const c = new Check(req.body);
  const vote = c.oneOf('vote', ['yes', 'no'], { label: 'Answer' });
  const comment = c.text('comment', { max: 500, label: 'Feedback', optional: true, multiline: true });
  c.done();
  // The same reader counts once: signed in → their account; signed out → their IP and browser (hashed, never stored raw).
  const voter = sec.hmac(req.user ? `u:${req.user.id}` : `a:${req.ip}:${String(req.get('user-agent') || '').slice(0, 200)}`);
  const now = db.now();
  const existing = await db('blog_feedback').where({ article_id: a.id, voter_hash: voter }).first();
  if (existing) {
    await db('blog_feedback').where({ id: existing.id }).update({
      vote, comment: comment || (vote === existing.vote ? existing.comment : null), user_id: req.user ? req.user.id : existing.user_id, updated_at: now
    });
  } else {
    await db('blog_feedback').insert({ article_id: a.id, voter_hash: voter, user_id: req.user ? req.user.id : null, vote, comment, created_at: now, updated_at: now });
  }
  res.json({ ok: true });
}));

router.get('/admin/blog/feedback', requireAdmin, h(async (req, res) => {
  const rows = await db('blog_feedback as f').join('blog_articles as a', 'a.id', 'f.article_id')
    .select('a.slug', 'a.title', 'f.vote', 'f.comment', 'f.updated_at').orderBy('f.updated_at', 'desc');
  const by = {};
  for (const r of rows) {
    const o = (by[r.slug] = by[r.slug] || { slug: r.slug, title: r.title, yes: 0, no: 0, comments: [] });
    o[r.vote] += 1;
    if (r.comment && o.comments.length < 20) o.comments.push({ vote: r.vote, comment: r.comment, at: r.updated_at });
  }
  res.json({ articles: Object.values(by).sort((x, y) => (y.yes + y.no) - (x.yes + x.no)) });
}));

const slugify = (t) => String(t).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 150);

router.get('/admin/blog/articles', requireAdmin, h(async (req, res) => {
  const rows = await db('blog_articles').orderBy('published_on', 'desc');
  res.json({ articles: rows.map((a) => present.article(a, { full: false })) });
}));

router.post('/admin/blog/articles', requireAdmin, h(async (req, res) => {
  const o = readArticle(req.body || {});
  const slug = slugify((req.body && req.body.slug) || o.title);
  if (!slug) throw E.validation({ slug: 'Enter a slug.' });
  if (await db('blog_articles').where({ slug }).first()) throw E.conflict('SLUG_TAKEN', 'An article with this URL already exists.');
  const now = db.now();
  await db.transaction(async (trx) => {
    if (o.featured) await trx('blog_articles').update({ featured: false });
    await trx('blog_articles').insert({ slug, featured: false, popular: false, is_demo: false, status: 'published', ...o, created_at: now, updated_at: now });
  });
  res.status(201).json({ article: present.article(await db('blog_articles').where({ slug }).first()) });
}));

router.patch('/admin/blog/articles/:slug', requireAdmin, h(async (req, res) => {
  const a = await db('blog_articles').where({ slug: String(req.params.slug) }).first();
  if (!a) throw E.notFound('Article not found.');
  const o = readArticle(req.body || {}, { partial: true });
  await db.transaction(async (trx) => {
    if (o.featured) await trx('blog_articles').whereNot({ id: a.id }).update({ featured: false });
    await trx('blog_articles').where({ id: a.id }).update({ ...o, updated_at: db.now() });
  });
  res.json({ article: present.article(await db('blog_articles').where({ id: a.id }).first()) });
}));

router.delete('/admin/blog/articles/:slug', requireAdmin, h(async (req, res) => {
  const n = await db('blog_articles').where({ slug: String(req.params.slug) }).del();
  if (!n) throw E.notFound('Article not found.');
  res.json({ ok: true });
}));

module.exports = router;
module.exports.unsubscribePage = unsubscribePage;
module.exports.CATEGORIES = CATEGORIES;
