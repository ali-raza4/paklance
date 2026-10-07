'use strict';
/*
 * Sign up / log in API — the contract used by the PaklanceAuth frontend module.
 *
 *   GET   /api/me                      → { user | null }
 *   POST  /api/auth/google             { credential }        → { user }
 *   POST  /api/auth/signup             { email, password }   → { pendingVerification: true }
 *   POST  /api/auth/verify-email       { email, code }       → { user }            (signs in)
 *   POST  /api/auth/resend-code        { email }             → { ok: true }
 *   POST  /api/auth/login              { email, password }   → { user } | { pendingVerification: true }
 *   POST  /api/auth/forgot-password    { email }             → { ok: true }        (always)
 *   POST  /api/auth/reset-password     { token, password }   → { user }            (signs in)
 *   PATCH /api/me                      { fullName } | { skills }  → { user }
 *   POST  /api/auth/logout                                    → { ok: true }
 *
 * Email sign-ups: the account row is created only after the 6-digit code is verified. Each code is tied
 * to the browser that requested it (pl_pending cookie), so nobody can "pre-register" someone else's email.
 */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { ApiError, E, h } = require('../lib/errors');
const v = require('../lib/validate');
const sec = require('../lib/security');
const mailer = require('../lib/mailer');
const emails = require('../lib/emails');
const limiter = require('../lib/limiter');
const present = require('../lib/present');
const { createSession, destroySession, requireAuth, cookieOptions } = require('../middleware/auth');

const router = express.Router();
const PENDING_COOKIE = 'pl_pending';
const HOUR = 60 * 60 * 1000;

let googleClient = null;
function google() {
  if (!googleClient) {
    const { OAuth2Client } = require('google-auth-library');
    // redirect_uri "postmessage" is what Google uses for the pop-up code flow.
    googleClient = new OAuth2Client(config.google.clientId, config.google.clientSecret, 'postmessage');
  }
  return googleClient;
}

/* ---------- helpers ---------- */

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);

function browserToken(req, res) {
  let t = req.cookies && req.cookies[PENDING_COOKIE];
  if (!t || t.length < 20 || t.length > 100) {
    t = sec.randomToken(24);
  }
  res.cookie(PENDING_COOKIE, t, cookieOptions(24 * HOUR));
  return t;
}

async function sendCode(email, code) {
  const m = emails.verifyCode(code);
  await mailer.send({ to: email, ...m }, { critical: true });
}

function retryError(secondsLeft) {
  const err = E.rateLimited(`Please wait ${secondsLeft} seconds before requesting another code.`);
  err.extra = { retryAfter: secondsLeft };
  return err;
}

// Limits code emails per address: one per cooldown, 10 per hour.
async function checkSendLimits(email) {
  const last = await db('signup_requests').where({ email }).orderBy('last_sent_at', 'desc').first();
  if (last) {
    const wait = Math.ceil((Date.parse(last.last_sent_at) + config.auth.resendCooldownSeconds * 1000 - Date.now()) / 1000);
    if (wait > 0) throw retryError(wait);
  }
  if (limiter.enabled) {
    const r = limiter.hit('codes:' + email, { max: 10, windowMs: HOUR });
    if (r.over) throw E.rateLimited('Too many codes requested for this email. Please try again later.');
  }
}

async function newSignupRequest(email, passwordHash, browser) {
  const code = sec.sixDigitCode();
  const now = db.now();
  await db('signup_requests').insert({
    email,
    password_hash: passwordHash,
    code_hash: sec.codeHash(email, code),
    browser_hash: sec.sha256(browser),
    attempts: 0,
    created_at: now,
    last_sent_at: now,
    expires_at: db.inMinutes(config.auth.codeTtlMinutes)
  });
  await sendCode(email, code);
}

