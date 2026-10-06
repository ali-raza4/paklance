'use strict';
/*
 * Seed data.
 *
 * SAMPLE CONTENT (all environments, unless SEED_SAMPLE_CONTENT=false):
 *   the 7 sample jobs, 7 sample specialists, 16 demo blog articles and 3 sample seminar dates from the approved design.
 *   Demo articles are kept in step with seeds/data/demo-articles.json at every start (real articles are never touched),
 *   and sample seminars are moved forward so they are always upcoming, until a real seminar is scheduled.
 *   They are flagged is_sample / is_demo, so the site keeps showing its "Sample" / "Demo Content" labels,
 *   and nobody can apply to a sample job. Remove them with:  npm run admin -- clear-samples
 *
 * DEMO ACCOUNTS (development only, never in production):
 *   demo@paklance.com   / Paklance123   specialist with an active contract, a finished one with reviews, wallet balance
 *                                       and notifications
 *   client@paklance.com / Paklance123   client who posted a job and funds milestones
 */
const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { refreshSampleSeminars } = require('./routes/seminars');

const DATA = path.join(config.ROOT, 'seeds', 'data');
const load = (f) => require(path.join(DATA, f));
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

async function seedJobs(db) {
  const jobs = load('sample-jobs.json');
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const at = iso(i * MIN); // keeps the design's order under "newest first"
    const clientUserId = crypto.createHash('md5').update('paklance-sample-client-' + (j.clientLabel || i)).digest('hex');
    const existingUser = await db('users').where({ id: clientUserId }).first();
    if (!existingUser) {
      await db('users').insert({
        id: clientUserId,
        email: `client${i + 1}@paklance.sample`,
        password_hash: null,
        full_name: j.clientLabel || 'Client',
        skills: JSON.stringify([]),
        email_verified: true,
        identity_verified: true,
        provider: 'email',
        role: 'member',
        is_sample: true,
        created_at: at,
        updated_at: at
      });
    }
    const [row] = await db('jobs').insert({
      client_id: clientUserId, title: j.title, client_label: j.clientLabel, city: j.city, category: j.category, budget: j.budget,
      type: j.type, safepay: j.safepay, client_verified: j.clientVerified, skills: JSON.stringify(j.skills),
      description: j.description, status: 'open', is_sample: true, created_at: at, updated_at: at
    }).returning('id');
    const id = typeof row === 'object' ? row.id : row;
    await db('job_milestones').insert(j.milestones.map((m, k) => ({ job_id: id, position: k + 1, title: m.title, amount: m.amount })));
  }
}

async function seedTalent(db) {
  const talent = load('sample-talent.json');
  for (let i = 0; i < talent.length; i++) {
    const t = talent[i];
    const at = iso(i * MIN);
    const talentUserId = crypto.createHash('md5').update('paklance-sample-talent-' + t.slug).digest('hex');
    const existingUser = await db('users').where({ id: talentUserId }).first();
    if (!existingUser) {
      await db('users').insert({
        id: talentUserId,
        email: `${t.slug}@paklance.sample`,
        password_hash: null,
        full_name: t.name,
        skills: JSON.stringify(t.skills),
        email_verified: true,
        identity_verified: true,
        provider: 'email',
        role: 'member',
        is_sample: true,
        created_at: at,
        updated_at: at
      });
    }
    const existingProfile = await db('talent_profiles').where({ id: t.slug }).first();
    if (!existingProfile) {
      await db('talent_profiles').insert({
        id: t.slug, user_id: talentUserId, name: t.name, initials: t.initials, headline: t.headline, city: t.city, category: t.category,
        hourly_rate: t.hourlyRate, availability: t.availability, skills: JSON.stringify(t.skills), bio: t.bio,
        stats: JSON.stringify(t.stats), verified: true, published: true, is_sample: true, created_at: at, updated_at: at
      });
    } else if (!existingProfile.user_id) {
      await db('talent_profiles').where({ id: t.slug }).update({ user_id: talentUserId });
    }
  }
}

