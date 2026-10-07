'use strict';
// Küçük JSON-Schema alt kümesi doğrulayıcı (sıfır bağımlılık).
// Desteklenen: type, enum, properties, required, additionalProperties:false, items, min/maxItems,
// min/maxLength, minimum/maximum, pattern. Hem API girdisi hem AI çıktısı için kullanılır.
function validate(schema, value, path = '$') {
  const errs = [];
  walk(schema, value, path, errs);
  return errs;
}
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}
function walk(s, v, p, errs) {
  if (s.type) {
    const t = typeOf(v);
    const ok = s.type === t || (s.type === 'number' && t === 'integer') ||
      (Array.isArray(s.type) && (s.type.includes(t) || (t === 'integer' && s.type.includes('number'))));
    if (!ok) { errs.push(`${p}: ${Array.isArray(s.type) ? s.type.join('|') : s.type} bekleniyordu`); return; }
  }
  if (s.enum && !s.enum.includes(v)) errs.push(`${p}: geçersiz değer`);
  if (typeof v === 'string') {
    if (s.minLength != null && v.length < s.minLength) errs.push(`${p}: çok kısa`);
    if (s.maxLength != null && v.length > s.maxLength) errs.push(`${p}: çok uzun`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) errs.push(`${p}: biçim geçersiz`);
  }
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) errs.push(`${p}: çok küçük`);
    if (s.maximum != null && v > s.maximum) errs.push(`${p}: çok büyük`);
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) errs.push(`${p}: en az ${s.minItems} öğe`);
    if (s.maxItems != null && v.length > s.maxItems) errs.push(`${p}: en fazla ${s.maxItems} öğe`);
    if (s.items) v.forEach((x, i) => walk(s.items, x, `${p}[${i}]`, errs));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of s.required || []) if (!(k in v)) errs.push(`${p}.${k}: zorunlu`);
    const props = s.properties || {};
    for (const [k, sub] of Object.entries(props)) if (k in v) walk(sub, v[k], `${p}.${k}`, errs);
    if (s.additionalProperties === false) for (const k of Object.keys(v)) if (!(k in props)) errs.push(`${p}.${k}: bilinmeyen alan`);
  }
}
module.exports = { validate };
