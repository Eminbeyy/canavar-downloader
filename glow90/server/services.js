'use strict';
// Orkestrasyon: çekirdek (deterministik) + AI (yalnızca gerektiğinde) birleşimi.
const { q } = require('./db');
const core = require('./core');
const ai = require('./ai');
const C = require('./content');
const E = require('./engine');
const { screenUserText } = require('./safety');
const { addDays, diffDays, avg, round1, clamp } = require('./util');

const trunc = (s, n) => (s ? String(s).slice(0, n) : undefined);

// ---- Onboarding analizi + plan ----
function analysisPayload(a) {
  // Tüm ham cevabı değil, kompakt bir özet gönder.
  return {
    goals: a.goals, text: trunc(a.free_text, 300), age: a.age, days: a.days_per_week, min: a.minutes_per_day,
    equip: a.has_gym ? 'gym' : a.home_equipment, discipline: a.discipline, sleep: a.sleep_hours, quality: a.sleep_quality,
    injury: !!a.injuries, derail: trunc(a.derail, 100), tone: a.coach_tone, selfcare: a.selfcare,
  };
}
async function analyze(db, uid) {
  const { answers } = core.getProfile(db, uid);
  const r = await ai.run(db, { uid, type: 'ONBOARDING_ANALYSIS', payload: analysisPayload(answers), fallback: () => C.analysisFallback(answers) });
  core.saveSummary(db, uid, r.data);
  return r;
}
async function generatePlan(db, uid) {
  let { answers, summary } = core.getProfile(db, uid);
  if (!summary) { await analyze(db, uid); ({ summary } = core.getProfile(db, uid)); }
  const ctx = E.deriveCtx(answers, { primary_goal: summary.primary_goal });
  const payload = { primary: summary.primary_goal, secondary: summary.secondary_goals, days: ctx.days, min: ctx.minutes, tone: summary.coach_tone,
    equip: ctx.equipment, flags: ctx.flags, text: trunc(answers.free_text, 200), likes: trunc(ctx.likes, 100), dislikes: trunc(ctx.dislikes, 100) };
  const r = await ai.run(db, { uid, type: 'PLAN_GENERATION', payload, fallback: () => C.blueprintFallback(answers, summary) });
  const bp = r.data;
  const phases = [1, 2, 3].map((n) => {
    const base = E.PHASES[n - 1]; const p = (bp.phases || []).find((x) => x.phase === n) || {};
    return { phase: n, name: base.name, theme: p.theme || base.theme, focus: p.focus || base.focus };
  });
  const plan = core.createPlan(db, uid, { phases, welcome: bp.welcome, custom_habits: bp.custom_habits || [], source: r.source });
  core.saveSnapshot(db, uid, plan.start_date);
  return { plan_id: plan.id, source: r.source };
}

// ---- Kompakt özet (spec §21) ----
function digest(db, uid, today) {
  const plan = core.activePlan(db, uid);
  if (!plan) return null;
  const ctx = core.adaptContext(db, uid, today);
  const prog = core.computeProgress(db, uid, today);
  const s = core.getProfile(db, uid).summary;
  const day = clamp(core.dayNumber(plan, today), 1, 90);
  const st = core.dayStats(core.dayTasks(db, uid, today), core.dayMode(db, uid, today));
  return {
    phase: E.phaseOf(day).n, day, goal_progress: round1((prog?.progress || 0) / 100), last_7_days_completion: round1(ctx.completion7),
    sleep_avg: ctx.sleepAvg, stress_avg: ctx.stressAvg, energy_avg: ctx.energyAvg, recent_weight_trend: ctx.weightDelta,
    level: plan.level, today_status: st.total && st.done === st.total ? 'complete' : st.done ? 'partial' : 'incomplete',
    primary_goal: s?.primary_goal, tone: s?.coach_tone,
  };
}

