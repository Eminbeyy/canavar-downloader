'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open, q } = require('../server/db');
const core = require('../server/core');
const E = require('../server/engine');
const ai = require('../server/ai');
const svc = require('../server/services');
const { validate } = require('../server/validate');
const schemas = require('../server/schemas');
const { clock, addDays, diffDays } = require('../server/util');
const { ANSWERS } = require('./helper');

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0); // 2026-01-05 (Pzt)
function setup(answers = ANSWERS) {
  delete process.env.ANTHROPIC_API_KEY;
  clock.set(T0);
  const db = open(':memory:');
  q.run(db, "INSERT INTO users(email,pass_hash,created_at,tz) VALUES('t@t.co','x','now','UTC')");
  q.run(db, 'INSERT INTO profiles(user_id) VALUES(1)');
  core.saveAnswers(db, 1, answers);
  return db;
}
const dayAt = (n) => clock.set(T0 + n * 864e5);
const completeDay = (db, date, frac = 1) => {
  const tasks = core.dayTasks(db, 1, date).filter((t) => !t.optional);
  tasks.slice(0, Math.ceil(tasks.length * frac)).forEach((t) => core.setTask(db, 1, t.id, true));
};
test.afterEach(() => clock.reset());

test('validate: şema kuralları', () => {
  assert.equal(validate(schemas.checkin, { energy: 5 }).length, 0);
  assert.ok(validate(schemas.checkin, { energy: 11 }).length);
  assert.ok(validate(schemas.checkin, { foo: 1 }).length);
  assert.ok(validate(schemas.ai.COACH_CHAT, { reply: 'x', action: 'rm -rf' }).length);
});

test('engine: 90 gün, günde 3-8 ana görev, minimum set 2-4, 3 faz', () => {
  for (const a of [ANSWERS, { goals: ['skin'] }, { goals: ['build_muscle'], has_gym: true, days_per_week: 5, discipline: 9, minutes_per_day: 60 }, {}]) {
    const ctx = E.deriveCtx(a);
    const days = E.generateDays(ctx, '2026-01-05', ctx.baseLevel);
    assert.equal(days.length, 90);
    for (const d of days) {
      const main = d.tasks.filter((t) => !t.optional); const mins = d.tasks.filter((t) => t.is_min);
      assert.ok(main.length >= 3 && main.length <= 8, `gün ${d.day}: ${main.length}`);
      assert.ok(mins.length >= 2 && mins.length <= 4, `gün ${d.day} min ${mins.length}`);
      assert.equal(new Set(d.tasks.map((t) => t.key)).size, d.tasks.length);
    }
    assert.deepEqual([...new Set(days.map((d) => d.phase))], [1, 2, 3]);
  }
});

test('engine: antrenman günü sayısı, yoğun günlerden kaçınma, yoğunluk artışı', () => {
  const ctx = E.deriveCtx({ ...ANSWERS, days_per_week: 3, busy_days: [0] });
  assert.equal(ctx.workoutDays.size, 3); assert.ok(!ctx.workoutDays.has(0));
  const days = E.generateDays(ctx, '2026-01-05', 3);
  const w1 = days.slice(0, 7).filter((d) => d.tasks.some((t) => t.key === 'workout')).length;
  assert.equal(w1, 3);
  const steps = (i) => Number(days[i].tasks.find((t) => t.key === 'steps').title.replace('.', '').split(' ')[0]);
  assert.ok(steps(70) > steps(0));
});

test('engine: güvenlik bayrakları (18 yaş altı / düşük BMI kilo verme görevi yok, sakatlık düşük etkili)', () => {
  const young = E.deriveCtx({ goals: ['lose_weight'], age: 16 });
  assert.ok(young.flags.includes('no_weight_loss') && !young.loseWeight);
  assert.ok(E.planNotes(young).length);
  const inj = E.deriveCtx({ goals: ['fitness'], injuries: 'diz ağrısı', likes: ['koşu'] });
  assert.ok(inj.lowImpact);
  const days = E.generateDays(inj, '2026-01-05', 3);
  assert.ok(!days.some((d) => d.tasks.some((t) => /koşu/i.test(t.title))));
  const w = days.flatMap((d) => d.tasks).find((t) => t.key === 'workout');
  assert.match(w.note, /doktor/);
});

test('adaptasyon kararı: yüksek/düşük tamamlama, bekleme süresi', () => {
  const b = { daysObserved: 7, level: 3, stressAvg: 4, lastAdaptGap: null };
  assert.equal(E.adaptDecision({ ...b, completion7: 0.4 }).change, -1);
  assert.equal(E.adaptDecision({ ...b, completion7: 0.95 }).change, 1);
  assert.equal(E.adaptDecision({ ...b, completion7: 0.75 }).change, 0);
  assert.equal(E.adaptDecision({ ...b, completion7: 0.4, lastAdaptGap: 1 }).change, 0);
  assert.equal(E.adaptDecision({ ...b, completion7: 0.4, daysObserved: 2 }).change, 0);
  assert.equal(E.adaptDecision({ ...b, completion7: 0.4, level: 1 }).change, 0);
});

