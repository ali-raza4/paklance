'use strict';
/*
 * Every money movement lives here so the API routes and the admin CLI use exactly the same rules.
 * All functions take a knex transaction.
 */
const db = require('../db');
const { E } = require('../lib/errors');
const { specialistFee } = require('../lib/payments');
const { notify } = require('./notify');

const pkr = (n) => 'PKR ' + Number(n).toLocaleString('en-US');

async function balances(userId, trx = db) {
  const available = await db.sum(trx('ledger_entries').where({ user_id: userId }), 'amount');
  const locked = await db.sum(trx('withdrawals').where({ user_id: userId }).whereIn('status', ['requested', 'processing']), 'amount');
  const earned = await db.sum(trx('ledger_entries').where({ user_id: userId, type: 'milestone_release' }), 'amount');
  const fees = await db.sum(trx('ledger_entries').where({ user_id: userId, type: 'specialist_fee' }), 'amount');
  return { available, locked, totalEarned: earned + fees };
}

// Client approved (or the Resolution Centre decided): pay the specialist's wallet.
async function releaseMilestone(trx, contract, milestone, { by = 'client' } = {}) {
  const now = db.now();
  const fee = specialistFee(milestone.amount);
  await trx('milestones').where({ id: milestone.id }).update({ status: 'released', released_at: now, updated_at: now });
  await trx('ledger_entries').insert([
    { user_id: contract.freelancer_id, type: 'milestone_release', amount: milestone.amount, contract_id: contract.id, milestone_id: milestone.id, description: `Released: ${milestone.title}`, created_at: now },
    { user_id: contract.freelancer_id, type: 'specialist_fee', amount: -fee, contract_id: contract.id, milestone_id: milestone.id, description: `Paklance fee on ${milestone.title}`, created_at: now }
  ]);
  await notify(trx, contract.freelancer_id, {
    type: 'milestone_released',
    title: `${pkr(milestone.amount - fee)} released to your wallet`,
    meta: `${milestone.title} · ${contract.code}${by === 'resolution' ? ' · Resolution Centre' : ''}`
  });
  const left = await db.count(trx('milestones').where({ contract_id: contract.id }).whereNot({ status: 'released' }).whereNot({ status: 'refunded' }));
  if (left === 0) await trx('contracts').where({ id: contract.id }).update({ status: 'completed', updated_at: now });
}

// Bank transfer / Raast money was seen on the escrow account.
async function confirmPayment(trx, paymentId, { adminId = null, bankReference = null } = {}) {
  const p = await db.lockRow(trx, 'payments', paymentId);
  if (!p) throw E.notFound('Payment not found.');
  if (p.status !== 'pending') throw E.conflict('INVALID_STATE', `This payment is already ${p.status}.`);
  const m = await trx('milestones').where({ id: p.milestone_id }).first();
  if (!m || m.status !== 'funding_pending') throw E.conflict('INVALID_STATE', 'The milestone is not waiting for funding.');
  const c = await trx('contracts').where({ id: p.contract_id }).first();
  const now = db.now();
  await trx('payments').where({ id: p.id }).update({ status: 'confirmed', confirmed_at: now, confirmed_by: adminId, bank_reference: bankReference, updated_at: now });
  await trx('milestones').where({ id: m.id }).update({ status: 'funded', funded_at: now, updated_at: now });
  await notify(trx, c.client_id, { type: 'funding_confirmed', title: 'SafePay funding confirmed', meta: `${m.title} · ${c.code}` });
  await notify(trx, c.freelancer_id, { type: 'milestone_funded', title: 'Milestone funded, you can start', meta: `${m.title} · ${c.code}` });
  return p;
}

async function cancelPayment(trx, paymentId) {
  const p = await db.lockRow(trx, 'payments', paymentId);
  if (!p) throw E.notFound('Payment not found.');
  if (p.status !== 'pending') throw E.conflict('INVALID_STATE', `This payment is already ${p.status}.`);
  const now = db.now();
  await trx('payments').where({ id: p.id }).update({ status: 'cancelled', updated_at: now });
  await trx('milestones').where({ id: p.milestone_id, status: 'funding_pending' }).update({ status: 'unfunded', updated_at: now });
  return p;
}

