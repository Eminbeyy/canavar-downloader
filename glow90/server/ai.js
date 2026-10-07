'use strict';
// Sunucu tarafı AI katmanı: görev başına küçük prompt, JSON şema (tool use), doğrulama, önbellek, günlük limit, kural tabanlı fallback.
// API anahtarı yalnızca ortam değişkeninde (ANTHROPIC_API_KEY); istemciye asla gitmez.
const crypto = require('node:crypto');
const { q } = require('./db');
const { validate } = require('./validate');
const { deepSafe } = require('./safety');
const schemas = require('./schemas');
const { estTokens, clock } = require('./util');

const MODEL = process.env.GLOW90_MODEL || 'claude-haiku-5-5';
const DAILY_LIMIT = Number(process.env.GLOW90_AI_DAILY_LIMIT || 30);
const SAFETY = 'Teşhis, ilaç/doz önerisi, aşırı kalori kısıtlaması veya tehlikeli egzersiz verme. Yargılama. Kısa, samimi, sade Türkçe yaz.';
const SYSTEM = {
  ONBOARDING_ANALYSIS: `Kullanıcının onboarding özetini hedeflere dönüştür. ${SAFETY}`,
  PLAN_GENERATION: `90 günlük planın 3 faz teması (RESET/BUILD/TRANSFORM), kısa hoş geldin mesajı ve en fazla 2 kişisel alışkanlık üret. Sağlık iddiası kurma. ${SAFETY}`,
  DAILY_ADAPTATION: `Plan küçük bir ayar gördü. Kullanıcıya tek-iki cümlelik, yargılamayan bir bilgilendirme yaz. ${SAFETY}`,
  WEEKLY_REVIEW: `Haftalık özet: en iyi yapılan, en zorlanılan, gelecek hafta tek odak. Her biri tek kısa cümle. ${SAFETY}`,
  COACH_CHAT: `Sen GLOW90 koçusun. Kullanıcının mesajına kısa yanıt ver ve gerekirse tek bir plan eylemi seç (none|minimum_today|lighten|boost|quick_20). Ciddi belirti anlatılırsa sağlık profesyoneline yönlendir. ${SAFETY}`,
  FINAL_REPORT: `90 günlük sonuç raporu: motive edici ama gerçekçi. Verilen sayılara sadık kal. ${SAFETY}`,
};

const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const todayUtc = () => new Date(clock.now()).toISOString().slice(0, 10);

function usageToday(db, uid) {
  const r = q.get(db, "SELECT COUNT(*) c FROM ai_events WHERE user_id=? AND source='ai' AND created_at>=?", uid, todayUtc());
  return { used: r.c, limit: DAILY_LIMIT };
}
function logEvent(db, uid, type, source, inTok, outTok) {
  q.run(db, 'INSERT INTO ai_events(user_id,event_type,model,source,input_token_estimate,output_token_estimate,created_at) VALUES(?,?,?,?,?,?,?)',
    uid, type, source === 'ai' ? MODEL : null, source, inTok, outTok, new Date(clock.now()).toISOString());
}

async function callAnthropic(type, payload, schema) {
  const key = process.env.ANTHROPIC_API_KEY;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await (module.exports.fetchImpl || fetch)('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: type === 'COACH_CHAT' ? 500 : 900, system: SYSTEM[type],
        tools: [{ name: 'respond', description: 'Yapılandırılmış yanıt', input_schema: schema }],
        tool_choice: { type: 'tool', name: 'respond' },
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const body = await res.json();
    const block = (body.content || []).find((b) => b.type === 'tool_use');
    if (!block) throw new Error('no tool_use');
    return block.input;
  } finally { clearTimeout(timer); }
}

/**
 * type: schemas.ai anahtarı; payload: yalnızca gereken kompakt özet; fallback: () => deterministik sonuç.
 * cache=false → sohbet gibi tekrar etmeyen çağrılar.
 */
async function run(db, { uid, type, payload, fallback, cache = true }) {
  const schema = schemas.ai[type];
  const key = hash([type, payload]);
  if (cache) {
    const hit = q.get(db, 'SELECT value FROM ai_cache WHERE key=?', key);
    if (hit) { logEvent(db, uid, type, 'cache', 0, 0); return { data: JSON.parse(hit.value), source: 'cache' }; }
  }
  const useAi = !!process.env.ANTHROPIC_API_KEY && usageToday(db, uid).used < DAILY_LIMIT;
  if (useAi) {
    try {
      const out = await callAnthropic(type, payload, schema);
      const errs = validate(schema, out);
      if (errs.length === 0 && deepSafe(out)) {
        if (cache) q.run(db, 'INSERT OR REPLACE INTO ai_cache(key,type,value,created_at) VALUES(?,?,?,?)', key, type, JSON.stringify(out), new Date(clock.now()).toISOString());
        logEvent(db, uid, type, 'ai', estTokens(JSON.stringify(payload)) + estTokens(SYSTEM[type]), estTokens(JSON.stringify(out)));
        return { data: out, source: 'ai' };
      }
    } catch (e) { if (process.env.GLOW90_DEBUG) console.error('[ai]', type, e.message); }
  }
  const data = fallback();
  logEvent(db, uid, type, 'rule', 0, 0);
  return { data, source: 'rule' };
}

module.exports = { run, usageToday, MODEL, hash, fetchImpl: null };
