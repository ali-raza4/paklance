'use strict';
/*
 * Specialist wallet, payout methods and withdrawals.
 *
 *   GET    /api/wallet                                  balance, locked amount, recent activity
 *   GET    /api/wallet/payout-methods
 *   POST   /api/wallet/payout-methods                   { channel, accountTitle, accountNumber, bankName?, isDefault? }
 *   POST   /api/wallet/payout-methods/:id/default
 *   DELETE /api/wallet/payout-methods/:id
 *   GET    /api/wallet/withdrawals
 *   POST   /api/wallet/withdrawals                      { amount, payoutMethodId } or { amount, channel, accountTitle, accountNumber }
 *
 * channel: 'bank' (IBAN / account number via 1Link) or 'raast'. JazzCash / Easypaisa → 409 GATEWAY_COMING_SOON.
 * Withdrawals are debited from the balance when requested (locked) and paid by the finance team via 1Link.
 */
const express = require('express');
const db = require('../db');
const config = require('../config');
const { E, h } = require('../lib/errors');
const { Check, idParam } = require('../lib/validate');
const pay = require('../lib/payments');
const money = require('../services/money');
const mailer = require('../lib/mailer');
const emails = require('../lib/emails');
const { notify } = require('../services/notify');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use('/wallet', requireAuth);

const methodOut = (p) => ({
  id: p.id,
  type: p.channel,
  channel: p.channel,
  accountTitle: p.account_title,
  accountNumberMasked: pay.mask(p.account_number),
  bankName: p.bank_name || null,
  isDefault: db.bool(p.is_default),
  createdAt: p.created_at
});
const withdrawalOut = (w) => ({
  id: w.id,
  channel: w.channel,
  accountTitle: w.account_title,
  accountNumberMasked: pay.mask(w.account_number),
  bankName: w.bank_name || null,
  amount: w.amount,
  status: w.status,
  note: w.admin_note || null,
  createdAt: w.created_at,
  processedAt: w.processed_at || null
});

function readAccount(body) {
  const c = new Check(body);
  const accountTitle = c.text('accountTitle', { min: 3, max: 100, label: 'Account title' });
  const bankName = c.text('bankName', { min: 2, max: 80, label: 'Bank name', optional: true });
  c.done();
  const channel = pay.payoutChannel(body.channel || body.type);
  const accountNumber = pay.payoutAccount(channel, body.accountNumber);
  return { channel, accountTitle, accountNumber, bankName };
}

router.get('/wallet', h(async (req, res) => {
  const b = await money.balances(req.user.id);
  const entries = await db('ledger_entries').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(20);
  const withdrawals = await db('withdrawals').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(10);
  res.json({
    currency: 'PKR',
    available: b.available,
    locked: b.locked,
    totalEarned: b.totalEarned,
    minWithdrawal: config.payments.minWithdrawal,
    entries: entries.map((e) => ({ id: e.id, type: e.type, amount: e.amount, description: e.description, createdAt: e.created_at })),
    withdrawals: withdrawals.map(withdrawalOut)
  });
}));

router.get('/wallet/payout-methods', h(async (req, res) => {
  const rows = await db('payout_methods').where({ user_id: req.user.id }).orderBy([{ column: 'is_default', order: 'desc' }, { column: 'id', order: 'asc' }]);
  res.json({ payoutMethods: rows.map(methodOut) });
}));

router.post('/wallet/payout-methods', h(async (req, res) => {
  const a = readAccount(req.body || {});
  const existing = await db('payout_methods')
    .where({ user_id: req.user.id, account_number: a.accountNumber })
    .first();

  const count = await db.count(db('payout_methods').where({ user_id: req.user.id }));
  if (!existing && count >= 10) throw E.conflict('LIMIT_REACHED', 'You can save up to 10 payout methods. Remove one first.');

  const makeDefault = !!(req.body && (req.body.isDefault === true || req.body.isDefault === 'true')) || count === 0;

  let id;
  if (existing) {
    await db.transaction(async (trx) => {
      if (makeDefault) await trx('payout_methods').where({ user_id: req.user.id }).update({ is_default: false });
      await trx('payout_methods').where({ id: existing.id }).update({
        channel: a.channel,
        account_title: a.accountTitle,
        bank_name: a.bankName,
        is_default: makeDefault
      });
    });
    id = existing.id;
  } else {
    id = await db.transaction(async (trx) => {
      if (makeDefault) await trx('payout_methods').where({ user_id: req.user.id }).update({ is_default: false });
      return db.insertId(trx('payout_methods').insert({
        user_id: req.user.id, channel: a.channel, account_title: a.accountTitle, account_number: a.accountNumber,
        bank_name: a.bankName, is_default: makeDefault, created_at: db.now()
      }));
    });
  }

  const row = await db('payout_methods').where({ id }).first();
  const m = methodOut(row);
  res.status(existing ? 200 : 201).json({ payoutMethod: m, ...m });
}));

