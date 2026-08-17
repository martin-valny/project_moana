import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/moana-phase0-1-initial.png' });

const canvas = await page.$('canvas');
const box = await canvas.boundingBox();

const candidates = [
  [0.955, 0.245],
  [0.94, 0.25],
  [0.96, 0.26],
  [0.945, 0.24],
  [0.95, 0.255],
];

let panelVisible = false;
for (const [fx, fy] of candidates) {
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(250);
  panelVisible = await page
    .locator('h2', { hasText: 'Helena' })
    .isVisible()
    .catch(() => false);
  if (panelVisible) break;
}

await page.screenshot({ path: '/tmp/moana-phase0-2-panel.png' });

if (panelVisible) {
  await page.locator('button', { hasText: 'Follow Swell' }).click();
  await page.waitForTimeout(200);
}
const followedStorage = await page.evaluate(() => localStorage.getItem('moana.swellDiary.followedIds'));
await page.screenshot({ path: '/tmp/moana-phase0-3-followed.png' });

// Jump the timeline to "3 Days" via its label (exercises the same
// onChange path a drag would, without relying on synthetic drag timing).
await page.locator('button', { hasText: '3 Days' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/moana-phase0-4-timeline-drag.png' });

await page.locator('button', { hasText: 'Data: Open-Meteo' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/moana-phase0-5-attribution.png' });

console.log('panel visible after click:', panelVisible);
console.log('localStorage after Follow:', followedStorage);
console.log('console/page errors:', JSON.stringify(errors, null, 2));

await browser.close();