// ---- Bugün ----
function milestoneDue(db, uid, day) {
  for (const n of [90, 60, 30]) {
    if (day >= n) {
      const seen = q.get(db, "SELECT 1 x FROM reports WHERE user_id=? AND kind='milestone_seen' AND ref=?", uid, String(n));
      if (!seen) return n;
    }
  }
  return null;
}
async function todayView(db, uid) {
  const today = core.userToday(db, uid);
  const plan = core.activePlan(db, uid);
  if (!plan) return { plan: false };
  const day = core.dayNumber(plan, today);
  const past = day > 90;
  const date = past ? plan.end_date : today;
  let adapt = null;
  if (!past && day >= 1) {
    const r = core.runAdaptation(db, uid, today);
    if (r && r.change !== 0) {
      const tone = core.getProfile(db, uid).summary?.coach_tone || 'friendly';
      const msg = await ai.run(db, { uid, type: 'DAILY_ADAPTATION', payload: { reason: r.reason, change: r.change, c7: round1(r.ctx.completion7), tone, phase: E.phaseOf(day).n },
        fallback: () => ({ coach_message: C.adaptMessage(r.reason, tone) }) });
      adapt = { change: r.change, message: msg.data.coach_message };
      q.run(db, "INSERT OR REPLACE INTO reports(user_id,kind,ref,content,created_at) VALUES(?,?,?,?,?)", uid, 'adapt', today, JSON.stringify(adapt), core.nowIso());
    }
  }
  if (!adapt) {
    const prev = q.get(db, "SELECT content FROM reports WHERE user_id=? AND kind='adapt' AND ref=?", uid, today);
    if (prev) adapt = core.J(prev.content);
  }
  const tasks = core.dayTasks(db, uid, date);
  const mode = core.dayMode(db, uid, date);
  const st = core.dayStats(tasks, mode);
  const prog = core.saveSnapshot(db, uid, date);
  const streak = core.computeStreak(db, uid, date);
  const ci = q.get(db, 'SELECT 1 x FROM checkins WHERE user_id=? AND date=?', uid, date);
  const phase = E.phaseOf(clamp(day, 1, 90));
  const meta = plan.meta.phases?.find((p) => p.phase === phase.n) || phase;
  const dueDay = clamp(day, 1, 90);
  return {
    plan: true, date, day: dueDay, total_days: 90, finished: past, phase: { n: phase.n, name: phase.name, theme: meta.theme },
    mode, tasks: tasks.map((t) => ({ id: t.id, key: t.key, title: t.title, category: t.category, type: t.type, priority: t.priority, minutes: t.minutes,
      optional: !!t.optional, is_min: !!t.is_min, minimum_version: t.minimum_version, note: t.note, completed: !!t.completed })),
    stats: { done: st.done, total: st.total }, progress: prog?.progress ?? 0, scores: prog?.scores ?? {}, streak,
    checkin_done: !!ci, welcome: day <= 1 ? plan.meta.welcome : null, adapt, notes: plan.meta.notes || [], milestone: milestoneDue(db, uid, dueDay),
  };
}

// ---- İlerleme ekranı ----
function progressView(db, uid) {
  const today = core.userToday(db, uid);
  const plan = core.activePlan(db, uid);
  if (!plan) return { plan: false };
  const end = today > plan.end_date ? plan.end_date : today;
  return { plan: true, ...core.computeProgress(db, uid, end), streak: core.computeStreak(db, uid, end), trends: core.trends(db, uid, end, 30),
    day: clamp(core.dayNumber(plan, today), 1, 90), milestones: [30, 60, 90].map((n) => ({ n, reached: core.dayNumber(plan, today) >= n })) };
}

// ---- Plan ekranı ----
function planView(db, uid) {
  const plan = core.activePlan(db, uid);
  if (!plan) return { plan: false };
  const today = core.userToday(db, uid);
  const rows = q.all(db, 'SELECT date, COUNT(*) total, SUM(completed) done, SUM(CASE WHEN optional=0 THEN 1 ELSE 0 END) main, SUM(CASE WHEN optional=0 AND completed=1 THEN 1 ELSE 0 END) main_done FROM daily_tasks WHERE plan_id=? GROUP BY date ORDER BY date', plan.id);
  const days = rows.map((r, i) => ({ day: i + 1, date: r.date, main: r.main, done: r.main_done, today: r.date === today }));
  return { plan: true, start: plan.start_date, end: plan.end_date, version: plan.plan_version, level: plan.level, today_day: core.dayNumber(plan, today),
    phases: plan.meta.phases.map((p) => ({ ...p, from: E.PHASES[p.phase - 1].from, to: E.PHASES[p.phase - 1].to })), notes: plan.meta.notes || [], days };
}
function planDay(db, uid, date) {
  const plan = core.activePlan(db, uid);
  if (!plan || date < plan.start_date || date > plan.end_date) return null;
  return { date, day: core.dayNumber(plan, date), mode: core.dayMode(db, uid, date),
    tasks: core.dayTasks(db, uid, date).map((t) => ({ id: t.id, title: t.title, category: t.category, optional: !!t.optional, is_min: !!t.is_min, minutes: t.minutes, completed: !!t.completed })) };
}

