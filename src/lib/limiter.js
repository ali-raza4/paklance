'use strict';
/*
 * Tiny in-memory counters used for per-email limits (failed logins, reset requests).
 * Per-IP limits use express-rate-limit in app.js. If you run several server instances,
 * move both to a shared store such as Redis.
 */
const config = require('../config');

const buckets = new Map();

function hit(key, { max, windowMs }) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count += 1;
  return { over: b.count > max, retryAfter: Math.ceil((b.reset - now) / 1000) };
}
function peek(key, max) {
  const b = buckets.get(key);
  if (!b || b.reset <= Date.now()) return { over: false, retryAfter: 0 };
  return { over: b.count >= max, retryAfter: Math.ceil((b.reset - Date.now()) / 1000) };
}
function clear(key) { buckets.delete(key); }

// forget expired buckets now and then
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, 10 * 60 * 1000).unref();

module.exports = { hit, peek, clear, reset: () => buckets.clear(), enabled: !config.isTest };
