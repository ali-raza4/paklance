'use strict';
/*
 * Video introduction links. Same rules as PaklanceVideo.parse() in the frontend: YouTube, Vimeo, Loom and
 * Google Drive links are accepted; "youtu.be/…" without https:// is fine.
 */
function parseVideoLink(url) {
  let s = String(url || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  if (/\s/.test(s) || s.length > 300) return null;
  let m;
  if ((m = s.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i))) return { provider: 'YouTube', id: m[1], url: s };
  if ((m = s.match(/^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})(?!\d)/i))) return { provider: 'Vimeo', id: m[1], url: s };
  if ((m = s.match(/^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([a-f0-9]{16,40})(?![a-f0-9])/i))) return { provider: 'Loom', id: m[1], url: s };
  if ((m = s.match(/^https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]{20,})/i))) return { provider: 'Google Drive', id: m[1], url: s };
  return null;
}

// The saved video in the shape the frontend reads (PaklanceVideo.fromSaved).
function presentVideo(u) {
  if (!u || !u.video_url) return null;
  if (u.video_kind === 'upload') {
    return {
      kind: 'upload',
      url: u.video_url,
      name: u.video_name || 'Video',
      size: u.video_size == null ? null : Number(u.video_size),
      type: u.video_type || '',
      duration: u.video_duration == null ? null : Number(u.video_duration)
    };
  }
  return { kind: 'link', url: u.video_url };
}

module.exports = { parseVideoLink, presentVideo };
