'use strict';
const path = require('node:path');
const { open } = require('./db');
const { createApp } = require('./app');

const dbFile = process.env.GLOW90_DB || path.join(__dirname, '..', 'data', 'glow90.db');
const port = Number(process.env.PORT || 3000);
const db = open(dbFile);
// Süresi dolan oturumları temizle
db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
createApp({ db }).listen(port, () => {
  console.log(`GLOW90 http://localhost:${port}  (AI: ${process.env.ANTHROPIC_API_KEY ? 'Claude' : 'kural tabanlı mod'})`);
});
