import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const canvas = await page.$('canvas');
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

// Rotate so a bright ribbon area sits roughly where the right panel will be.
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx - 120, cy + 40, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(300);

// Open the panel via the marker (search nearby since it moved with rotation).
const candidates = [];
for (let fx = 0.3; fx <= 0.95; fx += 0.05) {
  for (let fy = 0.15; fy <= 0.5; fy += 0.05) candidates.push([fx, fy]);
}
let panelVisible = false;
for (const [fx, fy] of candidates) {
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(120);
  panelVisible = await page.locator('h2', { hasText: 'Helena' }).isVisible().catch(() => false);
  if (panelVisible) break;
}
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/moana-panel-glass.png' });
console.log('panel visible:', panelVisible);
await browser.close();
