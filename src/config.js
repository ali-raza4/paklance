'use strict';
/*
 * All settings come from environment variables (see .env.example).
 * Nothing secret is hard-coded here.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = process.env;
const ROOT = path.join(__dirname, '..');
const NODE_ENV = env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

function int(name, fallback) {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}
function bool(name, fallback) {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}
function list(name) {
  return (env[name] || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

const APP_URL = (env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

let SESSION_SECRET = env.SESSION_SECRET || '';
if (!SESSION_SECRET) {
  if (isProd) throw new Error('SESSION_SECRET must be set in production (a long random string).');
  SESSION_SECRET = 'dev-only-secret-change-me';
}

/* ---------- database ---------- */
const DATABASE_URL = env.DATABASE_URL || '';
const usePg = /^postgres(ql)?:\/\//i.test(DATABASE_URL);
const sqliteFile = isTest ? ':memory:' : path.resolve(ROOT, env.SQLITE_FILE || 'data/paklance.sqlite');

const knex = usePg
  ? {
      client: 'pg',
      connection: {
        connectionString: DATABASE_URL,
        ssl: bool('DATABASE_SSL', false) ? { rejectUnauthorized: false } : false
      },
      pool: { min: 0, max: int('DATABASE_POOL_MAX', 10) },
      migrations: { directory: path.join(ROOT, 'migrations') },
      seeds: { directory: path.join(ROOT, 'seeds') }
    }
  : {
      client: 'better-sqlite3',
      connection: { filename: sqliteFile },
      useNullAsDefault: true,
      pool: {
        min: 1,
        max: 1,
        afterCreate(conn, done) {
          conn.pragma('foreign_keys = ON');
          if (sqliteFile !== ':memory:') conn.pragma('journal_mode = WAL');
          done();
        }
      },
      migrations: { directory: path.join(ROOT, 'migrations') },
      seeds: { directory: path.join(ROOT, 'seeds') }
    };

module.exports = {
  ROOT,
  NODE_ENV,
  isProd,
  isTest,
  port: int('PORT', 3000),
  appUrl: APP_URL,
  trustProxy: env.TRUST_PROXY || (isProd ? '1' : ''),
  sessionSecret: SESSION_SECRET,
  sessionDays: int('SESSION_DAYS', 30),
  cookieName: 'pl_session',
  cookieSecure: bool('COOKIE_SECURE', isProd),
  adminEmails: list('ADMIN_EMAILS'),

  db: { usePg, sqliteFile, knex },

  seed: {
    sampleContent: bool('SEED_SAMPLE_CONTENT', true),
    // Demo accounts have a published password, so they are never created in production.
    demoAccounts: !isProd && bool('SEED_DEMO_ACCOUNTS', !isTest)
  },

  auth: {
    codeTtlMinutes: int('VERIFY_CODE_TTL_MINUTES', 15),
    codeMaxAttempts: int('VERIFY_CODE_MAX_ATTEMPTS', 5),
    resendCooldownSeconds: int('RESEND_COOLDOWN_SECONDS', 30),
    resetTtlMinutes: int('RESET_LINK_TTL_MINUTES', 60),
    bcryptRounds: isTest ? 4 : int('BCRYPT_ROUNDS', 12)
  },

  google: { clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '' },

  mail: {
    from: env.MAIL_FROM || 'Paklance <no-reply@paklance.com>',
    smtp: env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: int('SMTP_PORT', 587),
          secure: bool('SMTP_SECURE', false),
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined
        }
      : null
  },

  /* Fees: PLACEHOLDERS that match the Pricing page (3% client / 10% specialist). Set the real rates here
     AND on the Pricing page, so what people read and what they are charged always agree. */
  fees: {
    clientPercent: int('CLIENT_FEE_PERCENT', 3),
    specialistPercent: int('SPECIALIST_FEE_PERCENT', 10)
  },

  /* Profile photos and video introductions. Files are kept on this server's disk under UPLOAD_DIR and
     served from /uploads. On a host without a persistent disk, mount a volume there (see docker-compose.yml). */
  uploads: {
    dir: path.resolve(ROOT, env.UPLOAD_DIR || (isTest ? 'data/test-uploads' : 'data/uploads')),
    photoMaxBytes: int('PHOTO_MAX_MB', 5) * 1024 * 1024,
    videoMaxBytes: int('VIDEO_MAX_MB', 100) * 1024 * 1024,
    videoMinSeconds: 10,
    videoMaxSeconds: int('VIDEO_MAX_SECONDS', 15)
  },

  payments: {
    minWithdrawal: int('MIN_WITHDRAWAL_PKR', 500),
    // Paklance's escrow account shown to clients funding a milestone by bank transfer / Raast.
    escrowBank: {
      accountTitle: env.ESCROW_ACCOUNT_TITLE || '',
      bankName: env.ESCROW_BANK_NAME || '',
      iban: env.ESCROW_IBAN || '',
      raastId: env.ESCROW_RAAST_ID || ''
    }
    // JazzCash and Easypaisa are "coming soon" (see src/lib/payments.js). There is deliberately no switch
    // to turn them on: they need real merchant integrations first, never simulated success.
  }
};
