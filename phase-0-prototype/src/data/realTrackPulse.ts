import type { SwellPathPoint, SwellPulse } from './types';

/**
 * Ingestion spike (PROGRESS.md "What's next" — round "10."), now promoted
 * to a real source: every number below comes from
 * `phase-1-validation/to_swell_pulse.py`, which runs the real clustering +
 * tracking pipeline (`clustering.py` / `tracking.py`) against real,
 * already-fetched Open-Meteo Marine API data
 * (`phase-1-validation/raw_clean.json`, the Dec 2025 Mullaghmore event) at
 * the plan's own validated `period_threshold=11` setting, and picks the one
 * track that passed the §8 clean-window bar (90h / 3619km — see
 * `test_event.py raw_clean.json`). Track id 35 of that run.
 *
 * Built the same way `helena.ts` builds its pulse (derived bearing/energy,
 * not hand-written) so any difference in how this reads on the globe comes
 * from the data, not from a second, differently-written construction path.
 * `offsetHours` is shifted so the track's own start lines up with -18h,
 * the same Timeline origin Helena uses, so both are comparable across the
 * same -18h..96h scrub range and the same "3 Days" (72h) stop the round
 * 14-17 comparison frames were judged at.
 */

interface RawWaypoint {
  offsetHours: number;
  lat: number;
  lon: number;
  swell_height: number; // metres, back-derived from the cluster's energy/period (see to_swell_pulse.py)
  swell_period: number; // seconds, energy-weighted mean of the cluster's member cells
}

const RAW_PATH: RawWaypoint[] = [
  { offsetHours: -18, lat: 46.583, lon: -43.75, swell_height: 9.11, swell_period: 12.32 },
  { offsetHours: -12, lat: 48.757, lon: -40.027, swell_height: 9.16, swell_period: 12.85 },
  { offsetHours: -6, lat: 49.719, lon: -37.907, swell_height: 7.69, swell_period: 13.13 },
  { offsetHours: 0, lat: 50.203, lon: -33.135, swell_height: 8.15, swell_period: 13.41 },
  { offsetHours: 6, lat: 49.153, lon: -34.012, swell_height: 7.35, swell_period: 13.37 },
  { offsetHours: 12, lat: 48.613, lon: -31.228, swell_height: 7.05, swell_period: 13.43 },
  { offsetHours: 18, lat: 46.679, lon: -29.141, swell_height: 6.52, swell_period: 13.33 },
  { offsetHours: 24, lat: 45.622, lon: -28.763, swell_height: 5.79, swell_period: 13.34 },
  { offsetHours: 30, lat: 43.764, lon: -28.785, swell_height: 5.01, swell_period: 12.86 },
  { offsetHours: 36, lat: 41.573, lon: -24.509, swell_height: 4.9, swell_period: 12.53 },
  { offsetHours: 42, lat: 39.329, lon: -25.196, swell_height: 4.41, swell_period: 12.13 },
  { offsetHours: 48, lat: 37.647, lon: -29.671, swell_height: 3.76, swell_period: 12.06 },
  { offsetHours: 54, lat: 36.419, lon: -31.24, swell_height: 3.4, swell_period: 11.93 },
  { offsetHours: 60, lat: 35.864, lon: -31.85, swell_height: 3.46, swell_period: 11.95 },
  { offsetHours: 66, lat: 37.323, lon: -30.464, swell_height: 4.09, swell_period: 12.1 },
  { offsetHours: 72, lat: 36.752, lon: -28.528, swell_height: 4.14, swell_period: 12.32 },
];

export const REAL_TRACK_MIN_OFFSET_HOURS = RAW_PATH[0].offsetHours;
export const REAL_TRACK_MAX_OFFSET_HOURS = RAW_PATH[RAW_PATH.length - 1].offsetHours;

function bearingDeg(a: RawWaypoint, b: RawWaypoint): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function energyOf(height: number, period: number): number {
  return height * height * period;
}

export function buildRealTrackPulse(startTime: Date = new Date()): SwellPulse {
  const startMs = startTime.getTime();

  const path: SwellPathPoint[] = RAW_PATH.map((wp, i) => {
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
    id: 'real-track-spike',
    name: 'Track 35',
    first_detected_at: path[0].timestamp,
    ended_at: null,
    parent_id: null,
    origin_basin: 'north_atlantic',
    category: 'groundswell',
    path,
    narrative_description:
      'Real North Atlantic groundswell tracked from Open-Meteo Marine API data ' +
      '(Dec 2025 Mullaghmore event), period_threshold=11 — from the ingestion spike, promoted to a real source.',
  };
}
