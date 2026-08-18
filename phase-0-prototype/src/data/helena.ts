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
}

// Origin ~1000km SW of the mid-Atlantic, arriving on Ireland's west coast.
const RAW_PATH: RawWaypoint[] = [
  { offsetHours: -18, lat: 39.8, lon: -52.0, swell_height: 2.6, swell_period: 13.5 },
  { offsetHours: -12, lat: 41.0, lon: -49.0, swell_height: 2.9, swell_period: 14.0 },
  { offsetHours: -6, lat: 42.3, lon: -46.0, swell_height: 3.3, swell_period: 14.8 },
  { offsetHours: 0, lat: 43.6, lon: -43.0, swell_height: 3.7, swell_period: 15.5 },
  { offsetHours: 6, lat: 44.9, lon: -40.0, swell_height: 4.0, swell_period: 16.0 },
  { offsetHours: 12, lat: 46.1, lon: -37.0, swell_height: 4.3, swell_period: 16.4 },
  { offsetHours: 18, lat: 47.2, lon: -34.0, swell_height: 4.5, swell_period: 16.6 },
  { offsetHours: 24, lat: 48.2, lon: -31.0, swell_height: 4.6, swell_period: 16.7 },
  { offsetHours: 30, lat: 49.1, lon: -28.0, swell_height: 4.6, swell_period: 16.6 },
  { offsetHours: 36, lat: 49.9, lon: -25.0, swell_height: 4.5, swell_period: 16.4 },
  { offsetHours: 42, lat: 50.6, lon: -22.0, swell_height: 4.4, swell_period: 16.1 },
  { offsetHours: 48, lat: 51.2, lon: -19.0, swell_height: 4.2, swell_period: 15.7 },
  { offsetHours: 54, lat: 51.8, lon: -16.5, swell_height: 4.0, swell_period: 15.2 },
  { offsetHours: 60, lat: 52.3, lon: -14.2, swell_height: 3.8, swell_period: 14.7 },
  { offsetHours: 66, lat: 52.8, lon: -12.2, swell_height: 3.6, swell_period: 14.1 },
  { offsetHours: 72, lat: 53.2, lon: -10.6, swell_height: 3.5, swell_period: 13.6 },
  { offsetHours: 78, lat: 53.6, lon: -9.6, swell_height: 3.6, swell_period: 13.1 },
  { offsetHours: 84, lat: 53.9, lon: -9.0, swell_height: 3.4, swell_period: 12.6 },
  { offsetHours: 90, lat: 54.15, lon: -8.7, swell_height: 2.6, swell_period: 12.0 },
  { offsetHours: 96, lat: 54.3, lon: -8.5, swell_height: 1.4, swell_period: 11.2 },
];

export const HELENA_MIN_OFFSET_HOURS = RAW_PATH[0].offsetHours;
export const HELENA_MAX_OFFSET_HOURS = RAW_PATH[RAW_PATH.length - 1].offsetHours;

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/**
 * The compass sector a swell arrives *from* — swells are conventionally
 * named by origin, while `heading_deg` records where they are travelling
 * *to*, so this is the reciprocal bearing.
 *
 * Derived rather than written down for the same reason as the bearing
 * itself: a hardcoded 'WNW' label survived here while the path ran ENE
 * (i.e. genuinely from the WSW), so the panel was describing a swell the
 * data did not contain.
 */
export function originSector(headingDeg: number): string {
  const from = (headingDeg + 180) % 360;
  return COMPASS[Math.round(from / 22.5) % 16];
}

/** Short descriptor for the UI panel — display convenience, not part of §9.1. */
export function shortLabelFor(headingDeg: number): string {
  return `Long-period ${originSector(headingDeg)} pulse`;
}

/**
 * Great-circle initial bearing from one waypoint to the next, in degrees.
 *
 * Heading is *derived* rather than hand-written per waypoint: an earlier
 * version carried both, and they disagreed — the literals said ~100° (ESE)
 * while the path itself runs ~62° (ENE). Anything reading heading (the globe
 * shader's flow direction, most visibly) then pointed the wrong way. Deriving
 * it makes the two impossible to desync.
 */
function bearingDeg(a: RawWaypoint, b: RawWaypoint): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

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

  const path: SwellPathPoint[] = RAW_PATH.map((wp, i) => {
    // Last point has no successor, so it keeps the bearing it arrived on.
    const [from, to] = i < RAW_PATH.length - 1 ? [wp, RAW_PATH[i + 1]] : [RAW_PATH[i - 1], wp];
    return {
      timestamp: new Date(startMs + wp.offsetHours * 60 * 60 * 1000).toISOString(),
      lat: wp.lat,
      lon: wp.lon,
      energy: energyOf(wp.swell_height, wp.swell_period),
      swell_height: wp.swell_height,
      swell_period: wp.swell_period,
      heading_deg: bearingDeg(from, to),
    };
  });

  return {
    id: 'helena-phase0',
    name: 'Helena',
    first_detected_at: path[0].timestamp,
    ended_at: null,
    parent_id: null,
    origin_basin: 'north_atlantic',
    category: 'groundswell',
    path,
    narrative_description: `Long-period ${originSector(
      path[0].heading_deg,
    )} groundswell crossing the North Atlantic, arriving on the west coast of Ireland.`,
  };
}
