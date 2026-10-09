'use strict';
/* API tests for Tasks 5–14: profile photo, video introduction, seminars, reviews/ratings and the blog's
   takeaways, next-step buttons and "Was this helpful?" feedback.   Run: npm test */
process.env.NODE_ENV = 'test';
process.env.RESEND_COOLDOWN_SECONDS = '0';
process.env.ADMIN_EMAILS = 'ops@paklance.test';
process.env.SEED_DEMO_ACCOUNTS = 'false';

const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const config = require('../src/config');
const { createApp } = require('../src/app');
const { seedIfEmpty } = require('../src/seed');
const mailer = require('../src/lib/mailer');

let app;
const ORIGIN = config.appUrl; // uploads must come from the site itself
const lastMailTo = (to) => [...mailer.outbox].reverse().find((m) => m.to === to);
const codeFor = (to) => (lastMailTo(to).subject.match(/^(\d{6})/) || [])[1];

async function newUser(email, { name = 'Test User', skills = ['Web Development', 'React'] } = {}) {
  const agent = request.agent(app);
  await agent.post('/api/auth/signup').send({ email, password: 'Passw0rd!' }).expect(201);
  await agent.post('/api/auth/verify-email').send({ email, code: codeFor(email) }).expect(200);
  if (name) await agent.patch('/api/me').send({ fullName: name }).expect(200);
  if (skills) await agent.patch('/api/me').send({ skills }).expect(200);
  return agent;
}

// Small files with the right first bytes
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(4000, 1)]);
const TEXT = Buffer.from('this is not a picture or a video, just some text in a file');

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
  fs.rmSync(config.uploads.dir, { recursive: true, force: true });
});

test('profile photo: upload, replace, remove; only images, only from the site', async () => {
  const a = await newUser('photo@example.com', { name: 'Hira Aslam' });
  let r = await a.get('/api/me').expect(200);
  assert.equal(r.body.user.photo, null);
  assert.match(r.body.user.memberSince, /^\d{4}-\d{2}-\d{2}$/);

  r = await a.post('/api/me/photo').attach('photo', JPEG, { filename: 'me.jpg', contentType: 'image/jpeg' }).expect(400);
  assert.equal(r.body.code, 'UNSUPPORTED_MEDIA_TYPE', 'an upload without the site’s Origin is refused');
  r = await a.post('/api/me/photo').set('Origin', 'https://evil.example').attach('photo', JPEG, 'me.jpg').expect(403);
  assert.equal(r.body.code, 'BAD_ORIGIN');
  r = await a.post('/api/me/photo').set('Origin', ORIGIN).attach('photo', TEXT, { filename: 'me.jpg', contentType: 'image/jpeg' }).expect(400);
  assert.equal(r.body.code, 'VALIDATION_ERROR', 'the file type comes from its bytes, not its name');
  r = await a.post('/api/me/photo').set('Origin', ORIGIN).attach('photo', JPEG, { filename: 'me.jpg', contentType: 'image/jpeg' }).expect(200);
  const first = r.body.user.photo;
  assert.match(first, /^\/uploads\/photos\/[\w-]+\.jpg$/);
  r = await request(app).get(first).expect(200);
  assert.equal(r.headers['content-type'], 'image/jpeg');

  r = await a.post('/api/me/photo').set('Origin', ORIGIN).attach('photo', JPEG, 'again.jpg').expect(200);
  assert.notEqual(r.body.user.photo, first);
  await new Promise((ok) => setTimeout(ok, 50));
  await request(app).get(first).expect(404);   // the old file is deleted
  await request(app).get('/uploads/tmp/anything').expect(404);
  await request(app).get('/uploads/../package.json').expect(404);

  r = await a.delete('/api/me/photo').expect(200);
  assert.equal(r.body.user.photo, null);
  await request(app).post('/api/me/photo').set('Origin', ORIGIN).attach('photo', JPEG, 'x.jpg').expect(401);
});

