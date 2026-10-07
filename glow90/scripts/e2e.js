// Opsiyonel uçtan uca tarayıcı testi (Playwright global kuruluysa): node scripts/e2e.js [baseUrl] [screenshotDir]
// Repo bağımlılığı değildir; yalnızca doğrulama içindir.
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:3111';
const shots = process.argv[3] || '/tmp';
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  const shot = async (n) => { await page.waitForTimeout(450); return page.screenshot({ path: `${shots}/${n}.png` }); };
  const email = `e2e${Date.now()}@test.co`;

  await page.goto(base); await page.waitForSelector('#af');
  await shot('01-auth');
  await page.click('#sw'); await page.fill('#em', email); await page.fill('#pw', 'password123'); await page.click('button[type=submit]');

  // Onboarding
  await page.waitForSelector('text=Seni tanıyalım');
  await page.fill('#f_age', '29'); await page.fill('#f_height_cm', '175'); await page.fill('#f_weight_kg', '82');
  await shot('02-onb1'); await page.click('[data-nav=next]');
  await page.waitForSelector('text=Hedeflerin');
  assert.equal(await page.locator('[data-nav=next]').isDisabled(), true);
  await page.click('.chip:has-text("Kilo vermek")'); await page.click('.chip:has-text("Daha düzenli uyumak")'); await page.click('.chip:has-text("Cilt bakım rutini")');
  await page.fill('#f_free_text', 'Daha enerjik ve düzenli olmak istiyorum');
  await shot('03-onb2'); await page.click('[data-nav=next]');
  await page.waitForSelector('text=Zamanın');
  await page.click('[data-k=days_per_week] .chip:has-text("3")'); await page.click('[data-k=minutes_per_day] .chip:has-text("30 dk")'); await page.click('[data-nav=next]');
  await page.waitForSelector('text=Hareket'); await page.click('[data-k=has_gym] .chip:has-text("Hayır")'); await page.click('[data-nav=next]');
  await page.waitForSelector('text=Beslenme'); await page.click('[data-nav=skip]');
  await page.waitForSelector('text=Uyku ve enerji'); await page.fill('#f_bedtime', '00:00'); await page.click('[data-k=sleep_quality] button:has-text("5")'); await page.click('[data-nav=next]');
  await page.waitForSelector('text=Kişisel bakım'); await page.click('.chip:has-text("Cilt")'); await page.click('.chip:has-text("Diş")'); await page.click('[data-nav=next]');
  await page.waitForSelector('text=Motivasyonun'); await page.click('[data-k=discipline] button:has-text("6")'); await page.click('[data-k=coach_tone] .chip:has-text("Samimi")'); await page.click('[data-nav=next]');
  await page.waitForSelector('text=Hazırız'); await page.waitForSelector('[data-nav=generate]');
  await shot('04-summary'); await page.click('[data-nav=generate]');

  // Bugün
  await page.waitForSelector('text=Glow Progress'); await page.waitForSelector('.task');
  await shot('05-today');
  const n = await page.locator('.card.tasks .task').count(); assert.ok(n >= 3 && n <= 8, `görev sayısı ${n}`);
  await page.locator('.card.tasks .task').first().click();
  await page.waitForSelector('.task[aria-pressed=true]');
  await page.locator('.card.tasks .task').nth(1).click(); await page.waitForTimeout(500);
  await shot('06-today-done');

  // Minimum gün
  await page.click('[data-act=mode]'); await page.waitForSelector('text=Minimum gün'); await shot('07-minimum');
  await page.click('[data-act=mode]'); await page.waitForSelector('h2:has-text("Bugün")');

  // Check-in
  await page.click('[data-act=checkin]'); await page.waitForSelector('#ci');
  await page.click('[data-scale=energy] button:has-text("7")'); await shot('08-checkin');
  await page.click('#ci button[type=submit]'); await page.waitForSelector('text=Bugünün check-in');

  // Sekmeler
  for (const [tab, marker, name] of [['plan', 'h1:has-text("Plan")', '09-plan'], ['progress', 'h1:has-text("İlerleme")', '10-progress']]) {
    await page.click(`.tab[href="#/${tab}"]`); await page.waitForSelector(marker); await page.waitForTimeout(400); await shot(name);
  }
  await page.click('.tab[href="#/plan"]'); await page.click('[data-day]:nth-of-type(2)'); await page.waitForSelector('.sheet'); await shot('11-plan-day'); await page.keyboard.press('Escape');
  await page.click('.tab[href="#/coach"]'); await page.waitForSelector('#cm');
  await page.fill('#cm', 'Bugün spor yapacak enerjim yok'); await page.press('#cm', 'Enter'); await page.waitForSelector('.bubble.coach >> nth=1'); await page.waitForTimeout(600); await shot('12-coach');
  await page.click('.tab[href="#/today"]'); await page.waitForSelector('text=Minimum gün');
  await page.click('.tab[href="#/profile"]'); await page.waitForSelector('h1:has-text("Profil")'); await shot('13-profile');

  // Çevrimdışı: görev tıkla → kuyruğa girsin, bağlanınca senkron
  await page.click('.tab[href="#/today"]'); await page.waitForSelector('.task');
  await ctx.setOffline(true);
  const before = await page.locator('.task[aria-pressed=true]').count();
  await page.locator('.task[aria-pressed=false]').first().click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.task[aria-pressed=true]').count(), before + 1);
  const q = await page.evaluate(() => JSON.parse(localStorage.getItem('g90q') || '[]').length); assert.ok(q >= 1, 'kuyruk boş');
  await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online'))); await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('g90q') || '[]').length), 0, 'kuyruk boşalmadı');

  // Koyu tema ekran görüntüsü
  await page.emulateMedia({ colorScheme: 'dark' }); await page.reload(); await page.waitForSelector('.task'); await shot('14-dark-today');

  console.log('PROBLEMS:', problems.length ? problems : 'yok');
  await browser.close();
  if (problems.some((p) => !/favicon|sw\.js/.test(p))) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
