// Ana ekranlar: Bugün, Plan, İlerleme, Koç, Profil + check-in / milestone sheet'leri.
import { api, mutate, store, NetError, HttpError } from './api.js';
import { esc, $, $$, icons, ring, dyn, bar, toast, sheet, CAT, SCORE_LABEL, fmtDate } from './ui.js';

const GREET = () => { const h = new Date().getHours(); return h < 5 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar'; };
const TC = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

// ============ BUGÜN ============
let today = null;
export async function renderToday(view, { go }) {
  let offline = false;
  try { today = await api('GET', '/api/today'); store.set('g90today', today); }
  catch (e) {
    if (e instanceof NetError && store.get('g90today')) { today = store.get('g90today'); offline = true; }
    else throw e;
  }
  draw();
  function draw() {
    const t = today;
    const main = t.tasks.filter((x) => !x.optional && (t.mode !== 'minimum' || x.is_min));
    const opt = t.tasks.filter((x) => x.optional && t.mode !== 'minimum');
    const min = t.mode === 'minimum';
    const done = main.filter((x) => x.completed).length;
    const row = (x) => `<button class="task" data-task="${x.id}" aria-pressed="${x.completed}"><span class="check">${TC}</span>
      <span class="grow"><span class="task-title">${esc(min && x.minimum_version ? x.minimum_version : x.title)}</span>
      <span class="task-sub">${esc([CAT[x.category], x.minutes && !min ? `${x.minutes} dk` : ''].filter(Boolean).join(' · '))}</span></span></button>`;
    view.innerHTML = `<div class="stack-lg fade-in">
      <header class="stack-sm">
        <div class="row between"><span class="t-over num">Gün ${t.day} / 90</span><span class="badge plain">${esc(t.phase.name)}</span></div>
        <h1 class="t-large">${GREET()}</h1>
      </header>
      ${t.milestone ? `<button class="card soft row between" data-milestone="${t.milestone}"><span class="stack-sm"><span class="t-over">Yeni</span><b>Gün ${t.milestone} özetin hazır</b></span><span class="badge">Aç</span></button>` : ''}
      ${t.welcome ? `<div class="card soft"><b>${esc(t.welcome)}</b></div>` : ''}
      ${t.adapt ? `<div class="card ${t.adapt.change < 0 ? 'warn' : 'soft'}"><div class="t-over">Koçundan</div><div>${esc(t.adapt.message)}</div></div>` : ''}
      <section class="card row">
        ${ring(t.progress, 'Glow progress')}
        <div class="grow stack-sm">
          <div class="t-over">Glow Progress</div>
          <div class="t-cap">90 günlük hedeflerine göre ilerleme</div>
          ${t.streak.streak ? `<div class="badge">${icons.flame.replace('<svg', '<svg width="16" height="16"')}${t.streak.streak} günlük seri</div>` : '<div class="t-cap">Bugün seriyi başlat</div>'}
        </div>
      </section>
      <section class="stack-sm">
        <div class="row between"><h2 class="t-title">${min ? 'Minimum gün' : 'Bugün'}</h2><span class="t-cap num">${done} / ${main.length} tamamlandı</span></div>
        ${min ? '<div class="t-cap">Zor bir gün için hafif versiyon. Bunları yapmak da seriyi korur.</div>' : ''}
        <div class="card tasks">${main.map(row).join('')}</div>
        ${opt.length ? `<div class="t-over">İsteğe bağlı</div><div class="card flat tasks">${opt.map(row).join('')}</div>` : ''}
      </section>
      ${t.notes?.length ? `<div class="card flat t-cap">${t.notes.map(esc).join('<br>')}</div>` : ''}
      <section class="stack-sm">
        ${t.checkin_done ? '<div class="card soft row"><span class="badge">✓</span><span>Bugünün check-in\'i tamam. Yarın görüşürüz.</span></div>'
          : `<button class="btn primary block" data-act="checkin">Akşam check-in (30 sn)</button>`}
        <button class="btn soft block" data-act="mode">${min ? 'Normal plana dön' : 'Zor bir gün mü? Minimum güne geç'}</button>
        <button class="btn line block" data-go="coach">Koçla konuş</button>
      </section></div>`;
    if (offline) $('.t-over', view).insertAdjacentHTML('afterend', ' <span class="badge warn">çevrimdışı</span>');
    dyn(view);
  }

  view.onclick = async (e) => {
    const task = e.target.closest('[data-task]');
    if (task) {
      const id = Number(task.dataset.task); const x = today.tasks.find((y) => y.id === id); x.completed = !x.completed;
      store.set('g90today', today); draw();
      const r = await mutate('PUT', `/api/tasks/${id}`, { completed: x.completed }).catch((er) => { toast(er.message); return null; });
      if (r && !r.queued) { today.progress = r.progress ?? today.progress; today.streak = r.streak ?? today.streak; store.set('g90today', today); draw(); }
      return;
    }
    const ms = e.target.closest('[data-milestone]');
    if (ms) return showMilestone(Number(ms.dataset.milestone), () => renderToday(view, { go }));
    const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'checkin') return openCheckin(() => renderToday(view, { go }));
    if (act === 'mode') {
      const mode = today.mode === 'minimum' ? 'normal' : 'minimum'; today.mode = mode; store.set('g90today', today); draw();
      await mutate('PUT', '/api/day/mode', { mode, date: today.date }).catch((er) => toast(er.message));
      renderToday(view, { go });
    }
  };
}

