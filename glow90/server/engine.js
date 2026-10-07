'use strict';
// Deterministik plan motoru: AI gerektirmeyen her şey burada (plan, günlük görevler, adaptasyon kuralları).
const { addDays, dow, clamp } = require('./util');

const PHASES = [
  { n: 1, key: 'reset', name: 'RESET', from: 1, to: 30, theme: 'Temel alışkanlıklar', focus: 'Küçük, kolay adımlarla düzeni kuruyoruz.' },
  { n: 2, key: 'build', name: 'BUILD', from: 31, to: 60, theme: 'Yoğunluğu kademeli artır', focus: 'Oturan alışkanlıkların üstüne yavaşça ekliyoruz.' },
  { n: 3, key: 'transform', name: 'TRANSFORM', from: 61, to: 90, theme: 'Sürdürebileceğin güçlü rutin', focus: 'Sana ait, uzun vadede sürdürülebilir bir sistem.' },
];
const phaseOf = (day) => PHASES[day <= 30 ? 0 : day <= 60 ? 1 : 2];
const PW = { high: 3, med: 2, low: 1 };
const MOVE_GOALS = ['lose_weight', 'reduce_fat', 'build_muscle', 'look_fit', 'fitness', 'steps', 'energy'];
const FOOD_GOALS = ['lose_weight', 'reduce_fat', 'build_muscle', 'nutrition', 'look_fit', 'energy'];

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// Onboarding cevaplarından plan bağlamı çıkar (eksikler güvenli varsayılanlarla).
function deriveCtx(a = {}, overrides = {}) {
  const goals = a.goals?.length ? a.goals : ['lifestyle'];
  if (overrides.primary_goal && !goals.includes(overrides.primary_goal)) goals.unshift(overrides.primary_goal);
  const days = clamp(a.days_per_week ?? 3, 1, 7);
  const minutes = clamp(a.minutes_per_day ?? 30, 10, 120);
  const busy = new Set(a.busy_days || []);
  const bmi = a.height_cm && a.weight_kg ? a.weight_kg / ((a.height_cm / 100) ** 2) : null;
  const flags = [];
  let loseWeight = goals.some((g) => g === 'lose_weight' || g === 'reduce_fat');
  if (loseWeight && ((a.age && a.age < 18) || (bmi && bmi < 18.5))) {
    loseWeight = false; flags.push('no_weight_loss');
  }
  if (a.injuries && a.injuries.trim().length > 2) flags.push('injury');
  const lowImpact = flags.includes('injury');
  const equipment = a.has_gym ? 'gym' : (a.home_equipment || []).some((e) => e === 'dumbbell' || e === 'bands') ? 'dumbbell' : 'bodyweight';
  const selfcare = a.selfcare || [];
  const sleepHours = a.sleep_hours ?? 7;
  const cats = {
    movement: goals.some((g) => MOVE_GOALS.includes(g) || g === 'lifestyle' || g === 'discipline'),
    nutrition: goals.some((g) => FOOD_GOALS.includes(g) || g === 'lifestyle' || g === 'discipline'),
    sleep: goals.some((g) => g === 'sleep' || g === 'energy' || g === 'lifestyle' || g === 'discipline') || (a.sleep_quality ?? 10) <= 5 || sleepHours < 6.5,
    selfcare: goals.some((g) => g === 'skin' || g === 'selfcare') || selfcare.length > 0,
  };
  // Hiç kategori seçilmediyse en azından hareket + uyku olsun
  if (!Object.values(cats).some(Boolean)) { cats.movement = true; cats.sleep = true; }
  // Gün en az 3 görev içersin: yalnızca bakım/uyku seçildiyse temel beslenme (su vb.) eklenir.
  if (!cats.movement && !cats.nutrition) cats.nutrition = true;
  const discipline = a.discipline ?? 5;
  let baseLevel = 4;
  if (discipline <= 4 || minutes <= 20 || a.quick_drop) baseLevel = 3;
  if (discipline >= 8 && minutes >= 45) baseLevel = 5;
  if (a.coach_tone === 'gentle' && discipline <= 3) baseLevel = 2;
  const workoutDays = pickWorkoutDays(days, busy);
  return {
    goals, primary: overrides.primary_goal || goals[0], minutes, days, busy, workoutDays, equipment, lowImpact, flags, cats, selfcare,
    bedtime: a.bedtime || '23:30', waketime: a.waketime || '07:00', sleepHours, quality: a.sleep_quality ?? 7,
    phoneInBed: !!a.phone_in_bed, caffeine: a.caffeine || 'low', nightEating: !!a.night_eating, sweets: a.sweets || 'weekly',
    breakfast: a.breakfast || 'sometimes', cooking: a.cooking || 'limited', canWalk: a.can_walk !== false,
    canSwim: !!a.can_swim, hasBike: !!a.has_bike, likes: (a.likes || []).join(' ').toLowerCase(),
    dislikes: (a.dislikes || []).join(' ').toLowerCase(), heavy: (a.weight_kg || 70) > 90, baseLevel, tone: a.coach_tone || 'friendly',
    loseWeight, discipline, taskStyle: a.task_style || 'short', age: a.age || null,
    extra: overrides.custom_habits || [],
  };
}

