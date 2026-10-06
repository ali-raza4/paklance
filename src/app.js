'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const config = require('./config');
const { E, errorHandler } = require('./lib/errors');
const { loadSession } = require('./middleware/auth');
const pages = require('./pages');

function limiter(windowMs, limit, message) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.isTest,
    handler: (req, res) => res.status(429).json({ code: 'RATE_LIMITED', message })
  });
}

// File uploads (multipart) are only accepted on these paths.
const UPLOAD_PATHS = ['/me/photo', '/me/profile/video/upload'];

// Blocks cross-site form posts (CSRF): state-changing API calls must come from this site and be JSON.
// Uploads are the one exception to JSON; they must also carry this site's Origin header, which browsers
// always send with fetch/XHR uploads, so a form on another site can't post a file here.
function sameOriginOnly(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  let host = '';
  if (origin) {
    try { host = new URL(origin).host; } catch (e) { /* invalid */ }
    const allowed = [req.get('host'), new URL(config.appUrl).host];
    if (!allowed.includes(host)) return next(E.forbidden('Cross-site requests aren’t allowed.', 'BAD_ORIGIN'));
  }
  if (req.is('multipart/form-data')) {
    if (req.method === 'POST' && UPLOAD_PATHS.includes(req.path) && origin && host) return next();
    return next(E.bad('UNSUPPORTED_MEDIA_TYPE', 'Send the request body as JSON.'));
  }
  const len = Number(req.get('content-length') || 0);
  if (len > 0 && !req.is('application/json')) {
    return next(E.bad('UNSUPPORTED_MEDIA_TYPE', 'Send the request body as JSON.'));
  }
  next();
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com'],
        'media-src': ["'self'", 'blob:'],
        'connect-src': ["'self'", 'https://accounts.google.com/gsi/'],
        // Google sign-in, and the players for video introductions shared as a link
        'frame-src': ['https://accounts.google.com/gsi/', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.loom.com', 'https://drive.google.com'],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': config.isProd ? [] : null
      }
    },
    // Google sign-in pop-ups need this so the opener can receive the credential.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    // Google Identity Services checks the page origin, so the referrer must include it.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: config.isProd
  }));

  app.use(cookieParser());
  app.use(express.json({ limit: '300kb' }));

  /* ---------- API ---------- */
  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(sameOriginOnly);
  api.use(loadSession);
  api.use(limiter(60 * 1000, 300, 'Too many requests. Please slow down and try again.'));
  api.use('/auth', limiter(10 * 60 * 1000, 60, 'Too many attempts. Please wait a few minutes and try again.'));
  api.use(['/match-requests', '/newsletter'], limiter(60 * 60 * 1000, 30, 'Too many requests. Please try again later.'));
  api.use(UPLOAD_PATHS, limiter(60 * 60 * 1000, 30, 'Too many uploads. Please try again later.'));
  api.use('/blog/articles/:slug/feedback', limiter(60 * 60 * 1000, 60, 'Thanks, we already have your feedback.'));

  api.use(require('./routes/site'));
  api.use(require('./routes/auth'));
  api.use(require('./routes/jobs'));
  api.use(require('./routes/talent'));
  api.use(require('./routes/media'));
  api.use(require('./routes/seminars'));
  api.use(require('./routes/requests'));
  api.use(require('./routes/contracts'));
  api.use(require('./routes/disputes'));
  api.use(require('./routes/wallet'));
  api.use(require('./routes/notifications'));
  api.use(require('./routes/messaging'));
  api.use(require('./routes/blog'));
  api.use(require('./routes/admin'));
  api.use((req, res, next) => next(E.notFound('No such API endpoint.')));
  app.use('/api', api);

  /* ---------- uploaded photos and videos ---------- */
  app.use('/uploads', (req, res, next) => (/^\/(photos|videos)\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/.test(req.path) ? next() : res.status(404).end()),
    express.static(config.uploads.dir, { index: false, maxAge: config.isProd ? '30d' : 0, immutable: config.isProd }),
    (req, res) => res.status(404).end());

  /* ---------- website ---------- */
  app.use(require('./routes/blog').unsubscribePage);
  app.use(pages.router);
  app.use(express.static(pages.PUBLIC, {
    index: 'index.html',
    extensions: ['html'],
    setHeaders(res, file) {
      if (/[\\/]assets[\\/]/.test(file)) res.set('Cache-Control', config.isProd ? 'public, max-age=3600' : 'no-cache');
      else res.set('Cache-Control', 'no-cache');
    }
  }));
  app.use((req, res) => res.status(404).sendFile(path.join(pages.PUBLIC, '404.html')));

  app.use(errorHandler(console));
  return app;
}

module.exports = { createApp };
