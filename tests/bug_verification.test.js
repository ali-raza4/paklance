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
const codeFor = (to) => (lastMailTo(to).subject.match(/^(\d{6})/) || [])[1];

async function newUser(email, { name = 'Test User', role = 'freelancer', skills = ['Web Development'], password = 'Passw0rd!' } = {}) {
  const agent = request.agent(app);
  await agent.post('/api/auth/signup').send({ email, password }).expect(201);
  await agent.post('/api/auth/verify-email').send({ email, code: codeFor(email) }).expect(200);
  if (name) await agent.patch('/api/me').send({ fullName: name }).expect(200);
  if (role) await db('users').where({ email }).update({ role });
  if (skills && role !== 'client') await agent.patch('/api/me').send({ skills }).expect(200);
  return agent;
}

test.before(async () => {
  if (db.isPg) {
    if (!/_test(\?|$)/.test(process.env.DATABASE_URL)) throw new Error('Use a database whose name ends in _test for tests.');
    await db.migrate.rollback(undefined, true);
  }
  await db.migrate.latest();
  await seedIfEmpty(db);
  app = createApp();
});

test.after(() => db.destroy());

test('BUG 1: User search works for authenticated non-admin users without Access Denied', async () => {
  // 1. Create client and specialist users
  const clientAgent = await newUser('client.tariq@example.com', { name: 'Tariq Mehmood', role: 'client' });
  const specialistAgent = await newUser('specialist.zoya@example.com', { name: 'Zoya Khan', role: 'freelancer', skills: ['UI/UX Design'] });

  // 2. Unauthenticated search is rejected
  await request(app).get('/api/users/search?q=Zoya').expect(401);

  // 3. Client searches for specialist by partial and case-insensitive name
  const r1 = await clientAgent.get('/api/users/search?q=zoy').expect(200);
  assert.ok(Array.isArray(r1.body));
  const zoyaMatch = r1.body.find(u => u.name.includes('Zoya'));
  assert.ok(zoyaMatch, 'Zoya Khan should be found by partial query "zoy"');
  assert.equal(zoyaMatch.name, 'Zoya Khan');
  assert.ok(zoyaMatch.accountType === 'Specialist / Freelancer' || zoyaMatch.role === 'freelancer');
  // Sensitive fields must NOT be exposed
  assert.equal(zoyaMatch.passwordHash, undefined);
  assert.equal(zoyaMatch.password, undefined);
  assert.equal(zoyaMatch.bankAccount, undefined);

  // 4. Specialist searches for client by full name
  const r2 = await specialistAgent.get('/api/users/search?q=Tariq Mehmood').expect(200);
  assert.ok(Array.isArray(r2.body));
  const tariqMatch = r2.body.find(u => u.name.includes('Tariq'));
  assert.ok(tariqMatch, 'Tariq Mehmood should be found by full name');
  assert.ok(tariqMatch.accountType === 'Client' || tariqMatch.role === 'client');
  assert.equal(tariqMatch.passwordHash, undefined);

  // 5. User does not see themselves in search results
  const rSelf = await clientAgent.get('/api/users/search?q=Tariq').expect(200);
  assert.ok(!rSelf.body.some(u => u.email === 'client.tariq@example.com'), 'Searcher should not see themselves in search results');

  // 6. Open a conversation from the search result and send a message
  const sendRes = await clientAgent.post('/api/messaging/send').send({
    receiverId: zoyaMatch.id,
    content: 'Hello Zoya, I saw your design work!'
  }).expect(201);
  assert.equal(sendRes.body.content, 'Hello Zoya, I saw your design work!');

  // 7. Verify specialist receives the message
  const convsRes = await specialistAgent.get('/api/messaging/conversations').expect(200);
  assert.ok(convsRes.body.length > 0);
  const conv = convsRes.body.find(c => c.otherUser.id === tariqMatch.id);
  assert.ok(conv, 'Conversation should exist with Tariq');
  assert.equal(conv.lastMessage.content, 'Hello Zoya, I saw your design work!');
});

