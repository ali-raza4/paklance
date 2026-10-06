'use strict';
/*
 * File uploads: profile photos and video introductions.
 *
 * Files go to config.uploads.dir (photos/ and videos/) with random names and are served from /uploads.
 * The file type is checked from the file's first bytes, never from its name or the browser's claim.
 * To move to S3 / Cloudflare R2 later, replace save() and remove() here; the routes don't change.
 */
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const sec = require('./security');
const { E } = require('./errors');

const DIR = config.uploads.dir;
const TMP = path.join(DIR, 'tmp');
for (const d of [DIR, TMP, path.join(DIR, 'photos'), path.join(DIR, 'videos')]) fs.mkdirSync(d, { recursive: true });

const mb = (bytes) => Math.round(bytes / 1024 / 1024);

// Returns { ext, type } from the first bytes, or null.
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg', kind: 'image' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png', kind: 'image' };
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', type: 'image/webp', kind: 'image' };
  if (buf.slice(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('latin1');
    return brand === 'qt  ' ? { ext: 'mov', type: 'video/quicktime', kind: 'video' } : { ext: 'mp4', type: 'video/mp4', kind: 'video' };
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { ext: 'webm', type: 'video/webm', kind: 'video' };
  return null;
}

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(16);
    const n = fs.readSync(fd, b, 0, 16, 0);
    return b.slice(0, n);
  } finally { fs.closeSync(fd); }
}

// multer → our JSON errors
function wrap(mw, { field, tooLarge }) {
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(E.bad('FILE_TOO_LARGE', tooLarge));
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return next(E.bad('BAD_UPLOAD', `Send one file in the "${field}" field.`));
    return next(E.bad('BAD_UPLOAD', 'We couldn’t read that upload. Please try again.'));
  });
}

const photoUpload = wrap(multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.photoMaxBytes, files: 1, fields: 5 }
}).single('photo'), { field: 'photo', tooLarge: `Use a photo under ${mb(config.uploads.photoMaxBytes)} MB.` });

const videoUpload = wrap(multer({
  storage: multer.diskStorage({ destination: TMP, filename: (req, f, cb) => cb(null, sec.randomToken(12) + '.part') }),
  limits: { fileSize: config.uploads.videoMaxBytes, files: 1, fields: 5 }
}).single('video'), { field: 'video', tooLarge: `Use a video under ${mb(config.uploads.videoMaxBytes)} MB.` });

// Saves an uploaded photo (memory buffer) → public URL. Throws a 400 for anything that isn't JPEG / PNG / WebP.
function savePhoto(file, ownerId) {
  if (!file) throw E.validation({ photo: 'Choose a photo to upload.' });
  const t = sniff(file.buffer);
  if (!t || t.kind !== 'image') throw E.validation({ photo: 'Use a JPG, PNG or WebP image.' });
  const name = `${String(ownerId).slice(0, 8)}-${sec.randomToken(9)}.${t.ext}`;
  fs.writeFileSync(path.join(DIR, 'photos', name), file.buffer);
  return `/uploads/photos/${name}`;
}

// Moves an uploaded video (temp file) into place → { url, type, size }. Deletes the temp file on any failure.
function saveVideo(file, ownerId) {
  if (!file) throw E.validation({ video: 'Choose a video to upload.' });
  let t = null;
  try { t = sniff(readHead(file.path)); } catch (e) { t = null; }
  if (!t || t.kind !== 'video') { discard(file); throw E.validation({ video: 'Use an MP4, MOV or WebM video.' }); }
  const name = `${String(ownerId).slice(0, 8)}-${sec.randomToken(9)}.${t.ext}`;
  fs.renameSync(file.path, path.join(DIR, 'videos', name));
  return { url: `/uploads/videos/${name}`, type: t.type, size: file.size };
}

function discard(file) {
  if (file && file.path) fs.rm(file.path, { force: true }, () => {});
}

// Deletes a file we stored earlier (ignores links and anything outside the upload folder).
function remove(url) {
  const m = /^\/uploads\/(photos|videos)\/([A-Za-z0-9_-]+\.[a-z0-9]{2,5})$/.exec(String(url || ''));
  if (!m) return;
  fs.rm(path.join(DIR, m[1], m[2]), { force: true }, () => {});
}

module.exports = { DIR, photoUpload, videoUpload, savePhoto, saveVideo, discard, remove, sniff };
