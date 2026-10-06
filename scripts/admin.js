#!/usr/bin/env node
'use strict';
/*
 * Paklance operations from the command line:   npm run admin -- <command> [args]
 *
 *   make-admin <email>                          give an account admin rights
 *   verify-identity <email> [false]             mark a client/specialist as identity-verified (or undo)
 *   payments                                    list bank transfers waiting for confirmation
 *   confirm-payment <reference> [bankRef]       money received on the escrow account → milestone funded
 *   cancel-payment <reference>
 *   withdrawals                                 list withdrawal requests to pay
 *   withdrawal <id> <processing|paid|rejected> [note]
 *   disputes                                    list open Resolution Centre cases
 *   resolve-dispute <id> <release|refund|dismiss> [note]
 *   subscribers                                 newsletter subscribers
 *   seminars                                    upcoming and past seminars with registration counts
 *   add-seminar "<title>" <Online|In-person> "<place>" <startsAt> <minutes> <seats> "<about>" ["<details>"]
 *                                               startsAt like 2026-10-10T19:00+05:00; details = joining link or full
 *                                               address, emailed to people who register
 *   seminar-registrations <id>                  who registered (name, email)
 *   cancel-seminar <id>
 *   feedback                                    "Was this helpful?" answers per blog article, with comments
 *   clear-samples                               delete sample jobs, specialists, demo articles, sample seminars and demo accounts
 */
const db = require('../src/db');
const money = require('../src/services/money');
const { clearSamples } = require('../src/seed');

const pkr = (n) => 'PKR ' + Number(n).toLocaleString('en-US');
const [cmd, ...args] = process.argv.slice(2);

async function userByEmail(email) {
  const u = await db('users').where({ email: String(email || '').toLowerCase() }).first();
  if (!u) throw new Error(`No account with email ${email}`);
  return u;
}
async function paymentByRef(ref) {
  const p = await db('payments').where({ reference: String(ref || '').toUpperCase() }).first();
  if (!p) throw new Error(`No payment with reference ${ref}`);
  return p;
}