test('çekirdek: düşük tamamlama planı hafifletir, yüksek tamamlama artırır; tamamlananlara dokunmaz', async () => {
  const db = setup();
  const plan = core.createPlan(db, 1);
  const start = plan.start_date; assert.equal(start, '2026-01-05');
  // 7 gün %30 tamamla
  for (let i = 0; i < 7; i++) { dayAt(i); completeDay(db, addDays(start, i), 0.3); }
  dayAt(7);
  const before = core.activePlan(db, 1).level;
  const r = core.runAdaptation(db, 1, addDays(start, 7));
  assert.equal(r.change, -1);
  assert.equal(core.activePlan(db, 1).level, before - 1);
  // geçmiş gün korunur, gelecek gün daha az görevli
  assert.ok(core.dayTasks(db, 1, start).some((t) => t.completed));
  const n = (d) => core.dayTasks(db, 1, d).filter((t) => !t.optional).length;
  assert.ok(n(addDays(start, 9)) < E.generateDay(E.deriveCtx(ANSWERS), 10, addDays(start, 9), before).filter((t) => !t.optional).length);
  // Aynı gün tekrar çalışmaz
  assert.equal(core.runAdaptation(db, 1, addDays(start, 7)), null);
});

test('ilerleme: ağırlıklar, bugün boşsa sayılmaz, olmayan kategori ağırlığı dağıtılır', () => {
  const db = setup({ goals: ['skin'], selfcare: ['skin'], sleep_quality: 9, sleep_hours: 8 }); // hareket/beslenme/uyku yok
  core.createPlan(db, 1);
  const cats = new Set(q.all(db, 'SELECT DISTINCT category FROM daily_tasks').map((r) => r.category));
  assert.ok(cats.has('selfcare') && !cats.has('movement') && !cats.has('sleep'));
  assert.equal(core.computeProgress(db, 1, '2026-01-05').progress, 0);
  completeDay(db, '2026-01-05', 1);
  const p = core.computeProgress(db, 1, '2026-01-05');
  // consistency/nutrition/selfcare %100, check-in %0 → (0.35+0.15+0.10)/(0.65)
  assert.equal(p.progress, Math.round(100 * (0.35 + 0.15 + 0.10) / 0.65));
  core.saveCheckin(db, 1, '2026-01-05', { sleep: 7, energy: 7 });
  assert.equal(core.computeProgress(db, 1, '2026-01-05').progress, 100);
  assert.deepEqual(Object.keys(core.computeProgress(db, 1, '2026-01-05').scores).sort(), ['checkin', 'consistency', 'nutrition', 'selfcare']);
});

test('seri: tek kaçırılan gün (toparlanma) seriyi bozmaz, iki ardışık bozar', () => {
  const db = setup(); core.createPlan(db, 1);
  const d = (i) => addDays('2026-01-05', i);
  [0, 1, 2, 4, 5].forEach((i) => completeDay(db, d(i), 1)); // 3. gün kaçırıldı
  assert.equal(core.computeStreak(db, 1, d(5)).streak, 5);
  assert.equal(core.computeStreak(db, 1, d(5)).recoveries, 1);
  // bugün henüz yapılmadıysa seri bozulmaz
  assert.equal(core.computeStreak(db, 1, d(6)).streak, 5);
  // iki gün kaçır
  assert.equal(core.computeStreak(db, 1, d(8)).streak, 0);
  // minimum gün tamamlanınca seri devam eder
  core.setMode(db, 1, d(6), 'minimum');
  core.dayTasks(db, 1, d(6)).filter((t) => t.is_min).forEach((t) => core.setTask(db, 1, t.id, true));
  assert.equal(core.computeStreak(db, 1, d(6)).streak, 6);
});

test('check-in: plan %90+ ise az soru, düşükse tam set; kilo haftada bir', () => {
  const db = setup(); core.createPlan(db, 1);
  const date = '2026-01-05';
  assert.ok(core.checkinQuestions(db, 1, date).questions.includes('stress'));
  completeDay(db, date, 1);
  const easy = core.checkinQuestions(db, 1, date);
  assert.equal(easy.easy, true); assert.ok(!easy.questions.includes('stress'));
  assert.ok(easy.questions.includes('weight'));
  core.saveCheckin(db, 1, date, { sleep: 7, energy: 7, weight: 80 });
  assert.ok(!core.checkinQuestions(db, 1, addDays(date, 3)).questions.includes('weight'));
  assert.ok(core.checkinQuestions(db, 1, addDays(date, 8)).questions.includes('weight'));
});

