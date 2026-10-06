'use strict';
const crypto = require('crypto');
const config = require('../config');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const hmac = (s) => crypto.createHmac('sha256', config.sessionSecret).update(String(s)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// 6-digit email code, e.g. "048213"
const sixDigitCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const codeHash = (email, code) => hmac(`code:${email}:${code}`);

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// Human-friendly payment reference without look-alike characters, e.g. "PLF-7K3QXM"
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function reference(prefix) {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[crypto.randomInt(0, REF_ALPHABET.length)];
  return `${prefix}-${s}`;
}

module.exports = { sha256, hmac, randomToken, sixDigitCode, codeHash, safeEqualHex, reference };
