'use strict';
/* End-to-end API tests on an in-memory SQLite database.   Run: npm test */
process.env.NODE_ENV = 'test';
process.env.RESEND_COOLDOWN_SECONDS = '0';
process.env.ADMIN_EMAILS = 'ops@paklance.test';
process.env.SEED_DEMO_ACCOUNTS = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const { createApp } = require('../src/app');
const { seedIfEmpty } = require('../src/seed');
const mailer = require('../src/lib/mailer');

let app;
const lastMailTo = (to) => [...mailer.outbox].reverse().find((m) => m.to === to);
const codeFor = (to) => (lastMailTo(to).subject.match(/^(\d{6})/) || [])[1];

// Full email sign-up + onboarding; returns a logged-in agent.
async function newUser(email, { name = 'Test User', skills = ['Web Development', 'React'], password = 'Passw0rd!' } = {}) {
  const agent = request.agent(app);
  await agent.post('/api/auth/signup').send({ email, password }).expect(201);
  await agent.post('/api/auth/verify-email').send({ email, code: codeFor(email) }).expect(200);
  if (name) await agent.patch('/api/me').send({ fullName: name }).expect(200);
  if (skills) await agent.patch('/api/me').send({ skills }).expect(200);
  return agent;
}

test.before(async () => {
  if (db.isPg) {
    // Tests can also run on PostgreSQL: DATABASE_URL=postgres://…/paklance_test npm test
    // The database is wiped first, so its name must end in _test.
    if (!/_test(\?|$)/.test(process.env.DATABASE_URL)) throw new Error('Use a database whose name ends in _test for tests.');
    await db.migrate.rollback(undefined, true);
  }
  await db.migrate.latest();
  await seedIfEmpty(db);
  app = createApp();
});
test.after(() => db.destroy());

test('health, config and payment methods', async () => {
  await request(app).get('/api/health').expect(200, { ok: true });
  const { body } = await request(app).get('/api/config').expect(200);
  assert.equal(body.fees.clientPercent, 3);
  const jc = body.paymentMethods.find((m) => m.id === 'jazzcash');
  const ep = body.paymentMethods.find((m) => m.id === 'easypaisa');
  assert.equal(jc.status, 'coming_soon');
  assert.equal(ep.status, 'coming_soon');
});

test('jobs: sample listings, filters, search, sort', async () => {
  let r = await request(app).get('/api/jobs').expect(200);
  assert.equal(r.body.total, 7);
  assert.ok(r.body.jobs.every((j) => j.isSample));
  assert.equal(r.body.jobs[0].title, 'Shopify store setup for a clothing brand');
  assert.equal(r.body.jobs[0].milestones.length, 3);
  r = await request(app).get('/api/jobs?category=Design').expect(200);
  assert.equal(r.body.total, 1);
  r = await request(app).get('/api/jobs?minBudget=100000').expect(200);
  assert.equal(r.body.total, 1);
  r = await request(app).get('/api/jobs?maxBudget=50000').expect(200);            // price range slider
  assert.deepEqual(r.body.jobs.map((j) => j.budget).sort((x, y) => x - y), [24000, 30000, 45000]);
  r = await request(app).get('/api/jobs?minBudget=25000&maxBudget=50000').expect(200);
  assert.equal(r.body.total, 2);
  r = await request(app).get('/api/jobs?q=shopify').expect(200);
  assert.equal(r.body.total, 1);
  r = await request(app).get('/api/jobs?q=100%25').expect(200);
  assert.equal(r.body.total, 0);
  r = await request(app).get('/api/jobs?sort=high').expect(200);
  assert.equal(r.body.jobs[0].budget, 180000);
  r = await request(app).get('/api/jobs?verified=true&safepay=true').expect(200);
  assert.ok(r.body.jobs.every((j) => j.clientVerified && j.safepay));
  await request(app).get('/api/jobs/9999').expect(404);
});

test('talent: sample profiles and search', async () => {
  let r = await request(app).get('/api/talent').expect(200);
  assert.equal(r.body.total, 7);
  assert.deepEqual(r.body.talent.find((t) => t.id === 'areeba').stats, { completion: 98, onTime: 94, repeatClients: 71 });
  r = await request(app).get('/api/talent?q=react').expect(200);
  assert.equal(r.body.talent[0].id, 'bilal');
  r = await request(app).get('/api/talent?available=now&maxRate=3000').expect(200);
  assert.deepEqual(r.body.talent.map((t) => t.id).sort(), ['hamza']);
  await request(app).get('/api/talent/bilal').expect(200);
  await request(app).get('/api/talent/nobody').expect(404);
});

