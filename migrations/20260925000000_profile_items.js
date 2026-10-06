'use strict';
/*
 * Profile sections behind the dashboard's profile-completion tracker:
 * portfolio projects, services, education, work experience and certificates.
 * (The introduction — headline, bio, city, category, rate — lives in talent_profiles.)
 */

exports.up = async function (knex) {
  await knex.schema.createTable('profile_items', (t) => {
    t.increments('id');
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('kind', 20).notNullable(); // 'portfolio' | 'services' | 'education' | 'experience' | 'certificates'
    t.string('title', 120).notNullable(); // project / service / degree / role / certificate name
    t.string('subtitle', 120).nullable(); // institution / company / issuer
    t.string('url', 300).nullable(); // portfolio link / credential link
    t.integer('amount').nullable(); // services: starting price in whole PKR
    t.integer('start_year').nullable();
    t.integer('end_year').nullable(); // experience: null = still working there
    t.text('description').nullable();
    t.string('created_at', 32).notNullable();
    t.index(['user_id', 'kind']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('profile_items');
};
