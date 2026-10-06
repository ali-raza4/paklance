'use strict';
/*
 * Messaging routes:
 *   GET    /api/messaging/conversations
 *   POST   /api/messaging/send               { receiverId, content }
 *   GET    /api/messaging/conversations/:id/messages
 *   POST   /api/messaging/sync-delivered
 *   DELETE /api/messaging/messages/:id
 *   GET    /api/messaging/users              ?q=
 *   GET    /api/users/search                 ?q=
 */
const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { E, h } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const like = (s) => '%' + String(s).toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c) + '%';

// Helper: canonical participant ordering to prevent race-condition duplicates
function canonicalParticipants(u1, u2) {
  return u1 < u2 ? [u1, u2] : [u2, u1];
}

async function findOrCreateConversation(userId, otherUserId) {
  if (userId === otherUserId) {
    throw E.bad('SELF_MESSAGE', 'Cannot start a conversation with yourself.');
  }

  const otherUser = await db('users').where({ id: otherUserId }).first();
  if (!otherUser) {
    throw E.notFound('Receiver user not found.');
  }

  let conv = await db('conversations')
    .where(function () {
      this.where({ participant1_id: userId, participant2_id: otherUserId })
        .orWhere({ participant1_id: otherUserId, participant2_id: userId });
    })
    .first();

  if (!conv) {
    const [p1, p2] = canonicalParticipants(userId, otherUserId);
    const convId = crypto.randomUUID();
    const now = db.now();
    await db('conversations').insert({
      id: convId,
      participant1_id: p1,
      participant2_id: p2,
      created_at: now,
      updated_at: now
    });
    conv = await db('conversations').where({ id: convId }).first();
  }

  return { conv, otherUser };
}

// GET /api/messaging/conversations
router.get('/messaging/conversations', requireAuth, h(async (req, res) => {
  const userId = req.user.id;

  const convs = await db('conversations')
    .where(function () {
      this.where({ participant1_id: userId }).orWhere({ participant2_id: userId });
    })
    .orderBy('updated_at', 'desc');

  if (!convs.length) return res.json([]);

  const otherIds = convs.map((c) => (c.participant1_id === userId ? c.participant2_id : c.participant1_id));
  const uniqueOtherIds = [...new Set(otherIds)];

  const otherUsers = await db('users')
    .whereIn('id', uniqueOtherIds)
    .select('id', 'full_name', 'email', 'role', 'photo_url');

  const talents = await db('talent_profiles')
    .whereIn('user_id', uniqueOtherIds)
    .select('user_id', 'headline');

  const talentMap = new Map(talents.map((t) => [t.user_id, t]));
  const userMap = new Map(
    otherUsers.map((u) => {
      const tp = talentMap.get(u.id);
      return [
        u.id,
        {
          id: u.id,
          name: u.full_name || (u.email && u.email.split('@')[0]) || 'User',
          email: u.email,
          role: tp?.headline || u.role || 'Member',
          headline: tp?.headline || null,
          avatarUrl: u.photo_url || null
        }
      ];
    })
  );

  const convIds = convs.map((c) => c.id);

  // Mark incoming undelivered messages as delivered
  await db('messages')
    .whereIn('conversation_id', convIds)
    .whereNot({ sender_id: userId })
    .where({ is_delivered: false })
    .update({ is_delivered: true });

  // Fetch last message for each conversation
  const out = [];
  for (const c of convs) {
    const otherId = c.participant1_id === userId ? c.participant2_id : c.participant1_id;
    const otherUser = userMap.get(otherId) || {
      id: otherId,
      name: 'User',
      email: '',
      role: 'Member',
      headline: null,
      avatarUrl: null
    };

    const lastMsg = await db('messages')
      .where({ conversation_id: c.id })
      .orderBy('created_at', 'desc')
      .first();

    out.push({
      id: c.id,
      participant1Id: c.participant1_id,
      participant2Id: c.participant2_id,
      otherUser,
      lastMessage: lastMsg
        ? {
            id: lastMsg.id,
            conversationId: lastMsg.conversation_id,
            senderId: lastMsg.sender_id,
            content: lastMsg.content,
            isDelivered: db.bool(lastMsg.is_delivered),
            isRead: db.bool(lastMsg.is_read),
            createdAt: lastMsg.created_at
          }
        : null,
      createdAt: c.created_at,
      updatedAt: c.updated_at
    });
  }

  res.json(out);
}));

