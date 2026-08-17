/**
 * Shared data contracts — mirrors MASTER_BUILD_PLAN.md §9.1.
 *
 * Phase 0 only ever populates these from hardcoded local data
 * (src/data/helena.ts). Nothing here should assume a live API —
 * that assumption arrives in Phase 1/2, and this file is the
 * contract those phases port forward unchanged.
 */

export type Basin =
  | 'north_atlantic'
  | 'south_atlantic'
  | 'north_pacific'
  | 'south_pacific'
  | 'indian_ocean'
  | 'southern_ocean'
  | 'arctic_ocean';

export type SwellCategory = 'groundswell' | 'wind_sea';

/** One waypoint in a tracked pulse's path — one entry per timestamp. */
export interface SwellPathPoint {
  timestamp: string; // ISO 8601
  lat: number;
  lon: number;
  /** H² × T proxy (§4.4). Arbitrary but consistent units across the app. */
  energy: number;
  swell_height: number; // metres
  swell_period: number; // seconds
  /** Compass bearing (0-360, from true north) the swell is travelling TOWARD. */
  heading_deg: number;
}

/** A single tracked, followable system — §9.1 SwellPulse. */
export interface SwellPulse {
  id: string;
  name: string;
  first_detected_at: string; // ISO 8601
  ended_at: string | null; // null while active
  parent_id: string | null; // null unless split from another pulse
  origin_basin: Basin;
  category: SwellCategory;
  path: SwellPathPoint[];
  narrative_description: string;
}

/** The three fixed points Phase 0's time scrubber can land on. */
export type ScrubberStop = 'now' | 'tomorrow' | 'three_days';

export const SCRUBBER_OFFSETS_HOURS: Record<ScrubberStop, number> = {
  now: 0,
  tomorrow: 24,
  three_days: 72,
};

export const SCRUBBER_LABELS: Record<ScrubberStop, string> = {
  now: 'Now',
  tomorrow: 'Tomorrow',
  three_days: '3 Days',
};
