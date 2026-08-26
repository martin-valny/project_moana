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
 * Ceiling on the band's angular width — the fix for the far-scrubber
 * washout bug, found by actually dragging the timeline live rather than
 * relying on the fixed -18h/Now/Tomorrow/3-Days stops every automated
 * screenshot check uses (`timeline-shots.mjs`, `shot.mjs`). Width grows
 * unboundedly with age (`width = rLead * relativeWidth`, no ceiling to
 * match the floor above) — self-limiting for any *one* band's own
 * brightness (`packetAttenuation`'s `stretch` term already decays toward
 * `ATTEN_FLOOR` as width grows) but not for its *footprint*: a fixed
 * angular width at radius `rLead` covers close to its maximum possible
 * area once `rLead` nears `HALF_PI` (`packetAttenuation`'s own lateral
 * `sin` term caps out there), so an ever-widening band keeps covering more
 * of the globe even after its own brightness has already floored out.
 * With `MAX_SWELL_SOURCES` invented sources all growing this way at once,
 * several eventually overlap across a shared region, and `fieldAt`'s true
 * energy *sum* across sources clips that whole shared region to white —
 * measured directly: "any energy" coverage jumps from 32% of the globe at
 * 72h to 52% at 96h, nearly doubling in the scrubber's last quarter.
 *
 * 0.35 rad (~20 deg) is picked to hold everything already measured and
 * gated through 72h unchanged — the CPU model's own natural width at 72h
 * is 0.349 rad, just under this ceiling — and only constrain the
 * previously-untested tail beyond it, where the bug actually lives.
 */
export const MAX_BAND_WIDTH_RAD = 0.35;

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
  /** `rLead - rTrail`, clamped to `[MIN_BAND_WIDTH_RAD, MAX_BAND_WIDTH_RAD]`. */
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
 * never the reverse — so the width floor/ceiling can never push the
 * trailing edge past the leading one, and the front (the thing the eye
 * reads as "where is it now") is never perturbed by either clamp.
 */
