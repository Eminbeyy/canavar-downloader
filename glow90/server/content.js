'use strict';
// AI olmadan çalışan metin/kural içerikleri (fallback) - sade, samimi, yargılamayan dil.
const { lc } = require('./safety');
const { PHASES } = require('./engine');

const KEYWORDS = [
  [/kilo ver|zayıfla|kilomu/, 'lose_weight'], [/yağ (oran|yak)|yağlarımı/, 'reduce_fat'], [/kas |kaslan|güçlen/, 'build_muscle'],
  [/fit |forma|daha iyi görün|vücut/, 'look_fit'], [/kondisyon|dayanıklı|nefes/, 'fitness'], [/uyku|uyu|geç yat/, 'sleep'],
  [/enerji|yorgun|dinç/, 'energy'], [/cilt|sivilce|akne|ışıl/, 'skin'], [/bakım|saç|sakal|stil|kıyafet/, 'selfcare'],
  [/beslen|diyet|yemek|sağlıklı yi/, 'nutrition'], [/disiplin|düzen|alışkanlık|erteleme|motivasyon/, 'discipline'],
  [/adım|yürü/, 'steps'],
];
function goalsFromText(text) {
  const t = ` ${lc(text)} `;
  const out = [];
  for (const [re, g] of KEYWORDS) if (re.test(t) && !out.includes(g)) out.push(g);
  return out;
}
const GOAL_LABEL = {
  lose_weight: 'sürdürülebilir kilo yönetimi', reduce_fat: 'daha dengeli bir vücut kompozisyonu', build_muscle: 'güç ve kas gelişimi',
  look_fit: 'daha fit hissetmek', fitness: 'kondisyon', sleep: 'düzenli uyku', energy: 'gün boyu enerji', skin: 'cilt bakım rutini',
  selfcare: 'kişisel bakım düzeni', nutrition: 'beslenme farkındalığı', discipline: 'disiplin ve alışkanlık', steps: 'günlük hareket', lifestyle: 'genel yaşam düzeni',
};

function analysisFallback(a) {
  const fromText = goalsFromText(a.free_text);
  const goals = [...new Set([...(a.goals || []), ...fromText])];
  const g = goals.length ? goals : ['lifestyle'];
  const disc = a.discipline ?? 5;
  const tol = Math.max(2, Math.min(9, Math.round((disc + (a.minutes_per_day ?? 30) / 15) / 1.6)));
  return {
    headline: `Seni tanıdım: odağın ${GOAL_LABEL[g[0]]}${g[1] ? ` ve ${GOAL_LABEL[g[1]]}` : ''}. Küçük ve sürdürülebilir adımlarla ilerleyeceğiz.`,
    primary_goal: g[0], secondary_goals: g.slice(1, 4),
    outcomes: g.slice(0, 4).map((x) => `90 gün sonunda ${GOAL_LABEL[x]} konusunda net bir düzen`),
    focus_notes: [
      a.days_per_week ? `Haftada ${a.days_per_week} gün, günde ~${a.minutes_per_day ?? 30} dk` : 'Gerçekçi bir tempo',
      a.injuries ? 'Kısıtlamalarına saygı duyan, düşük etkili seçimler' : 'Yavaş başlayıp kademeli artış',
    ],
    difficulty_tolerance: tol, coach_tone: a.coach_tone || 'friendly',
  };
}
function blueprintFallback(a, summary) {
  const first = GOAL_LABEL[summary?.primary_goal || (a.goals || [])[0]] || 'düzenli bir rutin';
  return {
    welcome: `Hazırsın. İlk 30 gün sadece temeli kuruyoruz: ${first} için küçük adımlar.`,
    phases: PHASES.map((p) => ({ phase: p.n, name: p.name, theme: p.theme, focus: p.focus })),
    custom_habits: [],
  };
}
const TONE = {
  gentle: { low: 'Bugün biraz zorlandın, bu çok normal. Yarın programı hafifletiyoruz.', up: 'Çok güzel gidiyorsun. Küçük bir adım ekliyoruz, istersen geri alırız.', ok: 'Dengeli gidiyorsun, aynen devam.' },
  friendly: { low: 'Bu hafta biraz zorlandın. Planı hafiflettik, ritmi geri yakalayacağız.', up: 'Harika bir hafta! Programa küçük bir ilerleme ekledik.', ok: 'Ritmin oturmuş görünüyor. Plan olduğu gibi devam.' },
  strict: { low: 'Plan fazla ağır geldi, sorun değil. Görev sayısını düşürdük; şimdi sözünü tutma zamanı.', up: 'Tutarlısın. Çıtayı biraz kaldırıyoruz.', ok: 'Plan yerinde. Odağını koru.' },
};
function adaptMessage(reason, tone = 'friendly') {
  const t = TONE[tone] || TONE.friendly;
  return reason === 'too_heavy' || reason === 'stress' ? t.low : reason === 'sustainable' ? t.up : t.ok;
}

