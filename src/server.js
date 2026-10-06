'use strict';
const config = require('./config');
const db = require('./db');
const { createApp } = require('./app');
const { seedIfEmpty } = require('./seed');

async function start() {
  if (!config.db.usePg) {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.dirname(config.db.sqliteFile), { recursive: true });
  }
  await db.migrate.latest();
  await seedIfEmpty(db);

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Paklance is running on ${config.appUrl} (port ${config.port}, ${config.db.usePg ? 'PostgreSQL' : 'SQLite'})`);
    if (!config.mail.smtp) console.log('Emails (verification codes, reset links) are printed in this window until SMTP is configured.');
    if (!config.google.clientId) console.log('Google sign-in is off until GOOGLE_CLIENT_ID is set.');
  });

  const stop = () => server.close(() => db.destroy().then(() => process.exit(0)));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

start().catch((err) => {
  console.error('Paklance failed to start:', err.message);
  process.exit(1);
});