async function ensureSkillsLoaded(u) {
  if (!u) return u;
  const skills = db.json(u.skills, []);
  if (!skills.length) {
    const tp = await db('talent_profiles').where({ user_id: u.id }).first();
    if (tp && tp.skills) {
      const tpSkills = db.json(tp.skills, []);
      if (tpSkills.length) {
        await db('users').where({ id: u.id }).update({ skills: JSON.stringify(tpSkills) });
        return await db('users').where({ id: u.id }).first();
      }
    }
  }
  return u;
}

/* ---------- routes ---------- */

router.get('/me', h(async (req, res) => {
  const u = await ensureSkillsLoaded(req.user);
  res.json({ user: present.user(u) });
}));

router.post('/auth/signup', h(async (req, res) => {
  const email = v.emailOrThrow(req.body.email);
  const password = v.passwordOrThrow(req.body.password);

  const existing = await db('users').where({ email }).first();
  if (existing) throw E.conflict('EMAIL_TAKEN', 'An account with this email already exists.');

  await checkSendLimits(email);
  const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
  await newSignupRequest(email, hash, browserToken(req, res));
  res.status(201).json({ pendingVerification: true });
}));

router.post('/auth/verify-email', h(async (req, res) => {
  const email = v.emailOrThrow(req.body.email);
  const code = String(req.body.code || '').replace(/\D/g, '');
  if (code.length !== 6) throw E.bad('INVALID_CODE', 'Enter the 6-digit code from your email.');

  const browser = req.cookies && req.cookies[PENDING_COOKIE];
  const pending = browser
    ? await db('signup_requests')
        .where({ email, browser_hash: sec.sha256(browser) })
        .whereNull('consumed_at')
        .orderBy('created_at', 'desc')
        .first()
    : null;
  if (!pending) throw E.notFound('We couldn’t find a sign up for this email. Please sign up again.');
  if (pending.expires_at <= db.now()) throw E.bad('CODE_EXPIRED', 'This code has expired. Request a new one.');
  if (pending.attempts >= config.auth.codeMaxAttempts) throw E.bad('CODE_EXPIRED', 'Too many incorrect attempts. Request a new code.');

  if (!sec.safeEqualHex(pending.code_hash, sec.codeHash(email, code))) {
    await db('signup_requests').where({ id: pending.id }).update({ attempts: pending.attempts + 1 });
    throw E.bad('INVALID_CODE', 'That code isn’t right. Check your email and try again.');
  }

  const now = db.now();
  const userId = crypto.randomUUID();
  await db.transaction(async (trx) => {
    const taken = await trx('users').where({ email }).first();
    if (taken) throw E.conflict('EMAIL_TAKEN', 'An account with this email already exists. Please log in.');
    await trx('users').insert({
      id: userId,
      email,
      password_hash: pending.password_hash,
      full_name: null,
      skills: '[]',
      email_verified: true,
      provider: 'email',
      role: config.adminEmails.includes(email) ? 'admin' : 'member',
      created_at: now,
      updated_at: now
    });
    await trx('signup_requests').where({ id: pending.id }).update({ consumed_at: now });
    await trx('signup_requests').where({ email }).whereNull('consumed_at').del();
  });

  res.clearCookie(PENDING_COOKIE, { path: '/' });
  await createSession(req, res, userId);
  const u = await db('users').where({ id: userId }).first();
  res.json({ user: present.user(u) });
}));

router.post('/auth/resend-code', h(async (req, res) => {
  const email = v.emailOrThrow(req.body.email);
  const browser = req.cookies && req.cookies[PENDING_COOKIE];
  const pending = browser
    ? await db('signup_requests').where({ email, browser_hash: sec.sha256(browser) }).whereNull('consumed_at').orderBy('created_at', 'desc').first()
    : null;
  if (!pending) throw E.notFound('We couldn’t find a sign up for this email. Please sign up again.');
  await checkSendLimits(email);

  const code = sec.sixDigitCode();
  await db('signup_requests').where({ id: pending.id }).update({
    code_hash: sec.codeHash(email, code),
    attempts: 0,
    last_sent_at: db.now(),
    expires_at: db.inMinutes(config.auth.codeTtlMinutes)
  });
  await sendCode(email, code);
  res.json({ ok: true });
}));

