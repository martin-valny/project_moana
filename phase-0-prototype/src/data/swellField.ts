/**
 * Canonical swell-field math — round 14.
 *
 * **This module is the single source of truth for packet geometry.** Nothing
 * else in the codebase may re-derive it. Three consumers need the same
 * numbers and would otherwise each re-implement them:
 *
 *  - the ocean shader (`GlobeSphere.tsx`), via `SWELL_FIELD_GLSL` below
 *  - CPU-side hit-testing (`Globe.tsx`) — "which swell did that tap land on"
 *  - the offline metrics harness (`field-metrics.mjs`)
 *
 * A CPU/GPU divergence is this project's most expensive recurring bug class
 * (round 9's uniforms-cloning bug; the hardcoded-heading bug; the 'WNW'
 * label bug — all the same shape: two places holding what should be one
 * fact). The math genuinely has to exist in two languages here, so the TS
 * and GLSL below are written as deliberate line-by-line transliterations of
 * each other, and `parity-probe.mjs` asserts numerically that they agree
 * rather than trusting that they do.
 *
 * Deliberately dependency-free (no `three`, plain number triples) so the
 * metrics harness can import it under `node --experimental-strip-types`
 * without pulling in a renderer.
 *
 * ---
 *
 * ## What replaced what (round 14)
 *
 * Rounds 9-13 modelled each source as a **filled disc sector**: everything
 * inside a soft-capped radius lit up, with a mild fade toward the origin.
 * Measured on the CPU, that profile is a plateau — the on-axis weight varies
 * only ~1.5:1 across 70% of a swell's radius, and it *peaks at d ~ 0.7 x
 * front*, i.e. behind the swell's own leading edge, with the storm origin
 * still at 57% of peak. A filled sector reads as a region, not as a thing in
 * motion, which is what "the swell movement, body, entity has to be
 * intuitive" was describing.
 *
 * Here each source is instead a **dispersive packet**: a band between two
 * radii that stretches as it travels, because long-period components outrun
 * short ones. That is real groundswell behaviour (it is why a groundswell
 * arrives long-period-first), it costs nothing, and it makes position,
 * direction and age all fall out of one mechanism.
 */

export type Vec3 = readonly [number, number, number];

/** Earth radius, km — matches `phase-1-validation/physics.py`. */
export const EARTH_RADIUS_KM = 6371;

// --- Packet geometry ------------------------------------------------------
//
// A storm does not emit one period, it emits a spectrum. The long-period end
// of that spectrum travels fastest, so the packet a storm launches arrives
// spread out in time and space. These two offsets bracket the spectrum
// around a source's nominal period.

/** Fastest component in the packet, relative to nominal period (seconds). */
export const PERIOD_LEAD_S = 2.0;
/** Slowest component in the packet, relative to nominal period (seconds). */
export const PERIOD_TRAIL_S = -3.5;

/**
 * Floor on the band's angular width.
 *
 * A freshly-spawned packet is genuinely near-zero-width — physically correct
 * and visually useless, since it lands well under a pixel.
 *
 * Raised from 0.05 rad (2.9 deg) after renders showed the failure mode is
 * not invisibility but *shape*: a narrow annular sector reads as a crescent
 * moon, a hard-edged lens with a silhouette. Helena is the case that forced
 * it — her front is derived from her own slow waypoint path, so at "Now" she
 * is only 8 deg out, and a 2.9 deg band there rendered as a crisp little
 * moon rather than a wisp of weather. The edge-break-up noise in
 * `GlobeSphere.tsx` scales with band width too, so a band this narrow got
 * almost none of it.
 *
 * 0.12 rad (~7 deg) makes a young packet a soft cap rather than a thin arc,
 * and gives the jitter something to work with. M1 and M4 are unaffected:
 * both are scale-invariant in width by construction.
 */
export const MIN_BAND_WIDTH_RAD = 0.12;

