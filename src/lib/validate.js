'use strict';
/*
 * Input validation. Rules for email, password, full name and skills match the frontend exactly
 * (see the auth module), so the server never accepts something the UI would reject, or vice versa.
 */
const { E } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
const CONTROL_RE = /[\u0000-\u001F\u007F]/g;

const clean = (v) => String(v).replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();

function normEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

function emailOrThrow(v) {
  const e = normEmail(v);
  if (!e) throw E.validation({ email: v ? 'Enter a valid email address, like name@example.com.' : 'Enter your email address.' });
  return e;
}

function passwordOrThrow(v, field = 'password') {
  if (typeof v !== 'string' || !v) throw E.validation({ [field]: 'Enter a password.' });
  if (v.length < 8 || !/[A-Za-z]/.test(v) || !/\d/.test(v)) {
    throw E.validation({ [field]: 'Use at least 8 characters, including a letter and a number.' });
  }
  if (v.length > 128) throw E.validation({ [field]: 'Use 128 characters or fewer.' });
  return v;
}

function fullName(v) {
  if (typeof v !== 'string') return { error: 'Enter your full name.' };
  const n = clean(v);
  if (!n) return { error: 'Enter your full name.' };
  if (n.length > 60) return { error: 'Use 60 characters or fewer.' };
  const letters = (n.match(/[\p{L}]/gu) || []).length;
  if (!NAME_RE.test(n) || letters < 2) return { error: 'Use letters only, as it appears on your ID.' };
  return { value: n };
}

function skills(v, max = 15) {
  if (!Array.isArray(v)) return { error: 'Add at least one skill.' };
  const out = [];
  const seen = new Set();
  for (const raw of v) {
    if (typeof raw !== 'string') return { error: 'Skills must be text.' };
    const s = clean(raw);
    if (s.length < 2 || s.length > 40) return { error: 'Each skill must be 2–40 characters.' };
    const k = s.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  if (!out.length) return { error: 'Add at least one skill.' };
  if (out.length > max) return { error: `You can add up to ${max} skills.` };
  return { value: out };
}

/*
 * Small collector for form-style validation:
 *   const c = new Check(req.body);
 *   const title = c.text('title', { min: 10, max: 140, label: 'Job title' });
 *   c.done();   // throws VALIDATION_ERROR with every failing field
 */
class Check {
  constructor(body) {
    this.body = body && typeof body === 'object' ? body : {};
    this.errors = {};
  }
  fail(field, msg) { if (!this.errors[field]) this.errors[field] = msg; return undefined; }
  has(field) { return this.body[field] !== undefined && this.body[field] !== null && this.body[field] !== ''; }

  text(field, { min = 1, max = 200, label = field, optional = false, multiline = false } = {}) {
    const v = this.body[field];
    if (v === undefined || v === null || v === '') return optional ? null : this.fail(field, `Enter ${article(label)} ${label.toLowerCase()}.`);
    if (typeof v !== 'string') return this.fail(field, `${label} must be text.`);
    const s = multiline ? v.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim() : clean(v);
    if (s.length < min) return this.fail(field, `${label} must be at least ${min} characters.`);
    if (s.length > max) return this.fail(field, `${label} must be ${max} characters or fewer.`);
    return s;
  }
  oneOf(field, options, { label = field, optional = false, fallback } = {}) {
    const v = this.body[field];
    if (v === undefined || v === null || v === '') {
      if (fallback !== undefined) return fallback;
      return optional ? null : this.fail(field, `Choose ${article(label)} ${label.toLowerCase()}.`);
    }
    if (!options.includes(v)) return this.fail(field, `Choose a valid ${label.toLowerCase()}.`);
    return v;
  }
  int(field, { min = 0, max = Number.MAX_SAFE_INTEGER, label = field, optional = false } = {}) {
    let v = this.body[field];
    if (v === undefined || v === null || v === '') return optional ? null : this.fail(field, `Enter ${article(label)} ${label.toLowerCase()}.`);
    if (typeof v === 'string') v = v.replace(/[,\s]/g, '').replace(/^PKR/i, '');
    const n = Number(v);
    if (!Number.isInteger(n)) return this.fail(field, `${label} must be a whole number.`);
    if (n < min) return this.fail(field, `${label} must be at least ${min.toLocaleString('en-US')}.`);
    if (n > max) return this.fail(field, `${label} must be ${max.toLocaleString('en-US')} or less.`);
    return n;
  }
  bool(field, fallback = false) {
    const v = this.body[field];
    if (v === undefined || v === null || v === '') return fallback;
    return v === true || v === 'true' || v === 1 || v === '1';
  }
  list(field, { min = 1, max = 15, itemMax = 40, label = field } = {}) {
    let v = this.body[field];
    if (typeof v === 'string') v = v.split(',');
    if (!Array.isArray(v)) v = [];
    const out = [];
    const seen = new Set();
    for (const raw of v) {
      if (typeof raw !== 'string') continue;
      const s = clean(raw);
      if (!s) continue;
      if (s.length > itemMax) return this.fail(field, `Each ${label.toLowerCase()} entry must be ${itemMax} characters or fewer.`);
      if (!seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
    }
    if (out.length < min) return this.fail(field, `Add at least ${min} ${label.toLowerCase()}.`);
    if (out.length > max) return this.fail(field, `Add up to ${max} ${label.toLowerCase()}.`);
    return out;
  }
  done() {
    if (Object.keys(this.errors).length) throw E.validation(this.errors);
  }
}

function article(label) { return /^[aeiou]/i.test(label) ? 'an' : 'a'; }

const idParam = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

module.exports = { EMAIL_RE, NAME_RE, clean, normEmail, emailOrThrow, passwordOrThrow, fullName, skills, Check, idParam };
