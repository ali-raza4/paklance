'use strict';
/*
 * Payment methods, fees and payout account checks.
 *
 * HONESTY RULE: JazzCash and Easypaisa are "coming soon" until merchant onboarding is complete.
 * The API refuses them (409 GATEWAY_COMING_SOON). There is no simulated success anywhere:
 * bank transfer / Raast funding stays "pending" until the money is actually confirmed.
 */
const config = require('../config');
const { E } = require('./errors');

const METHODS = [
  { id: 'raast', name: 'Raast', detail: 'Pakistan’s instant payment system, run by the State Bank of Pakistan', status: 'active', funding: true, payout: true },
  { id: 'nayapay', name: 'NayaPay', detail: 'Digital wallet · pay in or get paid through Raast or IBAN', status: 'active', via: 'raast', funding: false, payout: false },
  { id: 'sadapay', name: 'SadaPay', detail: 'Digital wallet · pay in or get paid through Raast or IBAN', status: 'active', via: 'raast', funding: false, payout: false },
  { id: 'bank_transfer', name: 'Bank Transfer', detail: 'Interbank transfer through 1Link (IBFT)', status: 'active', funding: true, payout: true },
  { id: 'jazzcash', name: 'JazzCash', detail: 'Mobile wallet · coming soon, once merchant onboarding is complete', status: 'coming_soon', funding: false, payout: false },
  { id: 'easypaisa', name: 'Easypaisa', detail: 'Mobile wallet · coming soon, once merchant onboarding is complete', status: 'coming_soon', funding: false, payout: false }
];

const COMING_SOON = new Set(['jazzcash', 'easypaisa']);
const comingSoonError = () =>
  E.conflict('GATEWAY_COMING_SOON', 'JazzCash and Easypaisa are coming soon, once merchant onboarding is complete. Please use bank transfer or Raast.');

const clientFee = (amount) => Math.round((amount * config.fees.clientPercent) / 100);
const specialistFee = (amount) => Math.round((amount * config.fees.specialistPercent) / 100);

function fundingMethod(v) {
  const m = String(v || 'bank_transfer').toLowerCase();
  if (COMING_SOON.has(m)) throw comingSoonError();
  if (m !== 'bank_transfer' && m !== 'raast') throw E.validation({ method: 'Choose bank transfer or Raast.' });
  return m;
}

// Where clients send escrow money. In production these must be configured; in development a clear
// "not configured" text is shown instead of anything that looks like a real account.
function escrowAccount() {
  const b = config.payments.escrowBank;
  if (b.iban && b.accountTitle) return { ...b };
  if (config.isProd) throw E.unavailable('ESCROW_NOT_CONFIGURED', 'Bank transfer funding isn’t available yet. Please try again later.');
  return {
    accountTitle: 'Not configured (set ESCROW_ACCOUNT_TITLE in .env)',
    bankName: b.bankName || '',
    iban: 'Not configured (set ESCROW_IBAN in .env)',
    raastId: b.raastId || ''
  };
}

/* ---------- payout accounts ---------- */

function payoutChannel(v) {
  const s = String(v || '').toLowerCase();
  if (/jazz/.test(s) || /easypaisa/.test(s)) throw comingSoonError();
  if (s === 'bank' || s === 'bank_transfer' || /bank|iban|1link/.test(s)) return 'bank';
  if (s === 'raast' || /raast/.test(s)) return 'raast';
  throw E.validation({ channel: 'Choose a bank account or Raast ID.' });
}

const IBAN_RE = /^PK\d{2}[A-Z]{4}[0-9A-Z]{16}$/;

// Returns the normalised account number or throws a field error.
function payoutAccount(channel, raw, field = 'accountNumber') {
  const v = String(raw || '').replace(/[\s-]/g, '').toUpperCase();
  if (!v) throw E.validation({ [field]: 'Enter the account, IBAN or Raast number.' });
  if (IBAN_RE.test(v)) return v;
  if (channel === 'bank' && /^\d{8,20}$/.test(v)) return v;
  if (channel === 'raast') {
    const m = v.match(/^(?:\+?92|0092|0)?(3\d{9})$/);
    if (m) return '0' + m[1];
  }
  throw E.validation({
    [field]: channel === 'raast'
      ? 'Enter a Raast ID (mobile number like 03XX XXXXXXX) or a Pakistani IBAN.'
      : 'Enter a Pakistani IBAN (PK + 22 characters) or an 8–20 digit account number.'
  });
}

const mask = (acct) => '•••• ' + String(acct).slice(-4);

module.exports = { METHODS, clientFee, specialistFee, fundingMethod, escrowAccount, payoutChannel, payoutAccount, mask, comingSoonError };