test('video introduction: link, upload, replace, remove', async () => {
  const a = await newUser('video@example.com', { name: 'Bilal Mahmood' });
  let r = await a.put('/api/me/profile/video').send({ url: 'https://example.com/my-video' }).expect(400);
  assert.match(r.body.message, /YouTube, Vimeo, Loom or Google Drive/);
  r = await a.put('/api/me/profile/video').send({ url: 'youtu.be/dQw4w9WgXcQ' }).expect(200);
  assert.deepEqual(r.body.video, { kind: 'link', url: 'https://youtu.be/dQw4w9WgXcQ' });
  r = await a.get('/api/me/profile').expect(200);
  assert.equal(r.body.video.url, 'https://youtu.be/dQw4w9WgXcQ');

  r = await a.post('/api/me/profile/video/upload').set('Origin', ORIGIN).attach('video', TEXT, { filename: 'intro.mp4', contentType: 'video/mp4' }).expect(400);
  assert.match(r.body.message, /MP4, MOV or WebM/);
  r = await a.post('/api/me/profile/video/upload').set('Origin', ORIGIN).field('duration', '400').attach('video', MP4, 'intro.mp4').expect(400);
  assert.match(r.body.message, /between 10 and 15 seconds/);
  r = await a.post('/api/me/profile/video/upload').set('Origin', ORIGIN).field('duration', '4').attach('video', MP4, 'intro.mp4').expect(400);
  assert.match(r.body.message, /at least 10 seconds/);
  r = await a.post('/api/me/profile/video/upload').set('Origin', ORIGIN).field('duration', '16').attach('video', MP4, 'intro.mp4').expect(400);
  assert.match(r.body.message, /between 10 and 15 seconds/);
  r = await a.post('/api/me/profile/video/upload').set('Origin', ORIGIN).field('duration', '12.4').attach('video', MP4, { filename: 'My intro.mp4', contentType: 'video/mp4' }).expect(201);
  const v = r.body.video;
  assert.equal(v.kind, 'upload');
  assert.equal(v.name, 'My intro.mp4');
  assert.equal(v.duration, 12);
  assert.equal(v.type, 'video/mp4');
  assert.equal(v.size, MP4.length);
  r = await request(app).get(v.url).set('Range', 'bytes=0-99').expect(206);   // seeking works
  assert.equal(r.headers['content-type'], 'video/mp4');
  assert.equal(fs.readdirSync(`${config.uploads.dir}/tmp`).length, 0, 'no temp files left behind');

  // a link replaces the upload, and the uploaded file is deleted
  await a.put('/api/me/profile/video').send({ url: 'https://vimeo.com/76979871' }).expect(200);
  await new Promise((ok) => setTimeout(ok, 50));
  await request(app).get(v.url).expect(404);
  r = await a.put('/api/me/profile/video').send({ url: '' }).expect(200);
  assert.equal(r.body.video, null);

  // onboarding comes first
  const half = request.agent(app);
  await half.post('/api/auth/signup').send({ email: 'halfvideo@example.com', password: 'Passw0rd!' });
  await half.post('/api/auth/verify-email').send({ email: 'halfvideo@example.com', code: codeFor('halfvideo@example.com') }).expect(200);
  r = await half.put('/api/me/profile/video').send({ url: 'youtu.be/dQw4w9WgXcQ' }).expect(403);
  assert.equal(r.body.code, 'PROFILE_INCOMPLETE');
});

