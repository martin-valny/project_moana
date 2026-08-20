import { Vector3 } from 'three';
import { latLonToVector3 } from '../three/geo';
import { HELENA_MIN_OFFSET_HOURS } from './helena';
import { interpolatePulseAt, normalizeEnergy } from './interpolate';
import { packetAmplitude, packetAt, packetFromFront, type SwellSourceState, type Vec3 } from './swellField';
import type { SwellPulse } from './types';

/**
 * Generating storms for the globe's swell-propagation field (round 9).
 *
 * Before this, the ocean surface was noise stretched along ONE global
 * direction taken from Helena's compass heading — every fragment on the
 * planet smeared the same way, which is exactly what it looked like. Here
 * each source radiates along great circles from its own storm, so flow
 * direction varies across the globe and the field actually means something:
 * where each swell has reached, and where it can still go.
 *
 * **Every source except Helena is invented for this prototype.** Phase 0 is
 * explicitly hardcoded-fake-data (MASTER_BUILD_PLAN.md §8) and Helena
 * herself is invented too, so this is in scope — but nothing here is
 * sourced from real forecast data, and none of it should survive into
 * Phase 1+, which replaces the lot with a real `SwellFieldFrame`.
 *
 * The positions are plausible rather than arbitrary: they sit in the
 * basins that actually generate long-period groundswell (the Southern
 * Ocean storm belt, the Aleutian low, the North Atlantic), and one of them
 * deliberately mirrors the real July 2024 New-Zealand-to-California event
 * that Phase −1 validated against real data.
 */

/** Must match `MAX_SOURCES` in the globe shader; the shader is templated from this. */
export const MAX_SWELL_SOURCES = 6;

export interface SwellSource {
  id: string;
  name: string;
  /** Unit vector of the generating storm's position. */
  origin: Vector3;
  /** Unit tangent at `origin`, pointing the way the swell travels. */
  direction: Vector3;
  periodS: number;
  heightM: number;
  /** Hours relative to app-load time at which this storm generated its swell. */
  spawnOffsetHours: number;
  /**
   * Set only for Helena. When present, her leading edge is read from her own
   * waypoint path instead of being propagated at `Cg` — see
   * `resolveSwellSources` for why.
   */
  pulse?: SwellPulse;
}

/**
 * Surface-tangent vector for a compass bearing at a given point.
 *
 * A bearing only means something relative to a position — the same bearing
 * points in a different 3D direction at every point on a sphere — so build
 * the real local north/east basis by differencing the sphere mapping rather
 * than collapsing everything into the equatorial plane.
 */
function tangentAt(lat: number, lon: number, bearingDeg: number): Vector3 {
  const eps = 0.35;
  const here = latLonToVector3(lat, lon, 1);
  const north = latLonToVector3(lat + eps, lon, 1).sub(here).normalize();
  const east = latLonToVector3(lat, lon + eps, 1).sub(here).normalize();
  const bearing = (bearingDeg * Math.PI) / 180;
  return north
    .multiplyScalar(Math.cos(bearing))
    .add(east.multiplyScalar(Math.sin(bearing)))
    .normalize();
}

interface RawSource {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Compass bearing the swell travels *toward*. */
  bearingDeg: number;
  periodS: number;
  heightM: number;
  spawnOffsetHours: number;
}