// Haftada `days` antrenman günü: yoğun günlerden kaçın, aralarını aç.
function pickWorkoutDays(days, busy) {
  const ideal = { 1: [2], 2: [1, 4], 3: [0, 2, 4], 4: [0, 1, 3, 5], 5: [0, 1, 3, 4, 5], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] }[days];
  const out = ideal.filter((d) => !busy.has(d));
  for (let d = 0; d < 7 && out.length < Math.min(days, 7 - busy.size); d++) if (!out.includes(d) && !busy.has(d)) out.push(d);
  return new Set(out.length ? out : [ideal[0]]);
}

const LEVEL_SCALE = [0.6, 0.8, 1, 1.1, 1.2];
const mainCount = (level, phaseN) => clamp(level + 2 + (phaseN >= 2 && level >= 3 ? 1 : 0), 3, 8);

function workoutFor(ctx, phaseN, k, level) {
  const base = [20, 30, 40][phaseN - 1];
  const minutes = clamp(Math.round(Math.min(base, Math.max(ctx.minutes - 5, 10)) * LEVEL_SCALE[level - 1] / 5) * 5, 10, 90);
  const rot = {
    gym: ['Salon: üst vücut gücü', 'Salon: alt vücut gücü', 'Salon: tüm vücut + hafif kardiyo'],
    dumbbell: ['Dumbbell: üst vücut', 'Dumbbell: alt vücut + core', 'Dumbbell: tüm vücut devre'],
    bodyweight: ['Vücut ağırlığı: tüm vücut', ctx.canWalk ? 'Tempolu yürüyüş' : 'Hafif tempolu hareket', 'Core ve mobilite'],
  }[ctx.equipment];
  let title = rot[k % 3];
  if (k % 3 === 2 || ctx.equipment === 'bodyweight') {
    if (ctx.canSwim && ctx.likes.includes('yüz')) title = 'Yüzme';
    else if (ctx.hasBike && ctx.likes.includes('bisiklet')) title = 'Bisiklet';
    else if (!ctx.lowImpact && ctx.likes.includes('koşu') && k % 3 === 2) title = 'Hafif tempo koşu';
  }
  return {
    key: 'workout', title: `${title} · ${minutes} dk`, category: 'movement',
    type: 'workout', priority: 'high', minutes, minimum_version: '10 dk hafif hareket veya esneme', is_min: 1,
    note: ctx.lowImpact ? 'Ağrı hissedersen bırak. Bilinen bir kısıtlaman varsa önce doktoruna danış.' : 'Isınmayı atlama; zorlanırsan süreyi kısalt.',
  };
}

