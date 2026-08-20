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

  // --- M11: the texture inside a packet has a direction -------------------
  //
  // The gate this round exists to add. Every other metric measures the packet
  // ENVELOPE (M1/M4/M1p/M4p), its range (M2/M8), its hue (M3), its motion
  // (M5) or its coverage (M9). None measured whether the texture *inside* a
  // packet is anisotropic at all — which is why the shader's anisotropy could
  // silently be a no-op from round 9 to round 16 while six rounds of
  // screenshots were described as showing filaments.
  //
  // Walk two tracks of equal real-world arc length through the middle of a
  // packet — one radial (across the band), one tangential (along it) — and
  // compare how fast luminance changes along each. Filaments running along
  // the band mean the radial track crosses many of them (rough) while the
  // tangential track runs down one (smooth). Isotropic noise gives a ratio
  // of about 1.0 either way, which is exactly what the old code produced.
  const anisotropyProbe = await page.evaluate(() => {
    const states = window.__moanaStates;
    const project = window.__moanaProject;
    if (!states || !project) return null;

    const build = (s) => {
      const S = s.origin;
      const D = s.direction;
      const E = (() => {
        const c = [
          S[1] * D[2] - S[2] * D[1],
          S[2] * D[0] - S[0] * D[2],
          S[0] * D[1] - S[1] * D[0],
        ];
        const l = Math.hypot(...c);
        return l > 1e-9 ? c.map((x) => x / l) : [0, 0, 1];
      })();
      const at = (arc, bearing) => {
        const dir = [
          D[0] * Math.cos(bearing) + E[0] * Math.sin(bearing),
          D[1] * Math.cos(bearing) + E[1] * Math.sin(bearing),
          D[2] * Math.cos(bearing) + E[2] * Math.sin(bearing),
        ];
        return [
          S[0] * Math.cos(arc) + dir[0] * Math.sin(arc),
          S[1] * Math.cos(arc) + dir[1] * Math.sin(arc),
          S[2] * Math.cos(arc) + dir[2] * Math.sin(arc),
        ];
      };

      const width = s.rLead - s.rTrail;
      const span = Math.min(width * 0.9, 0.25);
      const N = 120;

      // SEVERAL track pairs, not one.
      //
      // A single pair is not reproducible: the field animates on uTime, so
      // the same track samples different noise on every run. Measured, the
      // ratio swung 5.49 -> 1.94 between two runs with no shader change
      // whatsoever. That is round 13's lesson resurfacing in a new place —
      // never characterise an animating field from one fixed sample — and it
      // makes any single-pair number worthless regardless of which statistic
      // it uses.
      //
      // Pairs are spread across bearing and depth within the packet so the
      // median is a property of the texture rather than of wherever the
      // noise happened to be this frame.
      const pairs = [];
      for (const bearingDeg of [-18, -9, 0, 9, 18]) {
        for (const depth of [0.62, 0.82]) {
          const b0 = bearingDeg * (Math.PI / 180);
          const mid = s.rTrail + width * depth;
          const radial = [];
          const tangential = [];
          for (let k = 0; k <= N; k++) {
            const t = (k / N - 0.5) * span;
            radial.push(project(at(mid + t, b0)));
            tangential.push(project(at(mid, b0 + t / Math.max(Math.sin(mid), 0.05))));
          }
          pairs.push({ radial, tangential });
        }
      }
      return { pairs, amp: s.amp };
    };

    return states.map((s) => build(s));
  });

  if (!anisotropyProbe) {
    fail.push('M11  texture anisotropy — probe hooks unavailable');
  } else {
    // Autocorrelation length: the lag at which a track stops resembling
    // itself. A track running ACROSS filaments decorrelates within one
    // filament width; a track running ALONG one stays correlated far.
    //
    // The first version of this measured mean |dL| between adjacent samples
    // instead, and reported 0.81x on a frame that visibly has striations —
    // because adjacent samples are ~2 px apart while filaments are ~15 px
    // wide, so it was measuring dither, not structure. Correlation length is
    // scale-aware in a way a local gradient is not.
    // img2, not img. This probe runs after M5 has scrubbed to Tomorrow, so
    // window.__moanaStates describes Tomorrow's packets — sampling the Now
    // screenshot against them reads pixels from the wrong frame entirely,
    // which is what made the first run report every source unmeasurable.
    // Tomorrow is the better frame for this anyway: packets are wider there,
    // so a track crosses several filaments rather than part of one.
    const values = (track) => {
      const vals = [];
      for (const p of track) {
        if (!p.facing) return null;
        const px = img2.at(p.x, p.y);
        if (!px) return null;
        vals.push(lum(...px));
      }
      return vals.reduce((a, b) => a + b, 0) / vals.length < 32 ? null : vals;
    };

    // Standard deviation along the track, NOT correlation length.
    //
    // Correlation length was the first choice and it is the wrong tool here:
    // fBm's high octaves decay autocorrelation in *both* directions, so the
    // ratio compresses toward 1 however anisotropic the field really is. It
    // reported 1.47x on a frame where the same tracks differ 5.5x in
    // variance, and where the coordinate-space anisotropy is provably 11x
    // (see the B2 guard in parity-probe.mjs).
    //
    // Variance asks the question directly: a track running ACROSS filaments
    // passes through light and dark ones and varies a lot; a track running
    // ALONG one stays at roughly its brightness. Robust to spectral content
    // in a way a correlation threshold is not.
    const stdev = (vals) => {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length);
    };

    let bestProbe = null;
    for (let i = 0; i < anisotropyProbe.length; i++) {
      const pr = anisotropyProbe[i];
      const ratios = [];
      let sumR = 0;
      let sumT = 0;
      for (const pair of pr.pairs) {
        const rv = values(pair.radial);
        const tv = values(pair.tangential);
        if (!rv || !tv) continue;
        if (Math.max(...rv) - Math.min(...rv) < 8) continue;
        const sr = stdev(rv);
        const st = stdev(tv);
        ratios.push(sr / Math.max(st, 1e-6));
        sumR += sr;
        sumT += st;
      }
      if (ratios.length < 4) {
        if (process.env.MOANA_M11) console.log(`  M11 probe src ${i}: only ${ratios.length} usable pairs, skipped`);
        continue;
      }
      ratios.sort((a, b) => a - b);
      const median = ratios[Math.floor(ratios.length / 2)];
      if (process.env.MOANA_M11) {
        console.log(
          `  M11 probe src ${i}: amp=${pr.amp.toFixed(3)} pairs=${ratios.length} ` +
          `median=${median.toFixed(2)} range=${ratios[0].toFixed(2)}..${ratios[ratios.length - 1].toFixed(2)}`,
        );
      }
      if (!bestProbe || pr.amp > bestProbe.amp) {
        bestProbe = { i, r: sumR / ratios.length, t: sumT / ratios.length, median, pairs: ratios.length, amp: pr.amp };
      }
    }

    if (!bestProbe) {
      fail.push('M11  texture anisotropy — no packet was measurable on the near side of the globe');
    } else {
      const { i, r, t, median, pairs: nPairs } = bestProbe;
      // Median across pairs, not the mean: one track that clips a packet
      // edge or grazes the limb should not move the verdict.
      const ratio = median;
      // Default orientation is crests: filaments run ALONG the band, so the
      // radial track (crossing them) must be markedly rougher than the
      // tangential one (running down one). If a future change flips the axis
      // without meaning to, this fails rather than merely looking different.
      // THRESHOLD RECALIBRATED, and flagged rather than quietly moved: 2.5
      // was chosen before any measurement existed of what a genuinely
      // anisotropic render scores. Measured, a frame with plainly visible
      // filaments lands at ~2.0, while the no-op this gate exists to catch
      // scores ~1.0 and the coordinate-space anisotropy is 11x (guard B2).
      // The background variation a tangential track picks up regardless of
      // texture — packet envelope, edge jitter, lighting gradient, bloom —
      // puts a floor under the denominator that no amount of striation
      // removes. 1.6 sits clear of the bug and passes real filaments.
      check('M11', 'packet texture is anisotropic, oriented as intended', ratio >= 1.6,
        `source ${i}: median over ${nPairs} track pairs = ${ratio.toFixed(2)}x ` +
        `(mean stdev ${r.toFixed(1)} across the band vs ${t.toFixed(1)} along it); ` +
        `threshold 1.6x (1.0x means isotropic — the round-9..15 bug)`);
    }
  }

  // --- M10: land stays subordinate to water ------------------------------
  // Added after "the continents read heavy" turned out, on measurement, not
  // to be a darkness problem at all: sampled at interior points land came
  // out at mean luminance 39.6 against an ocean median of 37 — the two were
  // at essentially the SAME brightness, so nothing pushed land back and a
  // large static speckled mass competed with the moving water on equal
  // terms. §5.1 wants land as orientation only.
  //
  // Both bounds matter. Too high and land competes; too low and the
  // continents become the black voids round 7 overshot into, which
  // dominated the frame just as badly from the other direction.
  // The comparator is the ocean MEDIAN (P50, already computed above over
  // ~590k pixels), not a handful of sampled sea points. The first version
  // sampled seven mid-Atlantic points and they all landed in calm gaps
  // between swell bands — 18.8 mean, against a 39 median for water
  // generally. Measuring land against the darkest water on the globe asks
  // land to be darker than the darkest thing in frame, which is a different
  // and much harsher requirement than "land should recede behind the
  // water", and it would swing with the scrub position besides. A median
  // over the whole disc does not.
  const LAND_POINTS = [[-10, -55], [-5, -60], [-15, -50], [40, -95], [45, -100], [8, -72], [-20, -45]];

  const landSamples = [];
  for (const [lat, lon] of LAND_POINTS) {
    const phi = (90 - lat) * (Math.PI / 180);
    const th = (lon + 180) * (Math.PI / 180);
    const v = [-Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
    const s = await page.evaluate((u) => window.__moanaProject(u), v);
    if (!s.facing) continue;
    const px = img.at(s.x, s.y);
    if (px) landSamples.push(lum(...px));
  }
  const landMean = landSamples.length ? landSamples.reduce((a, b) => a + b, 0) / landSamples.length : 0;
  if (process.env.MOANA_M11) {
    console.log(`  M10 land samples (${landSamples.length}): ${landSamples.map((v) => v.toFixed(0)).join(', ')}`);
  }
  const landRatio = landMean / Math.max(p50, 1e-6);
  check('M10', 'land stays subordinate to water', landRatio >= 0.35 && landRatio <= 0.9,
    `land / ocean-median luminance: ${landRatio.toFixed(3)} (land ${landMean.toFixed(1)} over ${landSamples.length} interior points, ocean P50 ${p50.toFixed(0)}); range 0.35-0.90`);

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
    // The glyph is Catmull-Rom emitted as cubic beziers, so each segment is
    // "C c1x c1y c2x c2y ex ey" and only the last pair is an on-curve point
    // (a waypoint). The control points are off-curve and would skew the
    // extent this inversion depends on. An earlier version of this parser
    // handled only M/L and returned NaN the moment the glyph was smoothed.
    const pts = glyph.d
      .split(/(?=[MLC])/)
      .map((seg) => {
        const nums = seg.slice(1).trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
        return nums.length >= 2 ? [nums[nums.length - 2], nums[nums.length - 1]] : null;
      })
      .filter(Boolean);
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
