'use strict';
/*
 * Messaging schema: conversations between any two users (client <-> freelancer,
 * freelancer <-> freelancer, client <-> client), and individual messages.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('conversations', (t) => {
    t.string('id', 36).primary();
    t.string('participant1_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('participant2_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('created_at', 32).notNullable();
    t.string('updated_at', 32).notNullable();
    t.index(['participant1_id']);
    t.index(['participant2_id']);
    t.unique(['participant1_id', 'participant2_id']);
  });

  await knex.schema.createTable('messages', (t) => {
    t.string('id', 36).primary();
    t.string('conversation_id', 36).notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    t.string('sender_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('content').notNullable();
    t.boolean('is_delivered').notNullable().defaultTo(false);
    t.boolean('is_read').notNullable().defaultTo(false);
    t.string('created_at', 32).notNullable();
    t.index(['conversation_id']);
    t.index(['sender_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('messages');
  await knex.schema.dropTableIfExists('conversations');
};