test('seminars: sample dates, register, full, cancel, admin', async () => {
  let r = await request(app).get('/api/seminars').expect(200);
  assert.equal(r.body.seminars.length, 3);
  assert.ok(r.body.seminars.every((s) => s.sample && Date.parse(s.startsAt) > Date.now() && s.seatsLeft === s.seats));
  const a = await newUser('seminar@example.com', { name: 'Areeba Khan' });
  const b = await newUser('seminar2@example.com', { name: 'Hamza Qureshi' });
  const ops = await newUser('ops@paklance.test', { name: 'Ops Team' });
  r = await a.post(`/api/seminars/${r.body.seminars[0].id}/register`).send({}).expect(409);
  assert.equal(r.body.code, 'SAMPLE_CONTENT');

  await a.post('/api/admin/seminars').send({}).expect(403);
  r = await ops.post('/api/admin/seminars').send({ title: 'Record on your phone', mode: 'Online', place: 'Live on Zoom', about: 'Light, sound and a simple script.', startsAt: 'soon', minutes: 60, seats: 1 }).expect(400);
  assert.ok(r.body.fields.startsAt);
  const when = new Date(Date.now() + 3 * 86400000).toISOString();
  r = await ops.post('/api/admin/seminars').send({ title: 'Record on your phone', mode: 'Online', place: 'Live on Zoom', about: 'Light, sound and a simple script.', details: 'https://zoom.us/j/123', startsAt: when, minutes: 60, seats: 1 }).expect(201);
  const id = r.body.seminar.id;

  r = await request(app).get('/api/seminars').expect(200);
  assert.ok(r.body.seminars.some((s) => s.id === id && !s.sample));
  assert.equal(r.body.seminars.find((s) => s.id === id).details, undefined, 'the joining link is only emailed');
  await request(app).post(`/api/seminars/${id}/register`).send({}).expect(401);
  r = await a.post(`/api/seminars/${id}/register`).send({}).expect(201);
  assert.equal(r.body.seminar.registered, true);
  assert.equal(r.body.seminar.seatsLeft, 0);
  const mail = lastMailTo('seminar@example.com');
  assert.match(mail.subject, /You’re registered: Record on your phone/);
  assert.match(mail.text, /zoom\.us\/j\/123/);
  r = await a.post(`/api/seminars/${id}/register`).send({}).expect(200);
  assert.equal(r.body.seminar.taken, 1, 'registering twice keeps one place');
  r = await b.post(`/api/seminars/${id}/register`).send({}).expect(409);
  assert.equal(r.body.code, 'FULL');
  r = await a.get('/api/seminars').expect(200);
  assert.equal(r.body.seminars.find((s) => s.id === id).registered, true);
  r = await ops.get(`/api/admin/seminars/${id}/registrations`).expect(200);
  assert.equal(r.body.registrations[0].email, 'seminar@example.com');
  r = await a.delete(`/api/seminars/${id}/register`).expect(200);
  assert.equal(r.body.seminar.registered, false);
  await b.post(`/api/seminars/${id}/register`).send({}).expect(201);
  await ops.patch(`/api/admin/seminars/${id}`).send({ status: 'cancelled' }).expect(200);
  r = await request(app).get('/api/seminars').expect(200);
  assert.ok(!r.body.seminars.some((s) => s.id === id));
  await request(app).post('/api/seminars/nope/register').expect(401);
  await a.post('/api/seminars/nope/register').send({}).expect(404);
});

