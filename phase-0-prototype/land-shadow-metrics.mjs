/**
 * Stage L — the land-shadow acceptance gates.
 *
 *   node --import ./ts-resolve-hook.mjs --experimental-strip-types land-shadow-metrics.mjs
 *
 * ## Why this exists
 *
 * Four rounds tried to stop swells crossing continents. Each shipped, each
 * was reported broken by the user, and each time the reason was something no
 * automated check was looking at: swell reading through Central America,
 * then still reading through it, then rendering as speckle. The whole time
 * the CPU harnesses passed, because none of them touched land shadowing at
 * all — every round said so in its own write-up and none closed the gap.
 *
 * These are the properties those rounds were each missing, asserted against
 * the real `earth-water.png` and the real sources. `parity-probe.mjs`'s B3
 * covers the other half (that the GLSL renders the same numbers this scores).
 *
 * CPU only and about a second, so there is no excuse not to run it.
 */
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { buildShadowRow, shadowTransmission, sourceFrame } from './src/data/swellField.ts';
import { buildHelenaPulse } from './src/data/helena.ts';
import { buildSwellSources } from './src/data/swellSources.ts';

const mask = PNG.sync.read(fs.readFileSync('public/textures/earth-water.png'));
const isLand = (p) => {
  const phi = Math.acos(Math.max(-1, Math.min(1, p[1])));
  let u = Math.atan2(p[2], -p[0]) / (2 * Math.PI);
  u = ((u % 1) + 1) % 1;
  const px = Math.min(mask.width - 1, Math.floor(u * mask.width));
  const py = Math.min(mask.height - 1, Math.floor((phi / Math.PI) * mask.height));
  return mask.data[(py * mask.width + px) * 4] < 128;
};
const D2R = Math.PI / 180;
const ll = (lat, lon) => {
  const phi = (90 - lat) * D2R;
  const th = (lon + 180) * D2R;
  return [-Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const pass = [];
const fail = [];
const check = (id, name, ok, detail) => (ok ? pass : fail).push(`${id}  ${name} — ${detail}`);

const sources = buildSwellSources(buildHelenaPulse(new Date('2026-08-24T12:00:00Z')));
const origins = sources.map((s) => [s.origin.x, s.origin.y, s.origin.z]);
const t0 = Date.now();
const rows = origins.map((o) => buildShadowRow(o, isLand));
const bakeMs = Date.now() - t0;
const frames = origins.map((o) => sourceFrame(o));
const T = (i, p) => shadowTransmission(rows[i], origins[i], frames[i].e1, frames[i].e2, p, sources[i].periodS);

// --- L1: water with no sea route from a source stays dark ------------------
// The user's actual complaint, four times over: "swell kinda continue 'under'
// continents and then just reappear on the other side".
const SHADOWED = [
  ['Caribbean, behind Central America', 15, -75],
  ['Gulf of Mexico', 25, -90],
  ['Mediterranean', 36, 15],
  ['Hudson Bay', 60, -85],
  ['Sea of Japan', 40, 135],
];
let worstLeak = 0;
let worstWhere = '';
for (const [nm, lat, lon] of SHADOWED) {
  const p = ll(lat, lon);
  for (let i = 0; i < sources.length; i++) {
    const t = T(i, p);
    if (t > worstLeak) { worstLeak = t; worstWhere = `${sources[i].id} into ${nm}`; }
  }
}
check('L1', 'no swell reaches water it has no sea route to', worstLeak <= 0.05,
  `worst leak ${worstLeak.toFixed(4)} (${worstWhere || 'none'}) over ${SHADOWED.length} enclosed seas x ${sources.length} sources; threshold 0.05`);

// --- L2: and open water is not over-blocked --------------------------------
// The failure mode the opposite of L1, and the one a too-eager fix creates.
const OPEN = [
  ['kaimana into the open S Pacific', 2, -30, -120],
  ['aleutian into the open N Pacific', 4, 30, -150],
  ['helena into the open N Atlantic', 0, 40, -40],
  ['auster into the open Indian Ocean', 3, -20, 75],
];
let worstBlock = 1;
let blockWhere = '';
for (const [nm, si, lat, lon] of OPEN) {
  const t = T(si, ll(lat, lon));
  if (t < worstBlock) { worstBlock = t; blockWhere = nm; }
}
check('L2', 'open-ocean paths are not blocked', worstBlock >= 0.9,
  `worst ${worstBlock.toFixed(4)} (${blockWhere}); threshold 0.9`);

// --- L3: the shadow field is smooth, not speckled --------------------------
// Round "17." shipped a model whose output was a small integer count of land
// hits, so neighbouring pixels flipped between lit and dark independently and
// the swell rendered as choppy speckle. Measured the same way here: the
// largest change between samples one screen pixel apart (~0.15 deg).
let maxJump = 0;
let jumpWhere = '';
for (const [nm, lat, lon] of [['Caribbean', 15, -75], ['off Central America', 8, -90], ['off Indonesia', -5, 115], ['off W Africa', 10, -25]]) {
  for (let i = 0; i < sources.length; i++) {
    for (let a = -1.5; a <= 1.5; a += 0.15) {
      // Reset per scan line: the last sample of one line and the first of the
      // next are far apart, and comparing them is not a measure of anything.
      let prev = null;
      for (let b = -1.5; b <= 1.5; b += 0.15) {
        const p = ll(lat + a, lon + b);
        if (isLand(p)) { prev = null; continue; }
        const t = T(i, p);
        if (prev !== null && Math.abs(t - prev) > maxJump) { maxJump = Math.abs(t - prev); jumpWhere = `${sources[i].id} near ${nm}`; }
        prev = t;
      }
    }
  }
}
check('L3', 'shadow field is smooth, not speckled', maxJump <= 0.5,
  `largest change between adjacent samples ${maxJump.toFixed(3)} (${jumpWhere}); threshold 0.5 (the shipped round-"17." model measures 0.999 on this exact scan)`);

// --- L4: obstacle size decides block versus bend ---------------------------
// The physics the user asked for in their own words: "swell that hits large
// land mass disappear, swell that hits some smaller island bend somehow,
// weakens?". One mechanism has to produce both ends, with no special case.
function disc(obstacleKm, downstreamKm) {
  const o = ll(0, 0);
  const centre = ll(0, 40);
  const half = obstacleKm / 2 / 6371;
  const fake = (p) => Math.acos(Math.max(-1, Math.min(1, dot(p, centre)))) < half;
  const row = buildShadowRow(o, fake);
  const { e1, e2 } = sourceFrame(o);
  return shadowTransmission(row, o, e1, e2, ll(0, 40 + downstreamKm / 111.19), 15);
}
const islet = disc(8, 1200);
const continent = disc(1500, 1200);
check('L4', 'small obstacles bend, large ones block', islet >= 0.85 && continent <= 0.05,
  `an 8km islet transmits ${islet.toFixed(3)} (>= 0.85), a 1500km landmass ${continent.toFixed(3)} (<= 0.05), 1200km downstream`);

// --- L5: swell still reaches the coast it is running at --------------------
// A shadow model that stops swell short of the shore it is approaching would
// satisfy L1 and be just as wrong.
const COASTS = [
  ['helena reaching W Ireland', 0, 53.3, -11.5],
  ['kaimana reaching the Chilean coast', 2, -33, -72.5],
  ['aleutian reaching the Californian coast', 4, 36, -122.5],
];
let worstCoast = 1;
let coastWhere = '';
for (const [nm, si, lat, lon] of COASTS) {
  const t = T(si, ll(lat, lon));
  if (t < worstCoast) { worstCoast = t; coastWhere = nm; }
}
check('L5', 'swell reaches the coast it is approaching', worstCoast >= 0.9,
  `worst ${worstCoast.toFixed(4)} (${coastWhere}); threshold 0.9`);

console.log(`bake: ${bakeMs}ms for ${sources.length} sources\n`);
console.log('--- results ---');
for (const p of pass) console.log(`PASS  ${p}`);
for (const f of fail) console.log(`FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
