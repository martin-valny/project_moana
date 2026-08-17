import type { SwellPathPoint, SwellPulse } from './types';

/** Shortest-path circular lerp for compass bearings (handles the 350°→10° wrap). */
function lerpAngleDeg(a: number, b: number, t: number): number {
  let diff = ((b - a + 540) % 360) - 180;
  return (a + diff * t + 360) % 360;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolated position/state of a pulse at an arbitrary point in time,
 * clamped to the path's own start/end. This is the only thing the time
 * scrubber is allowed to move (§8 Phase 0): it reads Helena's hardcoded
 * path at a different moment, nothing else.
 */
export function interpolatePulseAt(pulse: SwellPulse, timestamp: Date): SwellPathPoint {
  const t = timestamp.getTime();
  const path = pulse.path;

  if (t <= new Date(path[0].timestamp).getTime()) return path[0];
  if (t >= new Date(path[path.length - 1].timestamp).getTime()) return path[path.length - 1];

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const aT = new Date(a.timestamp).getTime();
    const bT = new Date(b.timestamp).getTime();
    if (t >= aT && t <= bT) {
      const frac = (t - aT) / (bT - aT);
      return {
        timestamp: timestamp.toISOString(),
        lat: lerp(a.lat, b.lat, frac),
        lon: lerp(a.lon, b.lon, frac),
        energy: lerp(a.energy, b.energy, frac),
        swell_height: lerp(a.swell_height, b.swell_height, frac),
        swell_period: lerp(a.swell_period, b.swell_period, frac),
        heading_deg: lerpAngleDeg(a.heading_deg, b.heading_deg, frac),
      };
    }
  }

  return path[path.length - 1];
}

/**
 * Normalises §4.4's H²×T energy proxy to 0..1 for shader consumption.
 * The range is Helena's own min/max (roughly 22 at her weakest, 353 at
 * peak) — reasonable for a single hardcoded Phase 0 swell, not a
 * general-purpose calibration. Revisit once a real populated
 * `SwellFieldFrame` exists to normalise against.
 */
const ENERGY_RANGE = { min: 0, max: 400 };

export function normalizeEnergy(energy: number): number {
  return Math.min(1, Math.max(0, (energy - ENERGY_RANGE.min) / (ENERGY_RANGE.max - ENERGY_RANGE.min)));
}
