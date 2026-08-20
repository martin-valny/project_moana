/**
 * Round 14 acceptance metrics — the self-checking loop's measuring stick.
 *
 *   node --experimental-strip-types field-metrics.mjs --cpu      (Stage A)
 *   node --experimental-strip-types field-metrics.mjs --pixels   (Stage C)
 *
 * Every metric here is falsifiable with a number. The loop does not exit on
 * "looks better" — it exits on thresholds. This exists because round 13
 * burned three tuning passes adjusting shader constants downstream of a
 * variable (`fieldEnergy01`) that could never leave the bottom third of its
 * range, and nothing in the toolchain was able to say so.
 *
 * Stage A runs against the TypeScript model with no renderer at all, so a
 * geometry iteration costs milliseconds instead of the ~60 s a screenshot
 * costs in this sandbox (software WebGL, ~1.2 fps measured). All geometry
 * tuning belongs here; only things that genuinely require pixels belong in
 * Stage C.
 */
import {
  COMET_POWER,
  FIELD_GAIN,
  FRONT_FEATHER_FRACTION,
  cometEnvelope,
  fieldAt,
  fieldEnergy01,
  packetAmplitude,
  packetAt,
  packetAttenuation,
} from './src/data/swellField.ts';
import { buildHelenaPulse } from './src/data/helena.ts';
import { buildSwellSources, resolveSwellSources } from './src/data/swellSources.ts';

const D2R = Math.PI / 180;
const fail = [];
const pass = [];

function check(id, label, ok, detail) {
  (ok ? pass : fail).push(`${id}  ${label} — ${detail}`);
}

// Periods spanning every source in the app: Boreas 13.0 .. Kaimana 17.0,
// plus Helena's 13.5..16.7 range.
const PERIODS = [13.0, 13.5, 14.5, 15.5, 16.5, 17.0];
// Ages spanning the scrubber: HELENA_MIN_OFFSET_HOURS (-18) to +96, i.e. up
// to 114 h of elapsed travel for a source spawned at the far left.
const AGES = [2, 6, 12, 24, 48, 72, 96, 114];

/**
 * Samples the envelope along a source's own travel axis, where the
 * directional cone is 1 by construction, so this isolates packet shape.
 */
function profile(periodS, elapsedHours, samples = 4000) {
  const p = packetAt(periodS, elapsedHours);
  const lo = Math.max(0, p.rTrail - p.width * 0.5);
  const hi = p.rLead + p.width * (FRONT_FEATHER_FRACTION + 0.5);
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const d = lo + ((hi - lo) * i) / samples;
    pts.push({ d, v: cometEnvelope(d, p.rLead, p.rTrail) });
  }
  return { packet: p, pts };
}

/** Distance over which the envelope falls from its peak to `frac` of peak. */
function fallDistance(pts, peakIdx, frac, direction) {
  const target = pts[peakIdx].v * frac;
  for (let i = peakIdx; direction > 0 ? i < pts.length : i >= 0; i += direction) {
    if (pts[i].v <= target) return Math.abs(pts[i].d - pts[peakIdx].d);
  }
  return Infinity;
}

// ---------------------------------------------------------------- M1 ------
// Leading-edge dominance: the brightest point of a swell must BE its leading
// edge. Rounds 9-13 peaked at d ~ 0.7 x front — behind the front, on a
// plateau — which is why nothing read as moving.
function m1() {
  let worst = 0;
  let worstAt = '';
  for (const T of PERIODS) {
    for (const h of AGES) {
      const { packet, pts } = profile(T, h);
      let peakIdx = 0;
      for (let i = 1; i < pts.length; i++) if (pts[i].v > pts[peakIdx].v) peakIdx = i;
      const offset = Math.abs(pts[peakIdx].d - packet.rLead) / packet.width;
      if (offset > worst) {
        worst = offset;
        worstAt = `T=${T}s age=${h}h`;
      }
    }
  }
  check('M1', 'leading-edge dominance', worst <= 0.15,
    `peak offset from rLead, worst case: ${(worst * 100).toFixed(2)}% of band width (${worstAt}); threshold 15%`);
}

