'use strict';
/* Turn database rows into the JSON shapes the API returns. Nothing private leaves the server. */
const db = require('../db');

const json = db.json;
const bool = db.bool;

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '?').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
}

// The exact user shape used by the sign up / log in frontend.
function user(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name || null,
    skills: json(u.skills, []),
    emailVerified: bool(u.email_verified),
    provider: u.provider,
    memberSince: u.created_at ? String(u.created_at).slice(0, 10) : null,
    photo: u.photo_url || null,
    identityVerified: bool(u.identity_verified)
  };
}

function job(j, milestones, extra) {
  return {
    id: j.id,
    clientId: j.client_id || null,
    title: j.title,
    clientLabel: j.client_label,
    city: j.city,
    category: j.category,
    budget: j.budget,
    type: j.type,
    clientVerified: bool(j.client_verified),
    safepay: bool(j.safepay),
    skills: json(j.skills, []),
    description: j.description,
    status: j.status,
    isSample: bool(j.is_sample),
    createdAt: j.created_at,
    milestones: (milestones || []).map((m) => ({ title: m.title, amount: m.amount })),
    ...(extra || {})
  };
}

// extra: { photo, rating: { avg, count } } for real profiles (added by the talent routes)
function talent(t, computedStats, extra) {
  const stats = t.stats ? json(t.stats, null) : computedStats || null;
  return {
    id: t.id,
    userId: t.user_id || null,
    name: t.name,
    initials: t.initials,
    headline: t.headline,
    city: t.city,
    category: t.category,
    hourlyRate: t.hourly_rate,
    availability: t.availability,
    skills: json(t.skills, []),
    bio: t.bio,
    verified: bool(t.verified),
    stats, // { completion, onTime, repeatClients } — null values mean "not enough history yet"
    isSample: bool(t.is_sample),
    ...(extra || {})
  };
}

function milestone(m) {
  return {
    id: m.id,
    position: m.position,
    title: m.title,
    amount: m.amount,
    status: m.status,
    submissionNote: m.submission_note || null,
    clientNote: m.client_note || null,
    fundedAt: m.funded_at || null,
    submittedAt: m.submitted_at || null,
    releasedAt: m.released_at || null
  };
}

const PROTECTED = new Set(['funded', 'submitted', 'changes_requested', 'disputed']);

function contract(c, milestones, viewerId, names) {
  const ms = (milestones || []).map(milestone);
  const released = ms.filter((m) => m.status === 'released').reduce((s, m) => s + m.amount, 0);
  const prot = ms.filter((m) => PROTECTED.has(m.status)).reduce((s, m) => s + m.amount, 0);
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    status: c.status,
    isSample: bool(c.is_sample),
    role: viewerId === c.client_id ? 'client' : viewerId === c.freelancer_id ? 'freelancer' : 'viewer',
    client: { id: c.client_id, name: (names && names.client) || c.client_label || 'Client', label: c.client_label || null, verified: !!(names && names.clientVerified) },
    freelancer: { id: c.freelancer_id, name: (names && names.freelancer) || 'Specialist', verified: !!(names && names.freelancerVerified) },
    jobId: c.job_id,
    totals: { value: c.total_amount, released, protected: prot },
    milestones: ms,
    createdAt: c.created_at
  };
}

function notification(n) {
  return { id: n.id, type: n.type, title: n.title, meta: n.meta || '', link: n.link || null, read: !!n.read_at, createdAt: n.created_at };
}

// Blog articles use the same shape as the frontend's PaklanceBlog module.
function article(a, { full = true } = {}) {
  const out = {
    slug: a.slug,
    title: a.title,
    excerpt: a.excerpt,
    category: a.category,
    tags: json(a.tags, []),
    date: a.published_on,
    demo: bool(a.is_demo)
  };
  if (a.updated_on) out.updated = a.updated_on;
  if (bool(a.featured)) out.featured = true;
  if (bool(a.popular)) out.popular = true;
  if (full) out.body = json(a.body, []);
  const takeaways = json(a.takeaways, null);
  if (full && Array.isArray(takeaways) && takeaways.length) out.takeaways = takeaways;
  const cta = json(a.cta, null);
  if (full && cta && typeof cta === 'object') out.cta = cta;
  if (a.status && a.status !== 'published') out.status = a.status;
  return out;
}

module.exports = { initialsOf, user, job, talent, milestone, contract, notification, article };
