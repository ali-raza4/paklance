'use strict';
/*
 * Sessions: a random token in an HttpOnly cookie; only its SHA-256 is stored in the database,
 * so a leaked database can't be used to log in.
 */
const db = require('../db');
const config = require('../config');
const { sha256, randomToken } = require('../lib/security');
const { E } = require('../lib/errors');

const DAY = 24 * 60 * 60 * 1000;

function cookieOptions(maxAge) {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge };
}

async function createSession(req, res, userId) {
  const token = randomToken(32);
  const now = db.now();
  await db('sessions').insert({
    id: sha256(token),
    user_id: userId,
    ip: String(req.ip || '').slice(0, 64),
    user_agent: String(req.get('user-agent') || '').slice(0, 255),
    created_at: now,
    last_seen_at: now,
    expires_at: new Date(Date.now() + config.sessionDays * DAY).toISOString()
  });
  res.cookie(config.cookieName, token, cookieOptions(config.sessionDays * DAY));
}

async function destroySession(req, res) {
  const token = req.cookies && req.cookies[config.cookieName];
  if (token) await db('sessions').where({ id: sha256(token) }).del();
  res.clearCookie(config.cookieName, { path: '/' });
}

const isAdmin = (u) => !!u && (u.role === 'admin' || config.adminEmails.includes(u.email));

// Attaches req.user (full DB row) when the session cookie is valid.
async function loadSession(req, res, next) {
  try {
    req.user = null;
    const token = req.cookies && req.cookies[config.cookieName];
    if (!token) return next();
    const sid = sha256(token);
    const s = await db('sessions').where({ id: sid }).first();
    if (!s || s.expires_at <= db.now()) {
      if (s) await db('sessions').where({ id: sid }).del();
      res.clearCookie(config.cookieName, { path: '/' });
      return next();
    }
    const user = await db('users').where({ id: s.user_id }).first();
    if (!user) return next();
    req.user = user;
    req.user.isAdmin = isAdmin(user);
    req.sessionId = sid;
    // touch at most once an hour
    if (Date.parse(s.last_seen_at) < Date.now() - 60 * 60 * 1000) {
      await db('sessions').where({ id: sid }).update({ last_seen_at: db.now() });
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return next(E.unauthenticated());
  next();
}

// Signed in AND finished onboarding (verified email, full name, skills for freelancers).
function requireReady(req, res, next) {
  if (!req.user) return next(E.unauthenticated());
  if (!db.bool(req.user.email_verified) || !req.user.full_name) {
    return next(E.forbidden('Finish setting up your account (full name) first.', 'PROFILE_INCOMPLETE'));
  }
  const isClient = String(req.user.role || '').toLowerCase() === 'client';
  const skills = db.json(req.user.skills, []);
  if (!isClient && !skills.length) {
    return next(E.forbidden('Finish setting up your account (skills) first.', 'PROFILE_INCOMPLETE'));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(E.unauthenticated());
  if (!req.user.isAdmin) return next(E.forbidden());
  next();
}

module.exports = { createSession, destroySession, loadSession, requireAuth, requireReady, requireAdmin, isAdmin, cookieOptions };