function weeklyFallback({ best, hardest }) {
  const L = { consistency: 'Düzenlilik', movement: 'Hareket', sleep: 'Uyku', nutrition: 'Beslenme alışkanlıkların', selfcare: 'Kişisel bakım', checkin: 'Check-in' };
  const NEXT = {
    sleep: 'Uyku hedefini 30 dakika erkene çekiyoruz.', movement: 'Antrenman süresini aynı tutup yürüyüşe odaklanıyoruz.',
    nutrition: 'Öğünlerde tek bir küçük hedefe odaklanıyoruz.', selfcare: 'Bakım rutinini daha kısa tutuyoruz.',
    consistency: 'Görev sayısını sadeleştirip düzene odaklanıyoruz.', checkin: 'Check-in\'i 30 saniyeye indiriyoruz.',
  };
  return { best: `${L[best] || 'Düzenin'} bu hafta öne çıktı.`, hardest: `${L[hardest] || 'Genel tempo'} biraz daha zorladı.`, next_week: NEXT[hardest] || 'Aynı tempoda devam ediyoruz.' };
}
function finalFallback(s) {
  const L = { consistency: 'düzenlilik', movement: 'hareket', sleep: 'uyku', nutrition: 'beslenme alışkanlıkları', selfcare: 'kişisel bakım' };
  return {
    started: `Gün 1'de ilerlemen %${s.firstProgress ?? 0} idi; 90 gün sonunda %${s.progress}.`,
    changed: [`${s.totalDone} görevi tamamladın`, `Ortalama tamamlama %${s.completion}`, s.workouts ? `${s.workouts} antrenman yaptın` : 'Hareketi günlüğüne kattın'],
    strongest: `En güçlü alışkanlığın: ${L[s.best] || 'düzenlilik'}.`, hardest: `En çok zorlandığın alan: ${L[s.hardest] || 'tempo'}.`,
    keep: [`${L[s.best] || 'düzenlilik'} rutinini koru`, 'Minimum gün seçeneğini unutma'],
    next_direction: `Sonraki 90 gün için ${L[s.hardest] || 'zorlandığın alanı'} küçük adımlarla güçlendirmek iyi bir yön olabilir.`,
  };
}

const IS = (re, t) => re.test(lc(t));
function coachRule(message, tone = 'friendly') {
  const m = message;
  const S = tone === 'strict';
  if (IS(/bugün.*(spor|antrenman).*(enerji|yok)|enerjim yok|çok yorgun|bitkinim|halsiz/, m))
    return { reply: S ? 'Anlaşıldı. Bugün minimum güne geçtim: 10 dk yürüyüş ve temel görevler yeter. Sözünü minimum seviyede bile tut.' : 'Anlıyorum, bugün enerjin düşük. Seni minimum güne aldım: kısa bir yürüyüş ve temel görevler yeter. Seri korunuyor.', action: 'minimum_today' };
  if (IS(/sınav|yoğunum|yoğun bir|vizem|finalim|programı azalt|hafiflet/, m))
    return { reply: 'Sınav/yoğunluk döneminde plan küçülsün. Yarından itibaren görev sayısını azalttım, sen önce işine odaklan.', action: 'lighten' };
  if (IS(/(\d+)\s*(dk|dakika)/, m) && IS(/program|plan|ver|antrenman/, m))
    return { reply: 'Tamam, bugünü kısa tuttum: sadece temel, kısa görevler. 20 dakikada hallolur.', action: 'quick_20' };
  if (IS(/kaçırdım|yapamadım|aksattım|bıraktım/, m))
    return { reply: 'Sorun değil, ilerlemen silinmedi. Bugün küçük bir adımla geri dön; istersen seni minimum güne alayım. Önemli olan geri dönmen.', action: 'minimum_today' };
  if (IS(/çok yedim|fazla yedim|kaçamak|abarttım/, m))
    return { reply: 'Bir öğün ya da bir gün her şeyi belirlemez. Su iç, kısa bir yürüyüş yap ve bir sonraki öğününe normal devam et. Kendine sert davranma.', action: 'none' };
  if (IS(/harika|çok iyi|kolay geliyor|artır|zorlaştır/, m))
    return { reply: 'Güzel haber! Yarından itibaren programa küçük bir ilerleme ekliyorum. Çok gelirse söylemen yeter.', action: 'boost' };
  return { reply: 'Seni duyuyorum. Bugünkü planına bakıp küçük bir adım seçelim: ilk görevini tamamlamak güzel bir başlangıç olur. Daha fazla ayrıntı verirsen planı ona göre ayarlarım.', action: 'none' };
}
module.exports = { goalsFromText, analysisFallback, blueprintFallback, adaptMessage, weeklyFallback, finalFallback, coachRule, GOAL_LABEL };