router.post('/auth/login', h(async (req, res) => {
  const email = v.emailOrThrow(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!password) throw E.validation({ password: 'Enter your password.' });

  const failKey = 'login:' + email;
  if (limiter.enabled && limiter.peek(failKey, 10).over) {
    throw E.rateLimited('Too many login attempts. Please wait a few minutes and try again.');
  }
  const failed = () => {
    if (limiter.enabled) limiter.hit(failKey, { max: 10, windowMs: 15 * 60 * 1000 });
    return E.bad('INVALID_CREDENTIALS', 'Email or password is incorrect.');
  };

  const u = await db('users').where({ email }).first();
  if (!u) {
    // An email sign-up that was never verified: send a fresh code and continue at the verify step.
    const recent = await db('signup_requests')
      .where({ email })
      .whereNull('consumed_at')
      .where('created_at', '>', new Date(Date.now() - 24 * HOUR).toISOString())
      .orderBy('created_at', 'desc')
      .limit(3);
    for (const p of recent) {
      if (await bcrypt.compare(password, p.password_hash)) {
        const browser = browserToken(req, res);
        const mine = recent.find((r) => r.browser_hash === sec.sha256(browser));
        const last = recent[0];
        const coolingDown = Date.parse(last.last_sent_at) + config.auth.resendCooldownSeconds * 1000 > Date.now();
        if (mine && coolingDown) return res.json({ pendingVerification: true });
        await checkSendLimits(email);
        await newSignupRequest(email, p.password_hash, browser);
        return res.json({ pendingVerification: true });
      }
    }
    throw failed();
  }
  if (!u.password_hash) {
    throw E.bad('USE_GOOGLE', 'This account signs in with Google. Use “Continue with Google” instead.');
  }
  if (!(await bcrypt.compare(password, u.password_hash))) throw failed();

  limiter.clear(failKey);
  await createSession(req, res, u.id);
  const userRow = await ensureSkillsLoaded(u);
  res.json({ user: present.user(userRow) });
}));

router.post('/auth/forgot-password', h(async (req, res) => {
  const email = v.emailOrThrow(req.body.email);
  const r = limiter.enabled ? limiter.hit('reset:' + email, { max: 3, windowMs: HOUR }) : { over: false };
  if (!r.over) {
    const u = await db('users').where({ email }).first();
    if (u && u.password_hash) {
      const token = sec.randomToken(32);
      await db('password_resets').insert({
        user_id: u.id,
        token_hash: sec.sha256(token),
        created_at: db.now(),
        expires_at: db.inMinutes(config.auth.resetTtlMinutes)
      });
      const link = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
      await mailer.send({ to: email, ...emails.passwordReset(link) });
    } else if (u) {
      await mailer.send({ to: email, ...emails.resetForGoogleAccount() });
    }
  }
  // Same answer whether or not the account exists.
  res.json({ ok: true });
}));

router.post('/auth/reset-password', h(async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const password = v.passwordOrThrow(req.body.password);
  const row = token ? await db('password_resets').where({ token_hash: sec.sha256(token) }).first() : null;
  if (!row || row.used_at || row.expires_at <= db.now()) {
    throw E.bad('INVALID_TOKEN', 'This reset link is invalid or has expired. Request a new one.');
  }
  const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
  const now = db.now();
  await db.transaction(async (trx) => {
    await trx('users').where({ id: row.user_id }).update({ password_hash: hash, updated_at: now });
    await trx('password_resets').where({ user_id: row.user_id }).whereNull('used_at').update({ used_at: now });
    await trx('sessions').where({ user_id: row.user_id }).del(); // log out everywhere else
  });
  await createSession(req, res, row.user_id);
  const u = await db('users').where({ id: row.user_id }).first();
  res.json({ user: present.user(u) });
}));