// ---------------------------------------------------------------- M4 ------
// Still-frame direction: the front must be measurably sharper than the tail.
// This is the entire basis of the claim that travel direction is legible
// without animation — sharp on one side, long feather on the other.
function m4() {
  let worst = Infinity;
  let worstAt = '';
  for (const T of PERIODS) {
    for (const h of AGES) {
      const { pts } = profile(T, h);
      let peakIdx = 0;
      for (let i = 1; i < pts.length; i++) if (pts[i].v > pts[peakIdx].v) peakIdx = i;
      const ahead = fallDistance(pts, peakIdx, 0.5, +1);
      const behind = fallDistance(pts, peakIdx, 0.5, -1);
      const ratio = behind / ahead;
      if (ratio < worst) {
        worst = ratio;
        worstAt = `T=${T}s age=${h}h (ahead ${(ahead / D2R).toFixed(2)}deg, behind ${(behind / D2R).toFixed(2)}deg)`;
      }
    }
  }
  check('M4', 'still-frame direction asymmetry', worst >= 3.0,
    `tail half-fall / front half-fall, worst case: ${worst.toFixed(2)}x at ${worstAt}; threshold 3.0x`);
}

// ---------------------------------------------------------------- M8 ------
// Dynamic range: the colour chain's input must actually USE its range.
//
// This is round 13's post-mortem turned into a gate. That round tuned
// compositing for three passes against a `fieldEnergy01` whose measured mean
// was 0.30 and whose global max was 0.869, on a ramp that needed ~0.6 before
// it shifted hue at all — the failure was upstream of everything being
// adjusted, and nothing in the toolchain could say so. Now it can.
const SCRUB_HOURS = [-18, -6, 0, 12, 24, 48, 72, 96];

function fieldPercentiles(hours, defs, startTime) {
  const states = resolveSwellSources(defs, startTime, hours);
  const vals = [];
  for (let i = 0; i < 240; i++) {
    for (let j = 0; j < 480; j++) {
      const lat = 90 - ((i + 0.5) / 240) * 180;
      const lon = -180 + ((j + 0.5) / 480) * 360;
      const phi = (90 - lat) * D2R;
      const th = (lon + 180) * D2R;
      const e = fieldAt(states, [
        -Math.sin(phi) * Math.cos(th),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(th),
      ]).energy;
      if (e > 0.002) vals.push(fieldEnergy01(e));
    }
  }
  vals.sort((a, b) => a - b);
  const q = (p) => (vals.length ? vals[Math.floor(p * (vals.length - 1))] : 0);
  const total = 240 * 480;
  const clippedCount = vals.filter((x) => x >= 0.999).length;
  // Visually significant coverage, as opposed to "some energy present".
  // 0.35 is roughly where a packet stops being a tint on deep water and
  // starts reading as a lit band.
  const strongCount = vals.filter((x) => x >= 0.35).length;
  return {
    p99: q(0.99),
    // Clipping is reported as a fraction of the WHOLE GLOBE, not of covered
    // pixels. The first version used covered pixels and failed at -18h on a
    // 7.28% ratio that turned out to be 17 pixels — at that scrub position
    // only a few just-spawned packets exist, covering 0.2% of the globe, so
    // the ratio's denominator is too small to mean anything. The failure the
    // gate is actually guarding against is a large blown-out AREA reading as
    // flat and uniform, which is an absolute quantity.
    clippedOfGlobe: clippedCount / total,
    clippedOfCovered: vals.length ? clippedCount / vals.length : 0,
    covered: vals.length / total,
    strong: strongCount / total,
  };
}