// ---- AI katmanı ----
const mockFetch = (impl) => { ai.fetchImpl = impl; process.env.ANTHROPIC_API_KEY = 'test-key'; };
const toolResp = (input) => async () => ({ ok: true, json: async () => ({ content: [{ type: 'tool_use', input }] }) });
test.afterEach(() => { ai.fetchImpl = null; delete process.env.ANTHROPIC_API_KEY; });

test('AI: şema doğrulama, önbellek, token günlüğü, tool_choice ile JSON şema', async () => {
  const db = setup(); let calls = 0; let sent;
  const good = { phases: [1, 2, 3].map((n) => ({ phase: n, theme: 't' + n, focus: 'f' })), welcome: 'Merhaba' };
  mockFetch(async (url, init) => { calls++; sent = JSON.parse(init.body); return toolResp(good)(); });
  const run = () => ai.run(db, { uid: 1, type: 'PLAN_GENERATION', payload: { a: 1 }, fallback: () => ({ rule: true }) });
  const r1 = await run(); const r2 = await run();
  assert.equal(r1.source, 'ai'); assert.equal(r2.source, 'cache'); assert.equal(calls, 1);
  assert.equal(sent.tool_choice.type, 'tool'); assert.deepEqual(sent.tools[0].input_schema, schemas.ai.PLAN_GENERATION);
  assert.ok(!JSON.stringify(sent).includes('test-key'));
  assert.equal(q.get(db, "SELECT COUNT(*) c FROM ai_events WHERE source='ai'").c, 1);
});

test('AI: geçersiz / güvensiz çıktı veya hata → kural tabanlı fallback', async () => {
  const db = setup();
  mockFetch(toolResp({ reply: 'x', action: 'hack' }));
  assert.equal((await ai.run(db, { uid: 1, type: 'COACH_CHAT', payload: { m: 1 }, cache: false, fallback: () => ({ rule: 1 }) })).source, 'rule');
  mockFetch(toolResp({ reply: 'Hastalığın var, ilacı artır', action: 'none' }));
  assert.equal((await ai.run(db, { uid: 1, type: 'COACH_CHAT', payload: { m: 2 }, cache: false, fallback: () => ({ rule: 1 }) })).source, 'rule');
  mockFetch(async () => { throw new Error('network'); });
  assert.equal((await ai.run(db, { uid: 1, type: 'COACH_CHAT', payload: { m: 3 }, cache: false, fallback: () => ({ rule: 1 }) })).source, 'rule');
});

test('AI: günlük limit aşılınca çağrı yapılmaz', async () => {
  const db = setup(); let calls = 0;
  mockFetch(async () => { calls++; return toolResp({ reply: 'ok', action: 'none' })(); });
  for (let i = 0; i < 31; i++) await ai.run(db, { uid: 1, type: 'COACH_CHAT', payload: { i }, cache: false, fallback: () => ({ reply: 'r', action: 'none' }) });
  assert.equal(calls, 30);
});

test('AI: koç istemi tüm geçmişi göndermez (kompakt özet)', async () => {
  const db = setup(); core.createPlan(db, 1); let body;
  mockFetch(async (u, init) => { body = init.body; return toolResp({ reply: 'Tamam', action: 'none' })(); });
  for (let i = 0; i < 12; i++) q.run(db, "INSERT INTO coach_messages(user_id,role,content,created_at) VALUES(1,'user',?, 'x')", 'eski mesaj ' + i);
  await svc.coachChat(db, 1, 'merhaba koç');
  assert.ok(body.length < 2500, `prompt çok büyük: ${body.length}`);
  assert.ok(!body.includes('eski mesaj 0'));
});

test('haftalık rapor bir kez üretilir (önbellek); milestone ve final rapor', async () => {
  const db = setup(); core.createPlan(db, 1);
  dayAt(3); assert.equal((await svc.weeklyReport(db, 1)).available, false);
  for (let i = 0; i < 7; i++) completeDay(db, addDays('2026-01-05', i), 0.8);
  dayAt(7);
  const w1 = await svc.weeklyReport(db, 1); assert.equal(w1.available, true); assert.equal(w1.week, 1);
  assert.ok(w1.best && w1.hardest && w1.next_week);
  const before = q.get(db, 'SELECT COUNT(*) c FROM ai_events').c;
  await svc.weeklyReport(db, 1);
  assert.equal(q.get(db, 'SELECT COUNT(*) c FROM ai_events').c, before);
  dayAt(10); assert.equal((await svc.milestone(db, 1, 30)).reached, false);
  dayAt(89); const m = await svc.milestone(db, 1, 90);
  assert.equal(m.reached, true); assert.ok(m.report.next_direction); assert.ok(m.totals.tasks_done > 0);
  assert.equal((await svc.milestone(db, 1, 30)).message, 'İlk alışkanlıklar oturmaya başladı.');
});
