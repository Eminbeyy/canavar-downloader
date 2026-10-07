// Onboarding: 9 kısa adım, her adım kendi başına kaydedilir; geri dönülebilir, atlanabilir.
import { api, HttpError } from './api.js';
import { esc, $, $$, icons, dyn, bar } from './ui.js';

const YN = [[true, 'Evet'], [false, 'Hayır']];
const GOALS = [['lose_weight', 'Kilo vermek'], ['reduce_fat', 'Yağ oranını azaltmak'], ['build_muscle', 'Kas geliştirmek'], ['look_fit', 'Daha fit görünmek'],
  ['fitness', 'Kondisyon geliştirmek'], ['sleep', 'Daha düzenli uyumak'], ['energy', 'Daha enerjik hissetmek'], ['skin', 'Cilt bakım rutini'],
  ['selfcare', 'Kişisel bakım düzeni'], ['nutrition', 'Beslenme düzeni'], ['discipline', 'Disiplin / alışkanlık'], ['steps', 'Günlük hareketi artırmak'], ['lifestyle', 'Genel yaşam düzeni']];
const ACT = [['yürüyüş', 'Yürüyüş'], ['koşu', 'Koşu'], ['yüzme', 'Yüzme'], ['bisiklet', 'Bisiklet'], ['ağırlık', 'Ağırlık'], ['yoga', 'Yoga'], ['dans', 'Dans'], ['takım sporu', 'Takım sporu']];
const DAYS = [[0, 'Pzt'], [1, 'Sal'], [2, 'Çar'], [3, 'Per'], [4, 'Cum'], [5, 'Cmt'], [6, 'Paz']];

