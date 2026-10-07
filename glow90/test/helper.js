'use strict';
const { open } = require('../server/db');
const { createApp } = require('../server/app');

async function start() {
  delete process.env.ANTHROPIC_API_KEY;
  const db = open(':memory:');
  const server = createApp({ db, trustProxy: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let n = 0;
  const client = (headers = {}) => {
    let cookie = ''; const ip = `10.0.${Math.floor(++n / 250)}.${n % 250}`;
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-g90': '1', 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, body: json, headers: res.headers };
    };
    return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b || {}), put: (p, b) => call('PUT', p, b || {}), del: (p) => call('DELETE', p), raw: call };
  };
  return { db, server, base, client, close: () => new Promise((r) => server.close(r)) };
}
const ANSWERS = {
  age: 29, height_cm: 175, weight_kg: 82, goals: ['lose_weight', 'sleep', 'skin'], free_text: 'Daha enerjik olmak ve kilo vermek istiyorum',
  days_per_week: 3, minutes_per_day: 30, has_gym: false, home_equipment: ['dumbbell'], can_walk: true, selfcare: ['skin', 'dental'],
  bedtime: '00:00', sleep_hours: 6, sleep_quality: 5, phone_in_bed: true, caffeine: 'high', night_eating: true, discipline: 6, coach_tone: 'friendly',
};
async function onboarded(c, answers = ANSWERS, email = 'a@b.co') {
  await c.post('/api/auth/register', { email, password: 'password123', tz: 'Europe/Istanbul' });
  await c.put('/api/profile', answers);
  await c.post('/api/onboarding/analyze');
  return c.post('/api/plan/generate');
}
module.exports = { start, ANSWERS, onboarded };