async function setWithdrawalStatus(trx, withdrawalId, status, note = null) {
  const w = await db.lockRow(trx, 'withdrawals', withdrawalId);
  if (!w) throw E.notFound('Withdrawal not found.');
  const allowed = { requested: ['processing', 'paid', 'rejected'], processing: ['paid', 'rejected'] };
  if (!(allowed[w.status] || []).includes(status)) throw E.conflict('INVALID_STATE', `A ${w.status} withdrawal can’t be marked ${status}.`);
  const now = db.now();
  await trx('withdrawals').where({ id: w.id }).update({ status, admin_note: note, processed_at: status === 'processing' ? null : now, updated_at: now });
  if (status === 'rejected') {
    await trx('ledger_entries').insert({ user_id: w.user_id, type: 'withdrawal_reversal', amount: w.amount, withdrawal_id: w.id, description: 'Withdrawal returned to your balance', created_at: now });
    await notify(trx, w.user_id, { type: 'withdrawal_rejected', title: `Withdrawal of ${pkr(w.amount)} returned to your balance`, meta: note || 'Check your payout details and try again.' });
  } else if (status === 'paid') {
    await notify(trx, w.user_id, { type: 'withdrawal_paid', title: `${pkr(w.amount)} sent to your account`, meta: `${w.channel === 'raast' ? 'Raast' : 'Bank'} •••• ${String(w.account_number).slice(-4)}` });
  }
  return w;
}

// Resolution Centre outcome: release to the specialist, refund the client, or dismiss the case.
async function resolveDispute(trx, disputeId, outcome, note) {
  const d = await db.lockRow(trx, 'disputes', disputeId);
  if (!d) throw E.notFound('Case not found.');
  if (d.status === 'resolved') throw E.conflict('INVALID_STATE', 'This case is already resolved.');
  const c = await trx('contracts').where({ id: d.contract_id }).first();
  const m = d.milestone_id ? await trx('milestones').where({ id: d.milestone_id }).first() : null;
  const now = db.now();
  const fundedStates = ['funded', 'submitted', 'changes_requested'];

  if (outcome === 'release' || outcome === 'refund') {
    if (!m || !fundedStates.includes(d.milestone_prev_status)) {
      throw E.conflict('INVALID_STATE', 'Only a funded milestone can be released or refunded.');
    }
    if (outcome === 'release') {
      await releaseMilestone(trx, c, m, { by: 'resolution' });
    } else {
      await trx('milestones').where({ id: m.id }).update({ status: 'refunded', updated_at: now });
      // The refund itself is sent back to the client's bank by the finance team.
      await trx('payments').where({ milestone_id: m.id, status: 'confirmed' }).update({ status: 'refunded', updated_at: now });
      const left = await db.count(trx('milestones').where({ contract_id: c.id }).whereNotIn('status', ['released', 'refunded']));
      if (left === 0) await trx('contracts').where({ id: c.id }).update({ status: 'completed', updated_at: now });
    }
  } else if (m && d.milestone_prev_status) {
    await trx('milestones').where({ id: m.id }).update({ status: d.milestone_prev_status, updated_at: now });
  }

  await trx('disputes').where({ id: d.id }).update({ status: 'resolved', outcome, resolution_note: note || null, resolved_at: now, updated_at: now });
  const words = { release: 'Payment released to the specialist', refund: 'Refund approved for the client', dismiss: 'Case closed with no change' };
  for (const uid of [c.client_id, c.freelancer_id]) {
    await notify(trx, uid, { type: 'dispute_resolved', title: `Case resolved: ${words[outcome]}`, meta: `${c.code}${m ? ' · ' + m.title : ''}` });
  }
  return d;
}

module.exports = { balances, releaseMilestone, confirmPayment, cancelPayment, setWithdrawalStatus, resolveDispute, pkr };