// ---- Dönem istatistikleri (haftalık/milestone ortak) ----
function rangeStats(db, uid, plan, from, to) {
  const rows = q.all(db, 'SELECT * FROM daily_tasks WHERE plan_id=? AND date>=? AND date<=? ORDER BY date', plan.id, from, to);
  const modes = Object.fromEntries(q.all(db, 'SELECT date,mode FROM day_state WHERE user_id=? AND date>=? AND date<=?', uid, from, to).map((r) => [r.date, r.mode]));
  const cat = {}; let p = 0; let d = 0; let workouts = 0;
  for (const r of rows) {
    const m = modes[r.date] || 'normal';
    if (r.key === 'workout' && r.completed) workouts++;
    if (m === 'minimum' ? !r.is_min : r.optional) continue;
    const c = (cat[r.category] ||= { p: 0, d: 0 }); c.p++; c.d += r.completed; p++; d += r.completed;
  }
  const ratios = Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, v.p ? v.d / v.p : 0]));
  const ranked = Object.entries(ratios).sort((a, b) => b[1] - a[1]);
  const cis = q.all(db, 'SELECT * FROM checkins WHERE user_id=? AND date>=? AND date<=? ORDER BY date', uid, from, to);
  return { planned: p, done: d, completion: p ? Math.round((100 * d) / p) : 0, ratios, best: ranked[0]?.[0], hardest: ranked.length > 1 ? ranked[ranked.length - 1][0] : ranked[0]?.[0],
    workouts, checkins: cis, steps: cis.reduce((s, c) => s + (c.steps || 0), 0), sleepAvg: avg(cis.filter((c) => c.sleep).map((c) => c.sleep)) };
}

async function weeklyReport(db, uid) {
  const plan = core.activePlan(db, uid);
  if (!plan) return null;
  const today = core.userToday(db, uid);
  const day = core.dayNumber(plan, today);
  const n = Math.min(12, Math.floor((day - 1) / 7)); // tamamlanmış son hafta
  if (n < 1) return { available: false, week: 0, next_in: 8 - day };
  const cached = q.get(db, "SELECT content FROM reports WHERE user_id=? AND kind='weekly' AND ref=?", uid, String(n));
  if (cached) return { available: true, ...core.J(cached.content) };
  const from = addDays(plan.start_date, (n - 1) * 7); const to = addDays(from, 6);
  const s = rangeStats(db, uid, plan, from, to);
  const prev = core.computeProgress(db, uid, addDays(from, -1));
  const cur = core.computeProgress(db, uid, to);
  const delta = (cur?.progress || 0) - (n > 1 ? prev?.progress || 0 : 0);
  const tone = core.getProfile(db, uid).summary?.coach_tone || 'friendly';
  const r = await ai.run(db, { uid, type: 'WEEKLY_REVIEW', payload: { week: n, completion: s.completion, best: s.best, hardest: s.hardest, workouts: s.workouts, sleep: s.sleepAvg && round1(s.sleepAvg), tone },
    fallback: () => C.weeklyFallback(s) });
  const rep = { week: n, progress_delta: delta, completion: s.completion, workouts: s.workouts, ...r.data };
  q.run(db, 'INSERT OR REPLACE INTO reports(user_id,kind,ref,content,created_at) VALUES(?,?,?,?,?)', uid, 'weekly', String(n), JSON.stringify(rep), core.nowIso());
  return { available: true, ...rep };
}