/**
 * How far ahead of the leading edge the cutoff feathers out, **as a fraction
 * of band width** rather than an absolute angle.
 *
 * This started as a fixed 0.07 rad and the CPU harness rejected it
 * immediately: a packet's width grows ~10x over the scrubber (2.9 deg at
 * +6h, 26.7 deg at +96h), so any fixed feather is a small fraction of a
 * mature band and a *large* fraction of a young one. At +12h a 0.07 rad
 * feather made the leading edge softer than the trailing feather — the comet
 * pointing backwards, exactly inverting the direction cue it exists to
 * provide.
 *
 * Scaling with width makes the asymmetry scale-invariant instead: the tail
 * falls to half over 0.242x width (that is `0.5^(1/COMET_POWER)`), the front
 * over 0.075x width, so the front is consistently ~3.2x sharper than the
 * tail at every age. That ratio is what M4 asserts.
 */
export const FRONT_FEATHER_FRACTION = 0.15;

/**
 * Shapes the comet's tail. The envelope is `s^COMET_POWER` where s runs 0 at
 * the trailing edge to 1 at the leading edge, so the peak sits exactly at
 * the front and everything behind it falls away as a long feather.
 *
 * Lowered from 2.5 after the first renders: 2.5 concentrated so much of the
 * energy at the front that each packet read as a thin bright rim with a dark
 * interior — a crescent moon rather than a ribbon. The reference's bands are
 * broad and luminous along their whole length with the brightest line at the
 * spine, which is a gentler curve.
 *
 * Counter-intuitively this also *improves* M4: the front's sharpness comes
 * from FRONT_FEATHER_FRACTION, not from this, so flattening the tail widens
 * the gap between them (tail half-fall goes from 0.242x to 0.352x width
 * while the front's stays at 0.075x, taking the ratio from 3.2x to ~4.7x).
 */
export const COMET_POWER = 1.6;

/**
 * Floor on packet attenuation. Physically a packet decays to ~10% of its
 * initial amplitude by +96h; remapped to 0.35..1.0 so every swell stays
 * legible across the whole scrubber while decay still reads as decay.
 * A product decision, recorded here rather than buried in the shader.
 */
export const ATTEN_FLOOR = 0.35;

/**
 * Scales summed field energy into the 0..1 the colour chain consumes.
 *
 * **This constant exists to make round 13's failure structurally
 * impossible.** That round spent three tuning passes adjusting the colour
 * compositing while the variable driving it (`fieldEnergy01`) never left the
 * bottom third of its range — measured after the fact at mean 0.30, global
 * max 0.869, against a ramp that needed ~0.6 before it changed hue at all.
 * No amount of downstream tuning could have worked.
 *
 * The raw field has no reason to land in 0..1: it is a sum of envelope x
 * cone x amplitude terms, and its natural P99 across the scrubber measured
 * 0.385..0.654. 1.8 lifts that to 0.693..1.000 — the top of the range is
 * genuinely reached — while keeping clipping at 3.7% of covered pixels in
 * the worst frame, i.e. confined to the bright cores where the reference is
 * blown out anyway.
 *
 * Picked by sweeping against measured percentiles, and **guarded by M8** in
 * `field-metrics.mjs`: change the geometry so the range collapses again and
 * the harness fails rather than the look quietly degrading.
 */
export const FIELD_GAIN = 1.8;

/** Reference angular distance for lateral-spreading attenuation. */
const LATERAL_REF_RAD = 0.08;
const HALF_PI = Math.PI / 2;

/**
 * Directional cone: full strength within ~25 degrees of the travel bearing,
 * tapering to nothing by ~81.
 *
 * The outer bound was cos(60 deg) = 0.5 through rounds 9-13. Against a
 * dispersive packet that cut each band off abruptly at its ends, producing
 * the pointed horns of a crescent — a hard geometric silhouette where the
 * reference shows a ribbon that simply fades out. Widening the taper (and so
 * lengthening the fade) is what turns a crescent back into a filament.
 */
export const SPREAD_COS_FULL = 0.15;
export const SPREAD_COS_HALF = 0.906;