export const STEPS = [
  { title: 'Seni tanıyalım', sub: 'İstemediğin soruyu boş bırakabilirsin.', fields: [
    { k: 'age', t: 'num', label: 'Yaş', unit: 'yaş', min: 10, max: 100 }, { k: 'height_cm', t: 'num', label: 'Boy', unit: 'cm', min: 100, max: 230 },
    { k: 'weight_kg', t: 'num', label: 'Kilo', unit: 'kg', min: 30, max: 300, step: 0.1 },
    { k: 'sex', t: 'choice', label: 'Cinsiyet (isteğe bağlı)', opts: [['female', 'Kadın'], ['male', 'Erkek'], ['other', 'Diğer'], ['skip', 'Belirtmek istemiyorum']] },
    { k: 'occupation', t: 'choice', label: 'Günlük düzenin', opts: [['student', 'Öğrenci'], ['worker', 'Çalışan'], ['mixed', 'Karma'], ['other', 'Diğer']] },
    { k: 'busy_hours', t: 'num', label: 'Ortalama çalışma / okul süren', unit: 'saat', min: 0, max: 16 }, { k: 'country', t: 'text', label: 'Ülke / bölge', max: 60 }] },
  { title: 'Hedeflerin', sub: 'Bir veya birkaç tane seç (en fazla 5).', required: true, fields: [
    { k: 'goals', t: 'multi', label: 'Ana hedefler', opts: GOALS, max: 5 },
    { k: 'free_text', t: 'area', label: '90 günün sonunda ne değişmiş olsun istiyorsun?', max: 500, ph: 'Kendi cümlelerinle yaz…' }] },
  { title: 'Zamanın', sub: 'Gerçekçi bir plan için.', fields: [
    { k: 'days_per_week', t: 'choice', label: 'Haftada kaç gün ayırabilirsin?', opts: [1, 2, 3, 4, 5, 6, 7].map((n) => [n, String(n)]) },
    { k: 'minutes_per_day', t: 'choice', label: 'Günde kaç dakika?', opts: [10, 20, 30, 45, 60, 90].map((n) => [n, `${n} dk`]) },
    { k: 'preferred_time', t: 'choice', label: 'Hangi zaman daha uygun?', opts: [['morning', 'Sabah'], ['evening', 'Akşam'], ['flexible', 'Fark etmez']] },
    { k: 'busy_days', t: 'multi', label: 'İş / okul nedeniyle yoğun günler', opts: DAYS },
    { k: 'weekend_style', t: 'choice', label: 'Hafta sonu düzenin', opts: [['active', 'Hareketli'], ['relaxed', 'Rahat'], ['busy', 'Yoğun']] }] },
  { title: 'Hareket', sub: 'Sana uyan antrenmanları seçelim.', fields: [
    { k: 'current_exercise', t: 'choice', label: 'Şu an spor yapıyor musun?', opts: [['none', 'Hayır'], ['light', 'Ara sıra'], ['regular', 'Düzenli']] },
    { k: 'has_gym', t: 'yn', label: 'Spor salonu erişimin var mı?' },
    { k: 'home_equipment', t: 'multi', label: 'Evde ekipman', opts: [['dumbbell', 'Dumbbell'], ['bar', 'Barfiks'], ['bands', 'Direnç bandı'], ['none', 'Yok']] },
    { k: 'can_walk', t: 'yn', label: 'Yürüyüş yapabilir misin?' }, { k: 'can_swim', t: 'yn', label: 'Yüzme imkanın var mı?' }, { k: 'has_bike', t: 'yn', label: 'Bisikletin var mı?' },
    { k: 'likes', t: 'multi', label: 'Sevdiğin aktiviteler', opts: ACT }, { k: 'dislikes', t: 'multi', label: 'Sevmediklerin', opts: ACT },
    { k: 'injuries', t: 'area', label: 'Bilinen sakatlık / ağrı veya doktorun getirdiği kısıtlama', max: 300, ph: 'Varsa yaz. Teşhis koymayız; planı buna göre nazikleştiririz.' }] },
  { title: 'Beslenme', sub: 'Kalori hedefi seçmen gerekmiyor.', fields: [
    { k: 'meals_per_day', t: 'choice', label: 'Günde kaç öğün?', opts: [1, 2, 3, 4, 5].map((n) => [n, String(n)]) },
    { k: 'breakfast', t: 'choice', label: 'Kahvaltı', opts: [['always', 'Hep'], ['sometimes', 'Bazen'], ['never', 'Nadiren']] },
    { k: 'eating_out', t: 'choice', label: 'Dışarıda yemek', opts: [['rare', 'Nadiren'], ['weekly', 'Haftalık'], ['often', 'Sık']] },
    { k: 'diet', t: 'choice', label: 'Beslenme tercihi', opts: [['none', 'Özel yok'], ['vegetarian', 'Vejetaryen'], ['vegan', 'Vegan'], ['other', 'Diğer']] },
    { k: 'allergies', t: 'text', label: 'Alerji / intolerans', max: 200 }, { k: 'foods_like', t: 'text', label: 'Sevdiğin yiyecekler', max: 200 }, { k: 'foods_dislike', t: 'text', label: 'Sevmediğin yiyecekler', max: 200 },
    { k: 'cooking', t: 'choice', label: 'Yemek hazırlama', opts: [['yes', 'Rahatça'], ['limited', 'Kısıtlı'], ['no', 'Hayır']] },
    { k: 'budget', t: 'choice', label: 'Bütçe', opts: [['low', 'Düşük'], ['mid', 'Orta'], ['high', 'Rahat']] },
    { k: 'sweets', t: 'choice', label: 'Tatlı / abur cubur', opts: [['rare', 'Nadiren'], ['weekly', 'Haftalık'], ['daily', 'Her gün']] },
    { k: 'night_eating', t: 'yn', label: 'Gece atıştırma alışkanlığı var mı?' },
    { k: 'water_l', t: 'num', label: 'Günlük su', unit: 'litre', min: 0, max: 8, step: 0.5 }] },
  { title: 'Uyku ve enerji', sub: 'Yaklaşık değerler yeterli.', fields: [
    { k: 'bedtime', t: 'time', label: 'Ortalama yatış saati' }, { k: 'waketime', t: 'time', label: 'Ortalama kalkış saati' },
    { k: 'sleep_hours', t: 'stepper', label: 'Ortalama uyku süresi', min: 3, max: 12, step: 0.5, def: 7, unit: 'saat' },
    { k: 'sleep_quality', t: 'scale', label: 'Uyku kalitesi (1–10)' }, { k: 'phone_in_bed', t: 'yn', label: 'Gece yatakta telefon kullanıyor musun?' },
    { k: 'caffeine', t: 'choice', label: 'Kafein', opts: [['none', 'Yok'], ['low', 'Az'], ['high', 'Çok']] },
    { k: 'morning_energy', t: 'scale', label: 'Sabah enerjin (1–10)' }, { k: 'energy_dips', t: 'yn', label: 'Gün içinde enerji düşüşleri yaşıyor musun?' }] },
  { title: 'Kişisel bakım', sub: 'İsteğe bağlı — ilgilendiklerini seç.', fields: [
    { k: 'selfcare', t: 'multi', label: 'Kategoriler', opts: [['skin', 'Cilt'], ['hair', 'Saç'], ['beard', 'Sakal'], ['dental', 'Diş / ağız'], ['shower', 'Duş'], ['nails', 'Tırnak'], ['style', 'Stil'], ['hygiene', 'Hijyen'], ['posture', 'Duruş'], ['general', 'Genel bakım']] }] },
  { title: 'Motivasyonun', sub: 'Koçunu sana göre ayarlayalım.', fields: [
    { k: 'discipline', t: 'scale', label: 'Disiplinini kaç verirsin? (1–10)' },
    { k: 'derail', t: 'text', label: 'Planı en çok ne zaman bozuyorsun?', max: 200 }, { k: 'stress_behavior', t: 'text', label: 'Stresliyken ne yaparsın?', max: 200 },
    { k: 'quick_drop', t: 'yn', label: 'Motivasyonun çabuk düşer mi?' }, { k: 'support', t: 'choice', label: 'Nasıl daha iyi çalışırsın?', opts: [['solo', 'Tek başıma'], ['support', 'Destekle']] },
    { k: 'reminders', t: 'yn', label: 'Hatırlatıcı ister misin?' },
    { k: 'coach_tone', t: 'choice', label: 'Koç tonu', opts: [['gentle', 'Sakin'], ['friendly', 'Samimi'], ['strict', 'Sert']] },
    { k: 'task_style', t: 'choice', label: 'Görevler', opts: [['short', 'Kısa'], ['detailed', 'Detaylı']] }] },
  { title: 'Hazırız', summary: true },
];

