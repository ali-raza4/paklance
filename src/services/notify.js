'use strict';
const db = require('../db');

// Adds an in-app notification (shown under the bell). Pass a transaction to keep it atomic.
async function notify(trx, userId, { type, title, meta = '', link = null }) {
  if (!userId) return;
  await (trx || db)('notifications').insert({
    user_id: userId,
    type,
    title: String(title).slice(0, 160),
    meta: String(meta || '').slice(0, 200),
    link,
    created_at: db.now()
  });
}

module.exports = { notify };