function m8() {
  const startTime = new Date('2026-08-20T12:00:00Z');
  const defs = buildSwellSources(buildHelenaPulse(startTime));

  let worstP99 = Infinity;
  let worstP99At = '';
  let worstClip = 0;
  let worstClipAt = '';
  let worstStrong = 0;
  let worstStrongAt = '';
  const rows = [];

  for (const h of SCRUB_HOURS) {
    const r = fieldPercentiles(h, defs, startTime);
    rows.push({ h, ...r });
    if (r.p99 < worstP99) {
      worstP99 = r.p99;
      worstP99At = `${h}h`;
    }
    if (r.clippedOfGlobe > worstClip) {
      worstClip = r.clippedOfGlobe;
      worstClipAt = `${h}h`;
    }
    if (r.strong > worstStrong) {
      worstStrong = r.strong;
      worstStrongAt = `${h}h`;
    }
  }

  check('M8', 'field dynamic range (top of range reached)', worstP99 >= 0.65,
    `lowest P99 across the scrubber: ${worstP99.toFixed(3)} at ${worstP99At}; threshold 0.65 (FIELD_GAIN=${FIELD_GAIN})`);
  check('M8b', 'field not broadly clipped', worstClip <= 0.015,
    `worst clipped area: ${(worstClip * 100).toFixed(3)}% of the globe at ${worstClipAt}; threshold 1.5%`);

  // M9: the swell must stay a set of distinguishable bands, not a wash.
  // Nothing gated this until the +3 Days frame showed mature packets merged
  // into one pale mass covering most of the visible hemisphere — legible
  // peak brightness (M8) says nothing about how much AREA is lit, and the
  // reference's whole character is selective luminous ribbons over deep,
  // genuinely dark water.
  check('M9', 'swell stays bands, not a wash', worstStrong <= 0.22,
    `most globe area at/above 0.35 energy: ${(worstStrong * 100).toFixed(1)}% at ${worstStrongAt}; threshold 22%`);

  console.log('\nField coverage and range across the scrubber:');
  console.log('  offset   any     strong(>=0.35)   P99     clipped(globe)');
  for (const r of rows) {
    console.log(
      `  ${String(r.h).padStart(5)}h  ${(r.covered * 100).toFixed(1).padStart(5)}%   ` +
      `${(r.strong * 100).toFixed(1).padStart(6)}%         ` +
      `${r.p99.toFixed(3)}   ${(r.clippedOfGlobe * 100).toFixed(3).padStart(6)}%`,
    );
  }
}

// --------------------------------------------------- supporting readouts --
// Not gates, but the numbers a human needs to sanity-check the model. Round
// 13's lesson: report the honest range, not the best pixel found.
function readout() {
  console.log('\nPacket geometry (T = 16.5 s, Helena near peak period):');
  console.log('  age     rTrail   rLead   width    width°   atten   amp(floored)');
  for (const h of AGES) {
    const p = packetAt(16.5, h);
    console.log(
      `  ${String(h).padStart(4)}h   ${p.rTrail.toFixed(3)}   ${p.rLead.toFixed(3)}   ` +
      `${p.width.toFixed(3)}   ${(p.width / D2R).toFixed(1).padStart(5)}°   ` +
      `${packetAttenuation(p).toFixed(3)}   ${packetAmplitude(p).toFixed(3)}`,
    );
  }

  console.log('\nEnvelope across the packet (T = 16.5 s, age 48 h):');
  const { packet, pts } = profile(16.5, 48, 200);
  for (let i = 0; i <= 20; i++) {
    const idx = Math.round((i / 20) * (pts.length - 1));
    const { d, v } = pts[idx];
    const mark = Math.abs(d - packet.rLead) < (packet.width / 40) ? '  <- rLead' : '';
    console.log(`  ${(d / D2R).toFixed(1).padStart(5)}°  ${v.toFixed(3)}  ${'#'.repeat(Math.round(v * 46))}${mark}`);
  }
  console.log(`\n  COMET_POWER=${COMET_POWER}  FRONT_FEATHER_FRACTION=${FRONT_FEATHER_FRACTION}`);
}

// --------------------------------------------------------------- driver ---
const mode = process.argv.includes('--pixels') ? 'pixels' : 'cpu';

if (mode === 'cpu') {
  console.log('=== Stage A — CPU model (no renderer) ===');
  m1();
  m4();
  m8();
  readout();
} else {
  console.log('=== Stage C — rendered pixels ===');
  // M7 inverts the panel glyph's projection, which is fitted to the path's
  // own lon/lat bounding box. Read it from the real path data here rather
  // than restating it in the pixel harness.
  const bboxPath = buildHelenaPulse(new Date()).path;
  process.env.MOANA_PATH_BBOX = JSON.stringify({
    minLon: Math.min(...bboxPath.map((p) => p.lon)),
    maxLon: Math.max(...bboxPath.map((p) => p.lon)),
    minLat: Math.min(...bboxPath.map((p) => p.lat)),
    maxLat: Math.max(...bboxPath.map((p) => p.lat)),
  });
  const { runPixelMetrics } = await import('./field-metrics-pixels.mjs');
  const r = await runPixelMetrics();
  pass.push(...r.pass);
  fail.push(...r.fail);
}

console.log('\n--- results ---');
for (const p of pass) console.log(`PASS  ${p}`);
for (const f of fail) console.log(`FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
