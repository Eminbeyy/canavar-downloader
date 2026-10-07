'use strict';
// Uygulama çekirdeği: plan kaydı, günlük görevler, ilerleme, seri, check-in, adaptasyon. AI içermez.
const { q } = require('./db');
const E = require('./engine');
const { addDays, diffDays, todayIn, clamp, avg, round1, clock } = require('./util');

const J = (s, d = {}) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const nowIso = () => new Date(clock.now()).toISOString();

const getUser = (db, id) => q.get(db, 'SELECT * FROM users WHERE id=?', id);
const userToday = (db, uid) => todayIn(getUser(db, uid)?.tz || 'UTC');

function getProfile(db, uid) {
  const r = q.get(db, 'SELECT * FROM profiles WHERE user_id=?', uid);
  return { answers: J(r?.answers), summary: J(r?.summary, null), onboarded: !!r?.onboarded };
}
function saveAnswers(db, uid, patch) {
  const cur = getProfile(db, uid).answers;
  const merged = { ...cur, ...patch };
  q.run(db, `INSERT INTO profiles(user_id,answers,updated_at) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET answers=excluded.answers, updated_at=excluded.updated_at`, uid, JSON.stringify(merged), nowIso());
  return merged;
}
function saveSummary(db, uid, summary) {
  q.run(db, 'UPDATE profiles SET summary=?, updated_at=? WHERE user_id=?', JSON.stringify(summary), nowIso(), uid);
}

const activePlan = (db, uid) => {
  const p = q.get(db, "SELECT * FROM plans WHERE user_id=? AND status='active' ORDER BY id DESC LIMIT 1", uid);
  return p ? { ...p, meta: J(p.meta) } : null;
};
const dayNumber = (plan, date) => diffDays(date, plan.start_date) + 1;