test('profile completion tracker: introduction and profile sections', async () => {
  const me = await newUser('tracker@paklance.test', { name: 'Sana Tariq' });
  let r = await me.get('/api/me/profile').expect(200);
  assert.equal(r.body.profile, null);
  assert.deepEqual(r.body.items, []);

  // validation matches the tracker's forms
  r = await me.post('/api/me/profile/items').send({ kind: 'nope' }).expect(400);
  assert.ok(r.body.fields.kind);
  r = await me.post('/api/me/profile/items').send({ kind: 'portfolio', title: 'x', url: 'not a link' }).expect(400);
  assert.ok(r.body.fields.title && r.body.fields.url);
  r = await me.post('/api/me/profile/items').send({ kind: 'portfolio', title: 'Sales dashboard', url: 'javascript:alert(1)' }).expect(400);
  assert.ok(r.body.fields.url);
  r = await me.post('/api/me/profile/items').send({ kind: 'education', title: 'BS Data Analytics', subtitle: 'COMSATS', startYear: 2023, endYear: 2021 }).expect(400);
  assert.match(r.body.fields.endYear, /before the start year/);
  r = await me.post('/api/me/profile/items').send({ kind: 'certificates', title: 'Google Data Analytics', subtitle: 'Coursera', endYear: 1901 }).expect(400);
  assert.match(r.body.fields.endYear, /1960/);
  r = await me.post('/api/me/profile/items').send({ kind: 'services', title: 'Power BI dashboard', amount: 100 }).expect(400);
  assert.ok(r.body.fields.amount);

  // one of each section
  r = await me.post('/api/me/profile/items').send({ kind: 'portfolio', title: 'Sales dashboard', url: 'behance.net/sana/sales' }).expect(201);
  assert.equal(r.body.item.url, 'https://behance.net/sana/sales');
  const portfolioId = r.body.item.id;
  r = await me.post('/api/me/profile/items').send({ kind: 'services', title: 'Power BI dashboard', amount: '15,000', description: 'Up to 3 pages, 2 revisions.' }).expect(201);
  assert.equal(r.body.item.amount, 15000);
  await me.post('/api/me/profile/items').send({ kind: 'education', title: 'BS Business Data Analytics', subtitle: 'COMSATS University Islamabad', startYear: 2023, endYear: 2027 }).expect(201);
  r = await me.post('/api/me/profile/items').send({ kind: 'experience', title: 'Data analyst intern', subtitle: 'Systems Ltd', startYear: '2025' }).expect(201);
  assert.equal(r.body.item.endYear, null); // still working there
  await me.post('/api/me/profile/items').send({ kind: 'certificates', title: 'Google Data Analytics', subtitle: 'Coursera', endYear: 2025 }).expect(201);
  await me.put('/api/me/profile').send({ headline: 'Data analyst and dashboard builder', city: 'Islamabad', category: 'AI & Data', hourlyRate: 2500, availability: 'Available now', bio: 'I turn messy spreadsheets into clear Power BI dashboards.' }).expect(201);

  r = await me.get('/api/me/profile').expect(200);
  assert.equal(r.body.profile.headline, 'Data analyst and dashboard builder');
  assert.deepEqual(r.body.items.map((i) => i.kind), ['portfolio', 'services', 'education', 'experience', 'certificates']);

  // only the owner sees and removes their items
  const other = await newUser('other-tracker@paklance.test');
  assert.deepEqual((await other.get('/api/me/profile').expect(200)).body.items, []);
  await other.delete(`/api/me/profile/items/${portfolioId}`).expect(404);
  await me.delete(`/api/me/profile/items/${portfolioId}`).expect(200);
  await me.delete(`/api/me/profile/items/${portfolioId}`).expect(404);
  r = await me.get('/api/me/profile').expect(200);
  assert.equal(r.body.items.filter((i) => i.kind === 'portfolio').length, 0);

  // signed out, or sign-up not finished
  await request(app).get('/api/me/profile').expect(401);
  await request(app).post('/api/me/profile/items').send({ kind: 'portfolio', title: 'Nope' }).expect(401);
  const half = await newUser('half-tracker@paklance.test', { skills: null });
  r = await half.post('/api/me/profile/items').send({ kind: 'portfolio', title: 'Too early' }).expect(403);
  assert.equal(r.body.code, 'PROFILE_INCOMPLETE');
});

