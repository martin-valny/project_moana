// Single-stop, single-viewport screenshot: `node stop-shot.mjs out.png "Now"`.
// A lighter-weight companion to timeline-shots.mjs (which always shoots all
// four stops, both viewports) for when only one frame is actually needed —
// same wait/reducedMotion discipline so the frame is reproducible.
import { chromium } from 'playwright';

const outPath = process.argv[2] || '/tmp/stop-shot.png';
const stop = process.argv[3] || '3 Days';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(60000);
await page.locator('button', { hasText: stop }).click({ timeout: 30000 });
await page.waitForTimeout(7000);
await page.screenshot({ path: outPath });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
