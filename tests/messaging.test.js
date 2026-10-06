'use strict';
/* End-to-end messaging tests: conversations, send, receive, unsend, user search. Run: npm test */
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

async function newUser(email, { name = 'Test User', skills = ['Web Development', 'React'], password = 'Passw0rd!' } = {}) {
  const agent = request.agent(app);
  await agent.post('/api/auth/signup').send({ email, password }).expect(201);
  await agent.post('/api/auth/verify-email').send({ email, code: codeFor(email) }).expect(200);
  if (name) await agent.patch('/api/me').send({ fullName: name }).expect(200);
  if (skills) await agent.patch('/api/me').send({ skills }).expect(200);
  const me = await agent.get('/api/me').expect(200);
  agent.userId = me.body.user.id;
  agent.userName = me.body.user.fullName;
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

test('messaging: send, receive, persist, unsend across all user combinations', async () => {
  const clientA = await newUser('client_a@test.com', { name: 'Client Aamir' });
  const clientB = await newUser('client_b@test.com', { name: 'Client Bilal' });
  const freelancerA = await newUser('free_a@test.com', { name: 'Freelancer Fatima' });
  const freelancerB = await newUser('free_b@test.com', { name: 'Freelancer Farhan' });

  // 1. Initially empty conversation list
  let convs = await clientA.get('/api/messaging/conversations').expect(200);
  assert.equal(convs.body.length, 0);

  // 2. Client -> Freelancer
  const msg1 = await clientA.post('/api/messaging/send')
    .send({ receiverId: freelancerA.userId, content: 'Hi Fatima, are you available for a project?' })
    .expect(201);

  assert.equal(msg1.body.senderId, clientA.userId);
  assert.equal(msg1.body.content, 'Hi Fatima, are you available for a project?');
  const convId = msg1.body.conversationId;

  // Freelancer checks conversations
  let fConvs = await freelancerA.get('/api/messaging/conversations').expect(200);
  assert.equal(fConvs.body.length, 1);
  assert.equal(fConvs.body[0].id, convId);
  assert.equal(fConvs.body[0].otherUser.id, clientA.userId);
  assert.equal(fConvs.body[0].otherUser.name, 'Client Aamir');
  assert.equal(fConvs.body[0].lastMessage.content, 'Hi Fatima, are you available for a project?');

  // Freelancer reads messages
  let msgs = await freelancerA.get(`/api/messaging/conversations/${convId}/messages`).expect(200);
  assert.equal(msgs.body.length, 1);
  assert.equal(msgs.body[0].isRead, true);

  // 3. Freelancer -> Client (reply)
  const msg2 = await freelancerA.post('/api/messaging/send')
    .send({ receiverId: clientA.userId, content: 'Yes Aamir, I am available! Tell me more.' })
    .expect(201);
  assert.equal(msg2.body.conversationId, convId);

  // Client checks messages (persistence check)
  let cMsgs = await clientA.get(`/api/messaging/conversations/${convId}/messages`).expect(200);
  assert.equal(cMsgs.body.length, 2);
  assert.equal(cMsgs.body[0].content, 'Hi Fatima, are you available for a project?');
  assert.equal(cMsgs.body[1].content, 'Yes Aamir, I am available! Tell me more.');

  // 4. Freelancer -> Freelancer
  const ffMsg = await freelancerA.post('/api/messaging/send')
    .send({ receiverId: freelancerB.userId, content: 'Hey Farhan, want to collaborate?' })
    .expect(201);
  assert.ok(ffMsg.body.conversationId);

  const fbConvs = await freelancerB.get('/api/messaging/conversations').expect(200);
  assert.equal(fbConvs.body.length, 1);
  assert.equal(fbConvs.body[0].otherUser.id, freelancerA.userId);

  // 5. Client -> Client
  const ccMsg = await clientA.post('/api/messaging/send')
    .send({ receiverId: clientB.userId, content: 'Hello Bilal, how was your experience?' })
    .expect(201);
  assert.ok(ccMsg.body.conversationId);

  const cbConvs = await clientB.get('/api/messaging/conversations').expect(200);
  assert.equal(cbConvs.body.length, 1);
  assert.equal(cbConvs.body[0].otherUser.id, clientA.userId);

  // 6. Unsend own message
  await clientA.delete(`/api/messaging/messages/${msg1.body.id}`).expect(200);
  cMsgs = await clientA.get(`/api/messaging/conversations/${convId}/messages`).expect(200);
  assert.equal(cMsgs.body.length, 1);
  assert.equal(cMsgs.body[0].id, msg2.body.id);

  // Cannot unsend someone else's message
  await clientA.delete(`/api/messaging/messages/${msg2.body.id}`).expect(403);

  // Cannot message yourself
  await clientA.post('/api/messaging/send')
    .send({ receiverId: clientA.userId, content: 'Self message' })
    .expect(400);

  // Cannot view stranger conversation
  await clientB.get(`/api/messaging/conversations/${convId}/messages`).expect(403);

  // 7. User search
  const searchRes = await clientA.get('/api/users/search?q=Farhan').expect(200);
  assert.ok(searchRes.body.length >= 1);
  assert.equal(searchRes.body[0].name, 'Freelancer Farhan');
});
