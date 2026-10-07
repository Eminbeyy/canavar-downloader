// Gizlilik dostu ürün analitiği özeti (sağlık verisi içermez): node scripts/stats.js [db]
const path = require('node:path');
const { open } = require('../server/db');
const db = open(process.argv[2] || process.env.GLOW90_DB || path.join(__dirname, '..', 'data', 'glow90.db'));
const one = (sql) => db.prepare(sql).get();
const users = one('SELECT COUNT(*) c FROM users').c;
const onboarded = one("SELECT COUNT(DISTINCT uid_hash) c FROM events WHERE name='onboarding_completed'").c;
const signed = one("SELECT COUNT(DISTINCT uid_hash) c FROM events WHERE name='signup'").c;
const ret = (d) => one(`SELECT COUNT(DISTINCT uid_hash) c FROM events WHERE day>=${d}`).c;
const ai = db.prepare('SELECT source, COUNT(*) n, SUM(input_token_estimate) i, SUM(output_token_estimate) o FROM ai_events GROUP BY source').all();
console.log(JSON.stringify({
  users, onboarding_completion: signed ? +(onboarded / signed).toFixed(2) : null,
  retention_users: { day2plus: ret(2), day7plus: ret(7), day30plus: ret(30) },
  tasks_completed: one("SELECT COUNT(*) c FROM events WHERE name='task_completed'").c,
  adaptations: one("SELECT COUNT(*) c FROM reports WHERE kind='adapt'").c,
  milestones_opened: one("SELECT COUNT(*) c FROM events WHERE name LIKE 'milestone_%'").c,
  ai_usage: ai,
}, null, 2));