test('reviews after a finished contract: stars on both profiles, stats', async () => {
  const client = await newUser('rclient@example.com', { name: 'Nadia Karim', skills: ['Digital Marketing'] });
  const pro = await newUser('rpro@example.com', { name: 'Ali Raza', skills: ['WordPress'] });
  const ops = request.agent(app);
  await ops.post('/api/auth/login').send({ email: 'ops@paklance.test', password: 'Passw0rd!' }).expect(200);

  await pro.put('/api/me/profile').send({ headline: 'WordPress speed specialist', city: 'Lahore', category: 'Development', hourlyRate: 3000, availability: 'Available now', bio: 'I make WordPress and WooCommerce stores load fast on mobile.' }).expect(201);
  let r = await client.post('/api/jobs').send({ title: 'Speed up our WordPress shop', city: 'Karachi', category: 'Development', budget: 20000, skills: ['WordPress'], description: 'Make the product pages load in under two seconds on mobile phones.', milestones: [{ title: 'Speed fixes', amount: 20000 }] }).expect(201);
  const jobId = r.body.job.id;
  r = await pro.post(`/api/jobs/${jobId}/proposals`).send({}).expect(201);
  r = await client.post(`/api/proposals/${r.body.proposal.id}/hire`).send({}).expect(201);
  const cid = r.body.contractId;
  r = await client.get(`/api/contracts/${cid}`).expect(200);
  assert.deepEqual(r.body.contract.review, { canReview: false, mine: null, theirs: null });
  r = await client.post(`/api/contracts/${cid}/review`).send({ stars: 5, text: 'Great work, very fast.' }).expect(409);
  assert.equal(r.body.code, 'INVALID_STATE');

  const mid = (await client.get(`/api/contracts/${cid}`)).body.contract.milestones[0].id;
  r = await client.post(`/api/contracts/${cid}/milestones/${mid}/fund`).send({ method: 'bank_transfer' }).expect(201);
  const payment = (await ops.get('/api/admin/payments')).body.payments.find((p) => p.reference === r.body.payment.reference);
  await ops.post(`/api/admin/payments/${payment.id}/confirm`).send({}).expect(200);
  await pro.post(`/api/contracts/${cid}/milestones/${mid}/submit`).send({ note: 'Done.' }).expect(200);
  r = await client.post(`/api/contracts/${cid}/milestones/${mid}/approve`).send({}).expect(200);
  assert.equal(r.body.contract.status, 'completed');
  assert.equal(r.body.contract.review.canReview, true);

  r = await client.post(`/api/contracts/${cid}/review`).send({ stars: 6, text: 'x' }).expect(400);
  assert.ok(r.body.fields.stars && r.body.fields.text);
  r = await client.post(`/api/contracts/${cid}/review`).send({ stars: 5, text: 'Pages load in under two seconds now. Clear updates every day.' }).expect(201);
  assert.equal(r.body.contract.review.mine.stars, 5);
  assert.equal(r.body.contract.review.canReview, false);
  r = await client.post(`/api/contracts/${cid}/review`).send({ stars: 4, text: 'Changing my mind about this.' }).expect(409);
  assert.equal(r.body.code, 'ALREADY_REVIEWED');
  r = await pro.post(`/api/contracts/${cid}/review`).send({ stars: 4, text: 'Clear brief and quick approval.' }).expect(201);
  assert.equal(r.body.contract.review.theirs.stars, 5, 'each side sees the other’s review');
  r = await pro.get('/api/notifications').expect(200);
  assert.equal(r.body.notifications[0].title, 'New 5-star review');

  // the specialist's public profile
  r = await request(app).get('/api/talent?q=speed').expect(200);
  const t = r.body.talent.find((x) => x.name === 'Ali Raza');
  assert.deepEqual(t.rating, { avg: 5, count: 1 });
  r = await request(app).get(`/api/talent/${t.id}`).expect(200);
  const page = r.body.page;
  assert.deepEqual(page.rating.freelancer, [1, 0, 0, 0, 0]);
  assert.deepEqual(page.rating.client, [0, 0, 0, 0, 0]);
  assert.equal(page.reviews[0].by, 'Nadia K.');
  assert.equal(page.reviews[0].project, 'Speed up our WordPress shop');
  assert.match(page.reviews[0].date, /^\d{4}-\d{2}$/);
  assert.deepEqual(page.seller, { earned: 20000, projects: 1, services: 1, clients: 1, refunds: 0 });
  assert.equal(page.delivery[0], 100);
  assert.deepEqual(page.items, []);
  await pro.post('/api/me/profile/items').send({ kind: 'services', title: 'Speed audit', amount: 15000 }).expect(201);
  r = await request(app).get(`/api/talent/${t.id}`).expect(200);
  assert.equal(r.body.page.items[0].title, 'Speed audit', 'profile sections show on the public profile');
  r = await request(app).get('/api/talent/areeba').expect(200);
  assert.equal(r.body.page, null, 'sample profiles keep the page data built into the site');

  // the client's own profile shows the review they got as a client, and buyer stats
  r = await client.get('/api/me/profile').expect(200);
  assert.deepEqual(r.body.rating.client, [0, 1, 0, 0, 0]);
  assert.equal(r.body.reviews[0].by, 'Ali R. · Lahore');
  assert.deepEqual(r.body.buyer, { spent: 20000, posted: 1, hires: 1 });
});

