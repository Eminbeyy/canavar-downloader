'use strict';
// Sağlık güvenliği: AI'a gitmeden önce kırmızı bayrak kontrolü + AI çıktısı filtresi. Teşhis/reçete yok.
const lc = (s) => String(s || '').toLocaleLowerCase('tr');
const EMERGENCY = /(göğüs ağrı|nefes alam|bayıl|bayılacak|kalp çarpıntı|kalbim.*(sıkış|ağrı)|intihar|kendime zarar|ölmek istiyor|kan kus|kan tük|felç|şiddetli ağrı|baygın)/;
const EATING = /(kusuyorum|kusmaya çalış|aç kalıyorum|günlerce yemek|hiç yemeyece|500 kalori|600 kalori|800 kalori|yemek yemekten korkuyor|laksatif|yemeden durac)/;
const MEDS = /(ilaç|doz\b|dozunu|antibiyotik|hap kullan|steroid|insülin|reçete)/;
const OUTPUT_BAD = /(teşhis|tanı koy|hastalığın var|\b\d+\s?(mg|miligram)\b|ilacı (bırak|artır|azalt)|dozunu)/;

function screenUserText(text) {
  const t = lc(text);
  if (EMERGENCY.test(t)) return {
    level: 'emergency',
    reply: 'Bunu duyduğuma üzüldüm. Anlattığın belirtiler bir koçun değil, bir sağlık profesyonelinin alanında. Şu an kendini güvende hissetmiyorsan veya belirtiler şiddetliyse hemen 112\'yi (ya da bulunduğun yerin acil numarasını) ara ya da yakınındaki birinden yardım iste. Planı bekletebiliriz; önce sen.',
  };
  if (EATING.test(t)) return {
    level: 'eating',
    reply: 'Seninle burada olmak güzel. Yemekle ilgili anlattıkların bir sağlık profesyoneliyle (doktor veya diyetisyen) konuşulmaya değer. Ben bu konuda yönlendirme yapamam ama plan tarafında yükü hafifletebilirim. Kendine nazik ol.',
  };
  if (MEDS.test(t)) return {
    level: 'meds',
    reply: 'İlaçlarla ilgili sorular için doktoruna veya eczacına danışmalısın; ben ilaç ya da doz konusunda öneri veremem. Alışkanlık planında sana yardımcı olabilirim.',
  };
  return null;
}
const outputIsSafe = (text) => !OUTPUT_BAD.test(lc(text));
// Şemadaki tüm string değerleri tarar
function deepSafe(v) {
  if (typeof v === 'string') return outputIsSafe(v);
  if (Array.isArray(v)) return v.every(deepSafe);
  if (v && typeof v === 'object') return Object.values(v).every(deepSafe);
  return true;
}
module.exports = { screenUserText, outputIsSafe, deepSafe, lc };