const commands = {
  async 'make-admin'(email) {
    const u = await userByEmail(email);
    await db('users').where({ id: u.id }).update({ role: 'admin', updated_at: db.now() });
    console.log(`${u.email} is now an admin.`);
  },
  async 'verify-identity'(email, flag) {
    const u = await userByEmail(email);
    const verified = flag !== 'false';
    await db.transaction(async (trx) => {
      await trx('users').where({ id: u.id }).update({ identity_verified: verified, updated_at: db.now() });
      await trx('jobs').where({ client_id: u.id }).update({ client_verified: verified });
      await trx('talent_profiles').where({ user_id: u.id }).update({ verified });
    });
    console.log(`${u.email} identity verified: ${verified}`);
  },
  async payments() {
    const rows = await db('payments as p').join('contracts as c', 'c.id', 'p.contract_id').join('milestones as m', 'm.id', 'p.milestone_id')
      .join('users as u', 'u.id', 'p.payer_id').where('p.status', 'pending').orderBy('p.created_at')
      .select('p.reference', 'p.total', 'p.method', 'p.created_at', 'c.code', 'm.title', 'u.email');
    if (!rows.length) return console.log('No pending transfers.');
    console.table(rows.map((r) => ({ reference: r.reference, total: pkr(r.total), method: r.method, contract: r.code, milestone: r.title, payer: r.email, created: r.created_at })));
  },
  async 'confirm-payment'(ref, bankRef) {
    const p = await paymentByRef(ref);
    await db.transaction((trx) => money.confirmPayment(trx, p.id, { bankReference: bankRef || null }));
    console.log(`Confirmed ${p.reference} (${pkr(p.total)}). The milestone is now funded.`);
  },
  async 'cancel-payment'(ref) {
    const p = await paymentByRef(ref);
    await db.transaction((trx) => money.cancelPayment(trx, p.id));
    console.log(`Cancelled ${p.reference}.`);
  },
  async withdrawals() {
    const rows = await db('withdrawals as w').join('users as u', 'u.id', 'w.user_id').whereIn('w.status', ['requested', 'processing']).orderBy('w.created_at')
      .select('w.id', 'w.amount', 'w.channel', 'w.account_title', 'w.account_number', 'w.bank_name', 'w.status', 'u.email');
    if (!rows.length) return console.log('No withdrawals waiting.');
    console.table(rows.map((w) => ({ id: w.id, amount: pkr(w.amount), channel: w.channel, title: w.account_title, account: w.account_number, bank: w.bank_name || '', status: w.status, user: w.email })));
  },
  async withdrawal(id, status, ...note) {
    await db.transaction((trx) => money.setWithdrawalStatus(trx, Number(id), status, note.join(' ') || null));
    console.log(`Withdrawal ${id} marked ${status}.`);
  },
  async disputes() {
    const rows = await db('disputes as d').join('contracts as c', 'c.id', 'd.contract_id').leftJoin('milestones as m', 'm.id', 'd.milestone_id')
      .whereNot('d.status', 'resolved').select('d.id', 'c.code', 'm.title', 'm.amount', 'd.issue', 'd.created_at');
    if (!rows.length) return console.log('No open cases.');
    console.table(rows.map((d) => ({ id: d.id, contract: d.code, milestone: d.title || '(whole contract)', amount: d.amount ? pkr(d.amount) : '', issue: d.issue, opened: d.created_at })));
  },
  async 'resolve-dispute'(id, outcome, ...note) {
    await db.transaction((trx) => money.resolveDispute(trx, Number(id), outcome, note.join(' ') || null));
    console.log(`Case ${id} resolved: ${outcome}.`);
  },
  async subscribers() {
    const rows = await db('newsletter_subscribers').where({ status: 'subscribed' }).orderBy('created_at').select('email', 'source', 'created_at');
    console.table(rows);
  },
  async seminars() {
    const rows = await db('seminars').orderBy('starts_at', 'desc');
    if (!rows.length) return console.log('No seminars yet. Add one with add-seminar.');
    const counts = {};
    (await db('seminar_registrations').groupBy('seminar_id').select('seminar_id').count({ n: '*' })).forEach((r) => { counts[r.seminar_id] = Number(r.n); });
    console.table(rows.map((s) => ({ id: s.id, title: s.title, mode: s.mode, starts: s.starts_at, seats: s.seats, registered: counts[s.id] || 0, status: s.status + (db.bool(s.is_sample) ? ' (sample)' : '') })));
  },
  async 'add-seminar'(title, mode, place, startsAt, minutes, seats, about, details) {
    const m = String(mode || '').toLowerCase().replace(/[-_]/g, ' ') === 'in person' ? 'In person' : 'Online';
    const t = Date.parse(startsAt);
    if (!title || !place || !Number.isFinite(t) || !(Number(minutes) > 0) || !(Number(seats) > 0) || !about) {
      throw new Error('Usage: add-seminar "<title>" <Online|In-person> "<place>" <startsAt> <minutes> <seats> "<about>" ["<details>"]');
    }
    const id = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + Date.now().toString(36).slice(-4);
    const now = db.now();
    await db('seminars').insert({ id, title, mode: m, place, about, details: details || null, starts_at: new Date(t).toISOString(), minutes: Number(minutes), seats: Number(seats), status: 'scheduled', is_sample: false, created_at: now, updated_at: now });
    await db('seminars').where({ is_sample: true }).del();   // real dates replace the sample ones
    console.log(`Seminar ${id} added.`);
  },
  async 'seminar-registrations'(id) {
    const rows = await db('seminar_registrations as r').join('users as u', 'u.id', 'r.user_id').where('r.seminar_id', String(id))
      .orderBy('r.created_at').select('u.full_name as name', 'u.email', 'r.created_at as registered');
    if (!rows.length) return console.log('Nobody has registered yet.');
    console.table(rows);
  },
  async 'cancel-seminar'(id) {
    const n = await db('seminars').where({ id: String(id) }).update({ status: 'cancelled', updated_at: db.now() });
    console.log(n ? `Seminar ${id} cancelled. Let the people who registered know (see seminar-registrations).` : `No seminar ${id}.`);
  },
  async feedback() {
    const rows = await db('blog_feedback as f').join('blog_articles as a', 'a.id', 'f.article_id')
      .select('a.slug', 'f.vote', 'f.comment', 'f.updated_at').orderBy('f.updated_at', 'desc');
    if (!rows.length) return console.log('No feedback yet.');
    const by = {};
    rows.forEach((r) => { const o = (by[r.slug] = by[r.slug] || { article: r.slug, yes: 0, no: 0 }); o[r.vote] += 1; });
    console.table(Object.values(by));
    const comments = rows.filter((r) => r.comment).slice(0, 30);
    if (comments.length) console.table(comments.map((r) => ({ article: r.slug, answer: r.vote, comment: r.comment, at: r.updated_at })));
  },
  async 'clear-samples'() {
    const r = await clearSamples(db);
    console.log(`Removed ${r.jobs} sample jobs, ${r.talent} sample specialists, ${r.articles} demo articles, ${r.seminars} sample seminars and ${r.users} demo accounts.`);
  }
};

(async () => {
  const fn = commands[cmd];
  if (!fn) {
    console.log('Usage: npm run admin -- <command> [args]\nCommands: ' + Object.keys(commands).join(', '));
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  await db.migrate.latest();
  await fn(...args);
})()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => db.destroy());