test('blog: takeaways, checklists, next-step buttons and "Was this helpful?"', async () => {
  let r = await request(app).get('/api/blog/articles?full=1&limit=100').expect(200);
  assert.equal(r.body.total, 16);
  assert.ok(r.body.articles.every((a) => a.takeaways && a.takeaways.length === 3), 'every article has key takeaways');
  const video = r.body.articles.find((a) => a.slug === 'how-to-record-your-video-introduction');
  assert.equal(video.cta.action, 'video');
  assert.equal(r.body.articles.filter((a) => a.body.some((b) => b[0] === 'checklist')).length, 4);
  r = await request(app).get('/api/blog/articles?limit=100').expect(200);
  assert.equal(r.body.articles[0].takeaways, undefined, 'lists without full=1 stay small');

  const reader = request.agent(app);
  await reader.post('/api/blog/articles/nope/feedback').send({ vote: 'yes' }).expect(404);
  r = await reader.post('/api/blog/articles/how-to-record-your-video-introduction/feedback').send({ vote: 'maybe' }).expect(400);
  await reader.post('/api/blog/articles/how-to-record-your-video-introduction/feedback').send({ vote: 'no' }).expect(200);
  await reader.post('/api/blog/articles/how-to-record-your-video-introduction/feedback').send({ vote: 'no', comment: 'How long should a design video be?' }).expect(200);
  const other = await newUser('reader@example.com', { name: 'Sara Ali' });
  await other.post('/api/blog/articles/how-to-record-your-video-introduction/feedback').send({ vote: 'yes' }).expect(200);
  const ops = request.agent(app);
  await ops.post('/api/auth/login').send({ email: 'ops@paklance.test', password: 'Passw0rd!' }).expect(200);
  r = await ops.get('/api/admin/blog/feedback').expect(200);
  const fb = r.body.articles.find((a) => a.slug === 'how-to-record-your-video-introduction');
  assert.equal(fb.yes, 1);
  assert.equal(fb.no, 1, '"Not really" and its comment count as one answer');
  assert.equal(fb.comments[0].comment, 'How long should a design video be?');

  // admins can publish articles with the new parts
  const body = [['p', 'Intro paragraph for the test article.'], ['checklist', 'Before you start', ['One', 'Two'], 'All set.'], ['video', 'Watch this', '']];
  r = await ops.post('/api/admin/blog/articles').send({ title: 'A test article about checklists', excerpt: 'A short excerpt for the test article.', category: 'Freelancing', body,
    takeaways: ['First point here.', 'Second point here.'], cta: { title: 'Try it', text: 'Open the jobs page.', button: 'Browse jobs', href: '#javascript:alert(1)' } }).expect(400);
  assert.ok(r.body.fields.cta);
  r = await ops.post('/api/admin/blog/articles').send({ title: 'A test article about checklists', excerpt: 'A short excerpt for the test article.', category: 'Freelancing', body,
    takeaways: ['First point here.', 'Second point here.'], cta: { title: 'Try it', text: 'Open the jobs page.', button: 'Browse jobs', href: '#jobs' } }).expect(201);
  assert.deepEqual(r.body.article.takeaways, ['First point here.', 'Second point here.']);
  assert.deepEqual(r.body.article.cta, { title: 'Try it', text: 'Open the jobs page.', button: 'Browse jobs', href: '#jobs' });
});

test('demo articles stay in step with the seed file; config lists upload limits', async () => {
  await db('blog_articles').where({ slug: 'how-to-record-your-video-introduction' }).update({ takeaways: null, body: '[]' });
  await seedIfEmpty(db);
  const r = await request(app).get('/api/blog/articles/how-to-record-your-video-introduction').expect(200);
  assert.equal(r.body.article.takeaways.length, 3);
  assert.ok(r.body.article.body.length > 5);
  const c = await request(app).get('/api/config').expect(200);
  assert.deepEqual(c.body.uploads, { photoMaxMb: 5, videoMaxMb: 100, videoMaxSeconds: 15 });
});