/**
 * Radii within which the bearing-from-origin singularity is suppressed.
 *
 * "Bearing away from a point on a sphere" has a singularity at that point
 * (the hairy-ball theorem) — bearing sweeps its full 360-degree range over a
 * physically tiny distance there. Rounds 9 and 10 both shipped visible
 * artifacts from it: a hard-edged kite at Helena's origin, then a pinwheel.
 *
 * **Round 14 had to split what was one 0.26 rad constant into two**, because
 * the geometry underneath it changed. Rounds 9-13 drew filled sectors whose
 * fronts reached 0.5-1.5 rad, so a 0.26 rad blend zone only ever affected a
 * small core near the origin. A dispersive packet is a *thin band*, and a
 * young one sits entirely inside 0.26 rad — Helena's is at d = 0.085..0.135
 * at "Now". Under the old single constant her whole packet was inside the
 * blend zone, so the directional cone blended to 1.0 and she rendered as an
 * omnidirectional ring rather than a fan. First render of the round showed
 * exactly that: hard-edged bubbles instead of swell.
 *
 * The two uses need different radii because they are guarding different
 * things:
 *
 * - `SPREAD_POLE_FADE_RAD` guards the *cone test*, which only misbehaves
 *   where bearing is genuinely undefined — a hair around d = 0. Small.
 * - `FLOW_POLE_FADE_RAD` guards the *flow direction* fed into the
 *   anisotropic noise warp, which is chaotic with respect to its sampling
 *   direction: a smooth rotation there still renders as a seam or spiral, so
 *   it needs the wider original zone.
 */
export const SPREAD_POLE_FADE_RAD = 0.04;
export const FLOW_POLE_FADE_RAD = 0.26;

export interface Packet {
  /** Angular radius of the fastest (leading) component, radians. */
  rLead: number;
  /** Angular radius of the slowest (trailing) component, radians. */
  rTrail: number;
  /** `rLead - rTrail`, floored at `MIN_BAND_WIDTH_RAD`. */
  width: number;
}

/** Deep-water group velocity, km/h. `Cg = 1.56 * T` m/s. */
export function groupVelocityKmH(periodS: number): number {
  return 1.56 * periodS * 3.6;
}

/** Angular distance a component of the given period covers in `hours`. */
export function angularDistanceRad(periodS: number, hours: number): number {
  return (groupVelocityKmH(Math.max(periodS, 0.1)) * Math.max(0, hours)) / EARTH_RADIUS_KM;
}

/**
 * The packet implied by a leading edge that is already known.
 *
 * Dispersion width is a fixed *fraction* of distance travelled — both edges
 * advance linearly in time, so their ratio is constant and depends only on
 * period:
 *
 *     width / rLead = ((T + LEAD) - (T + TRAIL)) / (T + LEAD)
 *
 * Expressing it this way is what lets a source whose front comes from
 * somewhere other than `Cg` still disperse correctly. Helena's front is
 * derived from her own waypoint path (her track runs ~2.6x slower than her
 * stated period implies — see `swellSources.ts`), and this keeps her band
 * the same proportion of her journey as everyone else's without pretending
 * she travels at `Cg`.
 *
 * `rLead` is authoritative and `rTrail` is derived by subtracting a width,
 * never the reverse — so the width floor can never push the trailing edge
 * past the leading one, and the front (the thing the eye reads as "where is
 * it now") is never perturbed by the floor.
 */
export function packetFromFront(rLead: number, periodS: number): Packet {
  const relativeWidth = (PERIOD_LEAD_S - PERIOD_TRAIL_S) / Math.max(periodS + PERIOD_LEAD_S, 0.1);
  const width = Math.max(rLead * relativeWidth, MIN_BAND_WIDTH_RAD);
  return { rLead, rTrail: rLead - width, width };
}

/**
 * The packet a `Cg`-propagated source has spread into after `elapsedHours`.
 * Algebraically identical to computing both edges independently — see
 * `packetFromFront` — but routed through the one formula.
 */