// Tek bir günün aday görevleri (öncelik sırasına göre).
function candidates(ctx, day, date, level, phaseN) {
  const w = dow(date);
  const out = [];
  const T = (o) => out.push({ type: 'habit', priority: 'med', optional: 0, is_min: 0, minutes: null, note: null, ...o });
  const weekIdx = Math.floor((day - 1) / 7);
  if (ctx.cats.movement) {
    const steps = Math.max(4000, Math.round((5000 + 1000 * (phaseN - 1) + 500 * (level - 3)) / 500) * 500);
    T(ctx.canWalk
      ? { key: 'steps', title: `${String(steps).replace(/\B(?=(\d{3})+$)/g, '.')} adım`, category: 'movement', priority: 'high', minimum_version: '10 dk yürüyüş', is_min: 1 }
      : { key: 'steps', title: 'Gün içinde 15 dk hareket et', category: 'movement', priority: 'high', minimum_version: '5 dk esneme', is_min: 1 });
    if (ctx.workoutDays.has(w)) {
      const k = Math.floor(weekIdx * ctx.days + [...ctx.workoutDays].sort().indexOf(w));
      out.push({ optional: 0, ...workoutFor(ctx, phaseN, k, level) });
    } else {
      T({ key: 'mobility', title: '8 dk esneme / mobilite', category: 'movement', priority: 'low', minutes: 8, optional: 1, minimum_version: '3 dk esneme' });
    }
  }
  if (ctx.cats.nutrition || ctx.cats.movement) {
    T({ key: 'water', title: `${ctx.heavy ? '2,5' : '2'} litre su`, category: 'nutrition', priority: 'high', minimum_version: '1,5 litre su', is_min: 1 });
  }
  if (ctx.cats.nutrition) {
    T({ key: 'protein', title: 'Ana öğünlerde protein ekle', category: 'nutrition', priority: 'med', minimum_version: 'En az bir öğünde protein' });
    T({ key: 'veg', title: 'Öğünlerine sebze veya meyve ekle', category: 'nutrition', priority: 'low', minimum_version: 'Günde bir porsiyon sebze/meyve' });
    if (ctx.breakfast === 'never' && ctx.goals.some((g) => g === 'energy' || g === 'nutrition')) {
      T({ key: 'breakfast', title: 'Basit bir kahvaltı yap', category: 'nutrition', priority: 'med', minimum_version: 'Bir meyve veya yoğurt' });
    }
    if (ctx.nightEating && phaseN >= 1) {
      T({ key: 'nightsnack', title: 'Akşam yemeğinden sonra atıştırmayı kapat', category: 'nutrition', priority: 'med', minimum_version: 'Atıştırmayı küçük bir porsiyonla sınırla' });
    }
    if (ctx.sweets === 'daily' && phaseN >= 2) {
      T({ key: 'sweets', title: 'Tatlıyı tek porsiyonla sınırla', category: 'nutrition', priority: 'low', minimum_version: 'Tatlıyı yavaş ye, tek porsiyon' });
    }
    if ((w === 5 || w === 6) && ctx.cooking !== 'no') {
      T({ key: 'mealprep', title: 'Haftanın 2 öğününü önceden hazırla', category: 'nutrition', priority: 'low', optional: 1, minimum_version: '1 öğünü hazırla' });
    }
  }
  if (ctx.cats.sleep) {
    const shift = ctx.sleepHours >= 7.5 ? 0 : [0, 15, 30][phaseN - 1];
    const bed = toHHMM(toMin(ctx.bedtime) - shift);
    T({ key: 'bedtime', title: `Saat ${bed}: yatağa hazırlan`, category: 'sleep', priority: 'high', minimum_version: 'Ekranları yatmadan 30 dk önce kapat', is_min: 1 });
    if (ctx.phoneInBed) T({ key: 'screens', title: 'Yatmadan 30 dk önce telefonu bırak', category: 'sleep', priority: 'med', minimum_version: 'Yatakta telefonu 10 dk erken bırak' });
    if (ctx.caffeine === 'high') T({ key: 'caffeine', title: 'Kafeini öğleden sonra bırak (14:00)', category: 'sleep', priority: 'low', minimum_version: 'Akşam kafein alma' });
  }
  if (ctx.cats.selfcare) {
    const sc = ctx.selfcare.length ? ctx.selfcare : ['general'];
    const defs = {
      dental: { title: 'Diş fırçala + diş ipi', minimum_version: 'Dişlerini fırçala', priority: 'med', is_min: 1, minutes: 4 },
      skin: { title: 'Temel cilt rutini (temizle + nemlendir)', minimum_version: 'Yüzünü yıka ve nemlendir', priority: 'med', is_min: 1, minutes: 5, note: 'Süregelen veya şiddetli cilt sorunlarında bir dermatoloğa danış.' },
      hair: { title: 'Saç bakımı', minimum_version: 'Saçını tara/şekillendir', priority: 'low', minutes: 5 },
      beard: { title: 'Sakal/tıraş bakımı', minimum_version: 'Hızlı tıraş veya şekillendirme', priority: 'low', minutes: 5 },
      shower: { title: 'Duş ve vücut bakımı', minimum_version: 'Hızlı duş', priority: 'low', minutes: 10 },
      nails: { title: 'Tırnak bakımı', minimum_version: 'Tırnaklarını kontrol et', priority: 'low', minutes: 5 },
      style: { title: 'Yarın için kombinini hazırla', minimum_version: 'Kıyafetini akşamdan ayır', priority: 'low', minutes: 5 },
      hygiene: { title: 'Kişisel hijyen rutini', minimum_version: 'Temel hijyen adımları', priority: 'low', minutes: 5 },
      posture: { title: '5 dk duruş / omuz mobilitesi', minimum_version: '2 dk omuz çevirme', priority: 'low', minutes: 5 },
      general: { title: '10 dk kişisel bakım', minimum_version: '3 dk kendine ayır', priority: 'med', minutes: 10, is_min: 1 },
    };
    // Her gün diş (seçildiyse), kalanlar günlere döngüsel dağılır.
    const rot = sc.filter((c) => c !== 'dental');
    const pick = [];
    if (sc.includes('dental')) pick.push('dental');
    if (rot.length) pick.push(rot[(day - 1) % rot.length]);
    if (rot.length > 1 && level >= 4) pick.push(rot[(day) % rot.length]);
    [...new Set(pick)].forEach((c, i) => {
      const d = defs[c];
      T({ key: `care_${c}`, category: 'selfcare', type: 'habit', optional: i >= 2 ? 1 : 0, ...d });
    });
  }
  if (ctx.goals.includes('discipline')) {
    T({ key: 'tomorrow', title: 'Yarın için tek net hedef yaz (2 dk)', category: 'habit', priority: 'low', minimum_version: 'Yarının tek önceliğini düşün' });
  }
  for (const [i, h] of ctx.extra.entries()) {
    T({ key: `custom${i}`, title: h.title, category: h.category, priority: 'med', minimum_version: h.minimum_version });
  }
  return out;
}

