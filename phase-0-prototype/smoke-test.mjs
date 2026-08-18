// Interaction regression check for the Phase 0 prototype. This is NOT the
// human test — §8's five-non-surfers gate is a separate, manual thing.
//
//   npm run build && npm run preview -- --port 4173 & node smoke-test.mjs
import { chromium } from 'playwright';

// ?e2e=1 makes the app publish Helena's projected marker position on window.
// Sweeping screen coordinates to find it is not viable: under software GL
// every synthetic click waits on a rendered frame, so a grid search takes
// minutes per viewport.
const URL = 'http://127.0.0.1:4173/?e2e=1';

// The webfont comes from fonts.googleapis.com, which this sandbox's browser
// cannot reach (curl can; Chromium's CONNECT is reset by the proxy). It loads
// normally on a real machine — screenshots here show the Georgia fallback.
const ignorable = (t) => t.includes('fonts.googleapis.com') || t.includes('ERR_CONNECTION_RESET');

// Playwright waits for an element to be *actionable* before clicking, which
// on this page means waiting on rendered frames. Under software-rendered
// WebGL a frame can take a long time, so the original 8000ms was not a
// generous ceiling — it timed out in three separate sessions (rounds 6, 7,
// 8), each time on a click that a longer ceiling showed succeeding at
// ~10.2s. It was never a UI defect; the diagnosis is in this repo's
// PROGRESS.md under "Round 6". Raised so the suite reports real failures
// rather than this environment's frame rate.
const CLICK_TIMEOUT = 30000;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const results = [];

for (const [name, viewport] of [
  ['landscape', { width: 1600, height: 900 }],
  ['portrait', { width: 430, height: 932 }],
]) {
  // Reduced motion stops idle rotation, so the marker holds still.
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !ignorable(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => !ignorable(String(e)) && errors.push(String(e)));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `/tmp/moana-${name}-1-initial.png` });

  const marker = await page.evaluate(() => window.__moanaMarker ?? null);
  if (marker?.facing) {
    await page.mouse.click(marker.x, marker.y);
    await page.waitForTimeout(500);
  }
  const panelOpened = await page.locator('h2', { hasText: 'Helena' }).isVisible().catch(() => false);
  await page.screenshot({ path: `/tmp/moana-${name}-2-panel.png` });

  let followed = null;
  if (panelOpened) {
    await page.locator('button', { hasText: 'Follow Swell' }).click({ timeout: CLICK_TIMEOUT });
    await page.waitForTimeout(300);
    followed = await page.evaluate(() => localStorage.getItem('moana.swellDiary.followedIds'));
    await page.screenshot({ path: `/tmp/moana-${name}-3-followed.png` });
  }

  // Timeline: jumping to "3 Days" must move Helena's rendered position.
  const posBefore = await page.evaluate(() => window.__moanaMarker?.x ?? null);
  await page.locator('button', { hasText: '3 Days' }).click({ timeout: CLICK_TIMEOUT });
  await page.waitForTimeout(700);
  const posAfter = await page.evaluate(() => window.__moanaMarker?.x ?? null);
  await page.screenshot({ path: `/tmp/moana-${name}-4-timeline.png` });

  // Attribution lives behind the wordmark — no standalone credit in the view.
  const strayCredit = await page.locator('text=Data: Open-Meteo').count();
  await page.locator('button', { hasText: 'MOANA' }).click({ timeout: CLICK_TIMEOUT });
  await page.waitForTimeout(400);
  const aboutVisible = await page.locator('h3', { hasText: 'About the data' }).isVisible().catch(() => false);
  await page.screenshot({ path: `/tmp/moana-${name}-5-about.png` });

  results.push({
    name,
    panelOpened,
    followed,
    timelineMoved: posBefore !== null && posAfter !== null && Math.abs(posAfter - posBefore) > 2,
    aboutVisible,
    strayCredit: strayCredit > 0,
    errors,
  });
  await page.close();
}

let ok = true;
for (const r of results) {
  const pass =
    r.panelOpened &&
    r.followed === '["helena-phase0"]' &&
    r.timelineMoved &&
    r.aboutVisible &&
    !r.strayCredit &&
    r.errors.length === 0;
  ok &&= pass;
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${r.name.padEnd(9)} panel=${r.panelOpened} follow=${r.followed} timelineMoved=${r.timelineMoved} about=${r.aboutVisible} strayCredit=${r.strayCredit} errors=${r.errors.length ? JSON.stringify(r.errors) : 0}`,
  );
}

await browser.close();
process.exit(ok ? 0 : 1);