export function packetAt(periodS: number, elapsedHours: number): Packet {
  return packetFromFront(angularDistanceRad(periodS + PERIOD_LEAD_S, elapsedHours), periodS);
}

/**
 * How much a packet has faded, purely from geometry: it stretches as it
 * disperses, and it spreads laterally as it gets further from its origin.
 * Both dilute a fixed amount of energy over more area.
 *
 * Returns the raw 0..1 geometric factor; `ATTEN_FLOOR` is applied by
 * `packetAmplitude` so the unfloored value stays measurable.
 *
 * The `min(rLead, HALF_PI)` is a deliberate stylistic clamp, not physics: a
 * wavefront radiating from a point on a sphere genuinely re-converges past
 * the equator (antipodal focusing), so an unclamped `sin` would make a swell
 * brighten again as it crosses the far hemisphere. Real, but it reads as a
 * bug.
 */
export function packetAttenuation(packet: Packet): number {
  const stretch = Math.sqrt(MIN_BAND_WIDTH_RAD / Math.max(packet.width, MIN_BAND_WIDTH_RAD));
  const sinRef = Math.sin(LATERAL_REF_RAD);
  const spread = Math.sin(Math.min(Math.max(packet.rLead, LATERAL_REF_RAD), HALF_PI));
  const lateral = Math.sqrt(sinRef / Math.max(spread, sinRef));
  return Math.max(0, Math.min(1, stretch * lateral));
}

/** Attenuation with the legibility floor applied. */
export function packetAmplitude(packet: Packet): number {
  return ATTEN_FLOOR + (1 - ATTEN_FLOOR) * packetAttenuation(packet);
}

/**
 * The comet: peak exactly at the leading edge, long feather trailing back
 * toward the origin, sharp cutoff ahead of the front.
 *
 * This asymmetry is the whole point — it is what makes travel direction
 * legible in a *still* frame, with no animation and no drawn arrow. Sharp on
 * one side, feathered on the other, the way a comet reads.
 */
export function cometEnvelope(d: number, rLead: number, rTrail: number): number {
  const width = Math.max(rLead - rTrail, 1e-4);
  const s = Math.max(0, Math.min(1, (d - rTrail) / width));
  const outer = 1 - smoothstep(rLead, rLead + width * FRONT_FEATHER_FRACTION, d);
  return Math.pow(s, COMET_POWER) * outer;
}

// --- Per-source field evaluation -----------------------------------------

/**
 * A source resolved at one moment in time — everything the shader needs as
 * uniforms, and everything hit-testing needs on the CPU. Built by
 * `swellSources.ts`; consumed identically on both sides.
 */
export interface SwellSourceState {
  origin: Vec3;
  /** Unit tangent at `origin`, the way the swell travels. */
  direction: Vec3;
  rLead: number;
  rTrail: number;
  /** Normalised energy x spawn ramp x packet amplitude, 0..1. */
  amp: number;
  /** Nominal period, seconds — drives filament anisotropy and hue. */
  periodS: number;
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1];
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Directional cone strength at `p` for a source — real storms radiate into
 * roughly a 60-degree arc, not a full disc, which is what makes each source
 * a fan rather than an expanding ring.
 */
export function sourceSpread(state: SwellSourceState, p: Vec3, d: number): number {
  const sp = dot3(state.origin, p);
  const raw: Vec3 = [p[0] - state.origin[0] * sp, p[1] - state.origin[1] * sp, p[2] - state.origin[2] * sp];
  const len = Math.hypot(raw[0], raw[1], raw[2]);
  const toP: Vec3 = len > 1e-4 ? [raw[0] / len, raw[1] / len, raw[2] / len] : state.direction;
  const spreadRaw = smoothstep(SPREAD_COS_FULL, SPREAD_COS_HALF, dot3(state.direction, toP));
  const poleFade = smoothstep(0, SPREAD_POLE_FADE_RAD, d);
  return 1 + (spreadRaw - 1) * poleFade;
}

