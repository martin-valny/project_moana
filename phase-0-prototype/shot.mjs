// Quick two-viewport screenshot pass for iterating on the visual.
// Not a test — smoke-test.mjs is the regression check.
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

for (const [name, viewport] of [
  ['landscape', { width: 1600, height: 900 }],
  ['portrait', { width: 430, height: 932 }],
]) {
  // reducedMotion stops the idle auto-rotation, exactly as smoke-test.mjs and
  // rotate-test.mjs already do. Without it these screenshots are NOT
  // reproducible and do not show the app's actual opening composition: under
  // this sandbox's software-rendered WebGL a single shot takes tens of
  // seconds of wall-clock time, and autoRotate keeps spinning for all of it,
  // so each run lands on an essentially arbitrary longitude. Several rounds of
  // "why is there a huge continent in the middle of the frame?" were partly
  // this artifact rather than the framing itself.
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
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
