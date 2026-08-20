/**
 * Stage B — proves the GLSL in `swellField.ts` computes the same numbers its
 * TypeScript does.
 *
 *   node --import ./ts-resolve-hook.mjs --experimental-strip-types parity-probe.mjs
 *
 * ## Why this exists
 *
 * Round 14 needs the packet math in two languages: the ocean shader renders
 * it, and hit-testing (`Globe.tsx`) evaluates it on the CPU to answer "which
 * swell did that tap land on". Two implementations of one fact is this
 * project's most expensive recurring bug shape — round 9's uniforms-cloning
 * bug (the ocean had never actually animated; every screenshot for seven
 * rounds happened to be a plausible static frame), the hand-written heading
 * that contradicted its own waypoints, the 'WNW' label on an ENE path. Every
 * one of them was two places holding what should have been one fact, and
 * every one was found late and by accident.
 *
 * So the agreement is asserted rather than assumed.
 *
 * ## Why it does not render the app
 *
 * This compiles the shared GLSL into a bare WebGL2 context and runs it on
 * chosen inputs — no camera, no scene, no postprocessing. That matters:
 * round 13 established that inspecting a shader by overriding the ocean's
 * colour is invalid once the debug colour trips the bloom threshold, because
 * Bloom then averages brightness across the whole frame and the result has
 * nothing to do with the real composited scene. Isolating the function under
 * test sidesteps that entire class of measurement error, and it is fast:
 * this runs in about a second, against ~60 s for a screenshot in this
 * software-rendered sandbox.
 *
 * Values are packed into RGBA8 rather than read as floats — standard 4-byte
 * packing gives ~1e-7 precision with no float-render extension needed, well
 * under the 2% tolerance, so a failure here is a real disagreement rather
 * than readback quantisation.
 */
import { chromium } from 'playwright';
import { SWELL_FIELD_GLSL, sourceWeightAt } from './src/data/swellField.ts';
import { buildHelenaPulse } from './src/data/helena.ts';
import { buildSwellSources, resolveSwellSources } from './src/data/swellSources.ts';

const TOLERANCE = 0.02;
const D2R = Math.PI / 180;

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec3 uS;
uniform vec3 uD;
uniform vec3 uP;
uniform float uRLead;
uniform float uRTrail;
uniform float uAmp;

${SWELL_FIELD_GLSL}

// Standard RGBA8 float packing — see this file's header for why.
vec4 packFloat(float v) {
  vec4 enc = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * v);
  enc -= enc.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  return enc;
}