/** Outward tangent at `p` along the great circle from the source. */
export function sourceFlow(state: SwellSourceState, p: Vec3, d: number): Vec3 {
  const sp = dot3(state.origin, p);
  const raw: Vec3 = [p[0] * sp - state.origin[0], p[1] * sp - state.origin[1], p[2] * sp - state.origin[2]];
  const len = Math.hypot(raw[0], raw[1], raw[2]);
  const away: Vec3 = len > 1e-4 ? [raw[0] / len, raw[1] / len, raw[2] / len] : state.direction;
  const poleFade = smoothstep(0, FLOW_POLE_FADE_RAD, d);
  return normalize3([
    state.direction[0] + (away[0] - state.direction[0]) * poleFade,
    state.direction[1] + (away[1] - state.direction[1]) * poleFade,
    state.direction[2] + (away[2] - state.direction[2]) * poleFade,
  ]);
}

/**
 * This source's contribution at `p`. The same product the shader forms, and
 * the value hit-testing takes an argmax over — tap a swell and you select
 * the swell that is actually brightest under your finger.
 */
export function sourceWeightAt(state: SwellSourceState, p: Vec3): number {
  const d = Math.acos(Math.max(-1, Math.min(1, dot3(state.origin, p))));
  const env = cometEnvelope(d, state.rLead, state.rTrail);
  if (env <= 0) return 0;
  return env * sourceSpread(state, p, d) * state.amp;
}

/**
 * Raw summed energy -> the normalised 0..1 the colour chain consumes.
 * Kept separate from `sourceWeightAt` so hit-testing and the parity probe
 * compare ungained weights, which are the physical quantity.
 */
export function fieldEnergy01(energy: number): number {
  return Math.max(0, Math.min(1, energy * FIELD_GAIN));
}

export interface FieldSample {
  /** Summed weight across all sources, unclamped and ungained. */
  energy: number;
  /** Index of the strongest source here, or -1 if none reach. */
  dominant: number;
  /** Weight of the dominant source alone. */
  dominantWeight: number;
  /** Nominal period of the dominant source — drives hue and anisotropy. */
  dominantPeriodS: number;
}

/**
 * Field summary at a point. Energy is a true sum (overlapping swells really
 * do carry more combined energy), but hue/anisotropy follow the *dominant*
 * source rather than a blend — averaging two sources' periods would invent a
 * third swell that is not there, and blending their directions is what
 * round 10's lateral-inhibition fix was already working around.
 */
export function fieldAt(states: readonly SwellSourceState[], p: Vec3): FieldSample {
  let energy = 0;
  let dominant = -1;
  let dominantWeight = 0;
  for (let i = 0; i < states.length; i++) {
    const w = sourceWeightAt(states[i], p);
    energy += w;
    if (w > dominantWeight) {
      dominantWeight = w;
      dominant = i;
    }
  }
  return {
    energy,
    dominant,
    dominantWeight,
    dominantPeriodS: dominant >= 0 ? states[dominant].periodS : 0,
  };
}

// --- GLSL transliteration -------------------------------------------------

/**
 * The same math, for the ocean shader. Kept as a literal transliteration of
 * the TypeScript above — same constant names, same order of operations — so
 * that a divergence is visible in a side-by-side read, and provable by
 * `parity-probe.mjs`.
 *
 * Constants are interpolated from the TS values rather than restated, so a
 * change up there cannot silently fail to reach the GPU.
 */