// Seçim: önce her aktif kategoriden en iyi görev (hedefe göre sıralı), sonra kalan öncelik.
function generateDay(ctx, day, date, level) {
  const phaseN = phaseOf(day).n;
  const all = candidates(ctx, day, date, level, phaseN);
  const required = all.filter((t) => !t.optional);
  const optionalPool = all.filter((t) => t.optional);
  const n = mainCount(level, phaseN);
  const relevance = (cat) => (ctx.goals.some((g) => ({ movement: MOVE_GOALS, nutrition: FOOD_GOALS, sleep: ['sleep', 'energy'], selfcare: ['skin', 'selfcare'] }[cat] || []).includes(g)) ? 1 : 0);
  const byScore = (t) => PW[t.priority] * 10 + relevance(t.category) * 3 + (t.is_min ? 2 : 0);
  const sorted = [...required].sort((a, b) => byScore(b) - byScore(a));
  const chosen = [];
  const seenCat = new Set();
  const cats = [...new Set(sorted.map((t) => t.category))].sort((a, b) => relevance(b) - relevance(a));
  for (const c of cats) { if (chosen.length >= n) break; const t = sorted.find((x) => x.category === c); chosen.push(t); seenCat.add(t.key); }
  for (const t of sorted) { if (chosen.length >= n) break; if (!seenCat.has(t.key)) { chosen.push(t); seenCat.add(t.key); } }
  // Güvence: gün en az 3 ana görev içersin (opsiyonelleri yükselt)
  for (const t of optionalPool) { if (chosen.length >= 3) break; if (!seenCat.has(t.key)) { chosen.push({ ...t, optional: 0 }); seenCat.add(t.key); } }
  // Seçilmeyenler (level>=3) opsiyonel olarak gösterilir, en fazla 2.
  const extras = level >= 3 ? [...sorted.filter((t) => !seenCat.has(t.key)), ...optionalPool.filter((t) => !seenCat.has(t.key))].slice(0, 2).map((t) => ({ ...t, optional: 1 })) : [];
  const order = (t) => ({ movement: 0, nutrition: 1, sleep: 3, selfcare: 2, habit: 4 }[t.category] ?? 5);
  const main = chosen.sort((a, b) => order(a) - order(b));
  // Minimum set: en fazla 4, en az 2 görev
  let mins = main.filter((t) => t.is_min).slice(0, 4);
  if (mins.length < 2) mins = [...mins, ...main.filter((t) => !t.is_min).slice(0, 2 - mins.length)];
  const minKeys = new Set(mins.map((t) => t.key));
  return [...main.map((t) => ({ ...t, is_min: minKeys.has(t.key) ? 1 : 0 })), ...extras.map((t) => ({ ...t, is_min: 0 }))];
}