test('sign up with email: validation, verification, onboarding, log in/out', async () => {
  const a = request.agent(app);
  let r = await a.get('/api/me').expect(200);
  assert.equal(r.body.user, null);

  r = await a.post('/api/auth/signup').send({ email: 'nope', password: 'Passw0rd!' }).expect(400);
  assert.equal(r.body.code, 'VALIDATION_ERROR');
  r = await a.post('/api/auth/signup').send({ email: 'sara@example.com', password: 'short' }).expect(400);
  assert.match(r.body.message, /8 characters/);

  r = await a.post('/api/auth/signup').send({ email: 'Sara@Example.com', password: 'Passw0rd!' }).expect(201);
  assert.deepEqual(r.body, { pendingVerification: true });
  const code = codeFor('sara@example.com');
  assert.match(code, /^\d{6}$/);

  r = await a.post('/api/auth/verify-email').send({ email: 'sara@example.com', code: code === '000000' ? '111111' : '000000' }).expect(400);
  assert.equal(r.body.code, 'INVALID_CODE');
  // the code only works in the browser that asked for it
  r = await request(app).post('/api/auth/verify-email').send({ email: 'sara@example.com', code }).expect(404);
  assert.equal(r.body.code, 'NOT_FOUND');

  r = await a.post('/api/auth/resend-code').send({ email: 'sara@example.com' }).expect(200);
  const code2 = codeFor('sara@example.com');
  r = await a.post('/api/auth/verify-email').send({ email: 'sara@example.com', code: code2 }).expect(200);
  assert.equal(r.body.user.email, 'sara@example.com');
  assert.equal(r.body.user.emailVerified, true);
  assert.equal(r.body.user.fullName, null);
  assert.deepEqual(r.body.user.skills, []);
  assert.equal(r.body.user.provider, 'email');

  r = await a.get('/api/me').expect(200);
  assert.equal(r.body.user.email, 'sara@example.com');

  r = await a.patch('/api/me').send({ fullName: 'S' }).expect(400);
  assert.equal(r.body.code, 'INVALID_NAME');
  r = await a.patch('/api/me').send({ fullName: '  Sara   Ahmed ' }).expect(200);
  assert.equal(r.body.user.fullName, 'Sara Ahmed');
  r = await a.patch('/api/me').send({ skills: [] }).expect(400);
  assert.equal(r.body.code, 'INVALID_SKILLS');
  r = await a.patch('/api/me').send({ skills: ['React', 'react', 'Figma'] }).expect(200);
  assert.deepEqual(r.body.user.skills, ['React', 'Figma']);

  r = await request(app).post('/api/auth/signup').send({ email: 'sara@example.com', password: 'Passw0rd!' }).expect(409);
  assert.equal(r.body.code, 'EMAIL_TAKEN');

  await a.post('/api/auth/logout').expect(200);
  r = await a.get('/api/me').expect(200);
  assert.equal(r.body.user, null);
  r = await a.patch('/api/me').send({ fullName: 'Sara Ahmed' }).expect(401);
  assert.equal(r.body.code, 'UNAUTHENTICATED');

  r = await a.post('/api/auth/login').send({ email: 'sara@example.com', password: 'wrongpass1' }).expect(400);
  assert.equal(r.body.code, 'INVALID_CREDENTIALS');
  r = await a.post('/api/auth/login').send({ email: 'SARA@example.com', password: 'Passw0rd!' }).expect(200);
  assert.equal(r.body.user.fullName, 'Sara Ahmed');
  assert.deepEqual(r.body.user.skills, ['React', 'Figma']);
  assert.equal(r.body.user.role, 'member');
});

test('re-login: skills and profile preserved, client accounts do not require skills', async () => {
  // 1. Specialist logs out and logs back in — skills are retained and returned
  const specEmail = 'spec-relogin@example.com';
  const spec = await newUser(specEmail, { name: 'ReLogin Specialist', skills: ['Web Development', 'Node.js'] });
  let meRes = await spec.get('/api/me').expect(200);
  assert.deepEqual(meRes.body.user.skills, ['Web Development', 'Node.js']);

  await spec.post('/api/auth/logout').expect(200);
  const specLogin = await request(app).post('/api/auth/login').send({ email: specEmail, password: 'Passw0rd!' }).expect(200);
  assert.equal(specLogin.body.user.fullName, 'ReLogin Specialist');
  assert.deepEqual(specLogin.body.user.skills, ['Web Development', 'Node.js']);

  // 2. Client account setup: clients have full name but no skills required
  const clientEmail = 'client-relogin@example.com';
  const client = request.agent(app);
  await client.post('/api/auth/signup').send({ email: clientEmail, password: 'Passw0rd!' }).expect(201);
  await client.post('/api/auth/verify-email').send({ email: clientEmail, code: codeFor(clientEmail) }).expect(200);
  await client.patch('/api/me').send({ fullName: 'Client Owner' }).expect(200);

  // Mark role as client
  await db('users').where({ email: clientEmail }).update({ role: 'client' });

  // Client logs out and logs back in
  await client.post('/api/auth/logout').expect(200);
  const clientLogin = await client.post('/api/auth/login').send({ email: clientEmail, password: 'Passw0rd!' }).expect(200);
  assert.equal(clientLogin.body.user.fullName, 'Client Owner');
  assert.equal(clientLogin.body.user.role, 'client');
  assert.deepEqual(clientLogin.body.user.skills, []);

  // Client can post a job without skills setup requirement
  await client.post('/api/jobs').send({
    title: 'Client Project Job',
    clientLabel: 'Client Org',
    city: 'Lahore',
    category: 'Development',
    budget: 50000,
    type: 'Fixed price',
    skills: ['React'],
    description: 'Detailed description for client project job posting requirement.'
  }).expect(201);
});

