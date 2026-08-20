/**
 * Round 16 A/B: the same frames with filaments oriented each way.
 * ?filaments=travel -> streamlines; default -> wave crests.
 */
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [label, qs] of [['crests', ''], ['travel', '?filaments=travel']]) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:4173/${qs}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(60000);
  await page.screenshot({ path: `/tmp/ab-${label}-now.png` });
  await page.locator('button', { hasText: '3 Days' }).click({ timeout: 30000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `/tmp/ab-${label}-3days.png` });
  console.log(`captured ${label}`);
  await page.close();
}
await browser.close();
