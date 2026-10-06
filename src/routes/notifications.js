'use strict';
/*
 *   GET  /api/notifications            ?limit (default 20)  → { notifications, unread }
 *   POST /api/notifications/read-all
 *   POST /api/notifications/:id/read
 */
const express = require('express');
const db = require('../db');
const { E, h } = require('../lib/errors');
const { idParam } = require('../lib/validate');
const present = require('../lib/present');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use('/notifications', requireAuth);

router.get('/notifications', h(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const rows = await db('notifications').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(limit);
  const unread = await db.count(db('notifications').where({ user_id: req.user.id }).whereNull('read_at'));
  res.json({ notifications: rows.map(present.notification), unread });
}));

router.post('/notifications/read-all', h(async (req, res) => {
  await db('notifications').where({ user_id: req.user.id }).whereNull('read_at').update({ read_at: db.now() });
  res.json({ ok: true, unread: 0 });
}));

router.post('/notifications/:id/read', h(async (req, res) => {
  const id = idParam(req.params.id);
  const n = id ? await db('notifications').where({ id, user_id: req.user.id }).update({ read_at: db.now() }) : 0;
  if (!n) throw E.notFound('Notification not found.');
  const unread = await db.count(db('notifications').where({ user_id: req.user.id }).whereNull('read_at'));
  res.json({ ok: true, unread });
}));

module.exports = router;