test('unverified sign-up: log in continues at the verify step', async () => {
  const phone = request.agent(app);
  await phone.post('/api/auth/signup').send({ email: 'late@example.com', password: 'Passw0rd!' }).expect(201);
  const laptop = request.agent(app);
  let r = await laptop.post('/api/auth/login').send({ email: 'late@example.com', password: 'Passw0rd!' }).expect(200);
  assert.deepEqual(r.body, { pendingVerification: true });
  r = await laptop.post('/api/auth/verify-email').send({ email: 'late@example.com', code: codeFor('late@example.com') }).expect(200);
  assert.equal(r.body.user.email, 'late@example.com');
  r = await laptop.post('/api/auth/login').send({ email: 'late@example.com', password: 'Wrong1234' }).expect(400);
  assert.equal(r.body.code, 'INVALID_CREDENTIALS');
});

test('nobody can set the password for someone else’s pending sign-up', async () => {
  const victim = request.agent(app);
  const attacker = request.agent(app);
  await victim.post('/api/auth/signup').send({ email: 'victim@example.com', password: 'VictimPass1' }).expect(201);
  const victimCode = codeFor('victim@example.com');
  await attacker.post('/api/auth/signup').send({ email: 'victim@example.com', password: 'Attacker99' }).expect(201);
  const attackerTriggeredCode = codeFor('victim@example.com');
  // the victim types the most recent code from their inbox: it belongs to the attacker's request → rejected
  if (attackerTriggeredCode !== victimCode) {
    const r = await victim.post('/api/auth/verify-email').send({ email: 'victim@example.com', code: attackerTriggeredCode }).expect(400);
    assert.equal(r.body.code, 'INVALID_CODE');
  }
  await victim.post('/api/auth/verify-email').send({ email: 'victim@example.com', code: victimCode }).expect(200);
  await request(app).post('/api/auth/login').send({ email: 'victim@example.com', password: 'Attacker99' }).expect(400);
  await request(app).post('/api/auth/login').send({ email: 'victim@example.com', password: 'VictimPass1' }).expect(200);
});

test('forgot / reset password', async () => {
  let r = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(200);
  assert.deepEqual(r.body, { ok: true });
  await request(app).post('/api/auth/forgot-password').send({ email: 'sara@example.com' }).expect(200);
  const link = lastMailTo('sara@example.com').text.match(/https?:\/\/\S+reset-password\?token=(\S+)/);
  assert.ok(link, 'reset link emailed');
  const token = decodeURIComponent(link[1]);
  const a = request.agent(app);
  r = await a.post('/api/auth/reset-password').send({ token, password: 'weak' }).expect(400);
  r = await a.post('/api/auth/reset-password').send({ token, password: 'NewPassw0rd' }).expect(200);
  assert.equal(r.body.user.email, 'sara@example.com');
  r = await a.post('/api/auth/reset-password').send({ token, password: 'NewPassw0rd2' }).expect(400);
  assert.equal(r.body.code, 'INVALID_TOKEN');
  await request(app).post('/api/auth/login').send({ email: 'sara@example.com', password: 'Passw0rd!' }).expect(400);
  await request(app).post('/api/auth/login').send({ email: 'sara@example.com', password: 'NewPassw0rd' }).expect(200);
});

test('Google sign-in: off without credentials; new user, returning user, account linking', async () => {
  const config = require('../src/config');
  const authRoutes = require('../src/routes/auth');
  let r = await request(app).post('/api/auth/google').send({ code: 'x' }).expect(503);
  assert.equal(r.body.code, 'GOOGLE_UNAVAILABLE');
  assert.equal((await request(app).get('/api/config')).body.googleClientId, null);

  const people = {
    'tok-gina': { sub: 'g-1', email: 'gina@example.com', email_verified: true, name: 'Gina Malik' },
    'tok-sara': { sub: 'g-2', email: 'Sara@example.com', email_verified: true },
    'tok-unverified': { sub: 'g-3', email: 'u@example.com', email_verified: false }
  };
  authRoutes._setGoogleClient({
    async getToken(code) { return { tokens: { id_token: 'tok-' + code } }; },
    async verifyIdToken({ idToken, audience }) {
      assert.equal(audience, 'test-client-id');
      if (!people[idToken]) throw new Error('bad token');
      return { getPayload: () => people[idToken] };
    }
  });
  config.google.clientId = 'test-client-id';
  config.google.clientSecret = 'test-secret';
  try {
    assert.equal((await request(app).get('/api/config')).body.googleClientId, 'test-client-id');
    const a = request.agent(app);
    r = await a.post('/api/auth/google').send({ code: 'gina' }).expect(200);
    assert.equal(r.body.user.provider, 'google');
    assert.equal(r.body.user.emailVerified, true);
    assert.equal(r.body.user.fullName, null, 'name is still asked for in onboarding');
    const ginaId = r.body.user.id;
    r = await a.get('/api/me').expect(200);
    assert.equal(r.body.user.id, ginaId);
    r = await request(app).post('/api/auth/google').send({ credential: 'tok-gina' }).expect(200);
    assert.equal(r.body.user.id, ginaId, 'returning Google user');
    r = await request(app).post('/api/auth/login').send({ email: 'gina@example.com', password: 'Whatever1' }).expect(400);
    assert.equal(r.body.code, 'USE_GOOGLE');
    await request(app).post('/api/auth/forgot-password').send({ email: 'gina@example.com' }).expect(200);
    assert.match(lastMailTo('gina@example.com').subject, /Signing in to Paklance/);

    r = await request(app).post('/api/auth/google').send({ code: 'sara' }).expect(200);
    assert.equal(r.body.user.fullName, 'Sara Ahmed', 'linked to the existing email account');
    assert.equal(r.body.user.provider, 'email');
    await request(app).post('/api/auth/login').send({ email: 'sara@example.com', password: 'NewPassw0rd' }).expect(200);

    r = await request(app).post('/api/auth/google').send({ code: 'unverified' }).expect(400);
    assert.equal(r.body.code, 'GOOGLE_EMAIL_UNVERIFIED');
    r = await request(app).post('/api/auth/google').send({ code: 'forged' }).expect(401);
    assert.equal(r.body.code, 'INVALID_GOOGLE_TOKEN');
  } finally {
    config.google.clientId = '';
    config.google.clientSecret = '';
    authRoutes._setGoogleClient(null);
  }
});