router.post('/auth/google', h(async (req, res) => {
  const body = req.body || {};
  const code = typeof body.code === 'string' ? body.code : '';
  const credential = typeof body.credential === 'string' ? body.credential : '';
  // { code }: pop-up flow used by the site (needs the client secret) · { credential }: an ID token (One Tap / Google button)
  if (!config.google.clientId || (code && !config.google.clientSecret)) {
    throw E.unavailable('GOOGLE_UNAVAILABLE', 'Google sign-in isn’t available right now. Try again, or continue with email.');
  }
  if (!code && !credential) throw E.bad('INVALID_GOOGLE_TOKEN', 'Google sign-in failed. Please try again.');

  let payload;
  try {
    let idToken = credential;
    if (code) {
      const { tokens } = await withTimeout(google().getToken(code), 15000);
      idToken = tokens && tokens.id_token;
    }
    const ticket = await withTimeout(google().verifyIdToken({ idToken, audience: config.google.clientId }), 15000);
    payload = ticket.getPayload();
  } catch (e) {
    throw new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed. Please try again.');
  }
  const email = v.normEmail(payload && payload.email);
  if (!email || !payload.email_verified) {
    throw E.bad('GOOGLE_EMAIL_UNVERIFIED', 'Your Google account’s email isn’t verified. Verify it with Google, or continue with email.');
  }

  const now = db.now();
  let u = await db('users').where({ google_sub: payload.sub }).first();
  if (!u) {
    u = await db('users').where({ email }).first();
    if (u) {
      // Same email, verified by Google → link the Google account to the existing user.
      await db('users').where({ id: u.id }).update({ google_sub: payload.sub, email_verified: true, updated_at: now });
    } else {
      const id = crypto.randomUUID();
      await db('users').insert({
        id,
        email,
        password_hash: null,
        // Google's name is only a suggestion: the onboarding "Full name" step still asks the user to confirm it.
        full_name: null,
        skills: '[]',
        email_verified: true,
        provider: 'google',
        google_sub: payload.sub,
        role: config.adminEmails.includes(email) ? 'admin' : 'member',
        created_at: now,
        updated_at: now
      });
      u = { id };
    }
    // A signup that was never verified can't claim this email any more.
    await db('signup_requests').where({ email }).whereNull('consumed_at').del();
  }
  await createSession(req, res, u.id);
  const fresh = await ensureSkillsLoaded(await db('users').where({ id: u.id }).first());
  res.json({ user: present.user(fresh) });
}));

router.patch('/me', requireAuth, h(async (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (body.fullName !== undefined) {
    const r = v.fullName(body.fullName);
    if (r.error) throw E.bad('INVALID_NAME', r.error);
    patch.full_name = r.value;
  }
  if (body.skills !== undefined) {
    const r = v.skills(body.skills);
    if (r.error) throw E.bad('INVALID_SKILLS', r.error);
    patch.skills = JSON.stringify(r.value);
  }
  if (!Object.keys(patch).length) throw E.bad('VALIDATION_ERROR', 'Nothing to update.');
  patch.updated_at = db.now();
  await db('users').where({ id: req.user.id }).update(patch);

  // Keep a published talent profile in sync with the account.
  const profile = await db('talent_profiles').where({ user_id: req.user.id }).first();
  if (profile) {
    const p = { updated_at: patch.updated_at };
    if (patch.full_name) { p.name = patch.full_name; p.initials = present.initialsOf(patch.full_name); }
    if (patch.skills) p.skills = patch.skills;
    await db('talent_profiles').where({ id: profile.id }).update(p);
  }

  const u = await db('users').where({ id: req.user.id }).first();
  res.json({ user: present.user(u) });
}));

router.post('/auth/logout', h(async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
}));

module.exports = router;
// Tests replace the Google client with a stub.
module.exports._setGoogleClient = (c) => { googleClient = c; };