function fieldHtml(f, v) {
  const id = `f_${f.k}`;
  const head = `<label class="label" for="${id}">${esc(f.label)}</label>`;
  switch (f.t) {
    case 'num': return `<div class="field">${head}<div class="unit-wrap"><input class="input num" id="${id}" data-k="${f.k}" data-t="num" type="number" inputmode="decimal" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${v ?? ''}"><span class="unit">${esc(f.unit)}</span></div></div>`;
    case 'text': return `<div class="field">${head}<input class="input" id="${id}" data-k="${f.k}" data-t="text" maxlength="${f.max}" value="${esc(v)}"></div>`;
    case 'area': return `<div class="field">${head}<textarea class="input" id="${id}" data-k="${f.k}" data-t="text" maxlength="${f.max}" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea></div>`;
    case 'time': return `<div class="field">${head}<input class="input num" id="${id}" data-k="${f.k}" data-t="text" type="time" value="${esc(v)}"></div>`;
    case 'choice': case 'yn': case 'multi': {
      const opts = f.t === 'yn' ? YN : f.opts;
      const sel = (o) => (f.t === 'multi' ? (v || []).includes(o) : v === o);
      return `<div class="field"><div class="label">${esc(f.label)}</div><div class="chips" role="group" aria-label="${esc(f.label)}" data-k="${f.k}" data-t="${f.t}" data-max="${f.max || ''}">${opts.map(([o, l]) => `<button type="button" class="chip" data-v="${esc(JSON.stringify(o))}" aria-pressed="${sel(o)}">${esc(l)}</button>`).join('')}</div></div>`;
    }
    case 'scale': return `<div class="field"><div class="label">${esc(f.label)}</div><div class="scale" data-k="${f.k}" data-t="scale" role="group" aria-label="${esc(f.label)}">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button type="button" data-v="${n}" aria-pressed="${v === n}">${n}</button>`).join('')}</div></div>`;
    case 'stepper': { const cur = v ?? f.def; return `<div class="field"><div class="label">${esc(f.label)}</div><div class="stepper" data-k="${f.k}" data-t="stepper" data-min="${f.min}" data-max="${f.max}" data-step="${f.step}"><button type="button" data-d="-1" aria-label="Azalt">−</button><output class="num" aria-live="polite">${cur}</output><button type="button" data-d="1" aria-label="Artır">+</button><span class="muted">${esc(f.unit)}</span></div></div>`; }
    default: return '';
  }
}

export async function runOnboarding(root, { answers, onDone }) {
  const state = { ...answers };
  let i = 0;
  let busy = false;

  function collect(step) {
    const patch = {};
    for (const f of step.fields || []) {
      const wrap = $(`[data-k="${f.k}"]`, root);
      if (!wrap) continue;
      if (f.t === 'num') { const x = wrap.value; if (x !== '') patch[f.k] = Number(x); }
      else if (f.t === 'text' || f.t === 'area' || f.t === 'time') { if (wrap.value.trim()) patch[f.k] = wrap.value.trim(); }
      else if (f.t === 'stepper') patch[f.k] = Number($('output', wrap).textContent);
      else if (state[f.k] !== undefined) patch[f.k] = state[f.k];
    }
    return patch;
  }
  const draw = () => {
    const step = STEPS[i];
    const pct = Math.round((i / (STEPS.length - 1)) * 100);
    root.innerHTML = `<div class="fade-in">
      <div class="topbar"><button class="back" data-nav="back" aria-label="Geri" ${i === 0 ? 'hidden' : ''}>${icons.back}</button><div class="grow stack-sm"><div class="t-cap num">Adım ${i + 1} / ${STEPS.length}</div>${bar(pct)}</div></div>
      <div class="stack-lg">
        <div class="stack-sm"><h1 class="t-large">${esc(step.title)}</h1>${step.sub ? `<p class="muted m0">${esc(step.sub)}</p>` : ''}</div>
        ${step.summary ? '<div id="sum" class="stack"><div class="row"><div class="spinner"></div><span class="muted">Seni tanıyorum…</span></div></div>' : `<div class="stack">${step.fields.map((f) => fieldHtml(f, state[f.k])).join('')}</div>`}
        <div class="stack-sm">${step.summary ? '' : `<button class="btn primary block" data-nav="next" ${step.required && !state.goals?.length && !state.free_text ? 'disabled' : ''}>Devam</button>${step.required ? '' : '<button class="btn ghost block" data-nav="skip">Atla</button>'}`}</div>
        <div class="err" id="err" role="alert"></div>
      </div></div>`;
    dyn(root); window.scrollTo(0, 0);
    if (step.summary) loadSummary();
  };

  async function save(patch) {
    if (!Object.keys(patch).length) return;
    Object.assign(state, patch);
    await api('PUT', '/api/profile', patch);
  }
  async function loadSummary() {
    const box = $('#sum', root);
    try {
      const { summary } = await api('POST', '/api/onboarding/analyze');
      box.innerHTML = `<div class="card soft stack-sm"><div class="t-title">${esc(summary.headline)}</div></div>
        <div class="card stack-sm"><div class="t-over">90 gün sonunda</div>${summary.outcomes.map((o) => `<div class="row"><span class="badge">${icons.check.replace('<svg', '<svg width="14" height="14"')}</span><span>${esc(o)}</span></div>`).join('')}</div>
        ${summary.focus_notes?.length ? `<div class="card flat stack-sm"><div class="t-over">Odak notları</div>${summary.focus_notes.map((o) => `<div class="muted">• ${esc(o)}</div>`).join('')}</div>` : ''}
        <button class="btn primary block" data-nav="generate">Planımı oluştur</button>
        <p class="t-cap center m0">Bu bir sağlık tavsiyesi değildir; alışkanlık odaklı genel bir programdır.</p>`;
    } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div><button class="btn line block" data-nav="back">Geri dön</button>`; }
  }

  root.onclick = async (e) => {
    const chip = e.target.closest('.chip, .scale button, .stepper button');
    if (chip) {
      const wrap = chip.closest('[data-k]'); const k = wrap.dataset.k; const t = wrap.dataset.t;
      if (t === 'stepper') {
        const out = $('output', wrap); const s = Number(wrap.dataset.step); const nv = Math.min(Number(wrap.dataset.max), Math.max(Number(wrap.dataset.min), Number(out.textContent) + s * Number(chip.dataset.d)));
        out.textContent = String(nv); state[k] = nv; return;
      }
      const val = JSON.parse(chip.dataset.v);
      if (t === 'multi') {
        const cur = new Set(state[k] || []);
        if (cur.has(val)) cur.delete(val); else { if (wrap.dataset.max && cur.size >= Number(wrap.dataset.max)) return; cur.add(val); }
        state[k] = [...cur]; chip.setAttribute('aria-pressed', String(cur.has(val)));
      } else {
        state[k] = state[k] === val ? undefined : val; if (state[k] === undefined) delete state[k];
        $$('button', wrap).forEach((b) => b.setAttribute('aria-pressed', String(state[k] !== undefined && JSON.parse(b.dataset.v) === state[k])));
      }
      if (STEPS[i].required) $('[data-nav="next"]', root).disabled = !(state.goals?.length || state.free_text);
      return;
    }
    const nav = e.target.closest('[data-nav]')?.dataset.nav;
    if (!nav || busy) return;
    const step = STEPS[i]; const err = $('#err', root);
    try {
      busy = true;
      if (nav === 'back') { if (i > 0) { if (!step.summary) await save(collect(step)); i--; draw(); } }
      else if (nav === 'skip') { i++; draw(); }
      else if (nav === 'next') { await save(collect(step)); i++; draw(); }
      else if (nav === 'generate') {
        root.innerHTML = '<div class="hero stack center"><div class="spinner"></div><h1 class="t-title">Planını hazırlıyorum</h1><p class="muted">90 günlük programın senin hayatına göre şekilleniyor…</p></div>';
        await api('POST', '/api/plan/generate'); await onDone();
      }
    } catch (ex) {
      if (nav === 'generate') { draw(); }
      const m = ex instanceof HttpError ? ex.message : 'Bağlantı sorunu, tekrar dene';
      const er = $('#err', root); if (er) er.textContent = m; else if (err) err.textContent = m;
    } finally { busy = false; }
  };
  root.oninput = (e) => {
    if (STEPS[i].required && (e.target.dataset.k === 'free_text')) { state.free_text = e.target.value.trim(); $('[data-nav="next"]', root).disabled = !(state.goals?.length || state.free_text); }
  };
  draw();
}
