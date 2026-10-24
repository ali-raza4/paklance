'use strict';
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
const codeFor = (to) => (lastMailTo(to)?.subject?.match(/^(\d{6})/) || [])[1];

test.before(async () => {
  if (db.isPg) {
    if (!/_test(\?|$)/.test(process.env.DATABASE_URL)) throw new Error('Use a database whose name ends in _test for tests.');
    await db.migrate.rollback(undefined, true);
  }
  await db.migrate.latest();
  await seedIfEmpty(db);
  app = createApp();
});

test.after(async () => {
  await db.destroy();
});

test('role selection and enforcement during registration and API usage', async () => {
  try {
  // 1. Client registration: explicit client role selection
  const clientAgent = request.agent(app);
  const clientEmail = 'client-role-test@example.com';

  // Request signup as client
  let res = await clientAgent.post('/api/auth/signup').send({
    email: clientEmail,
    password: 'ClientPassword123!',
    role: 'client'
  }).expect(201);
  assert.equal(res.body.pendingVerification, true);

  // Retrieve verification code
  const clientCode = codeFor(clientEmail);
  assert.match(clientCode, /^\d{6}$/);

  // Verify email
  res = await clientAgent.post('/api/auth/verify-email').send({
    email: clientEmail,
    code: clientCode,
    role: 'client'
  }).expect(200);

  assert.equal(res.body.user.email, clientEmail);
  assert.equal(res.body.user.role, 'client');
  assert.equal(res.body.user.emailVerified, true);
  assert.deepEqual(res.body.user.skills, []);

  // Client sets full name but provides NO skills
  res = await clientAgent.patch('/api/me').send({ fullName: 'Client Test Corp' }).expect(200);
  assert.equal(res.body.user.fullName, 'Client Test Corp');
  assert.equal(res.body.user.role, 'client');
  assert.deepEqual(res.body.user.skills, []);

  // Client creates a job successfully
  res = await clientAgent.post('/api/jobs').send({
    title: 'Need a Fullstack Developer for App',
    category: 'Development',
    city: 'Lahore',
    budget: 50000,
    type: 'Fixed price',
    skills: ['React', 'Node.js'],
    description: 'Looking for an experienced engineer to build our portal.'
  }).expect(201);
  const jobId = res.body.job.id;
  assert.ok(jobId);

  // Client CANNOT apply to jobs (403 CLIENT_CANNOT_APPLY)
  res = await clientAgent.post(`/api/jobs/${jobId}/proposals`).send({
    bid: 45000,
    coverLetter: 'I am a client trying to bid on my own job.'
  }).expect(403);
  assert.equal(res.body.code, 'CLIENT_CANNOT_APPLY');

  // Persistence check: client logs out and logs back in
  await clientAgent.post('/api/auth/logout').expect(200);
  res = await clientAgent.post('/api/auth/login').send({
    email: clientEmail,
    password: 'ClientPassword123!'
  }).expect(200);
  assert.equal(res.body.user.role, 'client');
  assert.equal(res.body.user.fullName, 'Client Test Corp');

  // 2. Freelancer registration: explicit freelancer/specialist role selection
  const freeAgent = request.agent(app);
  const freeEmail = 'freelancer-role-test@example.com';

  res = await freeAgent.post('/api/auth/signup').send({
    email: freeEmail,
    password: 'FreePassword123!',
    role: 'freelancer'
  }).expect(201);

  const freeCode = codeFor(freeEmail);
  res = await freeAgent.post('/api/auth/verify-email').send({
    email: freeEmail,
    code: freeCode,
    role: 'freelancer'
  }).expect(200);

  assert.equal(res.body.user.role, 'specialist');
  assert.deepEqual(res.body.user.skills, []);

  // Freelancer sets name
  await freeAgent.patch('/api/me').send({ fullName: 'Specialist Pro' }).expect(200);

  // Freelancer tries to apply before adding skills -> 403 PROFILE_INCOMPLETE
  res = await freeAgent.post(`/api/jobs/${jobId}/proposals`).send({
    bidAmount: 48000,
    coverLetter: 'I have experience in building portals and would love to help.'
  }).expect(403);
  assert.equal(res.body.code, 'PROFILE_INCOMPLETE');

  // Freelancer sets skills
  res = await freeAgent.patch('/api/me').send({ skills: ['React', 'Node.js'] }).expect(200);
  assert.deepEqual(res.body.user.skills, ['React', 'Node.js']);

  // Now freelancer applies successfully
  res = await freeAgent.post(`/api/jobs/${jobId}/proposals`).send({
    bidAmount: 48000,
    coverLetter: 'I have experience in building portals and would love to help.'
  }).expect(201);
  assert.ok(res.body.proposal.id);

  // Persistence check: freelancer logs out and logs back in
  await freeAgent.post('/api/auth/logout').expect(200);
  res = await freeAgent.post('/api/auth/login').send({
    email: freeEmail,
    password: 'FreePassword123!'
  }).expect(200);
  assert.equal(res.body.user.role, 'specialist');
  assert.deepEqual(res.body.user.skills, ['React', 'Node.js']);

  // 3. Security checks: Admin escalation and invalid roles are strictly rejected
  const evilAgent = request.agent(app);
  res = await evilAgent.post('/api/auth/signup').send({
    email: 'evil-admin@example.com',
    password: 'Password123!',
    role: 'admin'
  }).expect(400);
  assert.equal(res.body.code, 'INVALID_ROLE');

  res = await evilAgent.post('/api/auth/signup').send({
    email: 'evil-hacker@example.com',
    password: 'Password123!',
    role: 'superadmin'
  }).expect(400);
  assert.equal(res.body.code, 'INVALID_ROLE');
  } catch (err) {
    console.error('ROLE TEST CAUGHT ERROR:', err);
    throw err;
  }
});
