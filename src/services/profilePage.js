'use strict';
/*
 * Everything a profile page shows beyond the introduction, worked out from real activity:
 *   rating    { freelancer: [n5, n4, n3, n2, n1], client: [n5 … n1] }   star counts, as the frontend expects
 *   reviews   [{ role, stars, project, text, by, date 'YYYY-MM' }]    latest 10 per role
 *   seller    { earned, projects, services, clients, refunds }        as a specialist
 *   buyer     { spent, posted, hires }                                as a client
 *   delivery  [completion %, on-time %, repeat clients %] | null
 *   items     portfolio, services, experience, education and certificates
 *   video, photo, memberSince
 */
const db = require('../db');
const { presentVideo } = require('../lib/video');

function presentItem(r) {
  return {
    id: String(r.id), kind: r.kind, title: r.title, subtitle: r.subtitle || null, url: r.url || null,
    amount: r.amount == null ? null : Number(r.amount), startYear: r.start_year == null ? null : Number(r.start_year),
    endYear: r.end_year == null ? null : Number(r.end_year), description: r.description || null
  };
}

const shortName = (n) => {
  const parts = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Paklance member';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0)}.` : parts[0];
};

async function ratings(userIds) {
  const out = {};
  if (!userIds.length) return out;
  const rows = await db('reviews').whereIn('reviewee_id', userIds).select('reviewee_id', 'role', 'stars');
  for (const r of rows) {
    const o = (out[r.reviewee_id] = out[r.reviewee_id] || { freelancer: [0, 0, 0, 0, 0], client: [0, 0, 0, 0, 0] });
    const i = 5 - Number(r.stars);
    if (i >= 0 && i < 5) o[r.role][i] += 1;
  }
  return out;
}

// { avg, count } from a star distribution
function summary(dist) {
  let n = 0, sum = 0;
  (dist || []).forEach((c, i) => { n += c; sum += c * (5 - i); });
  return { avg: n ? Math.round((sum / n) * 10) / 10 : 0, count: n };
}

async function reviewsFor(userId) {
  const rows = await db('reviews as r')
    .leftJoin('users as u', 'u.id', 'r.reviewer_id')
    .leftJoin('talent_profiles as t', 't.user_id', 'r.reviewer_id')
    .where('r.reviewee_id', userId)
    .orderBy([{ column: 'r.created_at', order: 'desc' }, { column: 'r.id', order: 'desc' }])
    .select('r.role', 'r.stars', 'r.text', 'r.project', 'r.created_at', 'u.full_name', 't.city');
  const per = { freelancer: 0, client: 0 };
  const out = [];
  for (const r of rows) {
    if (per[r.role] >= 10) continue;
    per[r.role] += 1;
    out.push({
      role: r.role, stars: Number(r.stars), project: r.project, text: r.text,
      by: shortName(r.full_name) + (r.city ? ' · ' + r.city : ''), date: String(r.created_at).slice(0, 7)
    });
  }
  return out;
}

async function sellerBuyer(userId) {
  const asFreelancer = await db('contracts').where({ freelancer_id: userId, is_sample: false }).select('id', 'client_id', 'status');
  const asClient = await db('contracts').where({ client_id: userId, is_sample: false }).select('id', 'freelancer_id', 'status');
  const fIds = asFreelancer.map((c) => c.id);
  const cIds = asClient.map((c) => c.id);
  const released = fIds.length ? await db.count(db('milestones').whereIn('contract_id', fIds).where({ status: 'released' })) : 0;
  const refunds = fIds.length ? await db.count(db('milestones').whereIn('contract_id', fIds).where({ status: 'refunded' })) : 0;
  const spent = cIds.length ? await db.sum(db('milestones').whereIn('contract_id', cIds).where({ status: 'released' }), 'amount') : 0;
  return {
    seller: {
      earned: await db.sum(db('ledger_entries').where({ user_id: userId, type: 'milestone_release' }), 'amount'),
      projects: asFreelancer.filter((c) => c.status === 'completed').length,
      services: released,
      clients: new Set(asFreelancer.filter((c) => c.status !== 'cancelled').map((c) => c.client_id)).size,
      refunds
    },
    buyer: {
      spent,
      posted: await db.count(db('jobs').where({ client_id: userId, is_sample: false })),
      hires: asClient.length
    }
  };
}

async function profilePage(user, computedStats) {
  const u = typeof user === 'object' ? user : await db('users').where({ id: user }).first();
  if (!u) return null;
  const rating = (await ratings([u.id]))[u.id] || { freelancer: [0, 0, 0, 0, 0], client: [0, 0, 0, 0, 0] };
  const stats = computedStats ? await computedStats(u.id) : null;
  return {
    memberSince: u.created_at ? String(u.created_at).slice(0, 10) : null,
    photo: u.photo_url || null,
    video: presentVideo(u),
    rating,
    reviews: await reviewsFor(u.id),
    ...(await sellerBuyer(u.id)),
    delivery: stats && stats.completion != null ? [stats.completion, stats.onTime, stats.repeatClients] : null,
    items: (await db('profile_items').where({ user_id: u.id }).orderBy([{ column: 'created_at', order: 'asc' }, { column: 'id', order: 'asc' }])).map(presentItem)
  };
}

module.exports = { profilePage, ratings, summary, shortName };