router.post('/wallet/payout-methods/:id/default', h(async (req, res) => {
  const id = idParam(req.params.id);
  const row = id && (await db('payout_methods').where({ id, user_id: req.user.id }).first());
  if (!row) throw E.notFound('Payout method not found.');
  await db.transaction(async (trx) => {
    await trx('payout_methods').where({ user_id: req.user.id }).update({ is_default: false });
    await trx('payout_methods').where({ id }).update({ is_default: true });
  });
  res.json({ payoutMethod: methodOut({ ...row, is_default: true }) });
}));

router.delete('/wallet/payout-methods/:id', h(async (req, res) => {
  const id = idParam(req.params.id);
  const n = id ? await db('payout_methods').where({ id, user_id: req.user.id }).del() : 0;
  if (!n) throw E.notFound('Payout method not found.');
  res.json({ ok: true });
}));

router.get('/wallet/withdrawals', h(async (req, res) => {
  const rows = await db('withdrawals').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(100);
  res.json({ withdrawals: rows.map(withdrawalOut) });
}));

router.post('/wallet/withdrawals', h(async (req, res) => {
  const body = req.body || {};
  const c = new Check(body);
  const amount = c.int('amount', { min: config.payments.minWithdrawal, max: 10000000, label: 'Withdrawal amount' });
  c.done();

  let account;
  let methodId = null;
  if (body.payoutMethodId) {
    const pm = await db('payout_methods').where({ id: idParam(body.payoutMethodId), user_id: req.user.id }).first();
    if (!pm) throw E.notFound('Payout method not found.');
    account = { channel: pm.channel, accountTitle: pm.account_title, accountNumber: pm.account_number, bankName: pm.bank_name };
    methodId = pm.id;
  } else {
    account = readAccount(body);
  }

  const now = db.now();
  const id = await db.transaction(async (trx) => {
    await db.lockRow(trx, 'users', req.user.id); // one withdrawal at a time per user
    const { available } = await money.balances(req.user.id, trx);
    if (amount > available) {
      throw E.conflict('INSUFFICIENT_BALANCE', `You can withdraw up to ${money.pkr(Math.max(0, available))}.`);
    }
    const wid = await db.insertId(trx('withdrawals').insert({
      user_id: req.user.id, payout_method_id: methodId, channel: account.channel, account_title: account.accountTitle,
      account_number: account.accountNumber, bank_name: account.bankName || null, amount, status: 'requested', created_at: now, updated_at: now
    }));
    await trx('ledger_entries').insert({ user_id: req.user.id, type: 'withdrawal', amount: -amount, withdrawal_id: wid, description: 'Withdrawal requested', created_at: now });
    await notify(trx, req.user.id, { type: 'withdrawal_requested', title: `Withdrawal of ${money.pkr(amount)} requested`, meta: `${account.channel === 'raast' ? 'Raast' : 'Bank'} ${pay.mask(account.accountNumber)}` });
    return wid;
  });
  await mailer.send({ to: req.user.email, ...emails.withdrawalRequested({ amount, channel: account.channel, masked: pay.mask(account.accountNumber) }) });
  const w = await db('withdrawals').where({ id }).first();
  res.status(201).json({ withdrawal: withdrawalOut(w) });
}));

