'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, ANSWERS, onboarded } = require('./helper');
const { clock } = require('../server/util');

let t;
test.before(async () => { t = await start(); });
test.after(async () => { clock.reset(); await t.close(); });

test('güvenlik: oturumsuz erişim ve CSRF başlığı', async () => {
  const c = t.client();
  assert.equal((await c.get('/api/today')).status, 401);
  const res = await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  const h = await c.get('/api/health');
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  assert.match(h.headers.get('content-security-policy'), /default-src 'self'/);
});

test('kayıt/giriş doğrulama ve parola karması', async () => {
  const c = t.client();
  assert.equal((await c.post('/api/auth/register', { email: 'bad', password: 'password123' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { email: 'x@y.co', password: 'short' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { email: 'x@y.co', password: 'password123', tz: 'Europe/Istanbul' })).status, 200);
  const u = t.db.prepare('SELECT pass_hash FROM users WHERE email=?').get('x@y.co');
  assert.ok(u.pass_hash.startsWith('s1$') && !u.pass_hash.includes('password123'));
  assert.equal((await t.client().post('/api/auth/login', { email: 'x@y.co', password: 'wrongpass1' })).status, 401);
  assert.equal((await t.client().post('/api/auth/login', { email: 'x@y.co', password: 'password123' })).status, 200);
  assert.equal((await t.client().post('/api/auth/register', { email: 'x@y.co', password: 'password123' })).status, 409);
});

test('auth rate limit', async () => {
  const c = t.client();
  let last;
  for (let i = 0; i < 12; i++) last = await c.post('/api/auth/login', { email: 'no@no.co', password: 'xxxxxxxx' });
  assert.equal(last.status, 429);
});

test('uçtan uca: onboarding → plan → bugün → görev → check-in → ilerleme', async () => {
  const c = t.client();
  const gen = await onboarded(c, ANSWERS, 'flow@test.co');
  assert.equal(gen.status, 200);
  const me = (await c.get('/api/me')).body;
  assert.equal(me.onboarded, true);
  assert.ok(me.summary.primary_goal);

  const today = (await c.get('/api/today')).body;
  assert.equal(today.day, 1);
  assert.ok(today.tasks.filter((x) => !x.optional).length >= 3 && today.tasks.filter((x) => !x.optional).length <= 8);
  assert.equal(today.progress, 0);

  const first = today.tasks.find((x) => !x.optional);
  const r = await c.put(`/api/tasks/${first.id}`, { completed: true });
  assert.equal(r.body.stats.done, 1);
  assert.ok(r.body.progress > 0);

  const q1 = (await c.get('/api/checkin')).body;
  assert.ok(q1.questions.includes('sleep') && q1.questions.includes('energy') && q1.questions.includes('stress'));
  const ci = await c.post('/api/checkin', { sleep: 6.5, energy: 6, stress: 5, hunger: 4, difficulty: 5, weight: 81.5, note: 'zor bir gündü' });
  assert.equal(ci.status, 200);
  assert.equal((await c.get('/api/today')).body.checkin_done, true);

  const prog = (await c.get('/api/progress')).body;
  assert.ok(prog.progress >= 0 && prog.progress <= 100);
  assert.ok('movement' in prog.scores && 'consistency' in prog.scores);
  const plan = (await c.get('/api/plan')).body;
  assert.equal(plan.days.length, 90);
  assert.equal(plan.phases.length, 3);
});

test('minimum gün: seri korunur, hafif görev seti', async () => {
  const c = t.client();
  await onboarded(c, ANSWERS, 'min@test.co');
  assert.equal((await c.put('/api/day/mode', { mode: 'minimum' })).status, 200);
  const today = (await c.get('/api/today')).body;
  assert.equal(today.mode, 'minimum');
  const mins = today.tasks.filter((x) => x.is_min);
  assert.ok(mins.length >= 2 && mins.length <= 4);
  for (const m of mins) await c.put(`/api/tasks/${m.id}`, { completed: true });
  const after = (await c.get('/api/today')).body;
  assert.equal(after.streak.streak, 1);
});

test('yetkilendirme: başkasının görevine dokunulamaz', async () => {
  const a = t.client(); const b = t.client();
  await onboarded(a, ANSWERS, 'owner@test.co');
  await onboarded(b, ANSWERS, 'other@test.co');
  const id = (await a.get('/api/today')).body.tasks[0].id;
  assert.equal((await b.put(`/api/tasks/${id}`, { completed: true })).status, 404);
});

test('girdi doğrulama: şema dışı onboarding reddedilir', async () => {
  const c = t.client();
  await c.post('/api/auth/register', { email: 'v@test.co', password: 'password123' });
  assert.equal((await c.put('/api/profile', { age: 'abc' })).status, 400);
  assert.equal((await c.put('/api/profile', { evil: 1 })).status, 400);
  assert.equal((await c.put('/api/profile', { goals: ['hack'] })).status, 400);
  assert.equal((await c.post('/api/checkin', { energy: 99 })).status, 400);
});

test('koç: kırmızı bayrak AI\'a gitmeden yönlendirir; kural tabanlı eylem uygulanır', async () => {
  const c = t.client();
  await onboarded(c, ANSWERS, 'coach@test.co');
  const red = (await c.post('/api/coach', { message: 'göğüs ağrım var ve nefes alamıyorum' })).body;
  assert.equal(red.source, 'safety'); assert.match(red.reply, /112/);
  const med = (await c.post('/api/coach', { message: 'ilaç dozunu artırsam mı?' })).body;
  assert.equal(med.source, 'safety');
  const low = (await c.post('/api/coach', { message: 'Bugün spor yapacak enerjim yok' })).body;
  assert.equal(low.action, 'minimum_today'); assert.equal(low.applied, true);
  assert.equal((await c.get('/api/today')).body.mode, 'minimum');
  const hist = (await c.get('/api/coach/history')).body.messages;
  assert.ok(hist.length >= 6);
});

test('dışa aktarma JSON/CSV ve hesap silme', async () => {
  const c = t.client();
  await onboarded(c, ANSWERS, 'exp@test.co');
  await c.post('/api/checkin', { sleep: 7, energy: 7, note: '=HYPERLINK("x")' });
  const j = await c.get('/api/export?format=json');
  assert.ok(j.body.tasks.length > 300 && j.body.checkins.length === 1);
  const csv = await c.get('/api/export?format=csv');
  assert.match(csv.body, /# tasks/); assert.ok(!csv.body.includes(',=HYPERLINK'), 'CSV formül enjeksiyonu engellenmeli');
  assert.equal((await c.del('/api/account')).status, 200);
  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM users WHERE email='exp@test.co'").get().c, 0);
  assert.equal(t.db.prepare('SELECT COUNT(*) c FROM daily_tasks WHERE user_id NOT IN (SELECT id FROM users)').get().c, 0);
});

test('bildirim planı: günde en fazla 3, check-in yapıldıysa hatırlatma yok', async () => {
  const c = t.client();
  await onboarded(c, ANSWERS, 'notif@test.co');
  assert.equal((await c.get('/api/notifications/plan')).body.enabled, false);
  await c.put('/api/settings', { notifications: { enabled: true, water: true, sleep: true, workout: true } });
  const p = (await c.get('/api/notifications/plan')).body;
  assert.ok(p.items.length <= 3 && p.items.length >= 1);
  await c.put('/api/settings', { notifications: { enabled: true, water: false, sleep: false, workout: false } });
  assert.ok((await c.get('/api/notifications/plan')).body.items.some((i) => i.id === 'checkin'));
  await c.post('/api/checkin', { sleep: 7, energy: 7 });
  assert.ok(!(await c.get('/api/notifications/plan')).body.items.some((i) => i.id === 'checkin'));
});

test('statik dosya: dizin dışına çıkılamaz, SPA fallback', async () => {
  for (const p of ['/%2e%2e/server/db.js', '/..%2fserver%2fdb.js', '/js/../../server/db.js']) {
    const res = await fetch(t.base + p); const body = await res.text();
    assert.ok(!body.includes('DatabaseSync'), p);
  }
  assert.equal((await fetch(t.base + '/')).status, 200);
  assert.equal((await fetch(t.base + '/sw.js')).status, 200);
});
