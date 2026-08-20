/**
 * Captures the opening composition at each labelled timeline stop, in both
 * viewports — the frames a human needs to judge a round like this.
 *
 * Not a test. `field-metrics.mjs` gates correctness; this exists because
 * automated metrics cannot settle whether the result looks right, and round
 * 13 is the second time in this project a change passed every automated
 * check and still was not what the user wanted once they saw it.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const STOPS = ['-18h', 'Now', 'Tomorrow', '3 Days'];

for (const [name, viewport] of [
  ['landscape', { width: 1600, height: 900 }],
  ['portrait', { width: 430, height: 932 }],
]) {
  // reducedMotion stops idle auto-rotation; without it this sandbox's ~1.2fps
  // means every shot lands on an arbitrary longitude and nothing is
  // comparable run to run.
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  // OrbitControls damping needs this long to settle here (round 13's finding).
  await page.waitForTimeout(60000);

  for (const stop of STOPS) {
    await page.locator('button', { hasText: stop }).click({ timeout: 30000 });
    await page.waitForTimeout(7000);
    const slug = stop.toLowerCase().replace(/[^a-z0-9]+/g, '');
    await page.screenshot({ path: `/tmp/moana-r14-${name}-${slug}.png` });
    console.log(`captured ${name} @ ${stop}`);
  }
  await page.close();
}
await browser.close();