test('BUG 2: Bank account details persistence, reload, duplicate prevention, and user isolation', async () => {
  const specialist = await newUser('banktest.spec@example.com', { name: 'Asad Ali', role: 'freelancer' });
  const otherUser = await newUser('other.user@example.com', { name: 'Other User', role: 'client' });

  // 1. Unauthenticated request to save payout method is rejected
  await request(app).post('/api/wallet/payout-methods').send({
    channel: 'Bank Account / 1Link (IBAN)',
    accountTitle: 'Asad Ali',
    accountNumber: 'PK36SCBL0000001123456701'
  }).expect(401);

  // 2. Validation: missing account title or number returns 400
  await specialist.post('/api/wallet/payout-methods').send({
    channel: 'Bank Account / 1Link (IBAN)',
    accountTitle: '',
    accountNumber: 'PK36SCBL0000001123456701'
  }).expect(400);

  await specialist.post('/api/wallet/payout-methods').send({
    channel: 'Bank Account / 1Link (IBAN)',
    accountTitle: 'Asad Ali',
    accountNumber: ''
  }).expect(400);

  // 3. Save bank account details via POST /api/wallet/payout-methods
  const saveRes = await specialist.post('/api/wallet/payout-methods').send({
    type: 'BANK',
    channel: 'Bank Account / 1Link (IBAN)',
    accountTitle: 'Asad Ali',
    accountNumber: 'PK36SCBL0000001123456701',
    bankName: 'Standard Chartered Pakistan',
    isDefault: true
  }).expect(201);

  assert.ok(saveRes.body.id, 'Response should contain persisted record id');
  assert.equal(saveRes.body.accountTitle, 'Asad Ali');
  assert.equal(saveRes.body.accountNumber, undefined, 'Full account number must never be exposed');
  assert.ok(saveRes.body.accountNumberMasked.includes('6701'), 'Masked account number should be returned');

  // 4. Verify record directly in database
  const dbRows = await db('payout_methods').where({ account_number: 'PK36SCBL0000001123456701' });
  assert.equal(dbRows.length, 1, 'Exactly one record should be in database');
  assert.equal(dbRows[0].account_title, 'Asad Ali');
  assert.equal(dbRows[0].bank_name, 'Standard Chartered Pakistan');

  // 5. Reload saved payment method from backend (Wallet reopening / page refresh)
  const getRes = await specialist.get('/api/wallet/payout-methods').expect(200);
  assert.ok(Array.isArray(getRes.body.payoutMethods || getRes.body));
  const methods = getRes.body.payoutMethods || getRes.body;
  assert.equal(methods.length, 1);
  assert.equal(methods[0].accountNumber, undefined, 'Full account number must not be exposed');
  assert.ok(methods[0].accountNumberMasked.includes('6701'));
  assert.equal(methods[0].accountTitle, 'Asad Ali');

  // 6. Duplicate prevention: resaving or editing the same account updates the existing record
  await specialist.post('/api/wallet/payout-methods').send({
    type: 'BANK',
    channel: 'Bank Account / 1Link (IBAN)',
    accountTitle: 'Asad Ali Updated',
    accountNumber: 'PK36SCBL0000001123456701',
    bankName: 'Standard Chartered Bank Limited',
    isDefault: true
  }).expect(200);

  const dbRowsAfterResave = await db('payout_methods').where({ account_number: 'PK36SCBL0000001123456701' });
  assert.equal(dbRowsAfterResave.length, 1, 'Duplicate records must not be created on resave');
  assert.equal(dbRowsAfterResave[0].account_title, 'Asad Ali Updated');

  // 7. Isolation: other user can NEVER see this user's bank account
  const otherRes = await otherUser.get('/api/wallet/payout-methods').expect(200);
  const otherMethods = otherRes.body.payoutMethods || otherRes.body;
  assert.equal(otherMethods.length, 0, 'Other user must not see any payout methods of Asad Ali');
});

test('SECURITY: Regular users cannot change their role or escalate privileges via PATCH /api/me', async () => {
  const member = await newUser('member.security@example.com', { name: 'Regular Member', role: 'member' });

  // 1. Attempting to change role to admin or client via PATCH /api/me must fail (400)
  await member.patch('/api/me').send({ role: 'admin' }).expect(400);
  await member.patch('/api/me').send({ role: 'client' }).expect(400);

  // 2. Attempting to include role with other valid fields must NOT update role
  await member.patch('/api/me').send({ fullName: 'Updated Name', role: 'admin' }).expect(200);

  // 3. Verify user's role remains unchanged in the database
  const user = await db('users').where({ email: 'member.security@example.com' }).first();
  assert.equal(user.role, 'member', 'User role must not be altered via PATCH /api/me');
});