test('Match shortlist and Global hiring requirements', async () => {
  let r = await request(app).post('/api/match-requests').send({
    role: 'Senior full-stack engineer for a SaaS dashboard', engagement: 'Dedicated resource', seniority: 'Senior',
    timezone: '4+ hours with UK / Europe', budgetModel: 'Monthly engagement', skills: 'React, Next.js, Node.js'
  }).expect(201);
  assert.equal(r.body.shortlist[0].id, 'bilal');
  assert.equal(r.body.shortlist[0].fit, 100);
  assert.deepEqual(r.body.shortlist[0].matchedSkills, ['React', 'Next.js', 'Node.js']);
  r = await request(app).post('/api/match-requests').send({ role: 'x' }).expect(400);
  assert.equal(r.body.code, 'VALIDATION_ERROR');

  const body = { role: 'Senior React engineer + QA', engagement: 'Dedicated resource', timezone: 'UK / Europe', duration: '6 months+', startWindow: 'Within 2 weeks', skills: 'React, TypeScript, Playwright', protections: { nda: true, ip: true, replacement: false } };
  await request(app).post('/api/global-requests').send(body).expect(401);
  const a = await newUser('global@example.com', { name: 'Omar Sheikh' });
  r = await a.post('/api/global-requests').send(body).expect(201);
  assert.equal(r.body.request.status, 'draft');
  assert.deepEqual(r.body.request.skills, ['React', 'TypeScript', 'Playwright']);
  r = await a.get('/api/global-requests').expect(200);
  assert.equal(r.body.requests.length, 1);
});

