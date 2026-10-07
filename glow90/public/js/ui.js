// Ortak UI yardımcıları: kaçış, ikonlar, halka, sheet, toast. CSP (inline stil yok) nedeniyle dinamik değerler data-* ile verilir.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icons = {
  today: P('<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.3 2.4 2.4 4.6-5"/>'),
  plan: P('<rect x="4" y="5.5" width="16" height="14" rx="3"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/>'),
  progress: P('<path d="M5 19V11M12 19V5M19 19v-6"/>'),
  coach: P('<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15h-.5A1.5 1.5 0 0 1 5 13.5z"/>'),
  profile: P('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c.8-3.2 3.6-5 7-5s6.2 1.8 7 5"/>'),
  check: P('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  back: P('<path d="m14.5 5-7 7 7 7"/>'),
  send: P('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  flame: P('<path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.2 1 2 2 2 0-3-1-5 1-8z"/>'),
};

const C = 2 * Math.PI * 44;
export function ring(pct, label, sm = false) {
  return `<div class="ring ${sm ? 'sm' : ''}" role="img" aria-label="${esc(label || 'İlerleme')} yüzde ${pct}"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="44"/><circle class="val" cx="50" cy="50" r="44" data-ring="${pct}"/></svg><div class="center-txt"><div class="big num">${pct}<span class="t-cap">%</span></div></div></div>`;
}
// data-w → genişlik, data-ring → halka
export function dyn(root = document) {
  $$('[data-w]', root).forEach((e) => { e.style.width = `${Math.max(0, Math.min(100, Number(e.dataset.w)))}%`; });
  $$('[data-ring]', root).forEach((e) => {
    e.style.strokeDasharray = String(C);
    e.style.strokeDashoffset = String(C);
    requestAnimationFrame(() => { e.style.strokeDashoffset = String(C * (1 - Number(e.dataset.ring) / 100)); });
  });
}
export const bar = (pct) => `<div class="bar"><i data-w="${pct}"></i></div>`;

let toastTimer;
export function toast(msg) {
  $('.toast')?.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2600);
}
export function sheet(html, onMount) {
  const s = document.createElement('div'); s.className = 'scrim';
  s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div>`;
  const close = () => { s.remove(); document.body.style.overflow = ''; };
  s.addEventListener('click', (e) => { if (e.target === s) close(); });
  document.addEventListener('keydown', function esc_(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc_); } });
  document.body.append(s); document.body.style.overflow = 'hidden';
  dyn(s); onMount?.(s, close);
  return close;
}
export const CAT = { movement: 'Hareket', nutrition: 'Beslenme', sleep: 'Uyku', selfcare: 'Bakım', habit: 'Alışkanlık' };
export const SCORE_LABEL = { consistency: 'Consistency', movement: 'Movement', sleep: 'Sleep', nutrition: 'Nutrition Habits', selfcare: 'Self Care', checkin: 'Check-in' };
export const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
