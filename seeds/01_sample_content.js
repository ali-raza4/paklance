'use strict';
// `npm run seed` resets the sample jobs, specialists and demo articles to their original state.
// Real jobs, users and articles are never touched.
const { reseedSamples } = require('../src/seed');

exports.seed = async function (knex) {
  await reseedSamples(knex);
};