function articleRow(a) {
  return {
    title: a.title, excerpt: a.excerpt, category: a.category, tags: JSON.stringify(a.tags || []),
    body: JSON.stringify(a.body || []), takeaways: a.takeaways ? JSON.stringify(a.takeaways) : null, cta: a.cta ? JSON.stringify(a.cta) : null,
    featured: !!a.featured, popular: !!a.popular, published_on: a.date, updated_on: a.updated || null
  };
}

async function seedArticles(db) {
  const articles = load('demo-articles.json');
  const at = new Date().toISOString();
  for (const a of articles) {
    await db('blog_articles').insert({ slug: a.slug, ...articleRow(a), is_demo: true, status: 'published', created_at: at, updated_at: at });
  }
}

// Brings the demo articles up to date with demo-articles.json (new demo articles are added; real articles and
// articles whose slug is used by a real article are left alone). Returns how many rows changed.
async function syncDemoArticles(db) {
  const articles = load('demo-articles.json');
  const rows = await db('blog_articles').select('id', 'slug', 'is_demo', 'body', 'takeaways', 'cta', 'title', 'excerpt');
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const at = new Date().toISOString();
  let n = 0;
  for (const a of articles) {
    const r = bySlug.get(a.slug);
    const want = articleRow(a);
    if (!r) {
      await db('blog_articles').insert({ slug: a.slug, ...want, is_demo: true, status: 'published', created_at: at, updated_at: at });
      n++;
    } else if (db.bool(r.is_demo) && (r.body !== want.body || (r.takeaways || null) !== want.takeaways || (r.cta || null) !== want.cta || r.title !== want.title || r.excerpt !== want.excerpt)) {
      await db('blog_articles').where({ id: r.id }).update({ ...want, updated_at: at });
      n++;
    }
  }
  const featured = articles.find((a) => a.featured);
  if (featured && !(await db('blog_articles').where({ is_demo: false, featured: true }).first())) {
    await db('blog_articles').whereNot({ slug: featured.slug }).where({ is_demo: true, featured: true }).update({ featured: false });
  }
  return n;
}

