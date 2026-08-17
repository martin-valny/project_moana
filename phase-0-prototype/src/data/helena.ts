import type { SwellPathPoint, SwellPulse } from './types';

/**
 * Phase 0 hardcoded fake swell — MASTER_BUILD_PLAN.md §8:
 * "Hard-code one fake swell path ('Helena') crossing the North Atlantic
 * as local TypeScript data." No live data, no backend, nothing derived
 * from phase-1-validation's real fetches.
 *
 * Geometry is loosely modelled on the shape of a real North Atlantic
 * groundswell (mid-ocean generation west of Ireland, easing period as
 * it shoals near the coast — the same real signal noted in
 * PROGRESS.md's Phase −1 findings) but every number below is invented
 * for this prototype, not sourced from any dataset.
 */

interface RawWaypoint {
  offsetHours: number;
  lat: number;
  lon: number;
  swell_height: number; // metres
  swell_period: number; // seconds
  heading_deg: number; // compass bearing the swell is travelling toward
}

// Origin ~1000km SW of the mid-Atlantic, arriving on Ireland's west coast.
const RAW_PATH: RawWaypoint[] = [
  { offsetHours: -18, lat: 39.8, lon: -52.0, swell_height: 2.6, swell_period: 13.5, heading_deg: 110 },
  { offsetHours: -12, lat: 41.0, lon: -49.0, swell_height: 2.9, swell_period: 14.0, heading_deg: 109 },
  { offsetHours: -6, lat: 42.3, lon: -46.0, swell_height: 3.3, swell_period: 14.8, heading_deg: 107 },
  { offsetHours: 0, lat: 43.6, lon: -43.0, swell_height: 3.7, swell_period: 15.5, heading_deg: 106 },
  { offsetHours: 6, lat: 44.9, lon: -40.0, swell_height: 4.0, swell_period: 16.0, heading_deg: 104 },
  { offsetHours: 12, lat: 46.1, lon: -37.0, swell_height: 4.3, swell_period: 16.4, heading_deg: 103 },
  { offsetHours: 18, lat: 47.2, lon: -34.0, swell_height: 4.5, swell_period: 16.6, heading_deg: 101 },
  { offsetHours: 24, lat: 48.2, lon: -31.0, swell_height: 4.6, swell_period: 16.7, heading_deg: 100 },
  { offsetHours: 30, lat: 49.1, lon: -28.0, swell_height: 4.6, swell_period: 16.6, heading_deg: 99 },
  { offsetHours: 36, lat: 49.9, lon: -25.0, swell_height: 4.5, swell_period: 16.4, heading_deg: 98 },
  { offsetHours: 42, lat: 50.6, lon: -22.0, swell_height: 4.4, swell_period: 16.1, heading_deg: 97 },
  { offsetHours: 48, lat: 51.2, lon: -19.0, swell_height: 4.2, swell_period: 15.7, heading_deg: 96 },
  { offsetHours: 54, lat: 51.8, lon: -16.5, swell_height: 4.0, swell_period: 15.2, heading_deg: 95 },
  { offsetHours: 60, lat: 52.3, lon: -14.2, swell_height: 3.8, swell_period: 14.7, heading_deg: 94 },
  { offsetHours: 66, lat: 52.8, lon: -12.2, swell_height: 3.6, swell_period: 14.1, heading_deg: 93 },
  { offsetHours: 72, lat: 53.2, lon: -10.6, swell_height: 3.5, swell_period: 13.6, heading_deg: 92 },
  { offsetHours: 78, lat: 53.6, lon: -9.6, swell_height: 3.6, swell_period: 13.1, heading_deg: 91 },
  { offsetHours: 84, lat: 53.9, lon: -9.0, swell_height: 3.4, swell_period: 12.6, heading_deg: 90 },
  { offsetHours: 90, lat: 54.15, lon: -8.7, swell_height: 2.6, swell_period: 12.0, heading_deg: 88 },
  { offsetHours: 96, lat: 54.3, lon: -8.5, swell_height: 1.4, swell_period: 11.2, heading_deg: 86 },
];

export const HELENA_MIN_OFFSET_HOURS = RAW_PATH[0].offsetHours;
export const HELENA_MAX_OFFSET_HOURS = RAW_PATH[RAW_PATH.length - 1].offsetHours;

/**
 * Short uppercase descriptor for the UI panel (visual-engine brief stage
 * 7) — not part of the §9.1 data contract, a Phase-0-only display
 * convenience for this one hardcoded swell.
 */
export const HELENA_SHORT_LABEL = 'Long-period WNW pulse';

/** §4.4: energy is always the derived H² × T proxy, never a hand-picked number. */
function energyOf(height: number, period: number): number {
  return height * height * period;
}

/**
 * Builds Helena anchored to `startTime` (defaults to app load time), so
 * "Now" in the time scrubber always lines up with whenever a person
 * actually opens the prototype, rather than a fixed historical date.
 */
export function buildHelenaPulse(startTime: Date = new Date()): SwellPulse {
  const startMs = startTime.getTime();

  const path: SwellPathPoint[] = RAW_PATH.map((wp) => ({
    timestamp: new Date(startMs + wp.offsetHours * 60 * 60 * 1000).toISOString(),
    lat: wp.lat,
    lon: wp.lon,
    energy: energyOf(wp.swell_height, wp.swell_period),
    swell_height: wp.swell_height,
    swell_period: wp.swell_period,
    heading_deg: wp.heading_deg,
  }));

  return {
    id: 'helena-phase0',
    name: 'Helena',
    first_detected_at: path[0].timestamp,
    ended_at: null,
    parent_id: null,
    origin_basin: 'north_atlantic',
    category: 'groundswell',
    path,
    narrative_description:
      'Long-period WNW groundswell crossing the North Atlantic, arriving on the west coast of Ireland.',
  };
}
