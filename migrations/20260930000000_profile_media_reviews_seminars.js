'use strict';
/*
 * Tasks 5–14 of the review build:
 *   - profile photo and video introduction (link or uploaded file) on the account
 *   - reviews after a finished contract (stars shown on profiles, as a freelancer and as a client)
 *   - free seminars on recording a video introduction, with registrations
 *   - blog: key takeaways and a matching next-step button per article, and "Was this helpful?" feedback
 */

const ts = (t, name, nullable = false) => {
  const c = t.string(name, 32);
  return nullable ? c.nullable() : c.notNullable();
};

exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('photo_url', 300).nullable();
    t.string('video_kind', 16).nullable();      // 'link' | 'upload'
    t.string('video_url', 300).nullable();      // the link, or /uploads/videos/<file>
    t.string('video_name', 200).nullable();     // original file name (uploads)
    t.bigInteger('video_size').nullable();      // bytes (uploads)
    t.string('video_type', 60).nullable();      // MIME type (uploads)
    t.integer('video_duration').nullable();     // seconds (uploads)
    ts(t, 'video_updated_at', true);
  });

  // One review per person per finished contract. role = the role of the person being reviewed.
  await knex.schema.createTable('reviews', (t) => {
    t.increments('id');
    t.integer('contract_id').unsigned().notNullable().references('id').inTable('contracts').onDelete('CASCADE');
    t.string('reviewer_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('reviewee_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('role', 12).notNullable(); // 'freelancer' (client reviewed the specialist) | 'client' (specialist reviewed the client)
    t.integer('stars').notNullable();
    t.text('text').notNullable();
    t.string('project', 140).notNullable();
    ts(t, 'created_at');
    t.unique(['contract_id', 'reviewer_id']);
    t.index(['reviewee_id', 'role']);
  });

  await knex.schema.createTable('seminars', (t) => {
    t.string('id', 60).primary();
    t.string('title', 140).notNullable();
    t.string('mode', 16).notNullable();        // 'Online' | 'In person'
    t.string('place', 200).notNullable();      // "Live on Zoom" / "Islamabad · venue details are emailed after you register"
    t.text('about').notNullable();
    t.text('details').nullable();              // joining link or full venue address, emailed after registration only
    ts(t, 'starts_at');
    t.integer('minutes').notNullable();
    t.integer('seats').notNullable();
    t.string('status', 16).notNullable().defaultTo('scheduled'); // scheduled | cancelled
    t.boolean('is_sample').notNullable().defaultTo(false);
    ts(t, 'created_at');
    ts(t, 'updated_at');
    t.index(['status', 'starts_at']);
  });

  await knex.schema.createTable('seminar_registrations', (t) => {
    t.increments('id');
    t.string('seminar_id', 60).notNullable().references('id').inTable('seminars').onDelete('CASCADE');
    t.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    ts(t, 'created_at');
    t.unique(['seminar_id', 'user_id']);
    t.index(['user_id']);
  });

  await knex.schema.alterTable('blog_articles', (t) => {
    t.text('takeaways').nullable(); // JSON array of short points
    t.text('cta').nullable();       // JSON { title, text, button, action? , href? }
  });

  // "Was this helpful?" One vote per reader per article (the latest answer counts).
  await knex.schema.createTable('blog_feedback', (t) => {
    t.increments('id');
    t.integer('article_id').unsigned().notNullable().references('id').inTable('blog_articles').onDelete('CASCADE');
    t.string('voter_hash', 64).notNullable();  // HMAC of the account id, or of IP + browser for signed-out readers
    t.string('user_id', 36).nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('vote', 4).notNullable();         // 'yes' | 'no'
    t.text('comment').nullable();              // "What was missing or unclear?"
    ts(t, 'created_at');
    ts(t, 'updated_at');
    t.unique(['article_id', 'voter_hash']);
    t.index(['article_id', 'vote']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('blog_feedback');
  await knex.schema.alterTable('blog_articles', (t) => { t.dropColumn('takeaways'); t.dropColumn('cta'); });
  await knex.schema.dropTableIfExists('seminar_registrations');
  await knex.schema.dropTableIfExists('seminars');
  await knex.schema.dropTableIfExists('reviews');
  await knex.schema.alterTable('users', (t) => {
    ['photo_url', 'video_kind', 'video_url', 'video_name', 'video_size', 'video_type', 'video_duration', 'video_updated_at'].forEach((c) => t.dropColumn(c));
  });
};