router.get('/wallet/summary', h(async (req, res) => {
  const b = await money.balances(req.user.id);
  const isClient = String(req.user.role || '').toLowerCase() === 'client';
  const entries = await db('ledger_entries').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(50);
  const withdrawals = await db('withdrawals').where({ user_id: req.user.id }).orderBy('id', 'desc');
  const pms = await db('payout_methods').where({ user_id: req.user.id }).orderBy([{ column: 'is_default', order: 'desc' }, { column: 'id', order: 'asc' }]);

  if (isClient) {
    res.json({
      role: 'CLIENT',
      currency: 'PKR',
      balance: b.available + b.locked,
      lockedBalance: b.locked,
      availableBalance: b.available,
      totalDeposited: b.totalEarned || 0,
      totalSpent: Math.abs(entries.filter((e) => e.type === 'escrow_fund').reduce((s, e) => s + e.amount, 0)),
      escrowHeld: b.locked || 0,
      pendingDepositsCount: 0,
      pendingDepositsAmount: 0,
      recentTransactions: entries.map((e) => ({
        id: String(e.id),
        type: e.type.toUpperCase(),
        amount: e.amount,
        description: e.description || e.type,
        referenceId: `TX-${e.id}`,
        createdAt: e.created_at
      }))
    });
  } else {
    const completedWd = withdrawals.filter((w) => w.status === 'completed').reduce((s, w) => s + w.amount, 0);
    const pendingWd = withdrawals.filter((w) => w.status === 'requested' || w.status === 'processing').reduce((s, w) => s + w.amount, 0);

    res.json({
      role: 'SPECIALIST',
      currency: 'PKR',
      balance: b.available + b.locked,
      lockedBalance: b.locked,
      availableBalance: b.available,
      totalEarnings: b.totalEarned || 0,
      periodEarnings: b.totalEarned || 0,
      pendingEarnings: b.locked || 0,
      escrowHeldForMe: b.locked || 0,
      releasedEarnings: b.totalEarned || 0,
      totalWithdrawn: completedWd,
      pendingWithdrawn: pendingWd,
      payoutMethods: pms.map(methodOut),
      recentTransactions: entries.map((e) => ({
        id: String(e.id),
        type: e.type.toUpperCase(),
        amount: e.amount,
        fee: Math.round(Math.abs(e.amount) * 0.1),
        description: e.description || e.type,
        referenceId: `TX-${e.id}`,
        createdAt: e.created_at
      }))
    });
  }
}));

router.get('/wallet/statement', h(async (req, res) => {
  const b = await money.balances(req.user.id);
  const entries = await db('ledger_entries').where({ user_id: req.user.id }).orderBy('id', 'desc');
  const rows = [
    ['Date', 'Reference', 'Type', 'Amount (PKR)', 'Fee (PKR)', 'Description'].join(','),
    ...entries.map((e) => [
      new Date(e.created_at).toISOString().slice(0, 10),
      `"TX-${e.id}"`,
      `"${e.type.toUpperCase()}"`,
      Number(e.amount).toFixed(2),
      '0.00',
      `"${(e.description || '').replace(/"/g, '""')}"`
    ].join(','))
  ];
  res.json({
    csv: rows.join('\n'),
    totalTransactions: entries.length,
    currentBalance: b.available
  });
}));

router.post('/wallet/deposit', h(async (req, res) => {
  const { amount, provider } = req.body || {};
  if (!amount || amount < 100) throw E.badRequest('INVALID_AMOUNT', 'Minimum deposit is PKR 100.');
  const now = db.now();
  await db('ledger_entries').insert({
    user_id: req.user.id,
    type: 'deposit',
    amount: Number(amount),
    description: `Wallet Deposit (${provider || 'BANK_TRANSFER'})`,
    created_at: now
  });
  res.status(201).json({
    message: `Deposit of PKR ${Number(amount).toLocaleString()} confirmed and credited.`,
    amount: Number(amount),
    status: 'COMPLETED'
  });
}));

router.post('/wallet/withdrawals/:id/cancel', h(async (req, res) => {
  const id = idParam(req.params.id);
  const w = await db('withdrawals').where({ id, user_id: req.user.id }).first();
  if (!w) throw E.notFound('Withdrawal request not found.');
  if (w.status !== 'requested') throw E.badRequest('CANNOT_CANCEL', 'Only pending requests can be cancelled.');

  await db.transaction(async (trx) => {
    await trx('withdrawals').where({ id }).update({ status: 'cancelled', updated_at: db.now() });
    await trx('ledger_entries').insert({
      user_id: req.user.id,
      type: 'withdrawal_cancelled',
      amount: w.amount,
      description: `Cancelled withdrawal #${w.id}. Funds restored.`,
      created_at: db.now()
    });
  });

  res.json({ message: 'Withdrawal cancelled and funds restored.' });
}));

module.exports = router;
