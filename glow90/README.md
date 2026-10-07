# GLOW90 — 90 günlük kişisel alışkanlık koçu (MVP)

Sıfır bağımlılık: Node ≥ 22.13 (yerleşik `node:sqlite`, `fetch`, `node:test`) + vanilla JS PWA. `npm install` gerekmez.

```bash
cd glow90
npm start            # http://localhost:3000
npm test             # 25 birim/entegrasyon testi
ANTHROPIC_API_KEY=sk-... npm start   # AI açık (yoksa kural tabanlı mod; uygulama yine tam çalışır)
```

Ortam değişkenleri: `PORT`, `GLOW90_DB` (varsayılan `data/glow90.db`), `ANTHROPIC_API_KEY`, `GLOW90_MODEL` (varsayılan `claude-haiku-5-5`),
`GLOW90_AI_DAILY_LIMIT` (kullanıcı/gün, varsayılan 30), `GLOW90_TRUST_PROXY=1` (proxy arkasında), `GLOW90_DEBUG=1`.

## Mimari (kısa)
| Katman | Dosya | Not |
|---|---|---|
| Plan motoru (AI yok) | `server/engine.js` | 3 faz × 90 gün, günde 3–8 görev, minimum gün seti, güvenlik bayrakları, adaptasyon kuralı |
| Çekirdek | `server/core.js` | plan kaydı, ilerleme %, seri (toparlanma günü), trendler, check-in, adaptasyon |
| AI | `server/ai.js` | sunucu tarafı; tool-use + **JSON şema**, doğrulama, `ai_cache`, günlük limit, fallback |
| Servisler | `server/services.js` | AI + çekirdek birleşimi (özet/kompakt prompt, haftalık/milestone/final rapor) |
| API/Güvenlik | `server/app.js` | scrypt, HttpOnly SameSite=Strict çerez, CSRF başlığı, rate limit, CSP, girdi doğrulama |
| İstemci | `public/` | design system (`styles.css`), onboarding, ekranlar, çevrimdışı kuyruk, service worker |

### AI kullanımı (maliyet kontrolü)
AI yalnızca: onboarding analizi, plan kişiselleştirme katmanı (faz temaları + ≤2 kişisel alışkanlık), adaptasyon mesajı, haftalık yorum, koç sohbeti, 90 gün raporu.
Yüzde, seri, görev, tarih, grafik, adaptasyon **kararı** normal koddur. Her çağrı kısa özet gönderir (spec §21), sonuç `ai_cache`'te saklanır, sohbet son 4 mesaj + özetle sınırlıdır.
Teşhis/ilaç/doz/acil durum anahtar kelimeleri AI'a gitmeden yönlendirilir; AI çıktısı filtrelenir.

### Bilinen sınırlar / V2
- Bildirimler: ayarlar + spam korumalı plan API'si + uygulama açıkken zamanlayıcı/service worker. Uygulama kapalıyken gerçek Web Push (VAPID) V2.
- Fotoğraf takibi, sağlık entegrasyonları, ödeme, sosyal: kapsam dışı (spec §46).
- Veritabanı şifrelemesi: parolalar scrypt ile; SQLite dosyası 0600. Hassas alan şifrelemesi / disk şifreleme dağıtım ortamına bırakıldı.
- Ürün analitiği: `events` tablosu (takma ad hash, sağlık verisi yok), özet için `node scripts/stats.js`.
- `node scripts/e2e.js` (opsiyonel, global Playwright gerekir): tarayıcıda uçtan uca akış + ekran görüntüleri.

> GLOW90 bir alışkanlık koçudur; tıbbi tavsiye, teşhis veya tedavi sunmaz.
