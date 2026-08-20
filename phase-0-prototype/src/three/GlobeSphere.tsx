import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { SIMPLEX_NOISE_GLSL } from './shaders/noise';
import { FBM_GLSL } from './shaders/fbm';
import { MAX_SWELL_SOURCES, buildSwellSources, resolveSwellSources } from '../data/swellSources';
import { SWELL_FIELD_GLSL } from '../data/swellField';
import {
  PERIOD_HUE_MAX_S,
  PERIOD_HUE_MIN_S,
  SWELL_CORE,
  SWELL_DEEP,
  SWELL_MID,
  SWELL_SHORT,
} from './swellPalette';
import type { SwellPulse } from '../data/types';

const SURFACE_VERTEX = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldNormal;
  void main() {
    vPos = normalize(position);
    vViewNormal = normalize(normalMatrix * normal);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Land/ocean lookup and the fBm domain-warp swell surface, in one pass —
// avoids a second blended sphere and keeps the land mask and the flow
// shader trivially in registration with each other.
const SURFACE_FRAGMENT = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldNormal;

  uniform sampler2D uLandMask;      // earth-water.png: white(1)=ocean, black(0)=land
  uniform sampler2D uNightTexture;  // earth-night.jpg: real continent structure + city lights
  uniform vec3 uLightDir; // fixed world-space direction, NOT view-relative
  uniform float uTime;
  uniform int uOctaves;

  // Round 9 replaced a single global flow direction with real swell
  // propagation from several storm sources — direction that varies with
  // position and time reads as flow, one direction everywhere reads as
  // smear. Round 14 keeps that and changes what each source *is*: no longer
  // a filled disc sector capped by a soft arc, but a dispersive packet — a
  // band between two radii that stretches as it travels. See
  // ../data/swellField.ts for the model and why; that module is the single
  // source of truth and the GLSL below is included from it verbatim.
  const int MAX_SOURCES = 6;
  uniform int uSourceCount;
  uniform vec3 uSourceOrigin[MAX_SOURCES];
  uniform vec3 uSourceDir[MAX_SOURCES];
  uniform float uSourceRLead[MAX_SOURCES];  // leading edge, radians
  uniform float uSourceRTrail[MAX_SOURCES]; // trailing edge, radians
  uniform float uSourceAmp[MAX_SOURCES];    // energy x spawn ramp x packet attenuation
  uniform float uSourcePeriod[MAX_SOURCES]; // seconds — drives hue and filament anisotropy

  /** Hours the scrubber is showing, so filaments advect with the scrub. */
  uniform float uScrubHours;
  /** Index of the selected source, or -1. Drives the focus pull. */
  uniform int uSelected;
  /** 0 = filaments run along the band (wave crests), 1 = along travel. */
  uniform float uFilamentAxis;

  uniform vec3 uLandColor;
  uniform vec3 uCoastColor;
  uniform vec3 uOceanDeep;
  uniform vec3 uOceanMid;
  uniform vec3 uSwellCore;  // near-white — a packet's leading edge
  uniform vec3 uSwellMid;   // cyan — long-period groundswell midtone
  uniform vec3 uSwellShort; // muted green-teal — shorter-period midtone
  uniform vec3 uSwellDeep;  // deep blue — the trailing feather
  uniform vec3 uScatterColor;
  uniform float uPeriodHueMin;
  uniform float uPeriodHueMax;

  ${SIMPLEX_NOISE_GLSL}
  ${FBM_GLSL}
  ${SWELL_FIELD_GLSL}

  // Must agree exactly with geo.ts's latLonToVector3, which the swell path
  // and marker use. An earlier version added +0.5 here, which offset the
  // land mask by a full 180 degrees of longitude — the continents rendered
  // antipodally, so Helena's North Atlantic path appeared to cross the
  // Pacific. (wrapS is RepeatWrapping, so negative u wraps correctly.)
  vec2 posToUv(vec3 p) {
    float phi = acos(clamp(p.y, -1.0, 1.0));
    float theta = atan(p.z, -p.x);
    return vec2(theta / (2.0 * 3.14159265), phi / 3.14159265);
  }

  void main() {
    vec2 uv = posToUv(vPos);
    // earth-water.png is a real (Natural-Earth-derived) mask: white(1)=ocean,
    // black(0)=land, with actual river networks — inverted here so every
    // line below keeps the original m: 1=land, 0=ocean convention. Mip-mapped
    // bilinear filtering (see the TextureLoader setup below) keeps the 0.5
    // contour smooth rather than stair-stepped, same goal as the old
    // pre-blurred hand-generated mask it replaces (round 4).
    float m = 1.0 - texture2D(uLandMask, uv).r;
    // Round 8: 0.10 -> 0.20. The reference does show its coastlines — as a
    // faint lighter contour tracing each continent, which is much of what
    // keeps its land legible as land while still being very dark. Raising
    // this is what lets the land base itself stay dark without the
    // continents dissolving into featureless holes.
    float stroke = smoothstep(0.30, 0.5, m) * smoothstep(0.70, 0.5, m) * 0.26;

    // Round 7: real Earth imagery (night-lights — continent structure and
    // city-light warmth, already close to this app's own dark navy palette)
    // sampled at every fragment, remapped through this shader's own hand-
    // tuned colours rather than trusted verbatim — grounds both land and
    // ocean in real geography/texture instead of flat hand-picked colours.
    vec3 nightSample = texture2D(uNightTexture, uv).rgb;
    float nightLum = dot(nightSample, vec3(0.299, 0.587, 0.114));

    vec3 color;

    if (m > 0.5) {
      // Land: a dark slate-navy shape lifted slightly by the real texture's
      // own luminance (coastline structure, subtle relief, city-light
      // flecks). Round 7 went too far in both directions in one sitting —
      // first a gentle pow(,0.8) leaked a bright uniform satellite-photo
      // tan, then an over-corrected pow(,2.2) on a near-black base turned
      // every continent into an opaque black hole punched through the
      // planet. The reference does neither: its continents are clearly
      // *darker* than the ocean but plainly part of the same lit sphere,
      // in the same tonal family, with the atmosphere passing over them.
      // Round 8 settles between the two — a base that is genuinely navy
      // rather than black, a near-neutral (not warm/tan) lift, and a
      // middling curve.
      // A gentler curve and a stronger lift than round 8's first attempt:
      // verified with a debug pass (land tinted flat red) that the
      // continents really do occupy the middle of the opening view, so
      // they cannot be a black void without dominating the whole frame.
      // In the reference the continents carry visible terrain texture and
      // sit only slightly darker than the unlit ocean around them.
      // Round 9: pulled back again. Round 8's lift made real terrain
      // texture read, but too much of it — the continents were competing
      // with the ocean for attention when §5.1 wants them as orientation
      // only. Steeper curve, lower gain: enough relief to see a coastline
      // and a hint of landform, not a legible terrain map.
      //
      // Round 15 pulled back once more, this time against a measurement
      // rather than an impression. The complaint was that the continents
      // "read heavy", which sounds like they are too dark — they were not.
      // Sampled at interior points they came out at mean luminance 39.6
      // against an ocean median of 37: land and water were sitting at
      // essentially the SAME brightness. Nothing was pushing land back, so
      // a large contiguous mass of static speckled terrain competed on
      // equal terms with the moving water around it, and read as a hole
      // punched through the field.
      //
      // Two changes, both about subordination rather than darkness for its
      // own sake: a base that genuinely sits below the water's mid-tone,
      // and a steeper, weaker terrain lift so the speckle stops rivalling
      // the ocean's filaments texturally. §5.1 wants land as orientation
      // only. M10 in field-metrics.mjs now holds the ratio in range, so
      // this cannot drift back on some later palette pass.
      color = uLandColor + vec3(0.34, 0.33, 0.31) * pow(nightLum, 2.3) * 0.30;
    } else {
      // --- Swell propagation: per-fragment direction and energy --------
      // Each source contributes a dispersive packet (../data/swellField.ts):
      // a band between rTrail and rLead that stretches as it travels,
      // because a storm emits a spectrum and its long-period components
      // outrun its short ones. Within the band the envelope peaks exactly at
      // the leading edge and feathers backward — a comet, not a plateau.
      //
      // That asymmetry is the point. Rounds 9-13 modelled each source as a
      // filled disc sector, whose on-axis weight measured only ~1.5:1 across
      // 70% of a swell's radius and peaked at d ~ 0.7 x front — *behind* the
      // swell's own edge, with the storm origin still at 57% of peak. A
      // filled sector reads as a region; a tapered packet reads as a thing
      // in motion, and its direction is legible in a still frame with no
      // animation and nothing drawn on top.
      //
      // 'away' is the outward tangent at this fragment along the great
      // circle from the source — recomputed per fragment per source, which
      // is what makes flow vary across the globe rather than smearing the
      // whole planet one way.
      vec3 flowAccum = vec3(0.0);
      float energyAccum = 0.0;
      float poleAccum = 0.0;
      // Dominant source at this fragment. Hue and filament anisotropy follow
      // whichever source is strongest here rather than a blend of all of
      // them: averaging two periods would invent a third swell that is not
      // there, and averaging their directions is the seam artifact round 10
      // already had to work around with lateral inhibition.
      float bestWeight = 0.0;
      float domPeriod = uSourcePeriod[0];
      float domSelected = 0.0;
      // The dominant source's polar frame at this fragment — the space the
      // anisotropic noise is sampled in. Following the dominant source
      // rather than blending frames matters: averaging two sources' polar
      // coordinates would describe a storm that is not there.
      vec2 domFrame = vec2(0.0);
      float domWidth = 0.12;

      // Breaks the analytic arc. The packet envelope is exact geometry, so
      // rendered straight it draws a mathematically perfect band — which is
      // precisely what the first renders of this round looked like: clean
      // crescents with silhouettes, not weather. Displacing the distance fed
      // to the envelope by low-frequency noise makes each leading edge
      // wander the way a real front does, without touching the model
      // underneath: hit-testing and the parity probe both still evaluate the
      // clean analytic field, because this is a rendering perturbation and
      // not part of what "where is this swell" means.
      float edgeJitter = fbm(vPos * 2.6, min(uOctaves, 3));

      for (int i = 0; i < MAX_SOURCES; i++) {
        if (i >= uSourceCount) break;
        vec3 S = uSourceOrigin[i];
        vec3 D = uSourceDir[i];
        float d = acos(clamp(dot(S, vPos), -1.0, 1.0));

        // The packet, from swellField.ts — sharp at the leading edge, long
        // feather behind it. Everything that used to be FRONT_WIDTH /
        // trailFade / falloff is now inside this one call plus the CPU-side
        // amplitude, so shader and CPU cannot drift apart.
        float bandWidth = max(uSourceRLead[i] - uSourceRTrail[i], 1e-4);
        // Displacement is capped against the packet's own RADIUS as well as
        // its width. Width alone is not enough: a young packet's width is
        // held up by MIN_BAND_WIDTH_RAD and can be most of its radius —
        // Helena at "Now" is 0.13 rad out with a 0.12 rad band — so a
        // width-proportional jitter shifted her whole leading edge by half
        // her radius. Measured, that pulled her rendered peak to 0.80 x
        // rLead, close to the 0.7 x plateau peak this round exists to get
        // away from. The cap keeps edges wandering without letting the
        // wander swamp the thing it is decorating.
        float jitterScale = min(bandWidth * 0.55, uSourceRLead[i] * 0.18);
        float dJittered = d + edgeJitter * jitterScale;
        float w = moanaSourceWeight(S, D, vPos, uSourceRLead[i], uSourceRTrail[i], uSourceAmp[i], dJittered);
        float poleFade = smoothstep(0.0, MOANA_FLOW_POLE, d);
        // The hairy-ball singularity, still real and still handled inside
        // moanaSpread/moanaFlow: "bearing away from a point on a sphere"
        // rotates arbitrarily fast in the small neighbourhood around that
        // point, which rounds 9 and 10 both shipped visible artifacts from
        // (a hard-edged kite at Helena's origin; a pinwheel). A packet
        // starts at its own origin even though it does not stay there, so
        // this is still needed.
        vec3 away = moanaFlow(S, D, vPos, d);

        if (w > bestWeight) {
          bestWeight = w;
          domPeriod = uSourcePeriod[i];
          domSelected = (i == uSelected) ? 1.0 : 0.0;
          domFrame = moanaSourceFrame(S, D, vPos, d);
          domWidth = bandWidth;
        }

        // Round 10: sharp dividing lines where two sources' fans overlap at
        // comparable strength — the user spotted this and proposed the fix
        // themselves. flowAccum used to be a plain linear sum of away * w;
        // where two sources have similar w but different away directions,
        // f = normalize(flowAccum) depends sensitively on their exact weight
        // ratio, so it sweeps through a range of directions over a narrow
        // spatial band as dominance flips from one source to the other. That
        // wouldn't matter for a colour blend, but f feeds straight into the
        // anisotropic noise stretch below, and noise is chaotic with respect
        // to its sampling direction — a smooth rotation of f renders as a
        // visible seam. Lateral inhibition: sharpen the weight used for
        // DIRECTION only, so the locally-strongest source dominates instead
        // of being averaged with weaker neighbours. Energy stays a true sum
        // (unchanged below) — overlapping swells genuinely do carry more
        // combined energy, and that part already read fine.
        float wDir = pow(w, 3.0);
        flowAccum += away * wDir;
        energyAccum += w;
        poleAccum += poleFade * w;
      }

      // poleFade blending away toward D removes the point singularity at
      // d=0 (the pinwheel above), but does not remove the transition band
      // itself: away_raw's bearing-dependence doesn't care where poleFade
      // is in its ramp, so across roughly d in (0, 0.26) the blended away
      // still visibly twists from "locked to D" toward "true outward
      // bearing" as the fragment's bearing around the source changes —
      // this rotation showed up in testing as a soft spiral/vortex ring
      // around each source's origin once the anisotropic stretch below
      // picked it up (a rotated field direction, evaluated at a scale
      // small enough to matter, still perturbs which noise is sampled).
      // Rather than chase the twist itself, suppress anisotropy — not
      // direction — in the same zone: energy-weighted average of poleFade
      // across whichever source(s) actually dominate here, so the near-
      // origin zone (any source's) renders as an isotropic soft cloud
      // (no streak direction to twist) instead of a stretched pinwheel,
      // consistent with the existing spread fade's own physical framing —
      // a storm's generation area isn't organized into a direction yet.
      float poleConfidence = energyAccum > 1e-4 ? clamp(poleAccum / energyAccum, 0.0, 1.0) : 1.0;

      // Fragments outside every source's reach (most of the globe, most of
      // the time) get a fallback axis purely to keep the anisotropic warp
      // below well-defined — with energyAccum ~0 the noise stays low-
      // contrast there regardless of which direction this points.
      float flowMag = length(flowAccum);
      vec3 f = flowMag > 1e-5 ? normalize(flowAccum) : vec3(0.0, 0.0, 1.0);
      // MOANA_FIELD_GAIN exists because the raw sum has no reason to land in
      // 0..1 — measured, its P99 across the scrubber was 0.385..0.654, so a
      // 0..1 ramp built on it would never reach its own top. That is
      // precisely the bug round 13 spent three passes tuning downstream of.
      // See swellField.ts's FIELD_GAIN, and M8 in field-metrics.mjs, which
      // fails if the range ever collapses again.
      float fieldEnergy01 = clamp(energyAccum * MOANA_FIELD_GAIN, 0.0, 1.0);

      // Period sets hue and filament shape. Long-period groundswell runs as
      // long, clean, near-parallel filaments; shorter-period swell is
      // choppier and shorter-scaled. Physically true, and it means the two
      // identity cues (hue, filament shape) reinforce each other instead of
      // being independent decorations.
      float periodMix = smoothstep(uPeriodHueMin, uPeriodHueMax, domPeriod);

      // --- Anisotropic noise domain -----------------------------------
      //
      // ROUND 16 — this is the fix for "I still don't see the filament
      // ribbon structures". It is worth reading why, because the previous
      // version of this block was a no-op that survived six rounds.
      //
      // It used to decompose the sample position along the flow tangent:
      //
      //     vec3 along  = dot(vPos, f) * f;
      //     vec3 across = vPos - along;
      //
      // But f comes from moanaFlow() and is a TANGENT at vPos, and a tangent
      // on a unit sphere is perpendicular to the position vector by
      // construction. So dot(vPos, f) was identically zero — measured at
      // 1.7e-16 — making 'along' the zero vector, 'across' exactly vPos, and
      // the whole expression a uniform scale of vPos. Isotropic. The comment
      // that used to sit here called this "the single most important line in
      // this shader" and warned that isotropic sampling "can only ever
      // produce curly, equal-sided blobs". Both true; the line beneath it had
      // been doing precisely that since round 9, when f changed from one
      // global direction (not tangent, so the decomposition worked) to this
      // per-fragment tangent (always tangent, so it could not).
      //
      // It is not repairable in place. vPos is the surface normal, so ANY
      // matrix built from tangent axes leaves it untouched:
      // outerProduct(t,t) * vPos = t * dot(t, vPos) = 0 for every tangent t.
      // The sampling space itself has to change.
      //
      // So: sample in the dominant source's own polar frame, which a radially
      // propagating wave field supplies for free — distance out from the
      // storm, and arc length around it (moanaSourceFrame in swellField.ts).
      // Anisotropy is then just scaling those two axes unequally, which is
      // well-defined everywhere, and filament ORIENTATION becomes a single
      // swap between them.
      //
      // dirConfidence no longer comes from flowMag. flowMag is the length of
      // a sum of away * pow(w, 3.0) — round 10's lateral inhibition, which
      // exists to sharpen which source wins the DIRECTION. Reusing that
      // cubed magnitude as a confidence collapsed it: at w = 0.3 inside a
      // packet body it lands at 0.027 * 6 = 0.16, so anisotropy would have
      // applied only at the very brightest peaks and faded out through the
      // body even after the projection was fixed. bestWeight — the dominant
      // source's un-cubed weight, already tracked above — is what "do we know
      // which way this is going" actually means.
      // Where two sources are near-equally strong, domFrame flips between two
      // entirely different polar coordinate systems from one fragment to the
      // next, and the noise jumps with it — that is the hard polygonal
      // faceting the first render of this round showed. Unlike a direction
      // vector, two sources' polar frames cannot be blended into a meaningful
      // third, so the answer is to stop claiming a direction at all where no
      // single source owns the fragment: fade to isotropic across the tie.
      // Round 10 solved the same class of seam for flow direction with
      // lateral inhibition; this is its equivalent for the sampling frame.
      float dominance = energyAccum > 1e-5 ? bestWeight / energyAccum : 1.0;
      float clearlyDominant = smoothstep(0.55, 0.85, dominance);
      float dirConfidence = clamp(bestWeight * 3.2, 0.0, 1.0) * poleConfidence * clearlyDominant;

      // Frequencies are ~10-20x higher than the old ones, and that is the
      // other half of why nothing read as filaments. At the previous
      // coord * 0.95 on a unit sphere, noise features were about 1 radian —
      // 57 degrees — while packets are 7-27 degrees wide. Less than one
      // feature spanned an entire band, which is exactly the broad lumpiness
      // that was on screen. ~9 per radian puts roughly five striations across
      // a 20-degree band, with the fBm octaves supplying detail above that.
      //
      // uFilamentAxis swaps which axis is fine and which is long:
      //   0 = crests      — filaments run ALONG the band (perpendicular to
      //                     travel), the way real wave crests do
      //   1 = streamlines — filaments run along the direction of travel
      // Filament COUNT across a band is what should be constant, not
      // filament wavelength — so the fine-axis frequency scales with the
      // band's own width rather than being a fixed number.
      //
      // A fixed constant cannot serve both ends of the scrubber. Packets run
      // 0.12 rad wide when young and 0.35+ when mature, so any single value
      // is either too coarse to fit a filament inside a young band (6.5 gave
      // a 0.154 rad wavelength against a 0.12 rad band — under one filament
      // across it, and M11 read 2.25x) or too fine for a mature one (14
      // turned the +3 Days frame into contour-line spaghetti). Both were
      // observed directly; this is the fix for the tension rather than a
      // compromise between the two.
      const float FILAMENTS_PER_BAND = 3.2;
      const float K_LONG = 0.7;
      float kFine = FILAMENTS_PER_BAND / max(domWidth, 0.04);
      float kRadial = uFilamentAxis < 0.5 ? kFine : K_LONG;
      float kTangential = uFilamentAxis < 0.5 ? K_LONG : kFine;

      // Long-period groundswell runs as longer, cleaner, more parallel
      // filaments than short-period wind swell. Same idea round 14 intended,
      // now applied somewhere it can actually take effect.
      float lengthen = mix(1.25, 0.72, periodMix);

      vec2 frame = domFrame;
      // Advection: the packet's texture streams outward with the swell, and
      // the scrub drags it (round 14's mechanism 4, unchanged in intent).
      // 0.004 rad/hour is deliberately well under the ~0.0141 a 16 s group
      // velocity implies — wave *energy* travels at Cg, the water surface
      // does not — and it keeps a fast scrub from reading as racing texture.
      frame.x -= uTime * 0.025 + uScrubHours * 0.004;

      // Blend toward an isotropic sample where direction is not trustworthy
      // (calm water, and the neighbourhood of a source's own origin), rather
      // than stretching noise along an axis that is essentially noise itself.
      vec2 aniso = vec2(frame.x * kRadial * lengthen, frame.y * kTangential);
      vec2 iso = frame * 2.2;
      vec2 sampled = mix(iso, aniso, dirConfidence);

      vec3 coord = vec3(sampled, uTime * 0.012);
      vec3 evolve = vec3(uTime * 0.009);

      // Moderate warp: enough for gentle S-curves and feathering, not so
      // much that it curls the streaks back into noodles. Round 7: octave
      // cap raised from a flat 3 to the tier's real budget (uOctaves, up to
      // 5 on high tier) — previously high-tier hardware paid for 5 octaves
      // in qualityTier.ts but this cap meant only 3 were ever used. Finer
      // filament detail is exactly what the reference shows more of.
      //
      // Warp strength is lower than round 14's 0.45 but nowhere near as low
      // as this round briefly took it. Domain warping displaces the sample
      // point by fBm of itself, and that displacement is isotropic, so in
      // principle it works against an anisotropic field — which is why it
      // was cut to 0.06 mid-round. That reasoning rested on a correlation-
      // length measurement later shown to be measuring fBm's spectrum rather
      // than the field's anisotropy (see M11's own comment), and at 0.06 the
      // filaments came out as hard, evenly-spaced contour lines: legible,
      // but drawn rather than grown. The warp is what makes them wander.
      float n = warpedFbm(coord, uOctaves, 0.26, evolve);
      n += fbm(coord * 2.6, uOctaves) * 0.10; // wispy edge detail
      n *= 0.75 + fieldEnergy01 * 0.9;                 // local swell energy drives contrast

      // Broad soft bands with a small bright core. Two failure modes to
      // stay between: a threshold low enough to light the whole sphere
      // (flat blue ball), and a ridged/contour transform, which gives
      // thin wiry filaments rather than the reference's feathery wisps.
      //
      // Round 8: both ramps widened (band 0.50 -> 0.85 wide, crest 0.32 ->
      // 0.37 wide with a steeper power). The reference's ribbons are
      // translucent, feathered veils — closer to high cirrus or aurora
      // than to painted streaks — and the previous narrow ramps were what
      // made these read as hard-edged saturated bands with abrupt
      // shoulders. Widening the ramp is what softens an edge; the noise
      // shape itself was never the problem.
      // TWO ramps, not one. Round 16 narrowed the single ramp from
      // smoothstep(-0.35, 0.52) so filaments would cross threshold crisply
      // instead of smearing into gradients — which worked, and also turned
      // the entire calm ocean into high-contrast contour lines, because the
      // same ramp feeds the ambient water texture. Splitting them keeps the
      // striations where they mean something:
      //   ambient — wide and soft, the faint structure open water has always
      //             had, unchanged from round 14.
      //   band    — narrow and crisp, used only where swell energy gates it.
      float ambient = smoothstep(-0.35, 0.52, n);
      float band = smoothstep(-0.16, 0.30, n);
      float crest = smoothstep(0.30, 0.62, n);
      crest = pow(crest, 2.0);

      // --- Colour: brightness carries the information, hue carries identity
      //
      // Round 14 replaces rounds 10-13's light-blue -> deep-purple
      // strength ramp. That ramp needed its input above ~0.6 before green
      // dropped below red (i.e. before it read violet at all), while the
      // field's measured range was 0.05..0.45, mean 0.30, all-time max
      // 0.869. Its violet half was never once requested on any frame — which
      // is what "you kinda just make everything look blue" was reporting,
      // and why three passes of tuning downstream could not have fixed it.
      //
      // The signal now rides luminance and saturation, which survive this
      // pipeline; hue only distinguishes *which* swell you are looking at,
      // across a narrow cyan-to-green-teal range in the midtones. See
      // swellPalette.ts. Round 13's own findings are respected rather than
      // discarded: ACES crushes saturation at both extremes, so nothing here
      // asks hue to carry meaning where brightness is extreme.
      vec3 swellHue = mix(uSwellShort, uSwellMid, periodMix);
      // Deep blue in the trailing feather -> hue through the body ->
      // near-white at the leading edge. One ramp, monotonic in brightness.
      vec3 swellColor = mix(uSwellDeep, swellHue, smoothstep(0.0, 0.55, fieldEnergy01));
      swellColor = mix(swellColor, uSwellCore, smoothstep(0.62, 1.0, fieldEnergy01));

      // Focus pull (§6/§8 selection, without drawing anything): the selected
      // swell lifts, the others recede. A contrast change rather than a
      // highlight ring or an outline — the reference never marks a swell,
      // it just makes the one you care about the brightest thing in frame.
      float focus = uSelected < 0 ? 1.0 : mix(0.62, 1.22, domSelected);
      float energyFocused = clamp(fieldEnergy01 * focus, 0.0, 1.0);

      // Calm water keeps its own faint structure — the reference shows wispy
      // detail across the whole ocean, not only inside the bright bands.
      vec3 oceanColor = mix(uOceanDeep, uOceanMid, ambient * 0.34);

      // Round 13's Bug 1, kept fixed: colour used to enter the ocean *only*
      // scaled by 'band' (how much ribbon noise sits at this exact pixel), so
      // the low-detail gaps between ribbons — most of a swell's actual
      // footprint — stayed flat deep blue however strong the swell was. This
      // wash is band-independent, so a packet's whole body carries its
      // colour and the noise modulates within it rather than gating it.
      //
      // Balance matters as much as presence. The first pass here washed the
      // packet body at 0.88 with only a 0.45 noise term on top, which made
      // each packet a near-solid crescent — clean, geometric, and nothing
      // like the reference's filament ribbons. The split below keeps colour
      // everywhere in the packet (so Bug 1 stays fixed) but moves most of the
      // *brightness* into the noise, so the body reads as flowing filaments
      // rather than a shape someone drew.
      // The wash is applied through a curve, not linearly. Linear meant a
      // faint but visible tint everywhere the field had any energy at all —
      // 55% of the globe by +3 Days — which read as the whole ocean changing
      // colour rather than as bands lit on deep water. Squaring-ish
      // suppresses the long low-energy tail while leaving the bands
      // untouched, so open water stays open water.
      float washWeight = pow(energyFocused, 1.6);
      oceanColor = mix(oceanColor, swellColor * 0.5, washWeight * 0.95);
      oceanColor = mix(oceanColor, swellColor * 1.45, band * washWeight * 0.9);

      // Round 13's Bug 2, kept fixed: the crest highlight used to blend
      // toward uOceanBright, a separately-authored near-white about twice
      // swellColor's luminance, so even an 80% blend left enough of it to
      // pull R and G back toward parity and erase the hue underneath.
      // Scaling swellColor's *own* brightness instead means a crest can
      // never drift off the ramp, whatever the weight. The multiplier stays
      // modest because round 13's Bug 3 found the opposite failure: push it
      // far enough and ACES returns flat white regardless of hue.
      vec3 crestColor = swellColor * mix(1.0, 1.6, energyFocused);
      oceanColor = mix(oceanColor, crestColor, crest * mix(0.10, 0.78, washWeight));
      // Real bathymetric/current texture as a subtle multiply on top of the
      // procedural ribbons — grounds them in actual geography instead of
      // being the sole source of ocean detail.
      oceanColor *= 1.0 + nightLum * 0.6;

      color = oceanColor;
    }

    color = mix(color, uCoastColor, stroke);

    // Directional key light, fixed in WORLD space — this is the actual "it
    // looks like a lit 3D sphere" cue: one side brighter, the other darker,
    // soft terminator between them (no hard line — calm, not dramatic).
    // Previous rounds instead darkened/glowed symmetrically around the
    // camera axis (brightest dead-centre, fading toward every edge
    // equally). That is a radial vignette, not sphere lighting — it reads
    // as a filter laid over a flat image precisely because it has no
    // direction, and it's what "the shading looks too obvious, doesn't
    // look 3D" was describing. Must be world-space, not view-space: a
    // camera-relative light would swing around with the camera as the user
    // drags, which is the same flattening problem wearing a different hat.
    float lambert = dot(vWorldNormal, uLightDir);
    float lit = smoothstep(-0.6, 0.9, lambert);
    // Round 7 widened this from mix(0.62, 1.12, ...) — the reference reads
    // as a bright, well-exposed "hero photograph," not a moody/dark
    // abstraction. Round 8 raises the *floor* further (0.68 -> 0.86): in
    // the reference essentially the whole disc is luminous, with only a
    // gentle gradient across it — there is no genuinely dark side. Keeping
    // the ceiling above the floor preserves round 5's directional read;
    // this only stops the unlit half falling away into near-black.
    color *= mix(0.80, 1.28, lit);

    // What used to carry the "sphere" read on its own is now just a
    // whisper: a near-imperceptible grazing-angle falloff, and a thin
    // rim catch-light rather than a bright halo competing with the
    // ribbons for attention.
    vec3 viewDir = normalize(-vViewPosition);
    float facing = clamp(dot(normalize(vViewNormal), viewDir), 0.0, 1.0);
    color *= mix(0.88, 1.0, smoothstep(0.0, 0.25, facing));
    // Round 8: broader, stronger in-scattering toward the limb (power
    // 4.0 -> 3.0, weight 0.2 -> 0.38). In the reference the planet's edge
    // is its brightest part — a wide luminous band of atmosphere wrapping
    // the disc, not a thin outline — and it passes over land and ocean
    // alike, which is a large part of what unifies the two into one lit
    // sphere rather than a textured ball with holes cut in it.
    color += uScatterColor * pow(1.0 - facing, 3.0) * 0.20;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  uniform vec3 uColor;
  uniform float uLimbCos;
  void main() {
    vec3 viewDir = normalize(-vViewPosition);
    // This shell is rendered BackSide, so every visible fragment has
    // facing <= 0 by construction.
    float facing = dot(normalize(vNormal), viewDir);
    // Round 7: round 5 cut this to a near-whisper specifically because the
    // shading underneath was still camera-relative and competing with the
    // ribbons for attention — that problem is gone now that round 5 itself
    // replaced it with world-space directional lighting. The reference
    // shows a genuinely prominent limb glow; broadened (lower power) and
    // ROUND 9 — this falloff was inverted, which is why the halo read as a
    // thick band with a hard outer edge and "no transitions".
    //
    // facing is 0 at the SHELL's own outer silhouette and reaches its
    // most negative value, -uLimbCos, where a ray grazing the planet's
    // limb crosses the shell. The old pow(1.0 + facing, k) therefore
    // peaked at 1.0 on the *outer* edge of the atmosphere and fell off
    // *inward* toward the planet — the exact opposite of how a real
    // atmospheric halo behaves — and because the shell geometry simply
    // ends there, that maximum was cut off dead, leaving a hard rim.
    // Widening the shell in round 8 only made the bad band thicker.
    //
    // Normalising by uLimbCos maps t = 1 at the planet's limb to t = 0 at
    // the outer edge of the atmosphere, so the glow is brightest where the
    // air is thickest and fades smoothly to nothing at the top of it. A
    // wider shell now buys a longer, softer gradient instead of a fatter
    // ring.
    float t = clamp(-facing / uLimbCos, 0.0, 1.0);
    // Round 9b: the direction fix was correct, but the first magnitude pass
    // (shell 1.15, power 2.2, peak 0.55) was a genuine overcorrection —
    // fixing the inward-fading bug meant the WHOLE shell could finally
    // glow at once instead of only a thin cut-off band, and a shell that
    // size at that brightness filled most of the frame's black margin. Much
    // smaller shell, steeper falloff, lower peak: a glow that hugs the limb
    // rather than one that competes with the planet for the frame.
    gl_FragColor = vec4(uColor, pow(t, 3.2) * 0.22);
  }
`;

// Radius of the atmosphere shell relative to the globe. With the corrected
// (outward-fading) falloff this sets how far the halo extends, not how
// thick a band it draws — so it can be generous without becoming a ring.
const ATMOSPHERE_SCALE = 1.045;

interface GlobeSphereProps {
  radius: number;
  pulse: SwellPulse;
  /** App-load time, the anchor `offsetHours` is measured from. Needed here because Helena's leading edge is read from her own waypoint path, which is timestamped. */
  startTime: Date;
  /** Hours relative to app-load time — the same value the Timeline drives (§8's scrubber), now read by the whole field, not just Helena's marker. See MASTER_BUILD_PLAN.md §11's round-9 decision-log entry for why that constraint was deliberately superseded. */
  offsetHours: number;
  /** Index into the source list of the selected swell, or -1. Drives the focus pull. */
  selectedIndex: number;
  /** Called with the tapped point as a unit vector, for Globe.tsx to resolve to a source. */
  onPick?: (unit: THREE.Vector3) => void;
  /** 0 = filaments run along the band (wave crests), 1 = along the direction of travel. */
  filamentAxis?: number;
  octaves?: number;
}

/**
 * The globe: a real (if deliberately coarse) coastline mask for
 * orientation per §5.1, and the domain-warped fBm "swell surface" that
 * replaces Phase 0's earlier particle field. Both share one shader pass
 * so they're always in registration.
 *
 * Round 9: the surface is driven by `swellSources.ts`'s multi-source
 * propagation model (Helena plus several invented storms) rather than a
 * single global flow direction — see the round-9 PROGRESS.md entry for why
 * (short version: one direction for the whole planet is what "the ocean
 * looks smeared" was describing).
 */
export function GlobeSphere({ radius, pulse, startTime, offsetHours, selectedIndex, onPick, filamentAxis = 0, octaves = 5 }: GlobeSphereProps) {
  // Round 7: a real (Natural-Earth-derived) land/ocean mask replaces the
  // earlier hand-rolled scanline-fill one — see public/textures/SOURCES.md.
  const landMask = useLoader(THREE.TextureLoader, '/textures/earth-water.png');
  landMask.wrapS = THREE.RepeatWrapping;
  landMask.colorSpace = THREE.NoColorSpace;
  landMask.minFilter = THREE.LinearMipmapLinearFilter;
  landMask.magFilter = THREE.LinearFilter;
  landMask.generateMipmaps = true;
  landMask.anisotropy = 4;

  // Round 7: real Earth night-lights imagery for continent structure and
  // ocean fine detail — see public/textures/SOURCES.md for source/license.
  const nightTexture = useLoader(THREE.TextureLoader, '/textures/earth-night.jpg');
  nightTexture.wrapS = THREE.RepeatWrapping;
  nightTexture.colorSpace = THREE.NoColorSpace; // sampled as raw texel data, same as this shader's hand-tuned hex colours — not colour-managed
  nightTexture.minFilter = THREE.LinearMipmapLinearFilter;
  nightTexture.magFilter = THREE.LinearFilter;
  nightTexture.generateMipmaps = true;
  nightTexture.anisotropy = 4;

  // Helena plus the invented storms (see swellSources.ts). The pulse's
  // identity is stable for the session (App.tsx builds it once from a fixed
  // startTime), so this only needs to recompute if that identity changes.
  const sources = useMemo(() => buildSwellSources(pulse), [pulse]);

  // Fixed-length arrays for the shader's uniform arrays: unused slots (if
  // fewer than MAX_SWELL_SOURCES sources exist) get zero energy below, so
  // they contribute nothing regardless of what origin/direction they hold.
  const { originArray, dirArray } = useMemo(() => {
    const originArray: THREE.Vector3[] = [];
    const dirArray: THREE.Vector3[] = [];
    for (let i = 0; i < MAX_SWELL_SOURCES; i++) {
      const s = sources[i];
      originArray.push(s ? s.origin.clone() : new THREE.Vector3(0, 1, 0));
      dirArray.push(s ? s.direction.clone() : new THREE.Vector3(0, 0, 1));
    }
    return { originArray, dirArray };
  }, [sources]);

  // Recomputed whenever the timeline scrubs. Every number here comes from
  // swellField.ts via resolveSwellSources — the same call Globe.tsx's
  // hit-testing uses, so what you tap and what you see cannot disagree.
  const { rLeadArray, rTrailArray, ampArray, periodArray } = useMemo(() => {
    const states = resolveSwellSources(sources, startTime, offsetHours);
    const rLeadArray: number[] = [];
    const rTrailArray: number[] = [];
    const ampArray: number[] = [];
    const periodArray: number[] = [];
    for (let i = 0; i < MAX_SWELL_SOURCES; i++) {
      const s = states[i];
      rLeadArray.push(s ? s.rLead : 0);
      rTrailArray.push(s ? s.rTrail : 0);
      ampArray.push(s ? s.amp : 0);
      periodArray.push(s ? s.periodS : 0);
    }
    return { rLeadArray, rTrailArray, ampArray, periodArray };
  }, [sources, startTime, offsetHours]);

  const surfaceUniforms = useMemo(
    () => ({
      uLandMask: { value: landMask },
      uNightTexture: { value: nightTexture },
      uTime: { value: 0 },
      uSourceCount: { value: sources.length },
      uSourceOrigin: { value: originArray },
      uSourceDir: { value: dirArray },
      uSourceRLead: { value: rLeadArray },
      uSourceRTrail: { value: rTrailArray },
      uSourceAmp: { value: ampArray },
      uSourcePeriod: { value: periodArray },
      uScrubHours: { value: offsetHours },
      uSelected: { value: selectedIndex },
      uFilamentAxis: { value: filamentAxis },
      uOctaves: { value: octaves },
      // World-space key light direction — soft upper-left bias, matching
      // the reference's gentle overall brightness gradient. Fixed, not
      // camera-relative (see the shading comment in SURFACE_FRAGMENT).
      uLightDir: { value: new THREE.Vector3(-0.4, 0.55, 0.5).normalize() },
      // Round 8 palette pass, measured against the reference rather than
      // nudged: its base ocean is a visible navy (not near-black), its
      // ribbons are a *desaturated* steel blue rather than a saturated
      // royal blue, and its green is a muted olive-emerald, not a vivid
      // teal. Saturation was as much of the mismatch as brightness was.
      uLandColor: { value: new THREE.Color('#0c1727') },
      uCoastColor: { value: new THREE.Color('#9fb4c6') },
      uOceanDeep: { value: new THREE.Color('#0a1c33') },
      uOceanMid: { value: new THREE.Color('#356da4') },
      // Authored slightly over 1.0 so only a packet's brightest core trips
      // the bloom threshold — the leading edge blooms, the feather does not.
      uSwellCore: { value: new THREE.Color(SWELL_CORE).multiplyScalar(1.35) },
      uSwellMid: { value: new THREE.Color(SWELL_MID) },
      uSwellShort: { value: new THREE.Color(SWELL_SHORT) },
      uSwellDeep: { value: new THREE.Color(SWELL_DEEP) },
      uScatterColor: { value: new THREE.Color('#5aa8cc') },
      uPeriodHueMin: { value: PERIOD_HUE_MIN_S },
      uPeriodHueMax: { value: PERIOD_HUE_MAX_S },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [landMask, nightTexture],
  );

  // The actual fix, and the most significant bug this round found: R3F's
  // <shaderMaterial uniforms={surfaceUniforms}> does NOT keep the material's
  // .uniforms as the same object passed in — it clones it, once, when the
  // prop is first applied. Confirmed directly (comparing object identity in
  // a running page): `materialRef.current.uniforms.uSourceFront !==
  // surfaceUniforms.uSourceFront`. Mutating the JS object declared above —
  // which is what every earlier version of this file did, including the
  // uTime line that's animated the ocean since round 2 — was mutating a
  // copy the renderer never reads again after mount. It is genuinely
  // frozen: checked materialRef.current.uniforms.uTime.value on a running
  // page 3 seconds apart and it read 0 both times. The ocean has never
  // actually animated over time in this project; every screenshot across
  // every round happened to look like a plausible static frame of one.
  //
  // (First fix attempt here was wrong in an instructive way: the timeline
  // not moving the field looked exactly like a stale-closure bug — useFrame
  // capturing an old `frontArray` — and switching that update to a
  // useEffect was a real improvement on its own merits, but didn't fix the
  // actual symptom, because the deeper problem was the target object being
  // mutated, not when. Left as useEffect below since it's still the more
  // correct trigger; the material ref is the part that actually matters.)
  //
  // Fix: mutate the material's own uniforms via a ref, never the object
  // that was only ever used to set initial values.
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  useFrame((state) => {
    if (materialRef.current) materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.uniforms.uSourceCount.value = sources.length;
    material.uniforms.uSourceOrigin.value = originArray;
    material.uniforms.uSourceDir.value = dirArray;
    material.uniforms.uSourceRLead.value = rLeadArray;
    material.uniforms.uSourceRTrail.value = rTrailArray;
    material.uniforms.uSourceAmp.value = ampArray;
    material.uniforms.uSourcePeriod.value = periodArray;
    material.uniforms.uScrubHours.value = offsetHours;
    material.uniforms.uSelected.value = selectedIndex;
    material.uniforms.uFilamentAxis.value = filamentAxis;
    material.uniforms.uOctaves.value = octaves;
  }, [sources, originArray, dirArray, rLeadArray, rTrailArray, ampArray, periodArray, offsetHours, selectedIndex, filamentAxis, octaves]);

  // Selection: unproject the tap to a point on the unit sphere and hand it
  // up. Globe.tsx does the argmax against the same resolved states this
  // shader is rendering, so "what you tapped" and "what you see" are the
  // same evaluation, not two implementations of it.
  // Where the pointer went down, so a drag can be told from a tap.
  //
  // This matters now in a way it did not before. Until round 14 the only
  // click target was a small invisible sphere at Helena's marker, so a drag
  // almost never began and ended on it. The whole globe is the target now,
  // and R3F fires onClick whenever pointerdown and pointerup land on the
  // same object — so every rotation of the globe ended in a "tap" at
  // wherever the drag finished, usually open water, silently clearing the
  // selection. Caught by panel-glass-test.mjs, which rotates the globe with
  // the panel open and photographs the result: it reported the panel opening
  // and then showed no panel in the screenshot.
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    pointerDownAt.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
  }, []);

  const handlePick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!onPick) return;
      const down = pointerDownAt.current;
      pointerDownAt.current = null;
      // A few pixels of slop, so a tap with a shaky finger still selects but
      // an intentional rotation never does.
      if (down) {
        const moved = Math.hypot(e.nativeEvent.clientX - down.x, e.nativeEvent.clientY - down.y);
        if (moved > 6) return;
      }
      e.stopPropagation();
      onPick(e.point.clone().normalize());
    },
    [onPick],
  );

  const atmosphereUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color('#9fd8e8') },
      // cos of the angle at which a limb-grazing ray crosses the shell —
      // i.e. the most negative `facing` any visible shell fragment can
      // have. Derived from ATMOSPHERE_SCALE rather than hand-tuned so the
      // falloff can never silently desync from the mesh's actual size.
      uLimbCos: { value: Math.sqrt(1 - 1 / (ATMOSPHERE_SCALE * ATMOSPHERE_SCALE)) },
    }),
    [],
  );

  return (
    <group>
      {/* The globe itself is the tap target now. Round 11's invisible
          hit-sphere at Helena's marker is gone with the marker: selection
          raycasts this mesh and asks the field which swell is strongest
          where you touched, so you select the swell you can actually see
          rather than a hidden proxy for it. */}
      <mesh onClick={handlePick} onPointerDown={handlePointerDown}>
        <sphereGeometry args={[radius, 128, 128]} />
        <shaderMaterial ref={materialRef} vertexShader={SURFACE_VERTEX} fragmentShader={SURFACE_FRAGMENT} uniforms={surfaceUniforms} />
      </mesh>
      <mesh scale={ATMOSPHERE_SCALE}>
        <sphereGeometry args={[radius, 64, 64]} />
        <shaderMaterial
          vertexShader={ATMOSPHERE_VERTEX}
          fragmentShader={ATMOSPHERE_FRAGMENT}
          uniforms={atmosphereUniforms}
          transparent
          depthWrite={false}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
