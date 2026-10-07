'use strict';
// Tarih yardımcıları ('YYYY-MM-DD' stringleri, UTC tabanlı, DST'den bağımsız) ve test için saat override'ı.
const pad = (n) => String(n).padStart(2, '0');
let fakeNow = null;
const clock = {
  now: () => (fakeNow ?? Date.now()),
  set: (ms) => { fakeNow = ms; },
  reset: () => { fakeNow = null; },
};
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
const dow = (s) => (parse(s).getUTCDay() + 6) % 7; // Pzt=0 ... Paz=6
function todayIn(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(clock.now()));
  } catch { return fmt(new Date(clock.now())); }
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const estTokens = (s) => Math.ceil(String(s || '').length / 4);
module.exports = { clock, parse, fmt, addDays, diffDays, dow, todayIn, clamp, round1, avg, estTokens, pad };