function insertDays(db, plan, uid, days, { skipExisting = false } = {}) {
  const ins = db.prepare(`INSERT OR ${skipExisting ? 'IGNORE' : 'REPLACE'} INTO daily_tasks
    (plan_id,user_id,date,key,title,category,type,priority,minutes,optional,is_min,minimum_version,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const d of days) for (const t of d.tasks) {
    ins.run(plan.id, uid, d.date, t.key, t.title, t.category, t.type, t.priority, t.minutes ?? null, t.optional ? 1 : 0, t.is_min ? 1 : 0, t.minimum_version ?? null, t.note ?? null);
  }
}

// Onboarding sonrası 90 günlük planı oluştur. blueprint: AI'dan (veya kural tabanlı) faz/özel alışkanlık katmanı.
function createPlan(db, uid, blueprint = {}) {
  const { answers, summary } = getProfile(db, uid);
  const ctx = E.deriveCtx(answers, { primary_goal: summary?.primary_goal, custom_habits: blueprint.custom_habits });
  const start = userToday(db, uid);
  return q.tx(db, () => {
    q.run(db, "UPDATE plans SET status='archived' WHERE user_id=? AND status='active'", uid);
    const level = ctx.baseLevel;
    const meta = { phases: blueprint.phases || E.PHASES.map(({ n, name, theme, focus }) => ({ phase: n, name, theme, focus })),
      welcome: blueprint.welcome || null, notes: E.planNotes(ctx), custom_habits: blueprint.custom_habits || [], source: blueprint.source || 'rule' };
    const r = q.run(db, 'INSERT INTO plans(user_id,start_date,end_date,level,meta,created_at) VALUES(?,?,?,?,?,?)',
      uid, start, addDays(start, 89), level, JSON.stringify(meta), nowIso());
    const plan = { id: Number(r.lastInsertRowid), user_id: uid, start_date: start, level, meta };
    insertDays(db, plan, uid, E.generateDays(ctx, start, level));
    q.run(db, 'UPDATE profiles SET onboarded=1 WHERE user_id=?', uid);
    q.run(db, 'DELETE FROM goals WHERE user_id=?', uid);
    ctx.goals.forEach((g, i) => q.run(db, 'INSERT INTO goals(user_id,category,target,priority) VALUES(?,?,?,?)', uid, g, i === 0 ? (answers.free_text || null) : null, i + 1));
    return plan;
  });
}

// Planın geri kalanını yeni seviyeyle yeniden üret (tamamlanmış görevlere dokunma).
function regenerate(db, uid, plan, fromDate, level) {
  const { answers, summary } = getProfile(db, uid);
  const ctx = E.deriveCtx(answers, { primary_goal: summary?.primary_goal, custom_habits: plan.meta.custom_habits });
  const fromDay = clamp(dayNumber(plan, fromDate), 1, 90);
  q.tx(db, () => {
    q.run(db, 'DELETE FROM daily_tasks WHERE plan_id=? AND date>=? AND completed=0', plan.id, fromDate);
    const days = E.generateDays(ctx, plan.start_date, level, fromDay);
    // Bugün zaten tamamlanmış görev varsa onları bozmadan eksikleri ekle (OR IGNORE)
    insertDays(db, plan, uid, days, { skipExisting: true });
    q.run(db, 'UPDATE plans SET level=?, plan_version=plan_version+1 WHERE id=?', level, plan.id);
  });
}

// ---- Günlük görevler ----
const dayMode = (db, uid, date) => q.get(db, 'SELECT mode FROM day_state WHERE user_id=? AND date=?', uid, date)?.mode || 'normal';
const dayTasks = (db, uid, date) => q.all(db, 'SELECT * FROM daily_tasks WHERE user_id=? AND date=? ORDER BY id', uid, date);
const activeSet = (tasks, mode) => (mode === 'minimum' ? tasks.filter((t) => t.is_min) : tasks.filter((t) => !t.optional));
function dayStats(tasks, mode) {
  const act = activeSet(tasks, mode);
  const done = act.filter((t) => t.completed).length;
  const ratio = act.length ? done / act.length : 0;
  const kept = act.length > 0 && (mode === 'minimum' ? done === act.length : ratio >= 0.6);
  return { done, total: act.length, ratio, kept, mode };
}
function setTask(db, uid, taskId, completed) {
  const r = q.run(db, 'UPDATE daily_tasks SET completed=?, completed_at=? WHERE id=? AND user_id=?', completed ? 1 : 0, completed ? nowIso() : null, taskId, uid);
  return r.changes > 0;
}
function setMode(db, uid, date, mode) {
  q.run(db, `INSERT INTO day_state(user_id,date,mode) VALUES(?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET mode=excluded.mode`, uid, date, mode);
}

// ---- İlerleme ----
const WEIGHTS = { consistency: 0.35, movement: 0.20, sleep: 0.15, nutrition: 0.15, selfcare: 0.10, checkin: 0.05 };

function computeProgress(db, uid, asOf) {
  const plan = activePlan(db, uid);
  if (!plan) return null;
  const end = asOf > plan.end_date ? plan.end_date : asOf;
  if (end < plan.start_date) return { progress: 0, scores: {}, elapsed: 0 };
  const rows = q.all(db, 'SELECT date,category,completed,is_min,optional FROM daily_tasks WHERE plan_id=? AND date<=?', plan.id, end);
  const modes = Object.fromEntries(q.all(db, 'SELECT date,mode FROM day_state WHERE user_id=? AND date<=?', uid, end).map((r) => [r.date, r.mode]));
  const checkins = q.all(db, 'SELECT date,sleep FROM checkins WHERE user_id=? AND date>=? AND date<=?', uid, plan.start_date, end);
  const ciDates = new Set(checkins.map((c) => c.date));
  // Bugün hiçbir şey yapılmadıysa bugünü sayma (gün bitmeden cezalandırma yok).
  const byDate = {};
  for (const r of rows) (byDate[r.date] ||= []).push(r);
  const todayRows = byDate[end];
  const todayTouched = todayRows?.some((r) => r.completed) || ciDates.has(end);
  const cat = {}; let planned = 0; let done = 0; let days = 0;
  for (const [date, list] of Object.entries(byDate)) {
    if (date === end && end === asOf && !todayTouched && asOf <= plan.end_date) continue;
    days++;
    const mode = modes[date] || 'normal';
    for (const r of list) {
      if (mode === 'minimum' ? !r.is_min : r.optional) continue;
      const c = (cat[r.category] ||= { p: 0, d: 0 });
      c.p++; c.d += r.completed; planned++; done += r.completed;
    }
  }
  const rate = (c) => (c && c.p ? c.d / c.p : 0);
  const scores = { consistency: planned ? done / planned : 0 };
  const active = ['consistency', 'checkin'];
  scores.checkin = days ? Math.min(1, [...ciDates].filter((d) => byDate[d]).length / days) : 0;
  for (const k of ['movement', 'nutrition', 'sleep', 'selfcare']) {
    if (cat[k]) { scores[k] = rate(cat[k]); active.push(k); }
  }
  if (cat.sleep && checkins.some((c) => c.sleep)) {
    const hrs = avg(checkins.filter((c) => c.sleep).map((c) => Math.min(1, c.sleep / 7.5)));
    scores.sleep = 0.5 * scores.sleep + 0.5 * hrs;
  }
  const totalW = active.reduce((s, k) => s + WEIGHTS[k], 0);
  const progress = Math.round(100 * active.reduce((s, k) => s + (WEIGHTS[k] / totalW) * (scores[k] || 0), 0));
  const pct = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.round(v * 100)]));
  return { progress, scores: pct, elapsed: days, planned, done };
}

function computeStreak(db, uid, today) {
  const plan = activePlan(db, uid);
  if (!plan) return { streak: 0, best: 0, recoveries: 0 };
  const rows = q.all(db, 'SELECT * FROM daily_tasks WHERE plan_id=? AND date<=? ORDER BY date', plan.id, today);
  const modes = Object.fromEntries(q.all(db, 'SELECT date,mode FROM day_state WHERE user_id=?', uid).map((r) => [r.date, r.mode]));
  const by = {};
  for (const r of rows) (by[r.date] ||= []).push(r);
  const dates = Object.keys(by).sort();
  const keptMap = Object.fromEntries(dates.map((d) => [d, dayStats(by[d], modes[d] || 'normal')]));
  // Seri: en fazla 7 günde bir "toparlanma günü" (1 kaçırılan gün) seriyi bozmaz.
  const run = (endIdx) => {
    let streak = 0; let lastMiss = -99; let misses = 0;
    for (let i = endIdx; i >= 0; i--) {
      const k = keptMap[dates[i]];
      if (k.kept) { streak++; continue; }
      if (i === endIdx && dates[i] === today) continue; // bugün henüz bitmedi
      if (lastMiss - i > 7 || lastMiss === -99) {
        if (i > 0 && keptMap[dates[i - 1]]?.kept) { lastMiss = i; misses++; continue; }
      }
      break;
    }
    return { streak, misses };
  };
  const cur = run(dates.length - 1);
  let best = 0;
  for (let i = 0; i < dates.length; i++) best = Math.max(best, run(i).streak);
  return { streak: cur.streak, best: Math.max(best, cur.streak), recoveries: cur.misses };
}

function trends(db, uid, today, span = 30) {
  const plan = activePlan(db, uid);
  if (!plan) return null;
  const from = addDays(today, -(span - 1));
  const start = from < plan.start_date ? plan.start_date : from;
  const rows = q.all(db, 'SELECT * FROM daily_tasks WHERE plan_id=? AND date>=? AND date<=? ORDER BY date', plan.id, start, today);
  const modes = Object.fromEntries(q.all(db, 'SELECT date,mode FROM day_state WHERE user_id=? AND date>=?', uid, start).map((r) => [r.date, r.mode]));
  const cis = Object.fromEntries(q.all(db, 'SELECT * FROM checkins WHERE user_id=? AND date>=? AND date<=?', uid, start, today).map((c) => [c.date, c]));
  const by = {};
  for (const r of rows) (by[r.date] ||= []).push(r);
  const out = { completion: [], sleep: [], steps: [], weight: [], workouts: 0, checkins: Object.keys(cis).length, checkin_rate: 0 };
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const st = dayStats(by[d] || [], modes[d] || 'normal');
    out.completion.push({ date: d, v: Math.round(st.ratio * 100), future: false });
    const c = cis[d];
    out.sleep.push({ date: d, v: c?.sleep ?? null });
    out.steps.push({ date: d, v: c?.steps ?? null });
    out.weight.push({ date: d, v: c?.weight ?? null });
    out.workouts += (by[d] || []).filter((t) => t.key === 'workout' && t.completed).length;
  }
  out.checkin_rate = out.completion.length ? Math.round(100 * out.checkins / out.completion.length) : 0;
  return out;
}

function saveSnapshot(db, uid, date) {
  const p = computeProgress(db, uid, date);
  if (!p) return null;
  q.run(db, `INSERT INTO progress_snapshots(user_id,date,progress,category_scores) VALUES(?,?,?,?)
    ON CONFLICT(user_id,date) DO UPDATE SET progress=excluded.progress, category_scores=excluded.category_scores`, uid, date, p.progress, JSON.stringify(p.scores));
  return p;
}

// ---- Check-in ----
function checkinQuestions(db, uid, date) {
  const stats = dayStats(dayTasks(db, uid, date), dayMode(db, uid, date));
  const profile = getProfile(db, uid).answers;
  const last = q.get(db, 'SELECT date FROM checkins WHERE user_id=? AND weight IS NOT NULL ORDER BY date DESC LIMIT 1', uid);
  const easy = stats.total > 0 && stats.ratio >= 0.9; // plan %90+ tamamlandıysa gereksiz soru yok
  const qs = ['sleep', 'energy'];
  if (!easy) qs.push('stress', 'hunger', 'difficulty');
  if (!last || diffDays(date, last.date) >= 7) qs.push('weight');
  if ((profile.goals || []).some((g) => ['steps', 'fitness', 'lose_weight', 'reduce_fat'].includes(g))) qs.push('steps');
  return { questions: qs, completion: Math.round(stats.ratio * 100), easy, existing: q.get(db, 'SELECT * FROM checkins WHERE user_id=? AND date=?', uid, date) || null };
}
function saveCheckin(db, uid, date, c) {
  const stats = dayStats(dayTasks(db, uid, date), dayMode(db, uid, date));
  q.run(db, `INSERT INTO checkins(user_id,date,sleep,energy,stress,hunger,completion,difficulty,steps,weight,note,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,date) DO UPDATE SET sleep=excluded.sleep, energy=excluded.energy, stress=excluded.stress, hunger=excluded.hunger,
      completion=excluded.completion, difficulty=excluded.difficulty, steps=excluded.steps, weight=excluded.weight, note=excluded.note`,
    uid, date, c.sleep ?? null, c.energy ?? null, c.stress ?? null, c.hunger ?? null, Math.round(stats.ratio * 100), c.difficulty ?? null,
    c.steps ?? null, c.weight ?? null, c.note ? String(c.note).trim() : null, nowIso());
  return stats;
}

// ---- Adaptasyon ----
function adaptContext(db, uid, today) {
  const plan = activePlan(db, uid);
  const from = addDays(today, -7);
  const rows = q.all(db, 'SELECT * FROM daily_tasks WHERE plan_id=? AND date>=? AND date<?', plan.id, from, today);
  const modes = Object.fromEntries(q.all(db, 'SELECT date,mode FROM day_state WHERE user_id=? AND date>=?', uid, from).map((r) => [r.date, r.mode]));
  const by = {};
  for (const r of rows) (by[r.date] ||= []).push(r);
  const ratios = Object.entries(by).map(([d, l]) => dayStats(l, modes[d] || 'normal').ratio);
  const cis = q.all(db, 'SELECT * FROM checkins WHERE user_id=? AND date>=? AND date<?', uid, from, today);
  const sleepAvg = avg(cis.filter((c) => c.sleep).map((c) => c.sleep));
  const stressAvg = avg(cis.filter((c) => c.stress).map((c) => c.stress));
  const energyAvg = avg(cis.filter((c) => c.energy).map((c) => c.energy));
  const w = q.all(db, 'SELECT weight FROM checkins WHERE user_id=? AND weight IS NOT NULL ORDER BY date DESC LIMIT 2', uid);
  return {
    plan, completion7: ratios.length ? avg(ratios) : 0, daysObserved: Math.min(ratios.length, plan ? dayNumber(plan, today) - 1 : 0),
    sleepAvg: sleepAvg && round1(sleepAvg), stressAvg: stressAvg && round1(stressAvg), energyAvg: energyAvg && round1(energyAvg),
    weightDelta: w.length === 2 ? round1(w[0].weight - w[1].weight) : null,
  };
}
// Kural tabanlı karar uygula (günde en fazla bir kez, 3 gün bekleme süresi).
function runAdaptation(db, uid, today) {
  const plan = activePlan(db, uid);
  if (!plan || today < plan.start_date || today > plan.end_date) return null;
  if (plan.last_adapt_date === today) return null;
  const ctx = adaptContext(db, uid, today);
  const gap = plan.last_adapt_date ? diffDays(today, plan.last_adapt_date) : null;
  const d = E.adaptDecision({ completion7: ctx.completion7, daysObserved: ctx.daysObserved, level: plan.level, stressAvg: ctx.stressAvg, lastAdaptGap: gap });
  if (d.change === 0) return { ...d, ctx };
  const level = clamp(plan.level + d.change, 1, 5);
  regenerate(db, uid, plan, addDays(today, 1), level); // yarından itibaren
  q.run(db, 'UPDATE plans SET last_adapt_date=? WHERE id=?', today, plan.id);
  return { ...d, level, ctx };
}
// Koç sohbetinden gelen kullanıcı isteği (beyaz listeli eylemler).
function applyCoachAction(db, uid, action, today) {
  const plan = activePlan(db, uid);
  if (!plan) return false;
  if (action === 'minimum_today') { setMode(db, uid, today, 'minimum'); return true; }
  if (action === 'lighten' || action === 'quick_20') {
    const level = clamp(plan.level - 1, 1, 5);
    regenerate(db, uid, plan, action === 'quick_20' ? today : addDays(today, 1), level);
    if (action === 'quick_20') setMode(db, uid, today, 'minimum');
    return true;
  }
  if (action === 'boost') { regenerate(db, uid, plan, addDays(today, 1), clamp(plan.level + 1, 1, 5)); return true; }
  return false;
}

module.exports = {
  J, nowIso, getUser, userToday, getProfile, saveAnswers, saveSummary, activePlan, dayNumber, createPlan, regenerate,
  dayMode, dayTasks, activeSet, dayStats, setTask, setMode, computeProgress, computeStreak, trends, saveSnapshot,
  checkinQuestions, saveCheckin, adaptContext, runAdaptation, applyCoachAction, WEIGHTS,
};
