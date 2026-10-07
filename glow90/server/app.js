'use strict';
// HTTP katmanı: yönlendirme, auth (scrypt + oturum çerezi), rate limit, girdi doğrulama, güvenlik başlıkları, statik dosyalar.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { q } = require('./db');
const core = require('./core');
const svc = require('./services');
const ai = require('./ai');
const schemas = require('./schemas');
const { validate } = require('./validate');
const { clock, todayIn, diffDays, addDays } = require('./util');
const E = require('./engine');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const SESSION_DAYS = 30;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

// ---- Rate limit (bellek içi, sabit pencere) ----
function limiter() {
  const hits = new Map();
  return (key, max, windowMs) => {
    const now = clock.now();
    const e = hits.get(key);
    if (!e || now > e.reset) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    e.n++;
    if (hits.size > 5000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return e.n <= max;
  };
}

// ---- Parola ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32);
  return `s1$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [v, salt, key] = String(stored).split('$');
  if (v !== 's1') return false;
  const k = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(k, Buffer.from(key, 'hex'));
}

function createApp({ db, secureCookies = false, trustProxy = process.env.GLOW90_TRUST_PROXY === '1' } = {}) {
  const rl = limiter();
  const DUMMY = hashPassword('dummy-password'); // kullanıcı yokken de zaman harca (enumeration)

  const parseCookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, v.join('=')]));
  function sessionUser(req) {
    const tok = parseCookies(req).g90;
    if (!tok) return null;
    const s = q.get(db, 'SELECT * FROM sessions WHERE token_hash=?', sha(tok));
    if (!s || s.expires_at < clock.now()) return null;
    return core.getUser(db, s.user_id);
  }
  function startSession(res, uid, req) {
    const tok = crypto.randomBytes(32).toString('hex');
    q.run(db, 'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', sha(tok), uid, clock.now() + SESSION_DAYS * 864e5);
    const secure = secureCookies || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', `g90=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 100_000) { reject(new HttpError(413, 'İstek çok büyük')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { const b = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(b && typeof b === 'object' ? b : {}); } catch { reject(bad('Geçersiz JSON')); }
      });
      req.on('error', reject);
    });
  }
  const send = (res, status, body, headers = {}) => {
    const isStr = typeof body === 'string';
    res.writeHead(status, { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(isStr ? body : JSON.stringify(body));
  };
  const check = (schema, v) => { const e = validate(schema, v); if (e.length) throw bad(`Geçersiz veri: ${e[0]}`); return v; };
  const needPlan = (uid) => { const p = core.activePlan(db, uid); if (!p) throw new HttpError(409, 'Önce planı oluştur'); return p; };

  const track = (uid, name) => {
    const plan = core.activePlan(db, uid);
    q.run(db, 'INSERT INTO events(uid_hash,name,day,ts) VALUES(?,?,?,?)', sha(`u${uid}`).slice(0, 16), name, plan ? core.dayNumber(plan, core.userToday(db, uid)) : null, core.nowIso());
  };

  // ---- Rotalar: [method, regex, handler(ctx)] ----
  const routes = [];
  const R = (method, pattern, fn, { auth = true } = {}) => routes.push({ method, re: new RegExp(`^${pattern}$`), fn, auth });

  R('GET', '/api/health', () => ({ ok: true, ai: !!process.env.ANTHROPIC_API_KEY }), { auth: false });

  const authLimited = (ctx) => { if (!rl(`auth:${ctx.ip}`, 10, 60_000)) throw new HttpError(429, 'Çok fazla deneme, biraz bekle'); };
  R('POST', '/api/auth/register', async (ctx) => {
    authLimited(ctx);
    const b = check({ type: 'object', required: ['email', 'password'], additionalProperties: false, properties: {
      email: { type: 'string', pattern: '^[^@\\s]{1,64}@[^@\\s]{1,200}\\.[^@\\s]{2,}$', maxLength: 254 }, password: { type: 'string', minLength: 8, maxLength: 200 },
      tz: { type: 'string', maxLength: 64 } } }, ctx.body);
    const email = b.email.toLowerCase();
    if (q.get(db, 'SELECT 1 x FROM users WHERE email=?', email)) throw new HttpError(409, 'Bu e-posta ile kayıt yapılamadı');
    const tz = (() => { try { new Intl.DateTimeFormat('en', { timeZone: b.tz }); return b.tz || 'UTC'; } catch { return 'UTC'; } })();
    const r = q.run(db, 'INSERT INTO users(email,pass_hash,created_at,tz,settings) VALUES(?,?,?,?,?)', email, hashPassword(b.password), core.nowIso(), tz, '{}');
    const uid = Number(r.lastInsertRowid);
    q.run(db, 'INSERT INTO profiles(user_id) VALUES(?)', uid);
    startSession(ctx.res, uid, ctx.req); track(uid, 'signup');
    return { ok: true };
  }, { auth: false });
  R('POST', '/api/auth/login', async (ctx) => {
    authLimited(ctx);
    const b = check({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', maxLength: 254 }, password: { type: 'string', maxLength: 200 } } }, ctx.body);
    const u = q.get(db, 'SELECT * FROM users WHERE email=?', b.email.toLowerCase());
    const ok = verifyPassword(b.password, u ? u.pass_hash : DUMMY);
    if (!u || !ok) throw new HttpError(401, 'E-posta veya parola hatalı');
    startSession(ctx.res, u.id, ctx.req);
    return { ok: true };
  }, { auth: false });
  R('POST', '/api/auth/logout', (ctx) => {
    const tok = parseCookies(ctx.req).g90;
    if (tok) q.run(db, 'DELETE FROM sessions WHERE token_hash=?', sha(tok));
    ctx.res.setHeader('Set-Cookie', 'g90=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { ok: true };
  }, { auth: false });

  R('GET', '/api/me', (ctx) => {
    const p = core.getProfile(db, ctx.uid); const plan = core.activePlan(db, ctx.uid);
    const settings = core.J(ctx.user.settings);
    return { email: ctx.user.email, onboarded: p.onboarded && !!plan, answers: p.answers, summary: p.summary, settings,
      ai: { ...ai.usageToday(db, ctx.uid), enabled: !!process.env.ANTHROPIC_API_KEY }, today: core.userToday(db, ctx.uid) };
  });

  // Onboarding: adım adım kısmi kayıt
  R('PUT', '/api/profile', (ctx) => {
    const a = check(schemas.answers, ctx.body);
    const merged = core.saveAnswers(db, ctx.uid, a);
    return { ok: true, answers: merged };
  });
  R('POST', '/api/onboarding/analyze', async (ctx) => {
    const r = await svc.analyze(db, ctx.uid); track(ctx.uid, 'onboarding_analyzed');
    return { summary: r.data, source: r.source };
  });
  R('POST', '/api/plan/generate', async (ctx) => {
    const r = await svc.generatePlan(db, ctx.uid); track(ctx.uid, 'onboarding_completed');
    return { ok: true, source: r.source };
  });

  R('GET', '/api/today', async (ctx) => { needPlan(ctx.uid); return svc.todayView(db, ctx.uid); });
  R('PUT', '/api/tasks/(\\d+)', (ctx) => {
    const b = check({ type: 'object', required: ['completed'], properties: { completed: { type: 'boolean' } } }, ctx.body);
    if (!core.setTask(db, ctx.uid, Number(ctx.m[1]), b.completed)) throw new HttpError(404, 'Görev bulunamadı');
    if (b.completed) track(ctx.uid, 'task_completed');
    const date = core.userToday(db, ctx.uid);
    const tasks = core.dayTasks(db, ctx.uid, date); const st = core.dayStats(tasks, core.dayMode(db, ctx.uid, date));
    const prog = core.saveSnapshot(db, ctx.uid, date);
    return { ok: true, stats: { done: st.done, total: st.total }, progress: prog?.progress, streak: core.computeStreak(db, ctx.uid, date) };
  });
  R('PUT', '/api/day/mode', (ctx) => {
    const b = check({ type: 'object', required: ['mode'], properties: { mode: { type: 'string', enum: ['normal', 'minimum'] } } }, ctx.body);
    const plan = needPlan(ctx.uid); const date = core.userToday(db, ctx.uid);
    if (date < plan.start_date || date > plan.end_date) throw bad('Plan dışı gün');
    core.setMode(db, ctx.uid, date, b.mode); track(ctx.uid, `mode_${b.mode}`);
    return { ok: true };
  });

  R('GET', '/api/checkin', (ctx) => { needPlan(ctx.uid); return core.checkinQuestions(db, ctx.uid, core.userToday(db, ctx.uid)); });
  R('POST', '/api/checkin', (ctx) => {
    const c = check(schemas.checkin, ctx.body); needPlan(ctx.uid);
    const date = core.userToday(db, ctx.uid); // check-in her zaman "bugün" için
    const st = core.saveCheckin(db, ctx.uid, date, c); const prog = core.saveSnapshot(db, ctx.uid, date); track(ctx.uid, 'checkin');
    return { ok: true, completion: Math.round(st.ratio * 100), progress: prog?.progress };
  });

  R('GET', '/api/plan', (ctx) => svc.planView(db, ctx.uid));
  R('GET', '/api/plan/day', (ctx) => {
    const date = ctx.url.searchParams.get('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Tarih geçersiz');
    const d = svc.planDay(db, ctx.uid, date); if (!d) throw new HttpError(404, 'Gün bulunamadı');
    return d;
  });
  R('GET', '/api/progress', (ctx) => svc.progressView(db, ctx.uid));
  R('GET', '/api/report/weekly', async (ctx) => { needPlan(ctx.uid); return svc.weeklyReport(db, ctx.uid); });
  R('GET', '/api/milestone/(30|60|90)', async (ctx) => { needPlan(ctx.uid); const r = await svc.milestone(db, ctx.uid, Number(ctx.m[1])); svc.markMilestoneSeen(db, ctx.uid, Number(ctx.m[1])); track(ctx.uid, `milestone_${ctx.m[1]}`); return r; });

  R('GET', '/api/coach/history', (ctx) => ({ messages: q.all(db, 'SELECT role,content FROM coach_messages WHERE user_id=? ORDER BY id DESC LIMIT 30', ctx.uid).reverse() }));
  R('POST', '/api/coach', async (ctx) => {
    const b = check({ type: 'object', required: ['message'], additionalProperties: false, properties: { message: { type: 'string', minLength: 1, maxLength: 500 } } }, ctx.body);
    if (!rl(`coach:${ctx.uid}`, 20, 60_000)) throw new HttpError(429, 'Biraz yavaşla, birkaç saniye sonra tekrar dene');
    needPlan(ctx.uid); track(ctx.uid, 'coach_message');
    return svc.coachChat(db, ctx.uid, b.message.trim());
  });

  R('GET', '/api/settings', (ctx) => core.J(ctx.user.settings));
  R('PUT', '/api/settings', (ctx) => {
    const s = check(schemas.settings, ctx.body);
    const cur = core.J(ctx.user.settings);
    const merged = { ...cur, ...s, notifications: { ...(cur.notifications || {}), ...(s.notifications || {}) } };
    q.run(db, 'UPDATE users SET settings=? WHERE id=?', JSON.stringify(merged), ctx.uid);
    if (s.coach_tone) { const sm = core.getProfile(db, ctx.uid).summary; if (sm) core.saveSummary(db, ctx.uid, { ...sm, coach_tone: s.coach_tone }); }
    return merged;
  });
  R('GET', '/api/notifications/plan', (ctx) => notificationPlan(db, ctx.uid, core.J(ctx.user.settings)));

  R('GET', '/api/export', (ctx) => exportData(db, ctx.uid, ctx.url.searchParams.get('format') === 'csv'));
  R('DELETE', '/api/account', (ctx) => {
    q.tx(db, () => { q.run(db, 'DELETE FROM coach_messages WHERE user_id=?', ctx.uid); q.run(db, 'DELETE FROM users WHERE id=?', ctx.uid); q.run(db, 'DELETE FROM ai_events WHERE user_id=?', ctx.uid); });
    ctx.res.setHeader('Set-Cookie', 'g90=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { ok: true };
  });

  const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
  const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };

  function serveStatic(req, res, pathname) {
    let p = pathname === '/' ? '/index.html' : pathname;
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { p = '/index.html'; }
    const f = path.join(PUBLIC, p);
    const body = fs.readFileSync(f);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': p === '/sw.js' ? 'no-cache' : 'no-cache', ...SEC });
    res.end(body);
  }

  return http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SEC)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://x');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Yöntem desteklenmiyor');
        return serveStatic(req, res, decodeURIComponent(url.pathname));
      }
      const route = routes.map((r) => ({ r, m: r.re.exec(url.pathname) })).find((x) => x.m && x.r.method === req.method);
      if (!route) throw new HttpError(404, 'Bulunamadı');
      // CSRF: durum değiştiren isteklerde özel başlık zorunlu (SameSite=Strict ile birlikte)
      if (req.method !== 'GET' && req.headers['x-g90'] !== '1') throw new HttpError(403, 'Geçersiz istek');
      const ip = (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || '?';
      const ctx = { req, res, url, m: route.m, ip, body: req.method === 'GET' ? {} : await readBody(req) };
      if (route.r.auth) {
        const user = sessionUser(req);
        if (!user) throw new HttpError(401, 'Oturum gerekli');
        if (!rl(`api:${user.id}`, 240, 60_000)) throw new HttpError(429, 'Çok fazla istek');
        ctx.user = user; ctx.uid = user.id;
      }
      const out = await route.r.fn(ctx);
      if (out && out.__raw) return send(res, 200, out.body, out.headers);
      return send(res, 200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error('[server]', e);
      return send(res, 500, { error: 'Beklenmeyen bir hata oluştu' });
    }
  });
}

// ---- Bildirim planı: spam yok (günde en fazla 3), check-in yapıldıysa hatırlatma yok ----
function notificationPlan(db, uid, settings) {
  const n = { enabled: false, morning: '08:30', checkin: '21:00', water: false, workout: false, sleep: false, ...(settings.notifications || {}) };
  if (!n.enabled) return { enabled: false, items: [] };
  const plan = core.activePlan(db, uid);
  if (!plan) return { enabled: true, items: [] };
  const today = core.userToday(db, uid);
  const day = core.dayNumber(plan, today);
  if (day < 1 || day > 90) return { enabled: true, items: [] };
  const tasks = core.dayTasks(db, uid, today);
  const done = !!q.get(db, 'SELECT 1 x FROM checkins WHERE user_id=? AND date=?', uid, today);
  const items = [{ id: 'morning', at: n.morning, title: `Gün ${day} / 90`, body: `Bugünün planı hazır: ${tasks.filter((t) => !t.optional).length} görev.` }];
  if (!done) items.push({ id: 'checkin', at: n.checkin, title: 'Akşam check-in', body: '30 saniyede günü kapat.' });
  const bed = tasks.find((t) => t.key === 'bedtime');
  if (n.sleep && bed) { const m = bed.title.match(/(\d\d):(\d\d)/); if (m) items.push({ id: 'sleep', at: E.toHHMM(E.toMin(`${m[1]}:${m[2]}`) - 45), title: 'Uyku hazırlığı', body: 'Ekranları kapatma zamanı yaklaşıyor.' }); }
  if (n.workout && tasks.some((t) => t.key === 'workout')) items.push({ id: 'workout', at: '18:00', title: 'Antrenman zamanı', body: 'Kısa bir versiyon da yeterli.' });
  if (n.water) items.push({ id: 'water', at: '15:00', title: 'Su molası', body: 'Bir bardak su iç.' });
  items.sort((a, b) => a.at.localeCompare(b.at));
  return { enabled: true, items: items.slice(0, 3) };
}

// ---- Dışa aktarma (JSON/CSV) ----
function exportData(db, uid, csv) {
  const user = core.getUser(db, uid);
  const prof = core.getProfile(db, uid);
  const tasks = q.all(db, 'SELECT date,key,title,category,priority,minutes,optional,is_min,completed FROM daily_tasks WHERE user_id=? ORDER BY date,id', uid);
  const checkins = q.all(db, 'SELECT date,sleep,energy,stress,hunger,completion,difficulty,steps,weight,note FROM checkins WHERE user_id=? ORDER BY date', uid);
  const snaps = q.all(db, 'SELECT date,progress,category_scores FROM progress_snapshots WHERE user_id=? ORDER BY date', uid);
  if (!csv) {
    return { __raw: true, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="glow90-export.json"' },
      body: JSON.stringify({ exported_at: core.nowIso(), email: user.email, settings: core.J(user.settings), profile: prof.answers, summary: prof.summary, tasks, checkins, snapshots: snaps }, null, 2) };
  }
  const esc = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = (name, list) => (list.length ? [`# ${name}`, Object.keys(list[0]).join(','), ...list.map((r) => Object.values(r).map(esc).join(','))].join('\n') : `# ${name}\n`);
  return { __raw: true, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="glow90-export.csv"' },
    body: `${rows('tasks', tasks)}\n\n${rows('checkins', checkins)}\n\n${rows('progress', snaps)}\n` };
}

module.exports = { createApp, HttpError, hashPassword, verifyPassword };
