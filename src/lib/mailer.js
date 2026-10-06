'use strict';
/*
 * Sends email through SMTP when SMTP_HOST is set. Without SMTP (local development) every email is
 * printed to the server console instead, so you can copy verification codes and reset links from there.
 */
const nodemailer = require('nodemailer');
const config = require('../config');
const { ApiError } = require('./errors');

const outbox = []; // last emails, kept in memory for tests
let transport = null;
if (config.mail.smtp) transport = nodemailer.createTransport(config.mail.smtp);

let warned = false;

async function send({ to, subject, text, html }, { critical = false } = {}) {
  const msg = { from: config.mail.from, to, subject, text, html };
  outbox.push(msg);
  if (outbox.length > 50) outbox.shift();

  if (config.isTest) return { logged: true };

  if (!transport) {
    if (!warned) {
      warned = true;
      console.warn('[mail] SMTP_HOST is not set, so emails are printed here instead of being sent.');
    }
    console.log(`\n[mail] To: ${to}\n[mail] Subject: ${subject}\n${text}\n`);
    return { logged: true };
  }

  try {
    await transport.sendMail(msg);
    return { sent: true };
  } catch (err) {
    console.error('[mail] Failed to send to', to, '-', err.message);
    if (critical) {
      throw new ApiError(502, 'EMAIL_FAILED', 'We couldn’t send the email right now. Please try again in a minute.');
    }
    return { failed: true };
  }
}

module.exports = { send, outbox };
