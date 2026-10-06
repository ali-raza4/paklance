'use strict';
// Used by the knex CLI (npm run migrate / npm run seed). Settings come from .env via src/config.js.
module.exports = require('./src/config').db.knex;
