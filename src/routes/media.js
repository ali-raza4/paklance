'use strict';
/*
 * Profile photo and video introduction (the camera button on the profile, and the dashboard's video card).
 *
 *   POST   /api/me/photo                  multipart: photo (JPG/PNG/WebP, up to PHOTO_MAX_MB)  → { user }
 *   DELETE /api/me/photo                                                                        → { user }
 *   PUT    /api/me/profile/video          { url }   YouTube, Vimeo, Loom or Google Drive link;
 *                                         url: null or '' removes the video                     → { video }
 *   POST   /api/me/profile/video/upload   multipart: video (MP4/MOV/WebM, up to VIDEO_MAX_MB) + duration (seconds,
 *                                         measured by the browser; 10 to VIDEO_MAX_SECONDS)       → { video }
 *
 * video = { kind: 'link', url } | { kind: 'upload', url: '/uploads/videos/…', name, size, type, duration }
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const { E, h } = require('../lib/errors');
const present = require('../lib/present');
const uploads = require('../lib/uploads');
const { parseVideoLink, presentVideo } = require('../lib/video');
const { requireAuth, requireReady } = require('../middleware/auth');

const router = express.Router();

const NO_VIDEO = { video_kind: null, video_url: null, video_name: null, video_size: null, video_type: null, video_duration: null };

router.post('/me/photo', requireAuth, uploads.photoUpload, h(async (req, res) => {
  const url = uploads.savePhoto(req.file, req.user.id);
  const old = req.user.photo_url;
  await db('users').where({ id: req.user.id }).update({ photo_url: url, updated_at: db.now() });
  if (old && old !== url) uploads.remove(old);
  res.json({ user: present.user(await db('users').where({ id: req.user.id }).first()) });
}));

router.delete('/me/photo', requireAuth, h(async (req, res) => {
  if (req.user.photo_url) {
    await db('users').where({ id: req.user.id }).update({ photo_url: null, updated_at: db.now() });
    uploads.remove(req.user.photo_url);
  }
  res.json({ user: present.user(await db('users').where({ id: req.user.id }).first()) });
}));

router.put('/me/profile/video', requireReady, h(async (req, res) => {
  const raw = req.body && req.body.url;
  const old = req.user.video_kind === 'upload' ? req.user.video_url : null;
  if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
    await db('users').where({ id: req.user.id }).update({ ...NO_VIDEO, video_updated_at: db.now(), updated_at: db.now() });
    if (old) uploads.remove(old);
    return res.json({ video: null });
  }
  if (typeof raw !== 'string') throw E.validation({ url: 'Paste a link to your video.' });
  const v = parseVideoLink(raw);
  if (!v) throw E.validation({ url: 'Use a YouTube, Vimeo, Loom or Google Drive link to your video.' });
  await db('users').where({ id: req.user.id }).update({ ...NO_VIDEO, video_kind: 'link', video_url: v.url, video_updated_at: db.now(), updated_at: db.now() });
  if (old) uploads.remove(old);
  res.json({ video: presentVideo(await db('users').where({ id: req.user.id }).first()) });
}));

router.post('/me/profile/video/upload', requireReady, uploads.videoUpload, h(async (req, res) => {
  const duration = Math.round(Number(req.body && req.body.duration));
  if (req.file && Number.isFinite(duration) && duration > config.uploads.videoMaxSeconds) {
    uploads.discard(req.file);
    throw E.validation({ video: `Keep your video to ${Math.floor(config.uploads.videoMaxSeconds / 60)} minutes or less.` });
  }
  if (req.file && Number.isFinite(duration) && duration > 0 && duration < 10) {
    uploads.discard(req.file);
    throw E.validation({ video: 'Record at least 10 seconds.' });
  }
  const saved = uploads.saveVideo(req.file, req.user.id);
  const old = req.user.video_kind === 'upload' ? req.user.video_url : null;
  const name = String(req.file.originalname || 'Video').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 200) || 'Video';
  await db('users').where({ id: req.user.id }).update({
    video_kind: 'upload', video_url: saved.url, video_name: name, video_size: saved.size, video_type: saved.type,
    video_duration: Number.isFinite(duration) && duration > 0 ? duration : null, video_updated_at: db.now(), updated_at: db.now()
  });
  if (old && old !== saved.url) uploads.remove(old);
  res.status(201).json({ video: presentVideo(await db('users').where({ id: req.user.id }).first()) });
}));

module.exports = router;
