/**
 * Renders ONLY the ocean's noise term `n`, over a patch spanning a real mature
 * packet — no colour ramp, no lighting, no bloom, no camera, no postprocessing.
 * Anything visible in the output is the noise field's own structure and
 * nothing else.
 *
 *   node --import ./ts-resolve-hook.mjs --experimental-strip-types noise-field-probe.mjs
 *
 * ## Why this exists
 *
 * Round 23's banding could not be judged from app screenshots. Shot through
 * the real scene at the default framing, the pre-round-23 build and the fixed
 * one look nearly identical: the colour ramp, the packet envelope, ACES and
 * bloom all compress the very structure under test, and whether the defect is
 * legible at all depends on camera angle, zoom and pixel density. Rounds "22."
 * and "22b." both signed off on app screenshots taken that way, and both
 * shipped a build the user immediately reported as still banded.
 *
 * Stripping the pipeline back to `n` removes every one of those variables. The
 * patch is parameterised so the packet's leading edge runs horizontally across
 * the frame, which means shear along the propagation direction shows up as
 * horizontal smearing — the artifact points one way, by construction.
 *
 * `uMode 0` is a frozen reproduction of the pre-round-23 sampling map, kept
 * verbatim as this round's evidence: it is deliberately NOT wired to the
 * shipping code, so deleting `f` and the drift terms could not quietly delete
 * the counterexample too. `uMode 1` calls the real shared functions.
 *
 * Measured with this (period 15 s at 48 h, scrub 96 h):
 *   old, t=0    — hard horizontal smear across the leading edge (at rest!)
 *   old, t=264  — pronounced horizontal lanes through the packet body
 *   new, t=264  — isotropic marbling, no directional structure
 *   new, t=3600 — unchanged after an hour of idle
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { SWELL_FIELD_GLSL } from './src/data/swellField.ts';
import { SIMPLEX_NOISE_GLSL } from './src/three/shaders/noise.ts';
import { FBM_GLSL } from './src/three/shaders/fbm.ts';

const W = 900, H = 700;
const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// uMode 0 = pre-round-23 map, 1 = round-23 map. Everything else identical.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uTime;
uniform float uScrubHours;
uniform int uMode;
uniform vec3 uS; uniform vec3 uD;
uniform float uRLead; uniform float uRTrail; uniform float uAmp;
uniform vec3 uE1; uniform vec3 uE2;

${SIMPLEX_NOISE_GLSL}
${FBM_GLSL}
${SWELL_FIELD_GLSL}

void main() {
  // Map the viewport onto a patch of the sphere around the packet: u sweeps
  // bearing about the storm, v sweeps angular distance across the whole band.
  vec2 uv = gl_FragCoord.xy / uRes;
  float bearing = (uv.x - 0.5) * 1.1;
  float arc = uRTrail - 0.10 + uv.y * ((uRLead + 0.10) - (uRTrail - 0.10));
  vec3 dir = normalize(uE1 * cos(bearing) + uE2 * sin(bearing));
  vec3 P = normalize(uS * cos(arc) + dir * sin(arc));

  float d = acos(clamp(dot(uS, P), -1.0, 1.0));
  float w = moanaSourceWeight(uS, uD, P, uRLead, uRTrail, uAmp, d);
  vec3 away = moanaFlow(uS, uD, P, d);
  float poleFade = smoothstep(0.0, MOANA_FLOW_POLE, d);
  float poleConfidence = w > 1e-4 ? clamp(poleFade, 0.0, 1.0) : 1.0;
  vec3 flowAccum = away * pow(w, 3.0);
  float flowMag = length(flowAccum);
  float dirConfidence = clamp(flowMag * 6.0, 0.0, 1.0) * poleConfidence;

  vec3 coord;
  vec3 evolve;
  if (uMode == 0) {
    vec3 f = flowMag > 1e-5 ? normalize(flowAccum) : vec3(0.0, 0.0, 1.0);
    coord = P * mix(1.0, 1.75, dirConfidence);
    const float COORD_DRIFT_BOUND = 1.4;
    coord += f * (COORD_DRIFT_BOUND * sin(uTime * (0.025 / COORD_DRIFT_BOUND)) + uScrubHours * 0.004) * dirConfidence;
    const vec3 EVOLVE_DRIFT_BOUND = vec3(1.3, 1.1, 1.5);
    evolve = f * 0.15 * dirConfidence
      + EVOLVE_DRIFT_BOUND * sin(uTime * (vec3(0.0091, 0.0069, 0.0113) / EVOLVE_DRIFT_BOUND));
  } else {
    coord = moanaNoiseCoord(P, uTime, uScrubHours);
    evolve = moanaNoiseEvolve(uTime);
  }

  // The ocean shader's own noise chain, verbatim (5 octaves = high tier).
  float n = warpedFbm(coord * 0.95, 5, 0.45, evolve);
  n += fbm(coord * 3.0, 5) * (uMode == 0 ? 0.06 : (0.06 + 0.08 * dirConfidence));
  float fieldEnergy01 = clamp(w * MOANA_FIELD_GAIN, 0.0, 1.0);
  n *= 0.75 + fieldEnergy01 * 0.9;

  // Same band/crest ramps the shader uses, rendered as plain grey.
  float band = smoothstep(-0.35, 0.52, n);
  float crest = pow(smoothstep(0.34, 0.70, n), 2.0);
  float g = clamp(band * 0.72 + crest * 0.5, 0.0, 1.0);
  fragColor = vec4(vec3(g), 1.0);
}`;

const D2R = Math.PI / 180;
const norm3 = (v) => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cross3 = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const latS = -55*D2R, lonS = -175*D2R;
const S = norm3([Math.cos(latS)*Math.cos(lonS), Math.sin(latS), Math.cos(latS)*Math.sin(lonS)]);
const Dv = norm3(cross3([0,1,0], S));
const E2 = norm3(cross3(S, Dv));
// period 15 s at 48 h
const RLEAD = 0.719, RTRAIL = 0.487, AMP = 0.410;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const shots = await page.evaluate(({ VERTEX, FRAG, W, H, S, Dv, E2, RLEAD, RTRAIL, AMP, cases }) => {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  const compile = (t, src) => { const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(prog, n);
  gl.viewport(0, 0, W, H);
  gl.uniform2f(U('uRes'), W, H);
  gl.uniform3fv(U('uS'), S); gl.uniform3fv(U('uD'), Dv);
  gl.uniform3fv(U('uE1'), Dv); gl.uniform3fv(U('uE2'), E2);
  gl.uniform1f(U('uRLead'), RLEAD); gl.uniform1f(U('uRTrail'), RTRAIL); gl.uniform1f(U('uAmp'), AMP);
  const out = {};
  for (const [name, mode, t, scrub] of cases) {
    gl.uniform1i(U('uMode'), mode);
    gl.uniform1f(U('uTime'), t);
    gl.uniform1f(U('uScrubHours'), scrub);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out[name] = Array.from(px);
  }
  return out;
}, { VERTEX, FRAG, W, H, S, Dv, E2, RLEAD, RTRAIL, AMP, cases: [
  ['old-t0-scrub96', 0, 0, 96],
  ['old-t264-scrub96', 0, 264, 96],
  ['new-t0-scrub96', 1, 0, 96],
  ['new-t264-scrub96', 1, 264, 96],
  ['new-t3600-scrub96', 1, 3600, 96],
]});
await browser.close();

for (const [name, arr] of Object.entries(shots)) {
  const png = new PNG({ width: W, height: H });
  // GL origin is bottom-left; flip so the leading edge reads at the top.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const si = ((H - 1 - y) * W + x) * 4, di = (y * W + x) * 4;
    png.data[di] = arr[si]; png.data[di+1] = arr[si+1]; png.data[di+2] = arr[si+2]; png.data[di+3] = 255;
  }
  fs.writeFileSync(`/tmp/nf-${name}.png`, PNG.sync.write(png));
  console.log(`/tmp/nf-${name}.png`);
}
