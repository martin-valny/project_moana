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
 *
 * The ingestion spike (PROGRESS.md "What's next" — round "10.") found that a
 * fixed 0..400 range, calibrated only to Helena's own invented 22-353 span,
 * was the bug: real tracked energy measures 138-2,497 across the real
 * windows in `phase-1-validation/` (see `to_swell_pulse.py`'s output and the
 * other four `raw_*` files), so a fixed Helena-only ceiling clamped roughly
 * half of a real track's points to maximum brightness and flattened round
 * 14's leading-edge-brightest motion cue. There is no single fixed number
 * that is "the real range" — a bigger storm always exists — so `range` is now
 * a required parameter instead of a module constant: callers compute it from
 * whichever sources are actually on screen (`computeEnergyRange` in
 * `swellSources.ts`) so relative brightness stays meaningful for whatever mix
 * of invented and real sources is loaded, rather than being pinned to one
 * dataset's numbers.
 */
export function normalizeEnergy(energy: number, range: { min: number; max: number }): number {
  return Math.min(1, Math.max(0, (energy - range.min) / (range.max - range.min)));
}