// POST /api/messaging/send
router.post('/messaging/send', requireAuth, h(async (req, res) => {
  const senderId = req.user.id;
  const receiverId = String(req.body.receiverId || '').trim();
  const content = String(req.body.content || '').trim();

  if (!receiverId) throw E.bad('INVALID_REQUEST', 'Receiver ID is required.');
  if (!content) throw E.bad('INVALID_REQUEST', 'Message content cannot be empty.');
  if (content.length > 4000) throw E.bad('INVALID_REQUEST', 'Message is too long (maximum 4000 characters).');

  const { conv } = await findOrCreateConversation(senderId, receiverId);

  const msgId = crypto.randomUUID();
  const now = db.now();

  await db('messages').insert({
    id: msgId,
    conversation_id: conv.id,
    sender_id: senderId,
    content,
    is_delivered: false,
    is_read: false,
    created_at: now
  });

  await db('conversations').where({ id: conv.id }).update({ updated_at: now });

  // Create an in-app notification for recipient
  try {
    const senderName = req.user.full_name || (req.user.email && req.user.email.split('@')[0]) || 'Someone';
    await db('notifications').insert({
      user_id: receiverId,
      type: 'new_message',
      title: `New message from ${senderName}`,
      meta: content.length > 60 ? content.slice(0, 57) + '…' : content,
      created_at: now
    });
  } catch (e) {
    // Non-fatal if notifications fails
  }

  res.status(201).json({
    id: msgId,
    conversationId: conv.id,
    senderId,
    content,
    isDelivered: false,
    isRead: false,
    createdAt: now
  });
}));

// GET /api/messaging/conversations/:id/messages
router.get('/messaging/conversations/:id/messages', requireAuth, h(async (req, res) => {
  const userId = req.user.id;
  const convId = String(req.params.id);

  const conv = await db('conversations').where({ id: convId }).first();
  if (!conv) throw E.notFound('Conversation not found.');

  if (conv.participant1_id !== userId && conv.participant2_id !== userId) {
    throw E.forbidden('Not your conversation.');
  }

  // Mark incoming unread messages as read and delivered
  await db('messages')
    .where({ conversation_id: convId })
    .whereNot({ sender_id: userId })
    .where(function () {
      this.where({ is_read: false }).orWhere({ is_delivered: false });
    })
    .update({ is_read: true, is_delivered: true });

  const msgs = await db('messages')
    .where({ conversation_id: convId })
    .orderBy('created_at', 'asc');

  res.json(
    msgs.map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      content: m.content,
      isDelivered: db.bool(m.is_delivered),
      isRead: db.bool(m.is_read),
      createdAt: m.created_at
    }))
  );
}));

// POST /api/messaging/sync-delivered
router.post('/messaging/sync-delivered', requireAuth, h(async (req, res) => {
  const userId = req.user.id;

  const convs = await db('conversations')
    .where(function () {
      this.where({ participant1_id: userId }).orWhere({ participant2_id: userId });
    })
    .select('id');

  const convIds = convs.map((c) => c.id);
  if (!convIds.length) return res.json({ success: true, updatedCount: 0 });

  const updatedCount = await db('messages')
    .whereIn('conversation_id', convIds)
    .whereNot({ sender_id: userId })
    .where({ is_delivered: false })
    .update({ is_delivered: true });

  res.json({ success: true, updatedCount: Number(updatedCount) || 0 });
}));

// DELETE /api/messaging/messages/:id
router.delete('/messaging/messages/:id', requireAuth, h(async (req, res) => {
  const userId = req.user.id;
  const msgId = String(req.params.id);

  const msg = await db('messages').where({ id: msgId }).first();
  if (!msg) throw E.notFound('Message not found.');

  if (msg.sender_id !== userId) {
    throw E.forbidden('You can only unsend your own messages.');
  }

  await db('messages').where({ id: msgId }).del();
  res.json({ success: true, id: msgId });
}));

// User search handler shared by /messaging/users and /users/search
async function handleUserSearch(req, res) {
  const myId = req.user.id;
  const q = String(req.query.q || '').trim().slice(0, 100);

  const query = db('users')
    .whereNot({ id: myId })
    .select('id', 'full_name', 'email', 'role', 'photo_url')
    .limit(20);

  if (q) {
    const w = like(q);
    query.where((b) => {
      b.whereRaw(`lower(full_name) like ? escape '\\'`, [w])
        .orWhereRaw(`lower(email) like ? escape '\\'`, [w]);
    });
  }

  const users = await query.orderBy([{ column: 'is_sample', order: 'asc' }, { column: 'created_at', order: 'desc' }]);

  const userIds = users.map((u) => u.id);
  const talents = userIds.length
    ? await db('talent_profiles').whereIn('user_id', userIds).select('user_id', 'headline')
    : [];

  const talentMap = new Map(talents.map((t) => [t.user_id, t]));

  const results = users.map((u) => {
    const tp = talentMap.get(u.id);
    return {
      id: u.id,
      name: u.full_name || (u.email && u.email.split('@')[0]) || 'User',
      email: u.email,
      role: tp?.headline || u.role || 'Member',
      headline: tp?.headline || null,
      avatarUrl: u.photo_url || null
    };
  });

  res.json(results);
}

// User search endpoints
router.get('/messaging/users', requireAuth, h(handleUserSearch));
router.get('/users/search', requireAuth, h(handleUserSearch));

module.exports = router;