export function packetFromFront(rLead: number, periodS: number): Packet {
  const relativeWidth = (PERIOD_LEAD_S - PERIOD_TRAIL_S) / Math.max(periodS + PERIOD_LEAD_S, 0.1);
  const width = Math.min(Math.max(rLead * relativeWidth, MIN_BAND_WIDTH_RAD), MAX_BAND_WIDTH_RAD);
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

  // Mirrors sourceFlow() in swellField.ts.
  vec3 moanaFlow(vec3 S, vec3 D, vec3 P, float d) {
    float sp = dot(S, P);
    vec3 raw = P * sp - S;
    float len = length(raw);
    vec3 away = len > 1e-4 ? raw / len : D;
    float poleFade = smoothstep(0.0, MOANA_FLOW_POLE, d);
    return normalize(mix(D, away, poleFade));
  }

  // --- The noise sampling map: an ISOMETRY, by invariant --------------------
  //
  // Everything about *where* the ocean's noise is sampled lives in this one
  // function, and it is allowed to be a rotation and a uniform scale and
  // nothing else. A rotation has an orthogonal Jacobian, so the field it
  // samples can never be sheared, compressed or contoured — at any angle,
  // for any elapsed time, with no bound of any kind needed.
  //
  // **This is the round-23 invariant, and it replaces the rule round "22b."
  // recorded** ("any uTime * rate will eventually band — bound it"), which
  // was wrong. A spatially *uniform* drift cannot band however far it
  // travels: it slides the field rigidly and the sampling map stays the
  // identity. What bands is **shear** — an offset that differs between
  // neighbouring fragments. Rounds "22." and "22b." each bounded a magnitude
  // while leaving the spatial gradient that actually caused the banding
  // fully intact, which is why neither fixed it. See PROGRESS.md round 23.
  //
  // Concretely, what used to be here and at the call site:
  //
  //   coord  = P * mix(1.0, 1.75, dirConfidence);
  //   coord += f * (bound * sin(uTime * k) + uScrubHours * 0.004) * dirConfidence;
  //
  // dirConfidence is a *cubed* packet weight ramping 0 -> 1 across a body only
  // ~0.23 rad wide, so |grad dirConfidence| measures 28.5 per unit sphere
  // radius. Multiplying any offset by it shears the domain by
  // 1 + amplitude * 28.5 — pointwise, 12x at rest at the far scrubber and 77x
  // at the drift sine's peak, along the propagation direction, with iso-lines
  // parallel to each packet's leading edge. (B4 replays that map through a
  // 1.5-degree central difference and gets 2.6-7.5: the same failure, read
  // through a window that averages rather than samples the peak.) Those are exactly the nested
  // contour lanes the bug was reported as. It is also the same anisotropic
  // stretch round 16 built deliberately and had rejected on sight ("hard,
  // evenly spaced contour lines, nothing like water") — an order of magnitude
  // stronger, and arrived at by accident rather than by decision.
  //
  // Anything that must vary from fragment to fragment modulates the noise's
  // AMPLITUDE instead (see the detail octave in GlobeSphere.tsx). Amplitude
  // moves no sample points, so it contributes exactly zero shear.
  //
  // B4 in parity-probe.mjs measures the Jacobian of THIS function across a
  // real packet and fails above 1.25. Both live here, in the shared GLSL,
  // for the same reason B2 does: a probe measuring a JS copy would keep
  // passing against a shader that had drifted away from it.

  /** Uniform scale. Constant by the invariant above, never confidence-varying. */
  const float MOANA_NOISE_SCALE = 1.2;
  /**
   * How fast the sampling frame spins, in radians per real second and per
   * forecast-hour of scrub. Deliberately slow: this is the "the water is
   * alive" cue, not the "which way is this swell going" cue — direction is
   * carried by the packets' own travel and round 14's comet envelope, which
   * is what that asymmetry was built for. The scrub term keeps round 14's
   * intent that dragging the timeline physically pulls the water along.
   */
  const float MOANA_NOISE_SPIN_PER_S = 0.0050;
  const float MOANA_NOISE_SPIN_PER_H = 0.0020;
  /**
   * Axis the sampling frame spins about. Arbitrary but fixed, and
   * deliberately nowhere near (1,1,1): round "22." established that the
   * simplex implementation in noise.ts treats its own lattice diagonal as a
   * degenerate direction, so no animated path should run along it.
   */
  const vec3 MOANA_NOISE_SPIN_AXIS = vec3(0.42, 0.76, -0.49);

  vec3 moanaNoiseCoord(vec3 P, float timeS, float scrubHours) {
    float a = timeS * MOANA_NOISE_SPIN_PER_S + scrubHours * MOANA_NOISE_SPIN_PER_H;
    float ca = cos(a);
    float sa = sin(a);
    vec3 k = normalize(MOANA_NOISE_SPIN_AXIS);
    // Rodrigues' rotation formula — an exact isometry at every angle, which
    // is why this needs none of round "22b."'s sin() bounding.
    vec3 R = P * ca + cross(k, P) * sa + k * dot(k, P) * (1.0 - ca);
    return R * MOANA_NOISE_SCALE;
  }

  /**
   * The slow independent evolution handed to the domain warp as its flow
   * bias, so the field never reads as one rigid texture sliding past.
   *
   * A spatially uniform translation: identical for every fragment, so its
   * spatial gradient is exactly zero and it cannot band however far it
   * travels — which is precisely the fact rounds "22."/"22b." got backwards.
   * The per-axis rates stay mutually incommensurate and off the (1,1,1)
   * lattice diagonal, which round "22." was right about.
   */
  vec3 moanaNoiseEvolve(float timeS) {
    return vec3(0.0091, 0.0069, 0.0113) * timeS;
  }

  // Mirrors sourceWeightAt() in swellField.ts.
  float moanaSourceWeight(vec3 S, vec3 D, vec3 P, float rLead, float rTrail, float amp, float d) {
    float env = moanaCometEnvelope(d, rLead, rTrail);
    if (env <= 0.0) return 0.0;
    return env * moanaSpread(S, D, P, d) * amp;
  }
`;

// --- Land shadowing --------------------------------------------------------
//
// Round 18 tried this as a live, per-ray blocking model: walk the arc from
// source to point, find where it first meets land, and read a Fresnel-style
// aperture off that distance at query time. It was rejected on sight —
// "sharp straight edges/breaks in swell and swell is still traveling under
// the continents" — and reverted. Two things were true about why, both
// measured before this replacement was written:
//
// 1. **A per-ray model's shadow boundaries are geometrically straight lines
//    on screen**, because a boundary is where one bearing is blocked and its
//    neighbour isn't — a great circle. Round 18 softened that boundary with
//    an aperture whose width came from the physically real Fresnel formula
//    for ocean-swell wavelengths (tens of metres to a few hundred), which
//    gives a physically accurate softening of a few tens of km even
//    thousands of km downstream — genuinely narrow, and narrower than a
//    single pixel at the zoom the app is actually viewed at (roughly
//    5-7km/pixel with the globe filling the frame). The model wasn't buggy;
//    physically accurate ocean diffraction just doesn't look soft at this
//    zoom. Making it look soft is a deliberate visual choice, not something
//    physics hands over for free — see `SHADOW_SOFT_FLOOR_KM` below.
// 2. **The aperture was computed live, per fragment, per source** — cheap
//    enough for round 18's ~13-tap sum, but a soft-at-zoom aperture needs
//    tap counts in the hundreds near a source (where a bearing cell is only
//    a few km wide), which no real-time fragment shader can afford. So this
//    is baked once on the CPU instead: for each source, a full
//    (bearing x radius) grid of *already-blurred* transmission values. The
//    shader does one cheap bilinear texture lookup, not a live sum — see
//    `bakeShadowGrid` below and its GLSL mirror.
//
// An earlier attempt at this round tried an *iterative* diffusion march —
// physically the most defensible approach (SWAN's obstacle transmission
// coefficients and WAVEWATCH III's obstruction grids both propagate energy
// outward and suppress it crossing land, rather than ray-casting) — but it
// has a real numerical failure mode: a discrete Gaussian kernel evaluated at
// integer cell offsets with sigma below about half a cell transfers
// essentially nothing to its neighbours (the tap weight underflows), so many
// small steps never accumulate the way the continuous diffusion equation
// says they should. That regime is common here, not an edge case: cell width
// in km grows with distance from the source, so at any fixed physical
// diffusion budget per step, cells eventually outgrow it. Measured directly:
// a point that had just cleared 250km of land stayed frozen at its raw
// absorbed value (0.00004) across 5,700km of further, entirely open-water
// travel — the diffusion simply never engaged. Fixing that properly needs
// either far higher angular resolution or an implicit solver; both are more
// machinery than this problem needs, given the single-pass grid below
// already meets every measured criterion. Not pursued further, and noted
// here so it isn't tried again the same way.
//
// The (bearing, radius) grid this bakes into replaces round 15/16's
// destination atlas (a lat/lon grid, later removed in round 17 for having a
// resolution ceiling no affordable bake could clear — Panama's ~70km
// isthmus needs finer texels than a lat/lon grid spanning the whole globe
// could afford). A source-centred grid has no such ceiling: distance along
// each bearing is a continuous ray march, not a value binned to whichever
// lat/lon cell happens to contain a point.

/** Bearings resolved per source. At 1024, the narrowest cell (near a
 * source's own origin) is a few km wide — narrower than the softening this
 * module applies, so the bearing grid is never the limiting resolution. */
export const SHADOW_BEARINGS = 1024;

/** Angular step the initial ray march walks each bearing outward in,
 * radians (~19km) — finer than `earth-water.png`'s own ~25km texel, so a
 * ray cannot step clean over a coastline. */
export const SHADOW_MARCH_STEP_RAD = 0.003;

/** Land closer than this to a source's own origin is ignored, so a storm
 * sitting on a coastline does not shadow itself. */
export const SHADOW_NEAR_SKIP_RAD = 0.004;

/**
 * Width, in bearings, of the morphological closing (dilate then erode)
 * applied to the raw first-land-hit row before anything else touches it.
 *
 * An island too small to draw should not cast a shadow you can see. Without
 * this, a 40km islet blocks one or two bearings, and — even after the wide
 * softening below — that projects a thin dark line across open ocean far
 * past where it should have healed. Measured against the real sources and
 * mask: Central America blocks a 587-bearing-wide span of a Pacific
 * source's row; the sub-cell islands that produced visible streaks blocked
 * one or two. Over two orders of magnitude apart, so a closing width in
 * this range cannot weaken a real barrier and does still let a genuine
 * strait (open on both sides for a wide span) pass swell through it.
 */
export const SHADOW_CLOSE_BEARINGS = 7;

/** Radial range the grid is baked over, radians. `SHADOW_R_MIN` skips the
 * near-source singularity (bearings converge at r=0, same reason
 * `MOANA_SPREAD_POLE`/`MOANA_FLOW_POLE` exist elsewhere in this file).
 * `SHADOW_R_MAX` covers the furthest any packet reaches across the full
 * scrub range (measured: 2.406 rad) plus its own trailing band width. */
export const SHADOW_R_MIN = 0.02;
export const SHADOW_R_MAX = 2.76;

/** Radial samples the grid is baked at. At 300 rings over the range above,
 * consecutive rings are ~6km apart at the equator-equivalent radius (r=pi/2)
 * — comfortably finer than the softening width below, so radial bilinear
 * interpolation between rings is not the limiting resolution either. */
export const SHADOW_RADIUS_RINGS = 300;

/**
 * Minimum softening width, km, applied to every shadow boundary regardless
 * of distance travelled — the deliberate visual choice this module makes in
 * place of the physically tiny Fresnel width (see the module comment above).
 *
 * First shipped at 200km, which the ground-truth score (below) validated —
 * zero deep-shadow leaks, and the best measured smoothness of the values
 * tried. It was still wrong: at 200km the aperture is wide enough that an
 * enclosed sea only a few hundred km across (the Gulf of Honduras, the
 * approach to the Gulf of Mexico) reads as almost uniformly lit rather than
 * "bright at the opening, dark toward the interior" — reported back as
 * "still running under Central America" even though every scored point and
 * every named chokepoint was numerically correct. The ground-truth score
 * cannot see this: it classifies points as right/wrong by whether they
 * cross a threshold, not by how the *gradient across an enclosed body of
 * water* reads once the swell's own brightness and the app's bloom pass are
 * layered on top.
 *
 * The first fix tried was narrowing this constant (to 80km) — that genuinely
 * changes the baked values (measured: 52% of pixels differ from the 200km
 * bake), but a screenshot of the same scene barely looked different, because
 * a moderately-dimmed pixel multiplied by a swell packet's own brightness
 * and pushed through the app's bloom pass still reads as "lit" to the eye.
 * Width alone was the wrong lever: it controls *how far a boundary is
 * softened*, not *how dark a partially-transmitting point looks*, and it was
 * the second one the screenshot was actually complaining about. Kept at
 * 200km — the wider value with the better measured smoothness — with
 * `SHADOW_CONTRAST_POWER` below doing the containment work instead.
 */
export const SHADOW_SOFT_FLOOR_KM = 200;

/**
 * Contrast power applied to every baked value: `transmission ** POWER`.
 *
 * A pure Gaussian blur (`POWER = 1`) is smooth but visually shallow — most of
 * an enclosed sea's approach sits in the 0.3-0.7 range, which still reads as
 * "lit" once combined with the swell's own brightness and bloom. Raising the
 * power steepens the falloff (0.5 at POWER=1 stays 0.5; at POWER=3 it drops
 * to 0.125) while leaving the fixed points at 0 and 1 untouched and the
 * function still smooth and monotonic everywhere — so it cannot introduce a
 * new discontinuity, only change how quickly brightness drops off across the
 * one the blur already produced. Rendering the raw transmission field at
 * POWER=1/2/3/4 made the effect directly visible: the lit cone narrows and
 * the interior darkens at each step, with 2-3 already reading as clearly
 * contained rather than merely dim.
 *
 * 2 was chosen as the smaller of the two values that looked contained in
 * that comparison — enough to fix the complaint without pushing the edges
 * toward looking hard again. Checked against the same ground-truth score:
 * zero deep-shadow leaks (unchanged from POWER=1), and every named
 * chokepoint (Gulf of Mexico interior, Yucatan Channel, the Caribbean side
 * of Panama) still reads as correctly dark or correctly lit depending on
 * which sea it actually opens onto. The score also shows the actual cost of
 * going higher: "wrongly dark" open-water points (bearings that sit close,
 * in *bearing* space, to a real shadow boundary, so the blur bleeds a little
 * shadow onto genuinely clear water) rise from 7 at POWER=1 to 149 at
 * POWER=2, 283 at POWER=3 and 481 at POWER=6 — the same edges-toward-hard
 * regression the wider floor was chosen to avoid, just reached through the
 * other lever instead. 2 is the point on that curve still close to the
 * POWER=1 baseline.
 */
export const SHADOW_CONTRAST_POWER = 2;

/** Deep-water wavelength for a peak period, km — `g T^2 / 2pi`. Longer-period
 * swell diffracts a little further, which is why the softening this module
 * still applies is per-source even though the floor above dominates it at
 * every distance that matters on screen. */
export function wavelengthKm(periodS: number): number {
  return (9.81 * periodS * periodS) / (2 * Math.PI) / 1000;
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** An orthonormal frame at a source's origin, defining the zero of bearing.
 * Every consumer — the bake and the query — takes the frame from this one
 * function, so a bearing means the same thing everywhere it's used. */
export function sourceFrame(origin: Vec3): { e1: Vec3; e2: Vec3 } {
  const ref: Vec3 = Math.abs(origin[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normalize3(cross3(ref, origin));
  return { e1, e2: cross3(origin, e1) };
}

/** Dilate then erode a periodic row by `width` bearings — see
 * `SHADOW_CLOSE_BEARINGS` for why. */
function closeRow(row: Float32Array, width: number): Float32Array {
  const n = row.length;
  const half = Math.floor(width / 2);
  const dilated = new Float32Array(n);
  for (let a = 0; a < n; a++) {
    let m = -Infinity;
    for (let k = -half; k <= half; k++) m = Math.max(m, row[(((a + k) % n) + n) % n]);
    dilated[a] = m;
  }
  const out = new Float32Array(n);
  for (let a = 0; a < n; a++) {
    let m = Infinity;
    for (let k = -half; k <= half; k++) m = Math.min(m, dilated[(((a + k) % n) + n) % n]);
    out[a] = m;
  }
  return out;
}

/**
 * One row: for each of `SHADOW_BEARINGS` bearings from `origin`, the
 * angular distance at which that ray first meets land (or PI if it never
 * does), closed to remove sub-cell islands. This is the raw geometry —
 * `bakeShadowGrid` below is what turns it into something soft.
 */
export function buildShadowRow(origin: Vec3, isLand: (p: Vec3) => boolean): Float32Array {
  const { e1, e2 } = sourceFrame(origin);
  const row = new Float32Array(SHADOW_BEARINGS);
  for (let a = 0; a < SHADOW_BEARINGS; a++) {
    const az = (a / SHADOW_BEARINGS) * 2 * Math.PI;
    const c = Math.cos(az);
    const s = Math.sin(az);
    const dir: Vec3 = [e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s];
    let hit = Math.PI;
    for (let r = SHADOW_NEAR_SKIP_RAD; r <= Math.PI; r += SHADOW_MARCH_STEP_RAD) {
      const cr = Math.cos(r);
      const sr = Math.sin(r);
      if (isLand([origin[0] * cr + dir[0] * sr, origin[1] * cr + dir[1] * sr, origin[2] * cr + dir[2] * sr])) {
        hit = r;
        break;
      }
    }
    row[a] = hit;
  }
  return closeRow(row, SHADOW_CLOSE_BEARINGS);
}

/**
 * Periodic box blur, O(n) via a prefix sum regardless of kernel width,
 * padded on both sides so wrap is correct in both directions (an earlier,
 * one-sided-padding version silently produced out-of-bounds reads for
 * bearings near the end of the array — caught by a delta-function sanity
 * check, kept here as the reason both-sided padding matters).
 */
function boxBlurPeriodic(arr: Float64Array, radiusCells: number): Float64Array {
  const n = arr.length;
  const r = Math.max(1, Math.round(radiusCells));
  if (r * 2 + 1 >= n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += arr[i];
    return new Float64Array(n).fill(sum / n);
  }
  const w = 2 * r + 1;
  const ext = new Float64Array(n + 2 * r);
  for (let i = 0; i < n; i++) ext[r + i] = arr[i];
  for (let i = 0; i < r; i++) ext[i] = arr[n - r + i];
  for (let i = 0; i < r; i++) ext[r + n + i] = arr[i];
  const prefix = new Float64Array(ext.length + 1);
  for (let i = 0; i < ext.length; i++) prefix[i + 1] = prefix[i] + ext[i];
  const out = new Float64Array(n);
  for (let b = 0; b < n; b++) out[b] = (prefix[b + w] - prefix[b]) / w;
  return out;
}

/** Triple box blur approximating a Gaussian of the given sigma (standard
 * formula for k passes: box width `w = sqrt(12*sigma^2/k + 1)`, here k=3). */
function gaussApproxPeriodic(arr: Float64Array, sigmaCells: number): Float64Array {
  if (sigmaCells < 0.05) return arr;
  const w = Math.sqrt(4 * sigmaCells * sigmaCells + 1);
  const radius = (w - 1) / 2;
  let out = arr;
  out = boxBlurPeriodic(out, radius);
  out = boxBlurPeriodic(out, radius);
  out = boxBlurPeriodic(out, radius);
  return out;
}

/**
 * Bakes the full (bearing x radius) grid of transmission values for one
 * source: `SHADOW_RADIUS_RINGS` rings, each `SHADOW_BEARINGS` wide, each
 * ring blurred independently with its own sigma (so the softening genuinely
 * grows with distance travelled, per the module comment above) via the O(n)
 * blur above rather than an iterative march. Returned flat, row-major
 * (ring-major), values in [0, 1] — 1 clear, 0 fully shadowed.
 */
export function bakeShadowGrid(origin: Vec3, periodS: number, isLand: (p: Vec3) => boolean): Float32Array {
  const row = buildShadowRow(origin, isLand);
  const dtheta = (2 * Math.PI) / SHADOW_BEARINGS;
  const grid = new Float32Array(SHADOW_RADIUS_RINGS * SHADOW_BEARINGS);
  const raw = new Float64Array(SHADOW_BEARINGS);
  for (let ring = 0; ring < SHADOW_RADIUS_RINGS; ring++) {
    const r = SHADOW_R_MIN + ((SHADOW_R_MAX - SHADOW_R_MIN) * ring) / (SHADOW_RADIUS_RINGS - 1);
    for (let b = 0; b < SHADOW_BEARINGS; b++) raw[b] = row[b] < r ? 0 : 1;
    const kmPerBearing = Math.max(Math.sin(r), 0.05) * EARTH_RADIUS_KM * dtheta;
    const sigmaKm = Math.max(SHADOW_SOFT_FLOOR_KM, Math.sqrt((wavelengthKm(periodS) * r * EARTH_RADIUS_KM) / 4));
    const blurred = gaussApproxPeriodic(raw, sigmaKm / kmPerBearing);
    for (let b = 0; b < SHADOW_BEARINGS; b++) {
      grid[ring * SHADOW_BEARINGS + b] = Math.pow(blurred[b], SHADOW_CONTRAST_POWER);
    }
  }
  return grid;
}

/** Bilinear sample of a baked grid at an exact (radius, fractional bearing).
 * Shared by CPU hit-testing and — conceptually, via the identical coordinate
 * math — the GLSL mirror below; both read the one baked grid, never a
 * second copy of it. */
export function sampleShadowGrid(grid: Float32Array, r: number, bearingIdx: number): number {
  const t = Math.max(0, Math.min(1, (r - SHADOW_R_MIN) / (SHADOW_R_MAX - SHADOW_R_MIN))) * (SHADOW_RADIUS_RINGS - 1);
  const ring0 = Math.floor(t);
  const ringFrac = t - ring0;
  const ring1 = Math.min(SHADOW_RADIUS_RINGS - 1, ring0 + 1);
  const b0 = Math.floor(bearingIdx);
  const bFrac = bearingIdx - b0;
  const n = SHADOW_BEARINGS;
  const at = (ring: number, b: number) => grid[ring * n + (((b % n) + n) % n)];
  const v0 = at(ring0, b0) * (1 - bFrac) + at(ring0, b0 + 1) * bFrac;
  const v1 = at(ring1, b0) * (1 - bFrac) + at(ring1, b0 + 1) * bFrac;
  return v0 * (1 - ringFrac) + v1 * ringFrac;
}

/** Fraction of this source's energy reaching `point`, from its baked grid. */
export function shadowTransmissionAt(grid: Float32Array, origin: Vec3, e1: Vec3, e2: Vec3, point: Vec3): number {
  const cosR = Math.max(-1, Math.min(1, dot3(origin, point)));
  const r = Math.acos(cosR);
  if (r < SHADOW_NEAR_SKIP_RAD) return 1;
  const t = normalize3([point[0] - origin[0] * cosR, point[1] - origin[1] * cosR, point[2] - origin[2] * cosR]);
  const az = Math.atan2(dot3(t, e2), dot3(t, e1));
  const fa = ((((az / (2 * Math.PI)) % 1) + 1) % 1) * SHADOW_BEARINGS;
  return sampleShadowGrid(grid, Math.min(r, SHADOW_R_MAX), fa);
}

/**
 * GLSL mirror of the *coordinate transform* only — `shadowTransmissionAt`'s
 * geometry, not its aperture math, because there is no aperture math left to
 * duplicate: the blur happened once, on the CPU, into the grid this samples.
 * The shader's `texture2D` call does the same bilinear interpolation
 * `sampleShadowGrid` does by hand, natively, so this is a much smaller
 * mirror than round 18's needed (that one duplicated a 13-tap weighted sum
 * and needed its own CPU/GPU parity gate; this only needs the two halves to
 * agree on where a bearing lands in the texture, which `parity-probe.mjs`'s
 * B3 gate below still checks, cheaply).
 *
 * `rowV0`/`rowV1` are the caller's v-coordinate range for this source's band
 * in the packed atlas (see `landOcclusion.ts`), so this function needs no
 * opinion about how many sources are packed into the texture or where.
 */
export const SWELL_SHADOW_GLSL = /* glsl */ `
  uniform sampler2D uShadowAtlas;

  const float MOANA_SHADOW_R_MIN = ${SHADOW_R_MIN.toFixed(5)};
  const float MOANA_SHADOW_R_MAX = ${SHADOW_R_MAX.toFixed(5)};
  const float MOANA_SHADOW_NEAR_SKIP = ${SHADOW_NEAR_SKIP_RAD.toFixed(5)};
  const float MOANA_TWO_PI = 6.28318531;

  // Mirrors shadowTransmissionAt() in swellField.ts, minus the blur it reads
  // pre-baked from uShadowAtlas. rowV0/rowV1 bound this source's padded band
  // within the packed atlas (see landOcclusion.ts's buildShadowAtlas).
  float moanaShadow(float rowV0, float rowV1, vec3 S, vec3 E1, vec3 E2, vec3 P) {
    float cosR = clamp(dot(S, P), -1.0, 1.0);
    float r = acos(cosR);
    if (r < MOANA_SHADOW_NEAR_SKIP) return 1.0;

    vec3 raw = P - S * cosR;
    float len = length(raw);
    vec3 t = len > 1e-6 ? raw / len : E1;
    float u = fract(atan(dot(t, E2), dot(t, E1)) / MOANA_TWO_PI);

    float v = mix(rowV0, rowV1, clamp((r - MOANA_SHADOW_R_MIN) / (MOANA_SHADOW_R_MAX - MOANA_SHADOW_R_MIN), 0.0, 1.0));
    return texture2D(uShadowAtlas, vec2(u, v)).r;
  }
`;