// ---- 30/60/90 milestone ----
const MILESTONE_TEXT = { 30: 'İlk alışkanlıklar oturmaya başladı.', 60: 'Artık düzenin oluşuyor.', 90: '90 gün tamamlandı.' };
async function milestone(db, uid, n) {
  const plan = core.activePlan(db, uid);
  if (!plan || ![30, 60, 90].includes(n)) return null;
  const today = core.userToday(db, uid);
  if (core.dayNumber(plan, today) < n) return { reached: false, n };
  const to = addDays(plan.start_date, n - 1);
  const s = rangeStats(db, uid, plan, plan.start_date, to);
  const prog = core.computeProgress(db, uid, to);
  const first = s.checkins.filter((c) => c.sleep).slice(0, 7); const last = s.checkins.filter((c) => c.sleep).slice(-7);
  const w = s.checkins.filter((c) => c.weight);
  const care = q.get(db, "SELECT COUNT(DISTINCT date) c FROM daily_tasks WHERE plan_id=? AND date<=? AND category='selfcare' AND completed=1", plan.id, to).c;
  const out = {
    reached: true, n, title: `DAY ${n}`, message: MILESTONE_TEXT[n], progress: prog.progress, scores: prog.scores,
    totals: { tasks_done: s.done, tasks_planned: s.planned, completion: s.completion, workouts: s.workouts, steps: s.steps, selfcare_days: care },
    sleep: { start: first.length ? round1(avg(first.map((c) => c.sleep))) : null, end: last.length ? round1(avg(last.map((c) => c.sleep))) : null },
    weight: w.length >= 2 ? { start: w[0].weight, end: w[w.length - 1].weight, delta: round1(w[w.length - 1].weight - w[0].weight) } : null,
    notes: s.checkins.filter((c) => c.note).slice(-3).map((c) => ({ date: c.date, note: c.note })),
    best: s.best, hardest: s.hardest,
  };
  if (n === 90) {
    const cached = q.get(db, "SELECT content FROM reports WHERE user_id=? AND kind='final' AND ref='90'", uid);
    if (cached) out.report = core.J(cached.content);
    else {
      const first1 = q.get(db, 'SELECT progress FROM progress_snapshots WHERE user_id=? ORDER BY date LIMIT 1', uid)?.progress ?? 0;
      const facts = { firstProgress: first1, progress: prog.progress, completion: s.completion, totalDone: s.done, workouts: s.workouts, best: s.best, hardest: s.hardest };
      const r = await ai.run(db, { uid, type: 'FINAL_REPORT', payload: facts, fallback: () => C.finalFallback(facts) });
      out.report = r.data;
      q.run(db, "INSERT OR REPLACE INTO reports(user_id,kind,ref,content,created_at) VALUES(?,?,?,?,?)", uid, 'final', '90', JSON.stringify(r.data), core.nowIso());
    }
  }
  return out;
}
const markMilestoneSeen = (db, uid, n) => q.run(db, "INSERT OR REPLACE INTO reports(user_id,kind,ref,content,created_at) VALUES(?,?,?,?,?)", uid, 'milestone_seen', String(n), '1', core.nowIso());

// ---- Koç sohbeti ----
async function coachChat(db, uid, message) {
  const today = core.userToday(db, uid);
  q.run(db, "INSERT INTO coach_messages(user_id,role,content,created_at) VALUES(?,?,?,?)", uid, 'user', message, core.nowIso());
  const save = (reply, action = 'none', source = 'rule') => {
    q.run(db, "INSERT INTO coach_messages(user_id,role,content,created_at) VALUES(?,?,?,?)", uid, 'coach', reply, core.nowIso());
    return { reply, action, applied: false, source };
  };
  const flagged = screenUserText(message);
  if (flagged) return save(flagged.reply, 'none', 'safety');
  const tone = core.getProfile(db, uid).summary?.coach_tone || 'friendly';
  const dg = digest(db, uid, today);
  const recent = q.all(db, 'SELECT role,content FROM coach_messages WHERE user_id=? ORDER BY id DESC LIMIT 5', uid).reverse().slice(0, -1)
    .map((m) => ({ r: m.role === 'user' ? 'u' : 'c', t: trunc(m.content, 200) }));
  const tasks = dg ? core.dayTasks(db, uid, today).filter((t) => !t.optional).map((t) => `${t.completed ? '✓' : '○'} ${t.title}`) : [];
  const r = await ai.run(db, { uid, type: 'COACH_CHAT', cache: false, payload: { msg: trunc(message, 400), ctx: dg, today: tasks, recent },
    fallback: () => C.coachRule(message, tone) });
  const data = r.data;
  const applied = core.applyCoachAction(db, uid, data.action, today);
  q.run(db, "INSERT INTO coach_messages(user_id,role,content,created_at) VALUES(?,?,?,?)", uid, 'coach', data.reply, core.nowIso());
  return { reply: data.reply, action: data.action, applied, source: r.source };
}

module.exports = { analyze, generatePlan, digest, todayView, progressView, planView, planDay, rangeStats, weeklyReport, milestone, markMilestoneSeen, coachChat };