test('full marketplace flow: post job → apply → hire → fund → confirm → submit → approve → withdraw', async () => {
  const client = await newUser('client@example.com', { name: 'Nadia Karim', skills: ['Digital Marketing'] });
  const pro = await newUser('pro@example.com', { name: 'Ali Raza', skills: ['WordPress', 'Web Development'] });
  const ops = await newUser('ops@paklance.test', { name: 'Ops Team' });

  // onboarding must be finished before posting / applying
  const half = request.agent(app);
  await half.post('/api/auth/signup').send({ email: 'half@example.com', password: 'Passw0rd!' });
  await half.post('/api/auth/verify-email').send({ email: 'half@example.com', code: codeFor('half@example.com') }).expect(200);
  let r = await half.post('/api/jobs/1/proposals').send({}).expect(403);
  assert.equal(r.body.code, 'PROFILE_INCOMPLETE');

  // post a job
  const job = {
    title: 'WordPress site speed optimisation', city: 'Lahore', category: 'Development', budget: 40000,
    skills: ['WordPress', 'Performance'], description: 'Fix slow pages and get Core Web Vitals into the green on mobile devices.',
    milestones: [{ title: 'Audit & plan', amount: 15000 }, { title: 'Fixes & report', amount: 20000 }]
  };
  r = await client.post('/api/jobs').send(job).expect(400);
  assert.match(r.body.fields.milestones, /add up to/);
  job.milestones[1].amount = 25000;
  r = await client.post('/api/jobs').send(job).expect(201);
  const jobId = r.body.job.id;
  assert.equal(r.body.job.isSample, false);
  assert.equal(r.body.job.clientLabel, 'Private client');
  r = await request(app).get('/api/jobs').expect(200);
  assert.equal(r.body.jobs[0].id, jobId, 'real jobs are listed before samples');

  // apply
  r = await pro.post('/api/jobs/1/proposals').send({}).expect(409);
  assert.equal(r.body.code, 'SAMPLE_CONTENT');
  r = await client.post(`/api/jobs/${jobId}/proposals`).send({}).expect(403);
  r = await pro.post(`/api/jobs/${jobId}/proposals`).send({}).expect(201);
  const proposalId = r.body.proposal.id;
  assert.equal(r.body.proposal.bidAmount, 40000);
  r = await pro.post(`/api/jobs/${jobId}/proposals`).send({}).expect(409);
  assert.equal(r.body.code, 'ALREADY_APPLIED');
  r = await pro.get(`/api/jobs/${jobId}`).expect(200);
  assert.equal(r.body.job.hasApplied, true);
  r = await client.get(`/api/jobs/${jobId}/proposals`).expect(200);
  assert.equal(r.body.proposals[0].freelancer.name, 'Ali Raza');
  await pro.get(`/api/jobs/${jobId}/proposals`).expect(404);
  r = await client.get('/api/notifications').expect(200);
  assert.equal(r.body.notifications[0].title, 'New proposal received');
  assert.equal(r.body.unread, 1);

  // hire → contract
  r = await client.post(`/api/proposals/${proposalId}/hire`).send({}).expect(201);
  const cid = r.body.contractId;
  assert.match(r.body.code, /^PK-\d+$/);
  r = await request(app).get(`/api/jobs/${jobId}`).expect(404); // closed after hiring
  r = await pro.get(`/api/contracts/${cid}`).expect(200);
  const c = r.body.contract;
  assert.equal(c.role, 'freelancer');
  assert.equal(c.milestones.length, 2);
  assert.deepEqual(c.totals, { value: 40000, released: 0, protected: 0 });
  const m1 = c.milestones[0];
  await request(app).get(`/api/contracts/${cid}`).expect(401);
  await ops.get(`/api/contracts/${cid}`).expect(200); // admins can look

  // SafePay funding
  r = await pro.post(`/api/contracts/${cid}/milestones/${m1.id}/submit`).send({}).expect(409);
  assert.match(r.body.message, /funded/);
  r = await pro.post(`/api/contracts/${cid}/milestones/${m1.id}/fund`).send({ method: 'bank_transfer' }).expect(403);
  r = await client.post(`/api/contracts/${cid}/milestones/${m1.id}/fund`).send({ method: 'jazzcash' }).expect(409);
  assert.equal(r.body.code, 'GATEWAY_COMING_SOON');
  r = await client.post(`/api/contracts/${cid}/milestones/${m1.id}/fund`).send({ method: 'easypaisa' }).expect(409);
  r = await client.post(`/api/contracts/${cid}/milestones/${m1.id}/fund`).send({ method: 'bank_transfer' }).expect(201);
  assert.equal(r.body.payment.fee, 450);
  assert.equal(r.body.payment.total, 15450);
  assert.equal(r.body.payment.status, 'pending');
  const ref = r.body.payment.reference;
  assert.match(ref, /^PLF-[A-Z2-9]{6}$/);
  assert.match(lastMailTo('client@example.com').text, new RegExp(ref));
  r = await client.post(`/api/contracts/${cid}/milestones/${m1.id}/fund`).send({ method: 'bank_transfer' }).expect(201);
  assert.equal(r.body.payment.reference, ref, 'asking again shows the same transfer');
  r = await client.get(`/api/contracts/${cid}`).expect(200);
  assert.equal(r.body.contract.milestones[0].status, 'funding_pending');
  assert.equal(r.body.contract.totals.protected, 0, 'not protected until the money is confirmed');

  // ops confirms the transfer
  await client.get('/api/admin/payments').expect(403);
  r = await ops.get('/api/admin/payments').expect(200);
  const pay = r.body.payments.find((p) => p.reference === ref);
  await ops.post(`/api/admin/payments/${pay.id}/confirm`).send({ bankReference: 'IBFT-778812' }).expect(200);
  r = await ops.post(`/api/admin/payments/${pay.id}/confirm`).send({}).expect(409);
  r = await client.get(`/api/contracts/${cid}`).expect(200);
  assert.equal(r.body.contract.milestones[0].status, 'funded');
  assert.equal(r.body.contract.totals.protected, 15000);

  // deliver and approve
  await client.post(`/api/contracts/${cid}/milestones/${m1.id}/approve`).send({}).expect(409);
  await pro.post(`/api/contracts/${cid}/milestones/${m1.id}/submit`).send({ note: 'Audit attached.' }).expect(200);
  await client.post(`/api/contracts/${cid}/milestones/${m1.id}/request-changes`).send({ note: 'Please add the mobile scores too.' }).expect(200);
  await pro.post(`/api/contracts/${cid}/milestones/${m1.id}/submit`).send({ note: 'Added mobile scores.' }).expect(200);
  await pro.post(`/api/contracts/${cid}/milestones/${m1.id}/approve`).send({}).expect(403);
  r = await client.post(`/api/contracts/${cid}/milestones/${m1.id}/approve`).send({}).expect(200);
  assert.equal(r.body.contract.milestones[0].status, 'released');
  assert.equal(r.body.contract.totals.released, 15000);
  await client.post(`/api/contracts/${cid}/milestones/${m1.id}/approve`).send({}).expect(409);

  // wallet: 15,000 − 10% = 13,500
  r = await pro.get('/api/wallet').expect(200);
  assert.equal(r.body.available, 13500);
  assert.equal(r.body.totalEarned, 13500);

  // payout methods
  r = await pro.post('/api/wallet/payout-methods').send({ channel: 'JazzCash Mobile Wallet — coming soon', accountTitle: 'Ali Raza', accountNumber: '03001234567' }).expect(409);
  assert.equal(r.body.code, 'GATEWAY_COMING_SOON');
  r = await pro.post('/api/wallet/payout-methods').send({ channel: 'Bank Account / 1Link (IBAN)', accountTitle: 'Ali Raza', accountNumber: 'PK12' }).expect(400);
  r = await pro.post('/api/wallet/payout-methods').send({ channel: 'Bank Account / 1Link (IBAN)', accountTitle: 'Ali Raza', accountNumber: 'PK36 SCBL 0000 0011 2345 6702', bankName: 'Standard Chartered' }).expect(201);
  assert.equal(r.body.payoutMethod.accountNumberMasked, '•••• 6702');
  assert.equal(r.body.payoutMethod.isDefault, true);
  assert.equal(r.body.payoutMethod.accountNumber, undefined, 'full number is never sent back');
  r = await pro.post('/api/wallet/payout-methods').send({ channel: 'Raast ID / Number', accountTitle: 'Ali Raza', accountNumber: '+92 300 1234567' }).expect(201);
  assert.equal(r.body.payoutMethod.channel, 'raast');

  // withdrawals
  r = await pro.post('/api/wallet/withdrawals').send({ channel: 'Raast ID / Mobile', accountTitle: 'Ali Raza', accountNumber: '03001234567', amount: '20,000' }).expect(409);
  assert.equal(r.body.code, 'INSUFFICIENT_BALANCE');
  r = await pro.post('/api/wallet/withdrawals').send({ channel: 'Raast ID / Mobile', accountTitle: 'Ali Raza', accountNumber: '03001234567', amount: 100 }).expect(400);
  r = await pro.post('/api/wallet/withdrawals').send({ channel: 'Raast ID / Mobile', accountTitle: 'Ali Raza', accountNumber: '03001234567', amount: '10,000' }).expect(201);
  const wid = r.body.withdrawal.id;
  r = await pro.get('/api/wallet').expect(200);
  assert.equal(r.body.available, 3500);
  assert.equal(r.body.locked, 10000);
  await ops.post(`/api/admin/withdrawals/${wid}/status`).send({ status: 'rejected', note: 'Account title mismatch' }).expect(200);
  r = await pro.get('/api/wallet').expect(200);
  assert.equal(r.body.available, 13500, 'rejected withdrawal goes back to the balance');
  assert.equal(r.body.locked, 0);
  await ops.post(`/api/admin/withdrawals/${wid}/status`).send({ status: 'paid' }).expect(409);

  // Resolution Centre on milestone 2
  const m2 = c.milestones[1];
  r = await client.post(`/api/contracts/${cid}/milestones/${m2.id}/fund`).send({ method: 'raast' }).expect(201);
  const p2 = (await ops.get('/api/admin/payments').expect(200)).body.payments.find((p) => p.reference === r.body.payment.reference);
  await ops.post(`/api/admin/payments/${p2.id}/confirm`).send({}).expect(200);
  r = await pro.post('/api/disputes').send({ contractId: cid, milestoneId: m2.id, issue: 'Payment / release issue', description: 'short' }).expect(400);
  r = await pro.post('/api/disputes').send({ contractId: cid, milestoneId: m2.id, issue: 'Payment / release issue', description: 'Work was delivered on time but the client has not responded for two weeks.' }).expect(201);
  const did = r.body.dispute.id;
  r = await client.get(`/api/contracts/${cid}`).expect(200);
  assert.equal(r.body.contract.milestones[1].status, 'disputed');
  await client.post(`/api/contracts/${cid}/milestones/${m2.id}/approve`).send({}).expect(409);
  await pro.post('/api/disputes').send({ contractId: cid, milestoneId: m2.id, issue: 'Other', description: 'A second case on the same milestone should fail.' }).expect(409);
  r = await client.get('/api/disputes').expect(200);
  assert.equal(r.body.disputes.length, 1);
  await ops.post(`/api/admin/disputes/${did}/resolve`).send({ outcome: 'release', note: 'Delivery evidence accepted.' }).expect(200);
  r = await pro.get('/api/wallet').expect(200);
  assert.equal(r.body.available, 13500 + 22500);
  r = await client.get(`/api/contracts/${cid}`).expect(200);
  assert.equal(r.body.contract.status, 'completed');

  // notifications
  r = await pro.get('/api/notifications').expect(200);
  assert.ok(r.body.unread > 0);
  await pro.post('/api/notifications/read-all').send({}).expect(200);
  r = await pro.get('/api/notifications').expect(200);
  assert.equal(r.body.unread, 0);

  // specialist profile + dashboard
  r = await pro.put('/api/me/profile').send({ headline: 'WordPress performance engineer', city: 'Lahore', category: 'Development', hourlyRate: 3000, bio: 'I make WordPress and WooCommerce sites fast, stable and easy to maintain.' }).expect(201);
  assert.equal(r.body.profile.id, 'ali-raza');
  assert.equal(r.body.profile.stats.completion, 100);
  r = await request(app).get('/api/talent?q=wordpress').expect(200);
  assert.equal(r.body.talent[0].id, 'ali-raza');
  r = await pro.get('/api/dashboard').expect(200);
  assert.equal(r.body.wallet.available, 36000);
  assert.equal(r.body.hasProfile, true);
});

