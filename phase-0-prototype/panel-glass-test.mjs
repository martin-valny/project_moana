// Confirms the swell panel's scrim stays faint enough to see the globe
// through it — the panel is deliberately not a solid card, so the failure
// mode to catch is a scrim heavy enough to read as one.
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
await page.goto('http://127.0.0.1:4173/?e2e=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

const marker = await page.evaluate(() => window.__moanaMarker ?? null);
if (marker?.facing) {
  await page.mouse.click(marker.x, marker.y);
  await page.waitForTimeout(600);
}
const open = await page.locator('h2', { hasText: 'Helena' }).isVisible().catch(() => false);

// Drag a bright, detailed region behind where the panel sits, then look.
const box = await (await page.$('canvas')).boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.45, { steps: 14 });
await page.mouse.up();
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/moana-panel-scrim.png' });

console.log('panel open:', open, '— inspect /tmp/moana-panel-scrim.png: globe detail must remain visible behind the text');
await browser.close();
