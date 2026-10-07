// Uygulama kabuğu: auth, onboarding yönlendirmesi, sekmeler, çevrimdışı senkron, bildirim zamanlayıcı.
import { api, flush, store, NetError, HttpError } from './api.js';
import { esc, $, icons, toast } from './ui.js';
import { runOnboarding } from './onboarding.js';
import { renderToday, renderPlan, renderProgress, renderCoach, renderProfile } from './screens.js';

const view = $('#view'); const tabbar = $('#tabbar'); const nav = $('nav', tabbar);
const TABS = [['today', 'Bugün'], ['plan', 'Plan'], ['progress', 'İlerleme'], ['coach', 'Koç'], ['profile', 'Profil']];
let me = null; let current = 'today';

async function loadMe() { me = await api('GET', '/api/me'); store.set('g90me', me); return me; }
function setTabs(on) {
  tabbar.hidden = !on; view.classList.toggle('no-tabs', !on);
  if (on) nav.innerHTML = TABS.map(([k, l]) => `<a class="tab" href="#/${k}" ${k === current ? 'aria-current="page"' : ''}>${icons[k]}<span>${l}</span></a>`).join('');
}
const go = (tab) => { location.hash = `#/${tab}`; };

// ---- Giriş / kayıt ----
function renderAuth(mode = 'login') {
  setTabs(false);
  const reg = mode === 'register';
  view.innerHTML = `<div class="hero stack-lg fade-in">
    <div class="stack-sm"><div class="t-over">GLOW90</div><h1 class="t-large">90 gün boyunca her gün biraz daha iyi.</h1><p class="muted m0">Seni tanıyan, planını sana göre ayarlayan sakin bir koç.</p></div>
    <form class="stack" id="af" novalidate>
      <div class="field"><label class="label" for="em">E-posta</label><input class="input" id="em" type="email" autocomplete="email" inputmode="email" required></div>
      <div class="field"><label class="label" for="pw">Parola ${reg ? '<span class="hint">(en az 8 karakter)</span>' : ''}</label><input class="input" id="pw" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="8" required></div>
      <div class="err" id="aerr" role="alert"></div>
      <button class="btn primary block" type="submit">${reg ? 'Hesap oluştur' : 'Giriş yap'}</button>
      <button class="btn ghost block" type="button" id="sw">${reg ? 'Zaten hesabım var' : 'Yeni hesap oluştur'}</button>
    </form><p class="t-cap m0">GLOW90 bir alışkanlık koçudur; tıbbi tavsiye, teşhis veya tedavi sunmaz.</p></div>`;
  $('#sw').onclick = () => renderAuth(reg ? 'login' : 'register');
  $('#af').onsubmit = async (e) => {
    e.preventDefault(); const btn = $('button[type=submit]', view); btn.disabled = true;
    try {
      await api('POST', reg ? '/api/auth/register' : '/api/auth/login', { email: $('#em').value.trim(), password: $('#pw').value, ...(reg ? { tz: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}) });
      await boot();
    } catch (er) { $('#aerr').textContent = er instanceof HttpError ? er.message : 'Bağlantı kurulamadı'; btn.disabled = false; }
  };
}

function startOnboarding() {
  setTabs(false); view.classList.add('no-tabs');
  runOnboarding(view, { answers: me?.answers || {}, onDone: async () => { store.del('g90today'); await loadMe(); location.hash = '#/today'; route(); scheduleNotifs(); } });
}

async function logout(deleted) {
  if (!deleted) await api('POST', '/api/auth/logout').catch(() => {});
  me = null; store.del('g90me'); store.del('g90today'); location.hash = ''; renderAuth('login');
}

// ---- Yönlendirme ----
async function route() {
  if (!me) return;
  const tab = (location.hash.match(/^#\/(\w+)/) || [])[1];
  current = TABS.some(([k]) => k === tab) ? tab : 'today';
  setTabs(true); window.scrollTo(0, 0);
  view.onclick = view.onchange = view.oninput = null;
  const ctx = { go, me, onLogout: logout, onOnboard: startOnboarding, refreshMe: loadMe, onRedo: startOnboarding };
  try {
    if (current === 'today') await renderToday(view, ctx);
    else if (current === 'plan') await renderPlan(view, ctx);
    else if (current === 'progress') await renderProgress(view, ctx);
    else if (current === 'coach') await renderCoach(view, ctx);
    else await renderProfile(view, { ...ctx, me: await loadMe().catch(() => me) });
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) return startOnboarding();
    if (e instanceof HttpError && e.status === 401) return;
    view.innerHTML = `<div class="hero stack center"><h1 class="t-title">${e instanceof NetError ? 'Çevrimdışısın' : 'Bir sorun oluştu'}</h1><p class="muted">${e instanceof NetError ? 'Bu ekran için bağlantı gerekiyor. Bugün ekranı çevrimdışı da çalışır.' : esc(e.message)}</p><button class="btn line" id="retry">Tekrar dene</button></div>`;
    $('#retry').onclick = route;
  }
}

// ---- Bildirimler (uygulama açıkken zamanlanır; kapalıyken gerçek push V2) ----
let timers = [];
async function scheduleNotifs() {
  timers.forEach(clearTimeout); timers = [];
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  let plan; try { plan = await api('GET', '/api/notifications/plan'); } catch { return; }
  const now = new Date();
  for (const it of plan.items) {
    const [h, m] = it.at.split(':').map(Number); const at = new Date(); at.setHours(h, m, 0, 0);
    const ms = at - now; if (ms <= 0 || ms > 864e5) continue;
    timers.push(setTimeout(async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      const opts = { body: it.body, tag: `g90-${it.id}`, icon: '/icon.svg' };
      if (reg) reg.showNotification(it.title, opts); else new Notification(it.title, opts);
    }, ms));
  }
}
window.addEventListener('g90:notif', scheduleNotifs);

// ---- Çevrimdışı ----
const offlineBar = $('#offline');
const setOnline = () => { offlineBar.hidden = navigator.onLine; };
window.addEventListener('offline', setOnline);
window.addEventListener('online', async () => { setOnline(); const n = await flush(); if (n) { toast('Değişiklikler senkronlandı'); route(); } });
window.addEventListener('g90:unauth', () => { if (me) { me = null; renderAuth('login'); } });
window.addEventListener('hashchange', route);

async function boot() {
  setOnline();
  try {
    await flush();
    await loadMe();
  } catch (e) {
    if (e instanceof NetError && store.get('g90me')) { me = store.get('g90me'); }
    else if (e instanceof HttpError && e.status === 401) { me = null; return renderAuth('login'); }
    else { view.innerHTML = '<div class="hero stack center"><h1 class="t-title">Bağlanılamadı</h1><button class="btn line" id="reload">Tekrar dene</button></div>'; $('#reload').onclick = () => location.reload(); return; }
  }
  if (!me.onboarded) return startOnboarding();
  await route(); scheduleNotifs();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