// All invented (see the file header). Spawn offsets are staggered so the
// fronts sit at different radii at any given moment — if they all spawned
// together the globe would show one synchronised pulse, which is not what
// a real ocean looks like.
const INVENTED: RawSource[] = [
  {
    id: 'kaimana',
    name: 'Kaimana',
    lat: -55,
    lon: -175,
    bearingDeg: 25, // NNE toward Tahiti / Hawaii — the real 2024 corridor
    periodS: 17,
    heightM: 5.2,
    // Round 9 pulled every spawn offset late (to -12..-30h) because a
    // filled disc sector that had been growing for 40+ hours blanketed most
    // of the visible hemisphere, leaving nothing to watch grow.
    //
    // Round 14 inverts that constraint. A dispersive packet is a thin band,
    // not a filled disc, so age no longer means coverage — it means a
    // *wider, softer* band that has travelled further, which is exactly the
    // reference's proportions (long ribbons, not small arcs). At -16h this
    // source opened as a 15-degree crescent 4.4 degrees wide; measured, the
    // reference's bands read far longer and broader than that.
    //
    // Offsets are now spread deliberately unevenly (-20 to -60h) so the
    // opening frame holds packets at genuinely different stages — a young
    // tight one, a couple mid-journey, one broad and fading — rather than
    // six variations of the same age. Real oceans are not synchronised.
    spawnOffsetHours: -38,
  },
  {
    id: 'auster',
    name: 'Auster',
    lat: -50,
    lon: 95,
    bearingDeg: 40,
    periodS: 16,
    heightM: 4.6,
    spawnOffsetHours: -52,
  },
  {
    id: 'aleutian',
    name: 'Aleutia',
    lat: 46,
    lon: 170,
    bearingDeg: 105, // ESE toward North America
    periodS: 15.5,
    heightM: 4.8,
    spawnOffsetHours: -60,
  },
  {
    id: 'meridian',
    name: 'Meridian',
    lat: -45,
    lon: -25,
    bearingDeg: 335, // NNW up the South Atlantic
    periodS: 14.5,
    heightM: 3.9,
    spawnOffsetHours: -30,
  },
  {
    id: 'boreas',
    name: 'Boreas',
    lat: 62,
    lon: -18,
    bearingDeg: 200, // SSW out of the Norwegian Sea
    periodS: 13,
    heightM: 3.4,
    spawnOffsetHours: -20,
  },
];

function toSource(raw: RawSource): SwellSource {
  return {
    id: raw.id,
    name: raw.name,
    origin: latLonToVector3(raw.lat, raw.lon, 1),
    direction: tangentAt(raw.lat, raw.lon, raw.bearingDeg),
    periodS: raw.periodS,
    heightM: raw.heightM,
    spawnOffsetHours: raw.spawnOffsetHours,
  };
}

/**
 * Helena plus the invented sources.
 *
 * Helena's entry is derived from her own first waypoint rather than
 * restated — position, period, height and heading all come off
 * `pulse.path[0]`, so her source and her rendered path cannot disagree.
 * (An earlier round shipped a hand-written heading that contradicted the
 * waypoints it was meant to describe; deriving is what stops that.)
 */
export function buildSwellSources(pulse: SwellPulse): SwellSource[] {
  const first = pulse.path[0];

  const helena: SwellSource = {
    id: pulse.id,
    name: pulse.name,
    origin: latLonToVector3(first.lat, first.lon, 1),
    direction: tangentAt(first.lat, first.lon, first.heading_deg),
    periodS: first.swell_period,
    heightM: first.swell_height,
    spawnOffsetHours: HELENA_MIN_OFFSET_HOURS,
    pulse,
  };

  return [helena, ...INVENTED.map(toSource)].slice(0, MAX_SWELL_SOURCES);
}

/**
 * Resolves every source to its state at one moment — the packet geometry and
 * amplitude the shader renders and hit-testing reads.
 *
 * **Helena's leading edge comes from her own waypoints, not from `Cg`.** Her
 * hardcoded path (`helena.ts`) covers 3594 km in 114 h — about 32 km/h —
 * while her stated ~14.8 s mean period implies a group velocity of ~83 km/h.
 * That is a 2.6x disagreement (9x on her final legs, where she shoals and
 * the track genuinely decelerates). Rounds 9-13 hid it: the field was a flat
 * plateau, so nobody could see where its edge was. Round 14 makes the
 * leading edge the brightest, most meaningful feature *and* drives the
 * panel's arc glyph off the same waypoints, so a `Cg`-propagated front would
 * have raced visibly ahead of where the glyph says she is.
 *
 * Deriving one from the other is this project's standing fix for exactly
 * this shape of bug — the hand-written heading that contradicted its own
 * waypoints, the 'WNW' label on an ENE path. The invented storms keep `Cg`
 * because they have no path: for them, `Cg` *is* the data.
 */
