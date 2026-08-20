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

// --- B2: the noise sampling stays isotropic --------------------------------
//
// Round 17 made isotropic sampling an explicit decision rather than an
// accident, so this asserts the decision holds. The history is worth keeping
// short: rounds 1-8 stretched the noise domain along the flow to produce
// streaks; round 9 swapped in a per-fragment tangent and silently reduced the
// whole thing to a uniform scale; rounds 9-16 rendered isotropic noise under a
// comment insisting otherwise. Round 16 fixed it properly and the result was
// rejected on sight — shown both frames side by side, the soft isotropic field
// won. `git show 1856985` has the anisotropic implementation.
//
// So the gate runs in the direction the look actually went. It is not "no
// anisotropy allowed, ever" — it is "a stretch cannot appear here without
// somebody deciding to". Reintroducing one means updating this threshold in
// the same commit, which is precisely the review moment that was missing when
// round 9 removed the stretch by accident.
//
// The check: step the same arc length twice from a point, once radially away
// from the storm and once tangentially around it, and map both through the
// sampling transform. Equal real-world steps must land at equal separations in
// noise space. Anything else means the domain has acquired a direction.
//
// It measures moanaNoiseCoord() from the shared GLSL — the same function the
// ocean shader calls — rather than a JS reimplementation. A mirrored copy
// would keep passing against a shader that had drifted away from it, which is
// how the original bug survived six rounds in the first place.
{
  const ISO_TOLERANCE = 0.02;
  const B2_FRAGMENT = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec3 uP;
uniform float uDirConfidence;
uniform int uComp;

${SWELL_FIELD_GLSL}

vec4 packFloat(float v) {
  vec4 enc = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * v);
  enc -= enc.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  return enc;
}

void main() {
  vec3 c = moanaNoiseCoord(normalize(uP), uDirConfidence);
  float v = uComp == 0 ? c.x : (uComp == 1 ? c.y : c.z);
  fragColor = packFloat(clamp((v + 4.0) / 8.0, 0.0, 1.0));
}`;

  const norm3 = (v) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  const cross3 = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];

  // A storm at 55S 175W, travelling local-east, and a point 40 degrees out
  // along that travel direction — well inside a mature packet.
  const latS = -55 * D2R;
  const lonS = -175 * D2R;
  const S = norm3([Math.cos(latS) * Math.cos(lonS), Math.sin(latS), Math.cos(latS) * Math.sin(lonS)]);
  const Dv = norm3(cross3([0, 1, 0], S));
  const E = norm3(cross3(S, Dv));

  const a0 = 40 * D2R;
  const stepRad = 2 * D2R;
  const at = (arc, bearing) => {
    const dir = [0, 1, 2].map((i) => Dv[i] * Math.cos(bearing) + E[i] * Math.sin(bearing));
    return [0, 1, 2].map((i) => S[i] * Math.cos(arc) + dir[i] * Math.sin(arc));
  };

  const samples = {
    p0: at(a0, 0),
    radial: at(a0 + stepRad, 0),
    // Equal arc length tangentially needs a bearing offset of step / sin(a0),
    // because a bearing sweep at distance d covers sin(d) times as much arc.
    tangential: at(a0, stepRad / Math.sin(a0)),
  };

  const b2Browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const b2Page = await b2Browser.newPage();
  const coords = await b2Page.evaluate(
    ({ VERTEX, FRAGMENT, samples, dirConfidence }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const gl = canvas.getContext('webgl2');
      if (!gl) throw new Error('no webgl2');
      const compile = (type, source) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, source);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(gl.getUniformLocation(prog, 'uDirConfidence'), dirConfidence);
      const px = new Uint8Array(4);
      const readComponent = (P, comp) => {
        gl.uniform3fv(gl.getUniformLocation(prog, 'uP'), P);
        gl.uniform1i(gl.getUniformLocation(prog, 'uComp'), comp);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const packed = px[0] / 255 + px[1] / 65025 + px[2] / 16581375 + px[3] / 4228250625;
        return packed * 8 - 4;
      };
      const out = {};
      for (const [key, P] of Object.entries(samples)) {
        out[key] = [0, 1, 2].map((c) => readComponent(P, c));
      }
      return out;
    },
    { VERTEX, FRAGMENT: B2_FRAGMENT, samples, dirConfidence: 1.0 },
  );
  await b2Browser.close();

  const sep = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
  const radialSep = sep(coords.p0, coords.radial);
  const tangentialSep = sep(coords.p0, coords.tangential);
  const ratio = Math.max(radialSep, tangentialSep) / Math.max(Math.min(radialSep, tangentialSep), 1e-9);

  console.log(
    `\nequal ${(stepRad / D2R).toFixed(1)}-degree steps map to noise-space separations ` +
      `${radialSep.toFixed(5)} (radial) vs ${tangentialSep.toFixed(5)} (tangential)`,
  );
  if (Math.abs(ratio - 1.0) > ISO_TOLERANCE) {
    console.error(
      `FAIL  B2  noise sampling is no longer isotropic — ratio ${ratio.toFixed(4)}, ` +
        `expected 1.0 +/- ${ISO_TOLERANCE}. If a stretch was reintroduced deliberately, ` +
        `update this threshold in the same commit and say so in the message.`,
    );
    process.exit(1);
  }
  console.log(`PASS  B2  noise sampling is isotropic — ratio ${ratio.toFixed(4)}, expected 1.0 +/- ${ISO_TOLERANCE}`);
}