function generateDays(ctx, startDate, level, fromDay = 1) {
  const days = [];
  for (let d = fromDay; d <= 90; d++) {
    const date = addDays(startDate, d - 1);
    days.push({ day: d, date, phase: phaseOf(d).n, tasks: generateDay(ctx, d, date, level) });
  }
  return days;
}

// Plan notları (teşhis değil, güvenli çerçeve)
function planNotes(ctx) {
  const notes = [];
  if (ctx.flags.includes('no_weight_loss')) notes.push('Kilo verme odaklı görevler eklenmedi; alışkanlık ve enerji odaklı gidiyoruz. İstersen bir sağlık uzmanıyla konuş.');
  if (ctx.flags.includes('injury')) notes.push('Belirttiğin kısıtlamayı dikkate aldık: düşük etkili hareketler öneriyoruz. Ağrı olursa dur ve uzmana danış.');
  return notes;
}

// ---- Adaptasyon (kural tabanlı) ----
// Son 7 günün tamamlama oranına göre seviye değişimi: -1 / 0 / +1
function adaptDecision({ completion7, daysObserved, level, stressAvg, lastAdaptGap }) {
  if (daysObserved < 4) return { change: 0, reason: 'not_enough_data' };
  if (lastAdaptGap != null && lastAdaptGap < 3) return { change: 0, reason: 'cooldown' };
  if (completion7 < 0.5 && level > 1) return { change: -1, reason: 'too_heavy' };
  if (completion7 < 0.65 && (stressAvg ?? 0) >= 7 && level > 1) return { change: -1, reason: 'stress' };
  if (completion7 >= 0.9 && level < 5) return { change: +1, reason: 'sustainable' };
  return { change: 0, reason: 'steady' };
}

module.exports = { PHASES, phaseOf, deriveCtx, generateDay, generateDays, planNotes, adaptDecision, mainCount, toHHMM, toMin };
