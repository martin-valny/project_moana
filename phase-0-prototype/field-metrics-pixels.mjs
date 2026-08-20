/**
 * Stage C — the acceptance metrics that genuinely need rendered pixels.
 *
 * Called by `field-metrics.mjs --pixels`; needs `npm run preview` on :4173.
 *
 * ## Two rules inherited from round 13's post-mortem, both load-bearing
 *
 * 1. **Scan for extrema across whole images; never sample fixed screen
 *    coordinates across runs.** The field animates continuously, so the same
 *    pixel is not the same part of the field twice. Round 13 concluded a
 *    formula change "did nothing" on exactly that mistake, when in fact the
 *    noise had simply moved between screenshots.
 * 2. **Never trust a debug-isolated render.** Overriding the ocean to a flat
 *    debug colour stops being valid the moment that colour trips the bloom
 *    threshold, because Bloom then averages across the entire frame. Every
 *    measurement here is taken from the real composited scene.
 *
 * Radial profiles are sampled through the page's own camera
 * (`window.__moanaProject`) rather than a reconstructed projection, for the
 * same reason the shader and hit-testing share `swellField.ts`: one fact,
 * one place.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'node:fs';

const URL = 'http://127.0.0.1:4173/?e2e=1';
// This sandbox renders at ~1.2 fps (software WebGL, measured), and
// OrbitControls damping needs far longer in wall-clock time to settle here
// than on real hardware. Round 13 found a ~20 s wait catches the camera
// mid-ease, producing different framing run to run independent of any code
// change. 60 s is the figure that made screenshots comparable.
const SETTLE_MS = 60000;

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

function readPng(path) {
  const png = PNG.sync.read(fs.readFileSync(path));
  return {
    w: png.width,
    h: png.height,
    at(x, y) {
      const px = Math.round(x);
      const py = Math.round(y);
      if (px < 0 || py < 0 || px >= png.width || py >= png.height) return null;
      const i = (py * png.width + px) * 4;
      return [png.data[i], png.data[i + 1], png.data[i + 2]];
    },
    forEach(fn) {
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          const i = (y * png.width + x) * 4;
          fn(png.data[i], png.data[i + 1], png.data[i + 2], x, y);
        }
      }
    },
  };
}

/**
 * Screen-space samples across a source's packet: a fan of great-circle
 * tracks spanning the directional cone, each walking from well inside the
 * tail to well past the leading edge. `frac` is in units of rLead, so 1.0 is
 * exactly the modelled leading edge.
 *
 * **Multiple tracks, not one.** The first version walked a single line down
 * the travel axis and M1p failed at 0.79 x rLead — but that was the
 * measurement, not the render. The shader deliberately displaces each
 * leading edge by low-frequency noise so fronts wander like weather instead
 * of drawing perfect arcs (see `edgeJitter` in GlobeSphere.tsx), and the
 * filament noise adds more variance on top. An argmax over one noisy
 * scanline therefore lands wherever the jitter happened to be favourable.
 * The claim being tested is about the packet's radial profile, so the
 * profile is what gets measured: averaging across the fan cancels the
 * zero-mean jitter and leaves the shape underneath.
 */
async function radialProfile(page, sourceIndex) {
  return page.evaluate((si) => {
    const states = window.__moanaStates;
    const project = window.__moanaProject;
    if (!states || !project || !states[si]) return null;
    const s = states[si];

    // Basis to rotate the travel direction around the origin, so the fan
    // stays on the sphere.
    const S = s.origin;
    const D = s.direction;
    const E = [
      S[1] * D[2] - S[2] * D[1],
      S[2] * D[0] - S[0] * D[2],
      S[0] * D[1] - S[1] * D[0],
    ];
    const eLen = Math.hypot(E[0], E[1], E[2]);
    const Eu = eLen > 1e-9 ? E.map((x) => x / eLen) : [0, 0, 1];

    const tracks = [];
    for (let t = -4; t <= 4; t++) {
      const phi = (t / 4) * 20 * (Math.PI / 180); // +/-20 deg, inside the cone's full-strength core
      const dir = [
        D[0] * Math.cos(phi) + Eu[0] * Math.sin(phi),
        D[1] * Math.cos(phi) + Eu[1] * Math.sin(phi),
        D[2] * Math.cos(phi) + Eu[2] * Math.sin(phi),
      ];
      const samples = [];
      for (let k = 0; k <= 120; k++) {
        const frac = 0.3 + (k / 120) * 1.0; // 0.3 .. 1.3 x rLead
        const a = s.rLead * frac;
        const p = [
          S[0] * Math.cos(a) + dir[0] * Math.sin(a),
          S[1] * Math.cos(a) + dir[1] * Math.sin(a),
          S[2] * Math.cos(a) + dir[2] * Math.sin(a),
        ];
        const scr = project(p);
        samples.push({ frac, x: scr.x, y: scr.y, facing: scr.facing });
      }
      tracks.push(samples);
    }
    return { rLead: s.rLead, rTrail: s.rTrail, amp: s.amp, tracks };
  }, sourceIndex);
}

