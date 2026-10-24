'use strict';

/**
 * Add role to signup_requests table so the selected role is persisted
 * during email verification.
 */
exports.up = async function (knex) {
  const hasRole = await knex.schema.hasColumn('signup_requests', 'role');
  if (!hasRole) {
    await knex.schema.alterTable('signup_requests', (t) => {
      t.string('role', 16).nullable().defaultTo('specialist');
    });
  }
};

exports.down = async function (knex) {
  const hasRole = await knex.schema.hasColumn('signup_requests', 'role');
  if (hasRole) {
    await knex.schema.alterTable('signup_requests', (t) => {
      t.dropColumn('role');
    });
  }
};
