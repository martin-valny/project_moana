import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const canvas = await page.$('canvas');
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

// Drag a large amount to bring the terminator/limb clearly into view.
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx - 300, cy, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/moana-rotate-1.png' });

await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 300, cy - 150, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/moana-rotate-2.png' });

await browser.close();
