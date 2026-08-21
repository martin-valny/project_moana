// QC for round "12.": does the round "11." fix (per-source energy range +
// monotonic front distance) actually hold across real tracks it wasn't
// built against, not just the one Mullaghmore track from round "10."?
//
// Reads each `phase-1-validation/output_*/swell_pulse*.json` produced by
// `to_swell_pulse.py`, builds a SwellSource from it the same way
// `buildSwellSources` does, and checks two properties directly against the
// exported functions the app actually renders with -- not by eyeballing
// screenshots.
//
// Usage: node --import ./ts-resolve-hook.mjs --experimental-strip-types qc-real-pulses.mjs
import { readFileSync } from 'node:fs';
import { energyRangeFor, frontDistanceRad, pulseSource } from './src/data/swellSources.ts';
import { interpolatePulseAt, normalizeEnergy } from './src/data/interpolate.ts';

const PULSE_FILES = [
  '../phase-1-validation/output_clean/swell_pulse_track35.json',
  '../phase-1-validation/output_clean2_ireland_nov2023/swell_pulse.json',
  '../phase-1-validation/output_clean3_nazare_feb2024/swell_pulse.json',
  '../phase-1-validation/output_clean4_nazare_jan2025/swell_pulse.json',
  '../phase-1-validation/output_pacific_2024/swell_pulse.json',
];

let anyFail = false;

for (const file of PULSE_FILES) {
  const pulse = JSON.parse(readFileSync(new URL(file, import.meta.url)));
  const source = pulseSource(pulse);
  const range = energyRangeFor(source);

  const startMs = new Date(pulse.path[0].timestamp).getTime();
  const endMs = new Date(pulse.path[pulse.path.length - 1].timestamp).getTime();

  // Sample densely across the track's own span -- finer than the raw
  // waypoints, so this also exercises interpolated points between them,
  // not just the exact hours the tracker happened to report.
  const N = 200;
  let prevFront = -Infinity;
  let monotonicOk = true;
  let worstRegression = 0;
  const amps = [];

  for (let i = 0; i <= N; i++) {
    const t = new Date(startMs + ((endMs - startMs) * i) / N);
    const at = interpolatePulseAt(pulse, t);
    const front = frontDistanceRad(pulse, source.origin, at);
    if (front < prevFront - 1e-9) {
      monotonicOk = false;
      worstRegression = Math.max(worstRegression, prevFront - front);
    }
    prevFront = Math.max(prevFront, front);
    amps.push(normalizeEnergy(at.energy, range));
  }

  const nAtMax = amps.filter((a) => a >= 0.999).length;
  const nAtMin = amps.filter((a) => a <= 0.001).length;
  const flatnessOk = nAtMax <= 2 && nAtMin <= 2; // only the true peak/trough should ever pin the ends

  const label = pulse.name || pulse.id;
  const status = monotonicOk && flatnessOk ? 'PASS' : 'FAIL';
  if (status === 'FAIL') anyFail = true;

  console.log(
    `${status} ${label} | range ${range.min.toFixed(0)}-${range.max.toFixed(0)} | ` +
      `front monotonic: ${monotonicOk} (worst regression ${worstRegression.toFixed(5)} rad) | ` +
      `amp clamped-high: ${nAtMax}/${N + 1}, clamped-low: ${nAtMin}/${N + 1}`,
  );
}

if (anyFail) {
  console.error('\nQC FAILED for at least one real pulse.');
  process.exit(1);
}
console.log('\nAll real pulses pass: front distance never regresses, energy never flat-clamps.');