void main() {
  float d = acos(clamp(dot(uS, uP), -1.0, 1.0));
  float w = moanaSourceWeight(uS, uD, uP, uRLead, uRTrail, uAmp, d);
  fragColor = packFloat(clamp(w, 0.0, 1.0));
}`;

/**
 * Sample points placed *relative to a packet*, not spread over the sphere.
 *
 * The first version of this probe used a uniform Fibonacci lattice and only
 * 10 of 270 samples landed on a non-zero weight — packets are thin bands, so
 * uniform sphere coverage almost entirely misses them, and a probe whose
 * samples are all zero passes while proving nothing. (The guard at the
 * bottom of this file exists because that is exactly what happened on the
 * first run.)
 *
 * These walk out along the source's own travel great circle and fan off it,
 * so they straddle every interesting discontinuity: the trailing edge, the
 * comet's body, the peak at rLead, the feather past the front, and the
 * cone's angular cutoff. A handful of far-field points keep the agreement
 * on *zero* honest too.
 */
function samplePoints(state) {
  const S = state.origin;
  const D = state.direction;
  // Perpendicular to both, to rotate the travel direction around the origin.
  const E = [
    S[1] * D[2] - S[2] * D[1],
    S[2] * D[0] - S[0] * D[2],
    S[0] * D[1] - S[1] * D[0],
  ];
  const eLen = Math.hypot(...E);
  const Eu = eLen > 1e-9 ? E.map((x) => x / eLen) : [0, 0, 1];

  const pts = [];
  // Fractions of rLead: inside the tail, through the body, across the peak,
  // and out past the feather into open water.
  const radial = [0.15, 0.45, 0.7, 0.88, 0.96, 1.0, 1.04, 1.12, 1.4];
  // Bearings off the travel axis: on-axis, inside the cone, at its edge,
  // and outside it.
  const bearings = [0, 20 * D2R, 45 * D2R, 70 * D2R];

  for (const frac of radial) {
    for (const phi of bearings) {
      const a = Math.max(state.rLead * frac, 1e-3);
      const dir = [
        D[0] * Math.cos(phi) + Eu[0] * Math.sin(phi),
        D[1] * Math.cos(phi) + Eu[1] * Math.sin(phi),
        D[2] * Math.cos(phi) + Eu[2] * Math.sin(phi),
      ];
      pts.push([
        S[0] * Math.cos(a) + dir[0] * Math.sin(a),
        S[1] * Math.cos(a) + dir[1] * Math.sin(a),
        S[2] * Math.cos(a) + dir[2] * Math.sin(a),
      ]);
    }
  }
  // The antipode and a couple of far-field points: both sides must agree
  // that nothing is there.
  pts.push([-S[0], -S[1], -S[2]]);
  return pts;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.goto('about:blank');

const startTime = new Date('2026-08-20T12:00:00Z');
const defs = buildSwellSources(buildHelenaPulse(startTime));

// Several scrub positions, so the comparison covers young narrow packets
// (where the width floor is active) and old stretched ones alike.
const cases = [];
for (const hours of [-18, 0, 24, 72, 96]) {
  const states = resolveSwellSources(defs, startTime, hours);
  for (let si = 0; si < states.length; si++) {
    for (const p of samplePoints(states[si])) {
      cases.push({ hours, si, state: states[si], p });
    }
  }
}

const gpu = await page.evaluate(
  async ({ vertex, fragment, cases }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return { error: 'no webgl2' };

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };

    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vertex));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
      return { error: String(e.message ?? e) };
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (n) => gl.getUniformLocation(prog, n);
    const out = [];
    const px = new Uint8Array(4);

    for (const c of cases) {
      gl.uniform3fv(u('uS'), c.state.origin);
      gl.uniform3fv(u('uD'), c.state.direction);
      gl.uniform3fv(u('uP'), c.p);
      gl.uniform1f(u('uRLead'), c.state.rLead);
      gl.uniform1f(u('uRTrail'), c.state.rTrail);
      gl.uniform1f(u('uAmp'), c.state.amp);
      gl.viewport(0, 0, 1, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push(
        (px[0] / 255) * 1 +
          (px[1] / 255) * (1 / 255) +
          (px[2] / 255) * (1 / 65025) +
          (px[3] / 255) * (1 / 16581375),
      );
    }
    return { values: out };
  },
  {
    vertex: VERTEX,
    fragment: FRAGMENT,
    cases: cases.map((c) => ({
      p: c.p,
      state: {
        origin: Array.from(c.state.origin),
        direction: Array.from(c.state.direction),
        rLead: c.state.rLead,
        rTrail: c.state.rTrail,
        amp: c.state.amp,
      },
    })),
  },
);

await browser.close();

if (gpu.error) {
  console.error(`FAIL  parity probe could not run: ${gpu.error}`);
  process.exit(1);
}

let worst = 0;
let worstDetail = '';
let compared = 0;
let nonZero = 0;

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const cpu = sourceWeightAt(c.state, c.p);
  const got = gpu.values[i];
  const diff = Math.abs(cpu - got);
  compared++;
  if (cpu > 1e-4) nonZero++;
  if (diff > worst) {
    worst = diff;
    worstDetail = `source ${c.si} at ${c.hours}h, cpu=${cpu.toFixed(6)} gpu=${got.toFixed(6)}`;
  }
}

console.log(`compared ${compared} samples (${nonZero} with non-zero weight) across 5 scrub positions`);
console.log(`worst absolute divergence: ${worst.toFixed(6)}  (${worstDetail})`);

// A probe where every sample is zero would "pass" while proving nothing —
// the sample set has to actually land inside some packets.
if (nonZero < 12) {
  console.error(`FAIL  only ${nonZero} samples had non-zero weight; the probe is not exercising the packets`);
  process.exit(1);
}

if (worst > TOLERANCE) {
  console.error(`FAIL  GLSL and TypeScript disagree by ${worst.toFixed(6)} (tolerance ${TOLERANCE})`);
  process.exit(1);
}

console.log(`PASS  B  CPU/GPU parity — worst divergence ${worst.toFixed(6)}, tolerance ${TOLERANCE}`);

// --- Degeneracy guard ------------------------------------------------------
//
// The anisotropic noise sampling has to actually be anisotropic. This is a
// direct guard against the bug round 16 found, which had gone unnoticed since
// round 9: the shader decomposed the sample position along the flow tangent,
// but a tangent on a unit sphere is perpendicular to the position vector by
// construction, so `dot(vPos, f)` was identically zero and the whole stretch
// collapsed to a uniform scale. Six rounds of screenshots, every one of them
// isotropic blobs while every comment in the file said "streaks".
//
// Nothing in the harness could see it, because every other metric measures the
// packet envelope, its range, its hue, its motion or its coverage — none
// measured whether the texture inside a packet has a direction at all.
//
// The check: take a point, step the same arc length away from it twice — once
// radially (away from the storm) and once tangentially (around it) — and map
// both through `moanaSourceFrame`. If sampling is anisotropic those two equal
// real-world steps must produce *unequal* separations in noise space. Under
// the old code the ratio was exactly 1.000.
{
  const D2R2 = Math.PI / 180;
  const ll = (lat, lon) => {
    const p = (90 - lat) * D2R2;
    const t = (lon + 180) * D2R2;
    return [-Math.sin(p) * Math.cos(t), Math.cos(p), Math.sin(p) * Math.sin(t)];
  };
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (v) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];

  // Mirrors moanaSourceFrame() in swellField.ts.
  const frame = (S, D, P) => {
    const d = Math.acos(Math.max(-1, Math.min(1, dot3(S, P))));
    const E = norm(cross(S, D));
    const sp = dot3(S, P);
    const raw = [P[0] - S[0] * sp, P[1] - S[1] * sp, P[2] - S[2] * sp];
    const len = Math.hypot(...raw);
    const toP = len > 1e-4 ? raw.map((x) => x / len) : D;
    const bearing = Math.atan2(dot3(toP, E), dot3(toP, D));
    return [d, bearing * Math.sin(d)];
  };

  const S = ll(-55, -175);
  const Dv = norm([
    ...(() => {
      // Any tangent at S will do for this test; use the local east direction.
      const north = [0, 1, 0];
      const e = cross(north, S);
      return Math.hypot(...e) > 1e-6 ? e : [1, 0, 0];
    })(),
  ]);
  const E = norm(cross(S, Dv));

  // A point 40 degrees out along the travel direction, then two equal steps.
  const a0 = 40 * D2R2;
  const step = 2 * D2R2;
  const at = (arc, bearingRad) => {
    const dir = [
      Dv[0] * Math.cos(bearingRad) + E[0] * Math.sin(bearingRad),
      Dv[1] * Math.cos(bearingRad) + E[1] * Math.sin(bearingRad),
      Dv[2] * Math.cos(bearingRad) + E[2] * Math.sin(bearingRad),
    ];
    return [
      S[0] * Math.cos(arc) + dir[0] * Math.sin(arc),
      S[1] * Math.cos(arc) + dir[1] * Math.sin(arc),
      S[2] * Math.cos(arc) + dir[2] * Math.sin(arc),
    ];
  };

  const P0 = at(a0, 0);
  const Pradial = at(a0 + step, 0);
  // Equal arc length tangentially: a bearing offset of step/sin(a0).
  const Ptangential = at(a0, step / Math.sin(a0));

  const K_FINE = 9.0;
  const K_LONG = 0.8;
  const f0 = frame(S, Dv, P0);
  const fr = frame(S, Dv, Pradial);
  const ft = frame(S, Dv, Ptangential);

  const scaled = (f) => [f[0] * K_FINE, f[1] * K_LONG];
  const sep = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const radialSep = sep(scaled(f0), scaled(fr));
  const tangentialSep = sep(scaled(f0), scaled(ft));
  const anisoRatio = Math.max(radialSep, tangentialSep) / Math.max(Math.min(radialSep, tangentialSep), 1e-9);

  console.log(
    `\nequal ${(step / D2R2).toFixed(1)}-degree steps map to noise-space separations ` +
    `${radialSep.toFixed(4)} (radial) vs ${tangentialSep.toFixed(4)} (tangential)`,
  );
  if (anisoRatio < 3.0) {
    console.error(
      `FAIL  B2  noise sampling is not anisotropic — ratio ${anisoRatio.toFixed(3)}, need >= 3.0. ` +
      `A ratio of 1.0 means the stretch has collapsed to a uniform scale again.`,
    );
    process.exit(1);
  }
  console.log(`PASS  B2  noise sampling is anisotropic — ratio ${anisoRatio.toFixed(2)}, threshold 3.0`);
}