// ============ CHECK-IN ============
export async function openCheckin(onDone) {
  let info;
  try { info = await api('GET', '/api/checkin'); } catch (e) { info = { questions: ['sleep', 'energy'], easy: true, completion: 0, existing: null }; }
  const v = { sleep: info.existing?.sleep ?? 7, ...(info.existing ? { energy: info.existing.energy, stress: info.existing.stress, hunger: info.existing.hunger, difficulty: info.existing.difficulty } : {}) };
  const Q = info.questions;
  const scale = (k, label, lo, hi) => `<div class="field"><div class="label">${label}</div><div class="scale" data-scale="${k}" role="group" aria-label="${label}">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button type="button" data-v="${n}" aria-pressed="${v[k] === n}">${n}</button>`).join('')}</div><div class="row between hint"><span>${lo}</span><span>${hi}</span></div></div>`;
  const html = `<form class="stack" id="ci" novalidate>
    <div class="stack-sm"><h2 class="t-large">Günün nasıldı?</h2><p class="muted m0">${info.easy ? 'Planının çoğunu tamamladın, sadece iki kısa soru.' : `Planın %${info.completion} tamamlandı — olduğu gibi kabul ediyoruz.`}</p></div>
    <div class="field"><div class="label">Bugün kaç saat uyudun?</div><div class="stepper" data-step><button type="button" data-d="-1" aria-label="Azalt">−</button><output class="num" id="sleepv">${v.sleep}</output><button type="button" data-d="1" aria-label="Artır">+</button><span class="muted">saat</span></div></div>
    ${scale('energy', 'Enerjin', 'düşük', 'yüksek')}
    ${Q.includes('stress') ? scale('stress', 'Stres', 'sakin', 'yüksek') : ''}
    ${Q.includes('hunger') ? scale('hunger', 'Açlık', 'tok', 'çok aç') : ''}
    ${Q.includes('difficulty') ? scale('difficulty', 'Plan bugün ne kadar zordu?', 'kolay', 'çok zor') : ''}
    ${Q.includes('steps') ? '<div class="field"><label class="label" for="ci_steps">Adım sayın (isteğe bağlı)</label><input class="input num" id="ci_steps" type="number" inputmode="numeric" min="0" max="100000"></div>' : ''}
    ${Q.includes('weight') ? '<div class="field"><label class="label" for="ci_w">Kilo (isteğe bağlı, haftada bir yeter)</label><div class="unit-wrap"><input class="input num" id="ci_w" type="number" inputmode="decimal" step="0.1" min="30" max="300"><span class="unit">kg</span></div></div>' : ''}
    <div class="field"><label class="label" for="ci_note">Not (isteğe bağlı)</label><textarea class="input" id="ci_note" maxlength="500" placeholder="Seni zorlayan bir şey oldu mu?">${esc(info.existing?.note || '')}</textarea></div>
    <div class="err" id="cierr" role="alert"></div>
    <button class="btn primary block" type="submit">Kaydet</button></form>`;
  sheet(html, (s, close) => {
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-scale] button');
      if (b) { const k = b.parentElement.dataset.scale; v[k] = Number(b.dataset.v); $$('button', b.parentElement).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
      const st = e.target.closest('[data-step] button');
      if (st) { v.sleep = Math.min(14, Math.max(0, v.sleep + 0.5 * Number(st.dataset.d))); $('#sleepv', s).textContent = String(v.sleep); }
    });
    $('#ci', s).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { sleep: v.sleep };
      for (const k of ['energy', 'stress', 'hunger', 'difficulty']) if (v[k]) body[k] = v[k];
      const st = $('#ci_steps', s)?.value; if (st) body.steps = Number(st);
      const w = $('#ci_w', s)?.value; if (w) body.weight = Number(w);
      const note = $('#ci_note', s).value.trim(); if (note) body.note = note;
      if (!body.energy) { $('#cierr', s).textContent = 'Enerjini seçer misin?'; return; }
      const today_ = store.get('g90today')?.date; if (today_) body.date = today_;
      try { const r = await mutate('POST', '/api/checkin', body); close(); toast(r.queued ? 'Kaydedildi, bağlanınca senkronlanacak' : 'Kaydedildi. Bugün için teşekkürler ✓'); onDone?.(); }
      catch (er) { $('#cierr', s).textContent = er.message; }
    });
  });
}

// ============ MİLESTONE ============
export async function showMilestone(n, onClose) {
  let m; try { m = await api('GET', `/api/milestone/${n}`); } catch (e) { return toast(e.message); }
  if (!m.reached) return toast('Bu özet henüz hazır değil');
  const t = m.totals; const r = m.report;
  const stat = (num, label) => `<div class="card flat stack-sm"><div class="t-title num">${num}</div><div class="t-cap">${label}</div></div>`;
  const html = `<div class="stack-lg">
    <div class="stack-sm center"><div class="t-over">${m.title}</div><h2 class="t-large">${esc(m.message)}</h2></div>
    <div class="row center">${ring(m.progress, 'Progress')}</div>
    <div class="grid2">${stat(`%${t.completion}`, 'Tamamlama')}${stat(t.tasks_done, 'Tamamlanan görev')}${stat(t.workouts, 'Antrenman')}${stat(t.steps ? t.steps.toLocaleString('tr-TR') : '—', 'Kayıtlı adım')}
      ${stat(m.sleep.start && m.sleep.end ? `${m.sleep.start} → ${m.sleep.end} sa` : '—', 'Uyku ortalaması')}${stat(t.selfcare_days, 'Bakım günü')}
      ${m.weight ? stat(`${m.weight.delta > 0 ? '+' : ''}${m.weight.delta} kg`, 'Kilo trendi') : ''}</div>
    ${m.notes.length ? `<div class="card stack-sm"><div class="t-over">Kendi notların</div>${m.notes.map((x) => `<div>“${esc(x.note)}”<div class="t-cap">${fmtDate(x.date)}</div></div>`).join('')}</div>` : ''}
    ${r ? `<div class="card soft stack-sm"><div class="t-over">90 DAY REPORT</div><div><b>Nereden başladın?</b><br>${esc(r.started)}</div>
      <div><b>Neler değişti?</b><br>${r.changed.map((x) => `• ${esc(x)}`).join('<br>')}</div><div>${esc(r.strongest)}</div><div>${esc(r.hardest)}</div>
      <div><b>Korunacaklar</b><br>${r.keep.map((x) => `• ${esc(x)}`).join('<br>')}</div><div><b>Sonraki yön</b><br>${esc(r.next_direction)}</div></div>` : ''}
    <button class="btn primary block" data-close>Devam</button></div>`;
  sheet(html, (s, close) => $('[data-close]', s).addEventListener('click', () => { close(); onClose?.(); }));
}

// ============ PLAN ============
export async function renderPlan(view) {
  const p = await api('GET', '/api/plan');
  const lvl = (d) => (d.day > p.today_day ? 'future' : !d.main ? '' : d.done / d.main >= 0.9 ? 'l3' : d.done / d.main >= 0.5 ? 'l2' : d.done > 0 ? 'l1' : '');
  const phaseCard = (ph) => {
    const cur = p.today_day >= ph.from && p.today_day <= ph.to;
    const days = p.days.filter((d) => d.day >= ph.from && d.day <= ph.to);
    return `<section class="card stack ${cur ? '' : 'flat'}"><div class="row between"><div><div class="t-over">Gün ${ph.from}–${ph.to}</div><h2 class="t-title">${esc(ph.name)}</h2></div>${cur ? '<span class="badge">Şu an</span>' : ''}</div>
      <div><b>${esc(ph.theme)}</b><div class="muted">${esc(ph.focus)}</div></div>
      <div class="grid90">${days.map((d) => `<button class="dot ${lvl(d)} ${d.day === p.today_day ? 'now' : ''}" data-day="${d.date}" aria-label="Gün ${d.day}">${d.day}</button>`).join('')}</div></section>`;
  };
  view.innerHTML = `<div class="stack-lg fade-in"><header class="stack-sm"><span class="t-over num">${fmtDate(p.start)} – ${fmtDate(p.end)}</span><h1 class="t-large">Plan</h1><p class="muted m0">3 faz, 90 gün. Bir güne dokunarak görevlerini gör.</p></header>
    ${p.notes.length ? `<div class="card warn t-cap">${p.notes.map(esc).join('<br>')}</div>` : ''}${p.phases.map(phaseCard).join('')}
    <div class="t-cap center">Plan sürümü ${p.version} · Koç yalnızca gerektiğinde küçük ayarlar yapar.</div></div>`;
  view.onclick = async (e) => {
    const b = e.target.closest('[data-day]'); if (!b) return;
    try {
      const d = await api('GET', `/api/plan/day?date=${b.dataset.day}`);
      sheet(`<div class="stack"><div class="stack-sm"><span class="t-over">Gün ${d.day} / 90</span><h2 class="t-title">${fmtDate(d.date)}</h2>${d.mode === 'minimum' ? '<span class="badge warn">Minimum gün</span>' : ''}</div>
        <div class="card tasks">${d.tasks.map((t) => `<div class="task" aria-pressed="${t.completed}"><span class="check">${TC}</span><span class="grow"><span class="task-title">${esc(t.title)}</span><span class="task-sub">${esc(CAT[t.category] || '')}${t.optional ? ' · isteğe bağlı' : ''}</span></span></div>`).join('')}</div></div>`);
    } catch (er) { toast(er.message); }
  };
}

// ============ İLERLEME ============
function barChart(vals, max = 100) {
  const w = 300; const h = 80; const n = vals.length; const bw = w / n;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Günlük tamamlama grafiği">${vals.map((v, i) => `<rect class="bar-bg" x="${i * bw + 1}" y="0" width="${Math.max(bw - 2, 1)}" height="${h}" rx="2"/><rect class="bar-c" x="${i * bw + 1}" y="${h - (v / max) * h}" width="${Math.max(bw - 2, 1)}" height="${(v / max) * h}" rx="2"/>`).join('')}</svg>`;
}
function lineChart(points, label) {
  const pts = points.map((p, i) => ({ i, v: p.v })).filter((p) => p.v != null);
  if (pts.length < 2) return `<div class="t-cap">Henüz yeterli veri yok</div>`;
  const w = 300; const h = 80; const lo = Math.min(...pts.map((p) => p.v)); const hi = Math.max(...pts.map((p) => p.v)); const span = hi - lo || 1;
  const x = (i) => (i / Math.max(points.length - 1, 1)) * (w - 8) + 4; const y = (v) => h - 8 - ((v - lo) / span) * (h - 16);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><polyline class="ln" points="${pts.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}"/>${pts.map((p) => `<circle class="pt" cx="${x(p.i)}" cy="${y(p.v)}" r="2.6"/>`).join('')}</svg>`;
}
export async function renderProgress(view) {
  const [p, wk] = await Promise.all([api('GET', '/api/progress'), api('GET', '/api/report/weekly')]);
  const t = p.trends; const last = (a) => [...a].reverse().find((x) => x.v != null)?.v;
  const sc = Object.entries(p.scores).filter(([k]) => k !== 'checkin');
  view.innerHTML = `<div class="stack-lg fade-in"><header class="stack-sm"><span class="t-over num">Gün ${p.day} / 90</span><h1 class="t-large">İlerleme</h1></header>
    <section class="card row">${ring(p.progress, 'Glow progress')}<div class="grow stack-sm"><div class="t-over">Glow Progress</div><div class="t-cap">90 günlük hedeflerine göre ilerleme. Sağlık skoru değildir; motivasyon içindir.</div>
      <div class="row"><span class="badge">${icons.flame.replace('<svg', '<svg width="14" height="14"')}${p.streak.streak} gün seri</span><span class="badge plain">En iyi ${p.streak.best}</span></div></div></section>
    ${wk.available ? `<section class="card soft stack-sm"><div class="row between"><div class="t-over">Hafta ${wk.week}</div><b class="num">${wk.progress_delta >= 0 ? '+' : ''}${wk.progress_delta}%</b></div>
      <div><b>En iyi yaptığın:</b> ${esc(wk.best)}</div><div><b>En zorlandığın:</b> ${esc(wk.hardest)}</div><div><b>Gelecek hafta:</b> ${esc(wk.next_week)}</div></section>`
      : `<section class="card flat t-cap">İlk haftalık özetin ${wk.next_in} gün sonra hazır.</section>`}
    <section class="card stack">${sc.map(([k, v]) => `<div class="score"><span>${SCORE_LABEL[k] || k}</span><b class="num">${v}%</b>${bar(v)}</div>`).join('')}</section>
    <section class="card stack-sm"><div class="row between"><b>Görev tamamlama</b><span class="t-cap">son 30 gün</span></div>${barChart(t.completion.map((x) => x.v))}</section>
    <section class="card stack-sm"><div class="row between"><b>Uyku</b><span class="t-cap num">${last(t.sleep) ?? '—'} sa</span></div>${lineChart(t.sleep, 'Uyku trendi')}</section>
    ${t.weight.some((x) => x.v) ? `<section class="card stack-sm"><div class="row between"><b>Kilo trendi</b><span class="t-cap num">${last(t.weight) ?? '—'} kg</span></div>${lineChart(t.weight, 'Kilo trendi')}</section>` : ''}
    ${t.steps.some((x) => x.v) ? `<section class="card stack-sm"><div class="row between"><b>Adım</b><span class="t-cap num">${last(t.steps)?.toLocaleString('tr-TR')}</span></div>${lineChart(t.steps, 'Adım trendi')}</section>` : ''}
    <section class="grid2"><div class="card flat stack-sm"><div class="t-title num">${t.workouts}</div><div class="t-cap">Antrenman (30 gün)</div></div><div class="card flat stack-sm"><div class="t-title num">%${t.checkin_rate}</div><div class="t-cap">Check-in oranı</div></div></section>
    <section class="stack-sm"><h2 class="t-title">Kilometre taşları</h2>${p.milestones.map((m) => `<button class="card flat row between" data-ms="${m.n}" ${m.reached ? '' : 'disabled'}><b>Gün ${m.n}</b><span class="badge ${m.reached ? '' : 'plain'}">${m.reached ? 'Aç' : 'Kilitli'}</span></button>`).join('')}</section></div>`;
  dyn(view);
  view.onclick = (e) => { const b = e.target.closest('[data-ms]'); if (b && !b.disabled) showMilestone(Number(b.dataset.ms)); };
}

// ============ KOÇ ============
export async function renderCoach(view) {
  const { messages } = await api('GET', '/api/coach/history');
  const SUG = ['Bugün spor yapacak enerjim yok', 'Yarın sınavım var, programı azalt', 'Bu hafta 3 gün kaçırdım', 'Bana bugün 20 dakikalık program ver', 'Bugün çok yedim'];
  const bub = (m) => `<div class="bubble ${m.role === 'user' ? 'me' : 'coach'}">${esc(m.content)}</div>`;
  view.innerHTML = `<div class="stack-lg fade-in"><header class="stack-sm"><h1 class="t-large">Koç</h1><p class="muted m0">Planını bilen, yargılamayan bir yardımcı. Tıbbi tavsiye vermez.</p></header>
    <div class="chat" id="chat">${messages.length ? messages.map(bub).join('') : '<div class="bubble coach">Merhaba! Bugün nasılsın? Planını senin tempona göre ayarlayabilirim.</div>'}</div>
    <div class="chips" id="sug">${SUG.map((s) => `<button class="chip" type="button">${esc(s)}</button>`).join('')}</div><div class="composer-space"></div></div>
    <div class="composer"><form id="cf"><input class="input" id="cm" maxlength="500" placeholder="Koçuna yaz…" autocomplete="off" aria-label="Mesaj"><button class="btn primary" aria-label="Gönder">${icons.send}</button></form></div>`;
  const chat = $('#chat', view);
  const scroll = () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  const send = async (text) => {
    if (!text.trim()) return;
    chat.insertAdjacentHTML('beforeend', bub({ role: 'user', content: text }));
    chat.insertAdjacentHTML('beforeend', '<div class="bubble coach" id="typing"><div class="spinner"></div></div>'); scroll();
    try {
      const r = await api('POST', '/api/coach', { message: text });
      $('#typing', view).outerHTML = bub({ role: 'coach', content: r.reply });
      if (r.applied) { toast('Planın güncellendi'); store.del('g90today'); }
    } catch (e) { $('#typing', view).outerHTML = bub({ role: 'coach', content: e instanceof NetError ? 'Şu an çevrimdışısın. Bağlanınca tekrar dene; görevlerin yine de burada.' : e.message }); }
    scroll();
  };
  $('#cf', view).onsubmit = (e) => { e.preventDefault(); const i = $('#cm', view); const v = i.value; i.value = ''; send(v); };
  $('#sug', view).onclick = (e) => { const b = e.target.closest('.chip'); if (b) send(b.textContent); };
  view.onclick = null; scroll();
}

// ============ PROFİL ============
const download = async (path, name) => {
  const res = await fetch(path, { credentials: 'same-origin' }); const blob = await res.blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
export async function renderProfile(view, { me, onLogout, onRedo, refreshMe }) {
  const s = me.settings || {}; const n = { enabled: false, morning: '08:30', checkin: '21:00', water: false, workout: false, sleep: false, ...(s.notifications || {}) };
  const tone = s.coach_tone || me.summary?.coach_tone || 'friendly';
  const GL = { lose_weight: 'Kilo yönetimi', reduce_fat: 'Yağ oranı', build_muscle: 'Kas', look_fit: 'Fit görünüm', fitness: 'Kondisyon', sleep: 'Uyku', energy: 'Enerji', skin: 'Cilt', selfcare: 'Bakım', nutrition: 'Beslenme', discipline: 'Disiplin', steps: 'Hareket', lifestyle: 'Yaşam düzeni' };
  const sw = (id, on, label) => `<div class="row between"><span>${label}</span><button class="switch" role="switch" aria-checked="${on}" aria-label="${label}" data-sw="${id}"></button></div>`;
  const goals = [me.summary?.primary_goal, ...(me.summary?.secondary_goals || [])].filter(Boolean);
  view.innerHTML = `<div class="stack-lg fade-in"><header class="stack-sm"><h1 class="t-large">Profil</h1><span class="muted">${esc(me.email)}</span></header>
    <section class="card stack-sm"><div class="t-over">Hedeflerin</div><div class="chips">${goals.map((g) => `<span class="badge">${esc(GL[g] || g)}</span>`).join('') || '<span class="muted">—</span>'}</div>
      ${me.summary?.headline ? `<div class="muted">${esc(me.summary.headline)}</div>` : ''}<button class="btn line small" data-act="redo">Cevaplarımı güncelle / planı yeniden oluştur</button></section>
    <section class="card stack"><div class="t-over">Koç kişiliği</div><div class="chips" id="tone">${[['gentle', 'Sakin'], ['friendly', 'Samimi'], ['strict', 'Sert']].map(([v, l]) => `<button class="chip" data-tone="${v}" aria-pressed="${tone === v}">${l}</button>`).join('')}</div></section>
    <section class="card stack"><div class="t-over">Bildirimler</div>${sw('enabled', n.enabled, 'Bildirimlere izin ver')}
      <div class="row between"><label for="nm">Sabah planı</label><input class="input num narrow" id="nm" type="time" value="${n.morning}"></div>
      <div class="row between"><label for="nc">Akşam check-in</label><input class="input num narrow" id="nc" type="time" value="${n.checkin}"></div>
      ${sw('water', n.water, 'Su hatırlatma')}${sw('workout', n.workout, 'Antrenman')}${sw('sleep', n.sleep, 'Uyku hazırlığı')}
      <div class="hint">Günde en fazla 3 bildirim. Check-in yaptıysan hatırlatma gelmez.</div></section>
    <section class="card stack"><div class="t-over">Birimler</div><div class="chips">${[['metric', 'kg / cm'], ['imperial', 'lb / in']].map(([v, l]) => `<button class="chip" data-unit="${v}" aria-pressed="${(s.units || 'metric') === v}">${l}</button>`).join('')}</div></section>
    <section class="card stack-sm"><div class="t-over">AI kullanımı</div><div class="row between"><span>Bugün</span><b class="num">${me.ai.used} / ${me.ai.limit}</b></div>${bar(Math.round(100 * me.ai.used / Math.max(me.ai.limit, 1)))}
      <div class="hint">${me.ai.enabled ? 'Koçluk ve kişiselleştirme için Claude kullanılır. Sadece kısa özetler gönderilir, tüm geçmişin değil.' : 'AI anahtarı tanımlı değil: uygulama kural tabanlı modda çalışıyor.'}</div></section>
    <section class="card stack-sm"><div class="t-over">Verilerin & gizlilik</div>
      <div class="hint">Verilerin yalnızca bu hesaba aittir; analitik sistemlerine sağlık verisi gönderilmez. Bu uygulama tıbbi tavsiye vermez.</div>
      <div class="row"><button class="btn line small" data-dl="json">JSON indir</button><button class="btn line small" data-dl="csv">CSV indir</button></div></section>
    <section class="stack-sm"><button class="btn line block" data-act="logout">Çıkış yap</button><button class="btn danger block" data-act="delete">Hesabı sil</button></section></div>`;
  dyn(view);
  const saveNotif = async (patch) => {
    Object.assign(n, patch);
    if (n.enabled && 'Notification' in window && Notification.permission === 'default') { const p = await Notification.requestPermission(); if (p !== 'granted') { n.enabled = false; toast('Bildirim izni verilmedi'); } }
    await api('PUT', '/api/settings', { notifications: n }).catch((e) => toast(e.message));
    await refreshMe(); renderProfile(view, { me: (await api('GET', '/api/me')), onLogout, onRedo, refreshMe });
    window.dispatchEvent(new Event('g90:notif'));
  };
  view.onchange = (e) => { if (e.target.id === 'nm') saveNotif({ morning: e.target.value }); if (e.target.id === 'nc') saveNotif({ checkin: e.target.value }); };
  view.onclick = async (e) => {
    const sw_ = e.target.closest('[data-sw]'); if (sw_) return saveNotif({ [sw_.dataset.sw]: sw_.getAttribute('aria-checked') !== 'true' });
    const tn = e.target.closest('[data-tone]'); if (tn) { await api('PUT', '/api/settings', { coach_tone: tn.dataset.tone }); $$('#tone .chip', view).forEach((c) => c.setAttribute('aria-pressed', String(c === tn))); toast('Koç tonu güncellendi'); return; }
    const un = e.target.closest('[data-unit]'); if (un) { await api('PUT', '/api/settings', { units: un.dataset.unit }); $$('[data-unit]', view).forEach((c) => c.setAttribute('aria-pressed', String(c === un))); return; }
    const dl = e.target.closest('[data-dl]'); if (dl) return download(`/api/export?format=${dl.dataset.dl}`, `glow90-export.${dl.dataset.dl}`);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'logout') return onLogout();
    if (act === 'redo') return onRedo();
    if (act === 'delete') {
      sheet(`<div class="stack"><h2 class="t-title">Hesabı sil?</h2><p class="muted m0">Tüm verilerin kalıcı olarak silinir. Önce dışa aktarmak istersen Profil'den indirebilirsin.</p>
        <button class="btn danger block" id="del">Evet, her şeyi sil</button><button class="btn line block" id="no">Vazgeç</button></div>`, (s2, close) => {
        $('#no', s2).onclick = close;
        $('#del', s2).onclick = async () => { await api('DELETE', '/api/account'); store.del('g90today'); store.del('g90q'); close(); onLogout(true); };
      });
    }
  };
}
