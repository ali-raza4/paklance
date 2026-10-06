'use strict';
const config = require('./config');

let knexFactory;
try {
  knexFactory = require('knex');
} catch (e) {
  throw new Error('Dependencies are missing. Run "npm install" first.');
}
if (!config.db.usePg) {
  try {
    require.resolve('better-sqlite3');
  } catch (e) {
    throw new Error(
      'SQLite driver (better-sqlite3) is not installed. Run "npm install" again, ' +
        'or set DATABASE_URL to a PostgreSQL connection string to use Postgres instead.'
    );
  }
}

const db = knexFactory(config.db.knex);

/* ---------- small helpers shared by the routes ---------- */

// Every timestamp is stored as an ISO-8601 UTC string, so SQLite and Postgres sort and compare them the same way.
db.now = () => new Date().toISOString();
db.inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();

db.isPg = config.db.usePg;

// insert(...).returning('id') gives [{ id }] on both drivers.
db.insertId = async (qb) => {
  const rows = await qb.returning('id');
  const r = rows[0];
  return r && typeof r === 'object' ? r.id : r;
};

db.count = async (qb) => {
  const row = await qb.count({ n: '*' }).first();
  return Number((row && row.n) || 0);
};

db.sum = async (qb, col) => {
  const row = await qb.sum({ s: col }).first();
  return Number((row && row.s) || 0);
};

// Row lock for money movements (Postgres). SQLite already serialises writes.
db.lockRow = (trx, table, id) => {
  const q = trx(table).where({ id }).first();
  return db.isPg ? q.forUpdate() : q;
};

db.json = (v, fallback) => {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return fallback; }
};
db.bool = (v) => v === true || v === 1 || v === '1' || v === 't' || v === 'true';

module.exports = db;