async function seedDemoAccounts(db) {
  if (await db('users').where({ email: 'demo@paklance.com' }).first()) return false;
  const hash = await bcrypt.hash('Paklance123', config.auth.bcryptRounds);
  const now = new Date().toISOString();
  const demo = crypto.randomUUID();
  const client = crypto.randomUUID();
  await db('users').insert([
    { id: demo, email: 'demo@paklance.com', password_hash: hash, full_name: 'Demo User', skills: JSON.stringify(['Web Development', 'React']), email_verified: true, identity_verified: false, provider: 'email', role: 'member', is_sample: true, created_at: now, updated_at: now },
    { id: client, email: 'client@paklance.com', password_hash: hash, full_name: 'Sana Khan', skills: JSON.stringify(['Brand Identity', 'Digital Marketing']), email_verified: true, identity_verified: true, provider: 'email', role: 'member', is_sample: true, created_at: now, updated_at: now }
  ]);

  // A job from the demo client that the demo specialist can apply to.
  const [jr] = await db('jobs').insert({
    client_id: client, title: 'Speed up a WordPress store (Core Web Vitals)', client_label: 'Sana Enterprises', city: 'Lahore',
    category: 'Development', budget: 40000, type: 'Fixed price', safepay: true, client_verified: true,
    skills: JSON.stringify(['WordPress', 'Web Development', 'Performance']),
    description: 'Audit our WooCommerce store, fix slow pages and get Core Web Vitals into the green on mobile. Share a before/after report.',
    status: 'open', is_sample: false, created_at: iso(5 * MIN), updated_at: now
  }).returning('id');
  const jobId = typeof jr === 'object' ? jr.id : jr;
  await db('job_milestones').insert([
    { job_id: jobId, position: 1, title: 'Audit & plan', amount: 15000 },
    { job_id: jobId, position: 2, title: 'Fixes & report', amount: 25000 }
  ]);

  // A contract between them: milestone 1 released, 2 funded (protected), 3 not funded yet.
  const [cr] = await db('contracts').insert({
    code: null, client_id: client, freelancer_id: demo, title: 'Company website redesign', client_label: 'Sana Enterprises',
    total_amount: 65000, status: 'active', is_sample: false, created_at: iso(12 * DAY), updated_at: now
  }).returning('id');
  const contractId = typeof cr === 'object' ? cr.id : cr;
  await db('contracts').where({ id: contractId }).update({ code: 'PK-' + (10000 + contractId) });
  await db('milestones').insert([
    { contract_id: contractId, position: 1, title: 'Wireframes & design direction', amount: 20000, status: 'released', funded_at: iso(11 * DAY), submitted_at: iso(6 * DAY), released_at: iso(5 * DAY), created_at: now, updated_at: now },
    { contract_id: contractId, position: 2, title: 'Homepage & inner pages', amount: 25000, status: 'funded', funded_at: iso(4 * DAY), created_at: now, updated_at: now },
    { contract_id: contractId, position: 3, title: 'Launch & handover', amount: 20000, status: 'unfunded', created_at: now, updated_at: now }
  ]);
  const ms = await db('milestones').where({ contract_id: contractId }).orderBy('position');
  await db('payments').insert([
    { contract_id: contractId, milestone_id: ms[0].id, payer_id: client, method: 'bank_transfer', amount: 20000, fee: Math.round(20000 * config.fees.clientPercent / 100), total: 20000 + Math.round(20000 * config.fees.clientPercent / 100), reference: 'PLF-DEMO01', status: 'confirmed', created_at: iso(11 * DAY), confirmed_at: iso(11 * DAY), updated_at: now },
    { contract_id: contractId, milestone_id: ms[1].id, payer_id: client, method: 'bank_transfer', amount: 25000, fee: Math.round(25000 * config.fees.clientPercent / 100), total: 25000 + Math.round(25000 * config.fees.clientPercent / 100), reference: 'PLF-DEMO02', status: 'confirmed', created_at: iso(4 * DAY), confirmed_at: iso(4 * DAY), updated_at: now }
  ]);
  const fee = Math.round(20000 * config.fees.specialistPercent / 100);
  await db('ledger_entries').insert([
    { user_id: demo, type: 'milestone_release', amount: 20000, contract_id: contractId, milestone_id: ms[0].id, description: 'Released: Wireframes & design direction', created_at: iso(5 * DAY) },
    { user_id: demo, type: 'specialist_fee', amount: -fee, contract_id: contractId, milestone_id: ms[0].id, description: 'Paklance fee on Wireframes & design direction', created_at: iso(5 * DAY) }
  ]);

  // An earlier, finished contract with a review from each side (stars on both profiles).
  const [dr] = await db('contracts').insert({
    code: null, client_id: client, freelancer_id: demo, title: 'Landing page for a spring sale', client_label: 'Sana Enterprises',
    total_amount: 30000, status: 'completed', is_sample: false, created_at: iso(40 * DAY), updated_at: iso(30 * DAY)
  }).returning('id');
  const doneId = typeof dr === 'object' ? dr.id : dr;
  await db('contracts').where({ id: doneId }).update({ code: 'PK-' + (10000 + doneId) });
  const [dm] = await db('milestones').insert({
    contract_id: doneId, position: 1, title: 'Design, build and launch', amount: 30000, status: 'released',
    funded_at: iso(39 * DAY), submitted_at: iso(32 * DAY), released_at: iso(30 * DAY), created_at: iso(40 * DAY), updated_at: iso(30 * DAY)
  }).returning('id');
  const doneMs = typeof dm === 'object' ? dm.id : dm;
  const fee2 = Math.round(30000 * config.fees.specialistPercent / 100);
  const cfee2 = Math.round(30000 * config.fees.clientPercent / 100);
  await db('payments').insert({ contract_id: doneId, milestone_id: doneMs, payer_id: client, method: 'bank_transfer', amount: 30000, fee: cfee2, total: 30000 + cfee2, reference: 'PLF-DEMO03', status: 'confirmed', created_at: iso(39 * DAY), confirmed_at: iso(39 * DAY), updated_at: iso(39 * DAY) });
  await db('ledger_entries').insert([
    { user_id: demo, type: 'milestone_release', amount: 30000, contract_id: doneId, milestone_id: doneMs, description: 'Released: Design, build and launch', created_at: iso(30 * DAY) },
    { user_id: demo, type: 'specialist_fee', amount: -fee2, contract_id: doneId, milestone_id: doneMs, description: 'Paklance fee on Design, build and launch', created_at: iso(30 * DAY) }
  ]);
  await db('reviews').insert([
    { contract_id: doneId, reviewer_id: client, reviewee_id: demo, role: 'freelancer', stars: 5, project: 'Landing page for a spring sale', text: 'Fast, clear updates and the page was live two days early. Our sale traffic loaded quickly on mobile.', created_at: iso(29 * DAY) },
    { contract_id: doneId, reviewer_id: demo, reviewee_id: client, role: 'client', stars: 5, project: 'Landing page for a spring sale', text: 'Clear brief, quick feedback and every milestone funded on time.', created_at: iso(29 * DAY) }
  ]);
  await db('notifications').insert([
    { user_id: demo, type: 'milestone_funded', title: 'Milestone funded, you can start', meta: 'Homepage & inner pages · PK-' + (10000 + contractId), created_at: iso(4 * DAY) },
    { user_id: demo, type: 'milestone_released', title: `PKR ${(20000 - fee).toLocaleString('en-US')} released to your wallet`, meta: 'Wireframes & design direction · PK-' + (10000 + contractId), created_at: iso(5 * DAY), read_at: iso(5 * DAY) },
    { user_id: client, type: 'funding_confirmed', title: 'SafePay funding confirmed', meta: 'Homepage & inner pages · PK-' + (10000 + contractId), created_at: iso(4 * DAY) }
  ]);
  return true;
}