export const SWELL_FIELD_GLSL = /* glsl */ `
  const float MOANA_FEATHER_FRAC  = ${FRONT_FEATHER_FRACTION.toFixed(4)};
  const float MOANA_COMET_POWER   = ${COMET_POWER.toFixed(4)};
  const float MOANA_SPREAD_FULL   = ${SPREAD_COS_FULL.toFixed(4)};
  const float MOANA_SPREAD_HALF   = ${SPREAD_COS_HALF.toFixed(4)};
  const float MOANA_SPREAD_POLE   = ${SPREAD_POLE_FADE_RAD.toFixed(4)};
  const float MOANA_FLOW_POLE     = ${FLOW_POLE_FADE_RAD.toFixed(4)};
  const float MOANA_FIELD_GAIN    = ${FIELD_GAIN.toFixed(4)};

  // Mirrors cometEnvelope() in swellField.ts.
  float moanaCometEnvelope(float d, float rLead, float rTrail) {
    float width = max(rLead - rTrail, 1e-4);
    float s = clamp((d - rTrail) / width, 0.0, 1.0);
    float outer = 1.0 - smoothstep(rLead, rLead + width * MOANA_FEATHER_FRAC, d);
    return pow(s, MOANA_COMET_POWER) * outer;
  }

  // Mirrors sourceSpread() in swellField.ts.
  float moanaSpread(vec3 S, vec3 D, vec3 P, float d) {
    float sp = dot(S, P);
    vec3 raw = P - S * sp;
    float len = length(raw);
    vec3 toP = len > 1e-4 ? raw / len : D;
    float spreadRaw = smoothstep(MOANA_SPREAD_FULL, MOANA_SPREAD_HALF, dot(D, toP));
    float poleFade = smoothstep(0.0, MOANA_SPREAD_POLE, d);
    return mix(1.0, spreadRaw, poleFade);
  }

  /**
   * The fragment's position in the source's own polar frame: how far out
   * from the storm, and what bearing around it, both as true arc lengths.
   *
   * Round 16 added this because the shader's anisotropic noise sampling had
   * no valid space to live in. It used to decompose vPos along the flow
   * tangent — but a tangent vector on a unit sphere is perpendicular to the
   * position vector by construction, so dot(vPos, f) is identically zero
   * (measured: 1.7e-16) and the whole "anisotropy" collapsed to a uniform
   * scale. That is not repairable in place: vPos is the surface normal, so
   * ANY matrix built from tangent axes leaves it untouched. The sampling
   * space itself has to change.
   *
   * A radially propagating wave field already has a natural anisotropic
   * coordinate system, which is this one. Returns (radial arc, tangential
   * arc):
   *
   *  - x is the angular distance d, i.e. distance ACROSS a packet's band.
   *  - y is bearing scaled by sin(d), which converts an angle into true arc
   *    length — distance ALONG the band. Without the sin(d) factor filaments
   *    would fan out and thin as a packet travelled, since a fixed bearing
   *    spans more ocean the further out you go.
   *
   * Two singularities handle themselves here rather than needing guards.
   * The bearing seam at +/-pi sits directly behind the storm, where the
   * directional cone has already cut the field to zero. And as d -> 0,
   * sin(d) -> 0 collapses the coordinate smoothly instead of spinning.
   */
  vec2 moanaSourceFrame(vec3 S, vec3 D, vec3 P, float d) {
    // Fixed tangent basis at the source: D is the travel direction, E is
    // ninety degrees around from it. Bearing is measured against this pair,
    // so it is stable for the whole packet rather than varying per fragment.
    vec3 E = normalize(cross(S, D));
    vec3 raw = P - S * dot(S, P);
    float len = length(raw);
    vec3 toP = len > 1e-4 ? raw / len : D;
    float bearing = atan(dot(toP, E), dot(toP, D));
    return vec2(d, bearing * sin(d));
  }

  // Mirrors sourceFlow() in swellField.ts.
  vec3 moanaFlow(vec3 S, vec3 D, vec3 P, float d) {
    float sp = dot(S, P);
    vec3 raw = P * sp - S;
    float len = length(raw);
    vec3 away = len > 1e-4 ? raw / len : D;
    float poleFade = smoothstep(0.0, MOANA_FLOW_POLE, d);
    return normalize(mix(D, away, poleFade));
  }

  // Mirrors sourceWeightAt() in swellField.ts.
  float moanaSourceWeight(vec3 S, vec3 D, vec3 P, float rLead, float rTrail, float amp, float d) {
    float env = moanaCometEnvelope(d, rLead, rTrail);
    if (env <= 0.0) return 0.0;
    return env * moanaSpread(S, D, P, d) * amp;
  }
`;