export async function runPixelMetrics() {
  const pass = [];
  const fail = [];
  const check = (id, label, ok, detail) => (ok ? pass : fail).push(`${id}  ${label} — ${detail}`);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  const ignorable = (t) => t.includes('fonts.googleapis.com') || t.includes('ERR_CONNECTION_RESET');
  page.on('console', (m) => m.type() === 'error' && !ignorable(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => !ignorable(String(e)) && errors.push(String(e)));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(SETTLE_MS);

  const shot = '/tmp/moana-metrics-now.png';
  await page.screenshot({ path: shot });
  const img = readPng(shot);

  // --- M2 / M3: distribution over ocean pixels ----------------------------
  // "Ocean" is everything bright enough not to be space or an unlit
  // continent. A crude segmentation, but it only has to separate water from
  // not-water, and both failure modes it guards against (no bright cores;
  // violet leakage) live well inside it.
  const oceanLum = [];
  let violet = 0;
  let oceanCount = 0;
  img.forEach((r, g, b) => {
    const L = lum(r, g, b);
    if (L < 22) return; // space, and the darkest land
    oceanCount++;
    oceanLum.push(L);
    // Violet/magenta: red dominant over BOTH other channels. The round-10
    // through round-13 palette would light this up; the round-14 one must
    // never produce it.
    if (r > g + 2 && r > b + 2) violet++;
  });
  oceanLum.sort((a, b) => a - b);
  const q = (p) => oceanLum[Math.floor(p * (oceanLum.length - 1))];
  const p95 = q(0.95);
  const p50 = q(0.5);
  const ratio = p95 / p50;

  check('M2', 'brightness range used on screen', ratio >= 2.5,
    `P95/P50 luminance over ${oceanCount} ocean pixels: ${ratio.toFixed(2)}x (P95=${p95.toFixed(0)}, P50=${p50.toFixed(0)}); threshold 2.5x`);

  const violetFrac = violet / Math.max(oceanCount, 1);
  check('M3', 'hue discipline (no violet leakage)', violetFrac <= 0.001,
    `red-dominant ocean pixels: ${violet} of ${oceanCount} (${(violetFrac * 100).toFixed(4)}%); threshold 0.1%`);

  // --- M1p / M4p: the packet shape as actually rendered -------------------
  // The CPU model says the peak sits at the leading edge with a sharp front
  // and a long tail. This asserts the same thing survives noise, colour,
  // tonemapping and bloom — i.e. that the mechanism reaches the screen.
  let bestSource = null;
  for (let si = 0; si < 6; si++) {
    const prof = await radialProfile(page, si);
    if (!prof) continue;

    // Average luminance across the fan at each radial position; a position
    // only counts where most tracks are on the near side of the globe.
    const n = prof.tracks[0].length;
    const lums = [];
    for (let k = 0; k < n; k++) {
      let sum = 0;
      let seen = 0;
      for (const track of prof.tracks) {
        const s = track[k];
        if (!s.facing) continue;
        const px = img.at(s.x, s.y);
        if (!px) continue;
        sum += lum(...px);
        seen++;
      }
      if (seen >= prof.tracks.length * 0.6) lums.push({ frac: prof.tracks[0][k].frac, L: sum / seen });
    }
    if (lums.length < 60) continue; // mostly round the far side

    const peak = lums.reduce((a, b) => (b.L > a.L ? b : a), lums[0]);
    // Prefer the source whose profile has the most contrast to measure —
    // a packet mostly hidden behind the limb tells us nothing.
    const span = peak.L - Math.min(...lums.map((l) => l.L));
    if (!bestSource || span > bestSource.span) bestSource = { si, lums, peak, span };
  }

  if (!bestSource) {
    fail.push('M1p/M4p  rendered packet shape — no source had a measurable on-screen profile');
  } else {
    const { si, lums, peak } = bestSource;
    if (process.env.MOANA_PROFILE) {
      console.log(`\n  averaged radial profile, source ${si} (1.00 = modelled leading edge):`);
      for (let k = 0; k < lums.length; k += 4) {
        const l = lums[k];
        console.log(`    ${l.frac.toFixed(2)}  ${l.L.toFixed(0).padStart(3)}  ${'#'.repeat(Math.round(l.L / 4))}`);
      }
    }
    check('M1p', 'leading edge is brightest on screen', Math.abs(peak.frac - 1.0) <= 0.18,
      `source ${si}: brightest sample at ${peak.frac.toFixed(2)} x rLead (1.00 = modelled leading edge); tolerance +/-0.18`);

    // Mean luminance ahead of the front vs an equal span behind it. The
    // comet must still read as asymmetric after the full pipeline.
    const ahead = lums.filter((l) => l.frac > 1.02 && l.frac <= 1.2);
    const behind = lums.filter((l) => l.frac >= 0.82 && l.frac < 0.98);
    const meanA = ahead.reduce((s, l) => s + l.L, 0) / Math.max(ahead.length, 1);
    const meanB = behind.reduce((s, l) => s + l.L, 0) / Math.max(behind.length, 1);
    check('M4p', 'still-frame asymmetry survives the pipeline', meanB > meanA * 1.25,
      `source ${si}: mean luminance behind front ${meanB.toFixed(1)} vs ahead ${meanA.toFixed(1)} (${(meanB / Math.max(meanA, 1e-6)).toFixed(2)}x); threshold 1.25x`);
  }

  // --- M5: scrubbing moves the field, coherently --------------------------
  // The claim is that dragging the timeline advances each packet's leading
  // edge outward and pulls the water with it. Measured as: the modelled
  // rLead advances, and the rendered image genuinely changes (a static
  // field would mean the scrub is not reaching the shader at all — which is
  // exactly the round-9 bug, where uTime never reached the GPU and every
  // screenshot for seven rounds was a plausible static frame).
  const before = await page.evaluate(() => window.__moanaStates.map((s) => s.rLead));
  await page.locator('button', { hasText: 'Tomorrow' }).click({ timeout: 30000 });
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => window.__moanaStates.map((s) => s.rLead));
  const shot2 = '/tmp/moana-metrics-tomorrow.png';
  await page.screenshot({ path: shot2 });

  const advanced = before.every((r, i) => after[i] > r + 1e-4);
  check('M5a', 'scrub advances every leading edge', advanced,
    `rLead before -> after: ${before.map((r, i) => `${r.toFixed(2)}->${after[i].toFixed(2)}`).join(', ')}`);

  const img2 = readPng(shot2);
  let changed = 0;
  let compared = 0;
  img.forEach((r, g, b, x, y) => {
    const p2 = img2.at(x, y);
    if (!p2) return;
    compared++;
    if (Math.abs(lum(r, g, b) - lum(...p2)) > 6) changed++;
  });
  const changedFrac = changed / Math.max(compared, 1);
  check('M5b', 'scrub visibly redraws the field', changedFrac >= 0.02,
    `${(changedFrac * 100).toFixed(2)}% of pixels changed by more than 6 luminance between Now and Tomorrow; threshold 2%`);

  // --- M7: the panel's path glyph agrees with the data -------------------
  // Now that the globe draws no line, the glyph is the only place a route
  // appears at all. Inverting its projection and comparing back to the
  // waypoint the app says it is showing catches the failure that would
  // otherwise go unnoticed: a dot drawn in the wrong place, on a schematic
  // nobody can check by eye. (The version this replaced was a hardcoded
  // curve that never agreed with anything.)
  await page.locator('button', { hasText: 'Now' }).click({ timeout: 30000 });
  await page.waitForTimeout(4000);
  const marker = await page.evaluate(() => window.__moanaMarker ?? null);
  if (marker?.facing) {
    await page.mouse.click(marker.x, marker.y);
    await page.waitForTimeout(1500);
  }

  const glyph = await page.evaluate(() => {
    const svg = document.querySelector('svg path[stroke]');
    const dot = document.querySelectorAll('svg circle');
    if (!svg || dot.length < 2) return null;
    return {
      d: svg.getAttribute('d'),
      cx: parseFloat(dot[1].getAttribute('cx')),
      cy: parseFloat(dot[1].getAttribute('cy')),
      current: window.__moanaCurrentPoint,
    };
  });

  if (!glyph?.current) {
    fail.push('M7  glyph/data agreement — panel did not open, or the glyph could not be read');
  } else {
    // Invert projectPath(): the glyph is an equirectangular fit to the
    // path's own lon/lat bounding box, padded by PAD on each side.
    const pts = glyph.d
      .split(/(?=[ML])/)
      .map((seg) => seg.slice(1).trim().split(/\s+/).map(Number))
      .filter((p) => p.length === 2 && p.every(Number.isFinite));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    // The glyph's drawn extent corresponds exactly to the path's lon/lat
    // extent, so the two bounding boxes give the mapping without needing to
    // know PAD or the viewBox.
    const helena = await page.evaluate(() => window.__moanaStates && null);
    void helena;
    const { minLon, maxLon, minLat, maxLat } = JSON.parse(process.env.MOANA_PATH_BBOX);
    const lon = minLon + ((glyph.cx - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs))) * (maxLon - minLon);
    const lat = minLat + ((Math.max(...ys) - glyph.cy) / (Math.max(...ys) - Math.min(...ys))) * (maxLat - minLat);
    const dLat = Math.abs(lat - glyph.current.lat);
    const dLon = Math.abs(lon - glyph.current.lon);
    check('M7', 'glyph dot matches the current waypoint', dLat <= 1.5 && dLon <= 1.5,
      `glyph dot inverts to (${lat.toFixed(2)}, ${lon.toFixed(2)}); app reports (${glyph.current.lat.toFixed(2)}, ${glyph.current.lon.toFixed(2)}); delta (${dLat.toFixed(2)}, ${dLon.toFixed(2)}) deg, tolerance 1.5`);
  }

  check('M6c', 'no console errors during metrics run', errors.length === 0,
    errors.length ? JSON.stringify(errors) : 'none');

  await browser.close();
  return { pass, fail };
}
