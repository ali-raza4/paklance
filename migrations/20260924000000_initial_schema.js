'use strict';
/*
 * Paklance schema. Works on SQLite (local) and PostgreSQL (production).
 * - Money is stored as whole PKR in integer columns.
 * - Timestamps are ISO-8601 UTC strings (same sorting/comparison on both databases).
 * - JSON values (skills, tags, article body …) are stored as text.
 */

const ts = (t, name, nullable = false) => {
  const c = t.string(name, 32);
  return nullable ? c.nullable() : c.notNullable();
};

exports.up = async function (knex) {
  await knex.schema.createTable('users', (t) => {
    t.string('id', 36).primary();
    t.string('email', 254).notNullable().unique();
    t.string('password_hash', 100).nullable();
    t.string('full_name', 60).nullable();
    t.text('skills').notNullable().defaultTo('[]');
    t.boolean('email_verified').notNullable().defaultTo(false);
    t.boolean('identity_verified').notNullable().defaultTo(false);
    t.string('provider', 16).notNullable().defaultTo('email'); // 'email' | 'google'
    t.string('google_sub', 64).nullable().unique();
    t.string('role', 16).notNullable().defaultTo('member'); // 'member' | 'admin'
    t.boolean('is_sample').notNullable().defaultTo(false);
    ts(t, 'created_at');
    ts(t, 'updated_at');
  });

  await knex.schema.createTable('sessions', (t) => {
    t.string('id', 64).primary(); // sha256 of the cookie token
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('ip', 64).nullable();
    t.string('user_agent', 255).nullable();
    ts(t, 'created_at');
    ts(t, 'last_seen_at');
    ts(t, 'expires_at');
    t.index(['user_id']);
  });

  // Email sign-ups waiting for their 6-digit code. The user row is only created after verification.
  await knex.schema.createTable('signup_requests', (t) => {
    t.increments('id');
    t.string('email', 254).notNullable();
    t.string('password_hash', 100).notNullable();
    t.string('code_hash', 64).notNullable();
    t.string('browser_hash', 64).notNullable(); // ties the code to the browser that asked for it
    t.integer('attempts').notNullable().defaultTo(0);
    ts(t, 'created_at');
    ts(t, 'last_sent_at');
    ts(t, 'expires_at');
    ts(t, 'consumed_at', true);
    t.index(['email']);
    t.index(['browser_hash']);
  });

  await knex.schema.createTable('password_resets', (t) => {
    t.increments('id');
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    ts(t, 'created_at');
    ts(t, 'expires_at');
    ts(t, 'used_at', true);
  });

  await knex.schema.createTable('talent_profiles', (t) => {
    t.string('id', 80).primary(); // URL-friendly id, e.g. "areeba"
    t.string('user_id', 36).nullable().unique().references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 60).notNullable();
    t.string('initials', 4).notNullable();
    t.string('headline', 100).notNullable();
    t.string('city', 60).notNullable();
    t.string('category', 40).notNullable();
    t.integer('hourly_rate').notNullable();
    t.string('availability', 40).notNullable();
    t.text('skills').notNullable().defaultTo('[]');
    t.text('bio').notNullable();
    t.text('stats').nullable(); // {completion, onTime, repeatClients} – sample profiles only; real ones are computed
    t.boolean('verified').notNullable().defaultTo(false);
    t.boolean('published').notNullable().defaultTo(true);
    t.boolean('is_sample').notNullable().defaultTo(false);
    ts(t, 'created_at');
    ts(t, 'updated_at');
    t.index(['published', 'category']);
  });

  await knex.schema.createTable('jobs', (t) => {
    t.increments('id');
    t.string('client_id', 36).nullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('title', 140).notNullable();
    t.string('client_label', 80).notNullable();
    t.string('city', 60).notNullable();
    t.string('category', 40).notNullable();
    t.integer('budget').notNullable();
    t.string('type', 20).notNullable(); // 'Fixed price' | 'Monthly' | 'Hourly'
    t.boolean('safepay').notNullable().defaultTo(true);
    t.boolean('client_verified').notNullable().defaultTo(false);
    t.text('skills').notNullable().defaultTo('[]');
    t.text('description').notNullable();
    t.string('status', 16).notNullable().defaultTo('open'); // open | closed
    t.boolean('is_sample').notNullable().defaultTo(false);
    ts(t, 'created_at');
    ts(t, 'updated_at');
    t.index(['status', 'category']);
    t.index(['client_id']);
  });

  await knex.schema.createTable('job_milestones', (t) => {
    t.increments('id');
    t.integer('job_id').unsigned().notNullable().references('id').inTable('jobs').onDelete('CASCADE');
    t.integer('position').notNullable();
    t.string('title', 120).notNullable();
    t.integer('amount').notNullable();
    t.index(['job_id']);
  });

  await knex.schema.createTable('proposals', (t) => {
    t.increments('id');
    t.integer('job_id').unsigned().notNullable().references('id').inTable('jobs').onDelete('CASCADE');
    t.string('freelancer_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('cover_letter').nullable();
    t.integer('bid_amount').notNullable();
    t.string('status', 16).notNullable().defaultTo('submitted'); // submitted | declined | withdrawn | hired
    ts(t, 'created_at');
    ts(t, 'updated_at');
    t.unique(['job_id', 'freelancer_id']);
    t.index(['freelancer_id']);
  });

  await knex.schema.createTable('contracts', (t) => {
    t.increments('id');
    t.string('code', 20).nullable().unique(); // e.g. PK-10482
    t.integer('job_id').unsigned().nullable().references('id').inTable('jobs').onDelete('SET NULL');
    t.integer('proposal_id').unsigned().nullable().references('id').inTable('proposals').onDelete('SET NULL');
    t.string('client_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('freelancer_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('title', 140).notNullable();
    t.string('client_label', 80).nullable();
    t.integer('total_amount').notNullable();
    t.string('status', 16).notNullable().defaultTo('active'); // active | completed | cancelled
    t.boolean('is_sample').notNullable().defaultTo(false);
    ts(t, 'created_at');
    ts(t, 'updated_at');
    t.index(['client_id']);
    t.index(['freelancer_id']);
  });

  await knex.schema.createTable('milestones', (t) => {
    t.increments('id');
    t.integer('contract_id').unsigned().notNullable().references('id').inTable('contracts').onDelete('CASCADE');
    t.integer('position').notNullable();
    t.string('title', 120).notNullable();
    t.integer('amount').notNullable();
    // unfunded → funding_pending → funded → submitted ⇄ changes_requested → released
    // (disputed and refunded come from the Resolution Centre)
    t.string('status', 20).notNullable().defaultTo('unfunded');
    t.text('submission_note').nullable();
    t.text('client_note').nullable();
    ts(t, 'funded_at', true);
    ts(t, 'submitted_at', true);
    ts(t, 'released_at', true);
    ts(t, 'created_at');
    ts(t, 'updated_at');
    t.index(['contract_id']);
  });

  // Escrow funding. Bank transfer / Raast payments stay "pending" until the money is seen on
  // Paklance's escrow account and confirmed (admin CLI/API, or a bank webhook later).
  await knex.schema.createTable('payments', (t) => {
    t.increments('id');
    t.integer('contract_id').unsigned().notNullable().references('id').inTable('contracts').onDelete('CASCADE');
    t.integer('milestone_id').unsigned().notNullable().references('id').inTable('milestones').onDelete('CASCADE');
    t.string('payer_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('method', 20).notNullable(); // bank_transfer | raast
    t.integer('amount').notNullable();
    t.integer('fee').notNullable();
    t.integer('total').notNullable();
    t.string('reference', 20).notNullable().unique();
    t.string('status', 16).notNullable().defaultTo('pending'); // pending | confirmed | cancelled | refunded
    t.string('bank_reference', 80).nullable();
    t.string('confirmed_by', 36).nullable();
    ts(t, 'created_at');
    ts(t, 'confirmed_at', true);
    ts(t, 'updated_at');
    t.index(['milestone_id']);
    t.index(['status']);
  });

  // Specialist wallet. Balance = SUM(amount). Withdrawals are debited when requested.
  await knex.schema.createTable('ledger_entries', (t) => {
    t.increments('id');
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('type', 24).notNullable(); // milestone_release | specialist_fee | withdrawal | withdrawal_reversal | adjustment
    t.integer('amount').notNullable(); // signed PKR
    t.integer('contract_id').unsigned().nullable();
    t.integer('milestone_id').unsigned().nullable();
    t.integer('withdrawal_id').unsigned().nullable();
    t.string('description', 200).notNullable();
    ts(t, 'created_at');
    t.index(['user_id']);
  });

  await knex.schema.createTable('payout_methods', (t) => {
    t.increments('id');
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('channel', 16).notNullable(); // bank | raast
    t.string('account_title', 100).notNullable();
    t.string('account_number', 34).notNullable();
    t.string('bank_name', 80).nullable();
    t.boolean('is_default').notNullable().defaultTo(false);
    ts(t, 'created_at');
    t.index(['user_id']);
  });

  await knex.schema.createTable('withdrawals', (t) => {
    t.increments('id');
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('payout_method_id').unsigned().nullable().references('id').inTable('payout_methods').onDelete('SET NULL');
    t.string('channel', 16).notNullable();
    t.string('account_title', 100).notNullable();
    t.string('account_number', 34).notNullable();
    t.string('bank_name', 80).nullable();
    t.integer('amount').notNullable();
    t.string('status', 16).notNullable().defaultTo('requested'); // requested | processing | paid | rejected
    t.string('admin_note', 300).nullable();
    ts(t, 'created_at');
    ts(t, 'processed_at', true);
    ts(t, 'updated_at');
    t.index(['user_id']);
    t.index(['status']);
  });

  await knex.schema.createTable('disputes', (t) => {
    t.increments('id');
    t.integer('contract_id').unsigned().notNullable().references('id').inTable('contracts').onDelete('CASCADE');
    t.integer('milestone_id').unsigned().nullable().references('id').inTable('milestones').onDelete('SET NULL');
    t.string('milestone_prev_status', 20).nullable();
    t.string('opened_by', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('issue', 80).notNullable();
    t.text('description').notNullable();
    t.string('status', 16).notNullable().defaultTo('open'); // open | under_review | resolved
    t.string('outcome', 16).nullable(); // release | refund | dismiss
    t.text('resolution_note').nullable();
    ts(t, 'created_at');
    ts(t, 'updated_at');
    ts(t, 'resolved_at', true);
    t.index(['contract_id']);
  });

  await knex.schema.createTable('notifications', (t) => {
    t.increments('id');
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('type', 40).notNullable();
    t.string('title', 160).notNullable();
    t.string('meta', 200).nullable();
    t.string('link', 200).nullable();
    ts(t, 'created_at');
    ts(t, 'read_at', true);
    t.index(['user_id', 'read_at']);
  });

  await knex.schema.createTable('match_requests', (t) => {
    t.increments('id');
    t.string('user_id', 36).nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('role', 140).notNullable();
    t.string('engagement', 40).notNullable();
    t.string('seniority', 40).notNullable();
    t.string('timezone', 60).notNullable();
    t.string('budget_model', 40).notNullable();
    t.text('skills').notNullable();
    t.string('status', 16).notNullable().defaultTo('new');
    ts(t, 'created_at');
  });

  await knex.schema.createTable('global_requests', (t) => {
    t.increments('id');
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('role', 140).notNullable();
    t.string('engagement', 40).notNullable();
    t.string('timezone', 40).notNullable();
    t.string('duration', 40).notNullable();
    t.string('start_window', 40).notNullable();
    t.text('skills').notNullable();
    t.text('protections').notNullable();
    t.string('status', 16).notNullable().defaultTo('draft'); // draft | submitted | in_review | closed
    ts(t, 'created_at');
    ts(t, 'updated_at');
    t.index(['user_id']);
  });

  await knex.schema.createTable('blog_articles', (t) => {
    t.increments('id');
    t.string('slug', 160).notNullable().unique();
    t.string('title', 200).notNullable();
    t.text('excerpt').notNullable();
    t.string('category', 40).notNullable();
    t.text('tags').notNullable().defaultTo('[]');
    t.text('body').notNullable().defaultTo('[]');
    t.boolean('featured').notNullable().defaultTo(false);
    t.boolean('popular').notNullable().defaultTo(false);
    t.boolean('is_demo').notNullable().defaultTo(false);
    t.string('status', 16).notNullable().defaultTo('published'); // published | draft
    t.string('published_on', 10).notNullable(); // YYYY-MM-DD
    t.string('updated_on', 10).nullable();
    ts(t, 'created_at');
    ts(t, 'updated_at');
    t.index(['status', 'published_on']);
  });

  await knex.schema.createTable('newsletter_subscribers', (t) => {
    t.increments('id');
    t.string('email', 254).notNullable().unique();
    t.string('status', 16).notNullable().defaultTo('subscribed'); // subscribed | unsubscribed
    t.string('source', 40).nullable();
    t.string('unsubscribe_token', 64).notNullable().unique();
    ts(t, 'created_at');
    ts(t, 'updated_at');
  });
};

exports.down = async function (knex) {
  const tables = [
    'newsletter_subscribers', 'blog_articles', 'global_requests', 'match_requests', 'notifications',
    'disputes', 'withdrawals', 'payout_methods', 'ledger_entries', 'payments', 'milestones', 'contracts',
    'proposals', 'job_milestones', 'jobs', 'talent_profiles', 'password_resets', 'signup_requests',
    'sessions', 'users'
  ];
  for (const t of tables) await knex.schema.dropTableIfExists(t);
};