export function resolveSwellSources(
  sources: readonly SwellSource[],
  startTime: Date,
  offsetHours: number,
): SwellSourceState[] {
  return sources.map((s) => {
    // A path-backed source carries a time series, so read it. Everything
    // below that can evolve — position, height, period — comes from the
    // waypoint interpolated at this moment rather than from a scalar frozen
    // at build time.
    const at = s.pulse
      ? interpolatePulseAt(s.pulse, new Date(startTime.getTime() + offsetHours * 3600_000))
      : undefined;

    // Direction is deliberately NOT interpolated: a packet's heading is set
    // when the storm generates it and does not change afterwards. Swinging
    // it with the current waypoint would rotate the whole packet, including
    // the part already far behind the front.
    const periodS = at ? at.swell_period : s.periodS;

    const packet = at
      ? packetFromFront(
          Math.acos(Math.max(-1, Math.min(1, s.origin.dot(latLonToVector3(at.lat, at.lon, 1))))),
          periodS,
        )
      : packetAt(s.periodS, offsetHours - s.spawnOffsetHours);

    // Helena's energy used to be taken from `pulse.path[0]` and never
    // updated, which meant the hero swell rendered at her own *weakest*
    // moment for the whole session: path[0] is 2.6 m / 13.5 s (energy 0.23
    // normalised) while she peaks at 4.6 m / 16.7 s (0.88). Measured at the
    // opening frame she came out at amp 0.194 — the dimmest source on the
    // globe, against Kaimana's 0.637 — so the swell the panel is about was
    // the hardest one to see. Same shape of bug as her front speed: a scalar
    // frozen at build time standing in for a series that was right there.
    const energy = normalizeEnergy(
      at ? at.energy : s.heightM * s.heightM * s.periodS,
    );
    const ramp = spawnRamp01(s.spawnOffsetHours, offsetHours);

    return {
      origin: s.origin.toArray() as unknown as Vec3,
      direction: s.direction.toArray() as unknown as Vec3,
      rLead: packet.rLead,
      rTrail: packet.rTrail,
      amp: energy * ramp * packetAmplitude(packet),
      periodS,
    };
  });
}

const EARTH_RADIUS_KM = 6371;

/**
 * How far (in radians of great-circle angle, since the globe is a literal
 * unit sphere) a source's front has travelled by `forecastHours`.
 *
 * `Cg = 1.56 * period` (deep-water group velocity, m/s) is the same formula
 * `phase-1-validation/physics.py`'s `group_velocity_kmh` uses for the real
 * Phase −1 validation work — deliberately the same number in both places
 * rather than a separately-invented one, even though this consumer is a
 * decorative visualisation and that one was a falsifiable data check.
 */
export function angularFrontDistanceRad(periodS: number, spawnOffsetHours: number, forecastHours: number): number {
  const elapsedHours = Math.max(0, forecastHours - spawnOffsetHours);
  const groupVelocityKmH = 1.56 * periodS * 3.6;
  const distanceKm = groupVelocityKmH * elapsedHours;
  return distanceKm / EARTH_RADIUS_KM;
}

const SPAWN_RAMP_HOURS = 4;

/**
 * How much of a source's full energy should render at `forecastHours`,
 * given it started generating at `spawnOffsetHours`. Round 12: the
 * timeline scrubber's range already reaches back before every invented
 * source's own spawn time (so a user can scrub into the genuine past, not
 * just forward), and `angularFrontDistanceRad` already clamps to a 0
 * radius before spawn — but energy itself was never gated the same way,
 * so a source rendered as a small fixed dot at its own origin regardless
 * of whether it had started yet. This fades a source in linearly over its
 * first `SPAWN_RAMP_HOURS`, so scrubbing to before it exists shows
 * genuinely nothing.
 */
export function spawnRamp01(spawnOffsetHours: number, forecastHours: number): number {
  const t = (forecastHours - spawnOffsetHours) / SPAWN_RAMP_HOURS;
  return Math.min(1, Math.max(0, t));
}