async function seedIfEmpty(db, { log = !config.isTest } = {}) {
  const done = [];
  if (config.seed.sampleContent) {
    if (!(await db('jobs').where({ is_sample: true }).first()) && !(await db('jobs').first())) { await seedJobs(db); done.push('sample jobs'); }
    if (!(await db('talent_profiles').first())) { await seedTalent(db); done.push('sample specialists'); }
    if (!(await db('blog_articles').first())) { await seedArticles(db); done.push('demo blog articles'); }
    else { const n = await syncDemoArticles(db); if (n) done.push(`${n} demo blog article${n === 1 ? '' : 's'} updated`); }
    await refreshSampleSeminars();
  }
  if (config.seed.demoAccounts && (await seedDemoAccounts(db))) done.push('demo accounts (demo@paklance.com, client@paklance.com / Paklance123)');
  if (log && done.length) console.log('Seeded: ' + done.join(', ') + '.');
}

// Removes the sample/demo content (keeps everything real).
async function clearSamples(db) {
  const jobs = await db('jobs').where({ is_sample: true }).del();
  const talent = await db('talent_profiles').where({ is_sample: true }).del();
  const articles = await db('blog_articles').where({ is_demo: true }).del();
  const users = await db('users').where({ is_sample: true }).del();
  const seminars = await db('seminars').where({ is_sample: true }).del();
  return { jobs, talent, articles, users, seminars };
}

// Puts the sample content back to its original state (used by `npm run seed`).
async function reseedSamples(db) {
  await db('jobs').where({ is_sample: true }).del();
  await db('talent_profiles').where({ is_sample: true }).del();
  await db('blog_articles').where({ is_demo: true }).del();
  await seedJobs(db);
  await seedTalent(db);
  const slugs = new Set((await db('blog_articles').select('slug')).map((r) => r.slug));
  if (!slugs.size) await seedArticles(db); else await syncDemoArticles(db);
  await refreshSampleSeminars();
  if (config.seed.demoAccounts) await seedDemoAccounts(db);
}

module.exports = { seedIfEmpty, clearSamples, reseedSamples };
