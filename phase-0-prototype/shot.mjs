// Quick two-viewport screenshot pass for iterating on the visual.
// Not a test — smoke-test.mjs is the regression check.
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

for (const [name, viewport] of [
  ['landscape', { width: 1600, height: 900 }],
  ['portrait', { width: 430, height: 932 }],
]) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    // The webfont is fetched from fonts.googleapis.com, which this sandbox's
  // browser cannot reach (curl can; Chromium's CONNECT is reset by the
  // proxy). It loads normally on a real machine — so screenshots taken here
  // show the Georgia/Palatino fallback, not Cormorant Garamond.
  const ignorable = (t) => t.includes('fonts.googleapis.com') || t.includes('ERR_CONNECTION_RESET');
  page.on('console', (m) => m.type() === 'error' && !ignorable(m.text()) && errors.push(`${name}: ${m.text()}`));
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `/tmp/shot-${name}.png` });
  await page.close();
}

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