test('blog, newsletter and SEO pages', async () => {
  let r = await request(app).get('/api/blog/articles').expect(200);
  assert.equal(r.body.total, 16);
  assert.ok(r.body.articles.every((a) => a.demo === true && a.body === undefined));
  assert.equal(r.body.articles.filter((a) => a.featured).length, 1);
  r = await request(app).get('/api/blog/articles?full=1&limit=200').expect(200);
  assert.ok(Array.isArray(r.body.articles[0].body));
  r = await request(app).get('/api/blog/articles?category=Global%20Hiring').expect(200);
  assert.ok(r.body.articles.length >= 1 && r.body.articles.every((a) => a.category === 'Global Hiring'));
  r = await request(app).get('/api/blog/articles/how-to-build-a-high-performing-remote-team').expect(200);
  assert.equal(r.body.related.length, 3);
  await request(app).get('/api/blog/articles/nope').expect(404);

  r = await request(app).post('/api/newsletter/subscribe').send({ email: 'bad' }).expect(400);
  r = await request(app).post('/api/newsletter/subscribe').send({ email: 'Reader@Example.com' }).expect(200);
  const mail = lastMailTo('reader@example.com');
  const token = mail.text.match(/token=(\S+)/)[1];
  await request(app).post('/api/newsletter/subscribe').send({ email: 'reader@example.com' }).expect(200);
  r = await request(app).get(`/newsletter/unsubscribe?token=${token}`).expect(200);
  assert.match(r.text, /unsubscribed/);

  r = await request(app).get('/blog/how-to-build-a-high-performing-remote-team').expect(200);
  assert.match(r.text, /<title>How to Build a High-Performing Remote Team \| Paklance Blog<\/title>/);
  assert.match(r.text, /og:title/);
  assert.match(r.text, /application\/ld\+json/);
  r = await request(app).get('/sitemap.xml').expect(200);
  assert.match(r.text, /\/blog\/introducing-the-new-paklance-sign-up/);
  await request(app).get('/robots.txt').expect(200);

  // admin publishing
  const ops = request.agent(app);
  await ops.post('/api/auth/login').send({ email: 'ops@paklance.test', password: 'Passw0rd!' }).expect(200);
  r = await ops.post('/api/admin/blog/articles').send({
    title: 'Paklance is live', excerpt: 'What you can do on Paklance today, from posting jobs to SafePay.', category: 'Paklance Updates',
    tags: ['paklance'], body: [['p', 'Hello **world**.'], ['h2', 'Next'], ['ul', ['One', 'Two']]]
  }).expect(201);
  assert.equal(r.body.article.slug, 'paklance-is-live');
  assert.equal(r.body.article.demo, false);
  r = await request(app).get('/api/blog/articles').expect(200);
  assert.equal(r.body.total, 17);
  await ops.post('/api/admin/blog/articles').send({ title: 'Bad body', excerpt: 'This article body is not valid at all.', category: 'Business', body: [['script', 'x']] }).expect(400);
});

test('website, security headers and cross-site protection', async () => {
  let r = await request(app).get('/').expect(200);
  assert.match(r.text, /<title>Paklance<\/title>/);
  assert.doesNotMatch(r.text, /reviewFab|Review build/);
  assert.match(r.headers['content-security-policy'], /script-src 'self' https:\/\/accounts.google.com\/gsi\/client/);
  await request(app).get('/pricing').expect(200);
  await request(app).get('/reset-password').expect(200);
  await request(app).get('/assets/js/site.js').expect(200);
  r = await request(app).get('/no-such-page').expect(404);
  r = await request(app).get('/api/no-such-endpoint').expect(404);
  assert.equal(r.body.code, 'NOT_FOUND');
  r = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({ email: 'a@b.co', password: 'x' }).expect(403);
  assert.equal(r.body.code, 'BAD_ORIGIN');
  r = await request(app).post('/api/auth/login').type('form').send('email=a@b.co&password=x').expect(400);
  assert.equal(r.body.code, 'UNSUPPORTED_MEDIA_TYPE');
  r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad').expect(400);
  assert.equal(r.body.code, 'BAD_JSON');
});
