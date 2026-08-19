import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { SIMPLEX_NOISE_GLSL } from './shaders/noise';
import { FBM_GLSL } from './shaders/fbm';
import { MAX_SWELL_SOURCES, angularFrontDistanceRad, buildSwellSources, spawnRamp01 } from '../data/swellSources';
import { normalizeEnergy } from '../data/interpolate';
import { SWELL_WEAK, SWELL_STRONG } from './swellPalette';
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

  // Round 9: replaces a single global flow direction (Helena's own compass
  // heading, applied to the entire planet) with real swell propagation from
  // several storm sources. This is what "the ocean looks smeared" was
  // describing — one direction everywhere reads as smear, not current;
  // direction that varies with position and time reads as flow. Per source:
  // an origin, an initial travel direction, how far its front has reached
  // (uSourceFront, precomputed on the CPU from Cg = 1.56 * period per
  // phase-1-validation/physics.py's group_velocity_kmh, so the two agree),
  // and a normalised energy for weighting. See swellSources.ts.
  const int MAX_SOURCES = 6;
  uniform int uSourceCount;
  uniform vec3 uSourceOrigin[MAX_SOURCES];
  uniform vec3 uSourceDir[MAX_SOURCES];
  uniform float uSourceFront[MAX_SOURCES];   // angular distance travelled, radians
  uniform float uSourceEnergy[MAX_SOURCES];  // normalised 0..1

  uniform vec3 uLandColor;
  uniform vec3 uCoastColor;
  uniform vec3 uOceanDeep;
  uniform vec3 uOceanMid;
  uniform vec3 uOceanBright; // authored >1.0 so only ribbon crests trip the bloom threshold
  uniform vec3 uSwellWeak;   // light blue — weak local swell energy
  uniform vec3 uSwellStrong; // deep purple — strong local swell energy
  uniform vec3 uScatterColor;

  ${SIMPLEX_NOISE_GLSL}
  ${FBM_GLSL}

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
    float stroke = smoothstep(0.30, 0.5, m) * smoothstep(0.70, 0.5, m) * 0.20;

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
      color = uLandColor + vec3(0.34, 0.33, 0.31) * pow(nightLum, 1.8) * 0.62;
    } else {
      // --- Swell propagation: per-fragment direction and energy --------
      // For each source, three things at this fragment (vPos):
      //  - arrived: has the source's front (grown from uSourceFront, which
      //    the JS side advances as the timeline scrubs) reached here yet,
      //    with a soft leading edge rather than a hard cutoff — real swell
      //    fills in behind a front, it doesn't just vanish ahead of it.
      //  - spread: real storms don't radiate a full 360-degree disc — swell
      //    stays within roughly a 60-degree arc of the storm's actual
      //    direction. toP is the tangent AT THE SOURCE pointing toward this
      //    fragment; comparing it to the source's own travel direction is
      //    what makes this a directional fan rather than an expanding ring.
      //  - falloff: simple distance decay (real geometric spreading on a
      //    sphere is closer to 1/sqrt(sin(d)), but that blows up at d=0 and
      //    this is a stylised prototype, not a physics sim — 1/(1+d*k) is
      //    numerically safe and tunable by eye like everything else here).
      // away, the outward tangent AT THIS FRAGMENT continuing along the
      // same great circle, is what previous rounds called the flow bias —
      // the difference is it is now recomputed per fragment per source
      // instead of once for the whole planet.
      const float FRONT_WIDTH = 0.14;
      const float SPREAD_COS_FULL = 0.5;   // cos(60°) — spread reaches zero here
      const float SPREAD_COS_HALF = 0.906; // cos(25°) — full strength within this cone

      vec3 flowAccum = vec3(0.0);
      float energyAccum = 0.0;
      float poleAccum = 0.0;

      for (int i = 0; i < MAX_SOURCES; i++) {
        if (i >= uSourceCount) break;
        vec3 S = uSourceOrigin[i];
        vec3 D = uSourceDir[i];
        float d = acos(clamp(dot(S, vPos), -1.0, 1.0));

        vec3 toPRaw = vPos - S * dot(S, vPos);
        float toPLen = length(toPRaw);
        vec3 toP = toPLen > 1e-4 ? toPRaw / toPLen : D;
        float spreadRaw = smoothstep(SPREAD_COS_FULL, SPREAD_COS_HALF, dot(D, toP));
        // The real bug this round shipped with, and the actual cause of a
        // sharp diamond/kite artifact right at Helena's marker: toP (the
        // bearing FROM the source TO this fragment) sweeps through its full
        // 360-degree range over a physically tiny distance near the source's
        // own origin — small steps around the pole are huge steps in
        // bearing. The directional cone test (spreadRaw) is well-defined
        // there mathematically, but it cuts out a literal pie-slice at a
        // scale small enough to render as a hard-edged wedge rather than the
        // soft fan it becomes farther out. Blending toward fully omni-
        // directional within about 15 degrees of each source's own origin
        // fixes this at the geometric root — and is physically reasonable
        // too: a storm's generation area isn't a strongly directional point
        // source yet, only the swell radiating away from it organizes into
        // one.
        float poleFade = smoothstep(0.0, 0.26, d);
        float spread = mix(1.0, spreadRaw, poleFade);

        // Round 12: leadingEdge is the same crisp cutoff as before — real
        // information ("the swell hasn't reached here yet") that should
        // stay sharp. What's new is trailFade, dimming the long-passed
        // part of the wake back toward the source's own origin. Physically
        // the previous flat plateau behind the edge was defensible (these
        // are modelled as ongoing storms, still generating, not a single
        // pulse), but it meant a static frame carried no visual cue that
        // the water near an origin is OLDER than the water at the growing
        // edge — nothing read as in motion without scrubbing the timeline.
        // Purely a legibility device, same spirit as round 11's fade on
        // Helena's own path: brightest and sharpest at the current edge,
        // gently receding behind it, floor at 0.3 so the wake recedes
        // rather than disappearing (it is still there, just older).
        float leadingEdge = 1.0 - smoothstep(uSourceFront[i] - FRONT_WIDTH, uSourceFront[i] + FRONT_WIDTH, d);
        float trailFade = smoothstep(0.0, max(uSourceFront[i] * 0.75, FRONT_WIDTH), d);
        float arrived = leadingEdge * mix(0.3, 1.0, trailFade);
        float falloff = 1.0 / (1.0 + d * 1.3);
        float w = spread * arrived * falloff * uSourceEnergy[i];

        vec3 awayRaw = vPos * dot(S, vPos) - S;
        float awayLen = length(awayRaw);
        vec3 away = awayLen > 1e-4 ? awayRaw / awayLen : D;
        // away has the exact same hairy-ball singularity toP did above — the
        // bearing AWAY from the source sweeps through its full range over a
        // tiny distance near the source's own origin, same underlying cause.
        // Round 9's poleFade fix only ever blended spread (the cone-test
        // magnitude), never this direction, so it was still fed into
        // flowAccum raw. That was already a latent bug; the round-10 sharpen
        // below turned it into a visible pinwheel/starburst, by concentrating
        // weight most heavily exactly at d=0 (falloff peaks there) — right
        // where this direction is least defined. Same fix as spread: blend
        // toward the stable source direction D near the origin.
        away = normalize(mix(D, away, poleFade));

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
      float fieldEnergy01 = clamp(energyAccum, 0.0, 1.0);

      // --- Anisotropic noise domain -----------------------------------
      // The single most important line in this shader. Splitting the sample
      // position into components along and across the flow direction and
      // scaling them unequally makes features longer along the flow than
      // across it. Sampling isotropically (as early rounds did) can only
      // ever produce curly, equal-sided blobs — no colour-ramp or threshold
      // tuning turns those into streaks.
      //
      // Round 9: ratio brought down from ~10:1 to 5:1 at full confidence.
      // Direction now genuinely varies across the globe instead of being one
      // constant everywhere, so less stretch is needed to read as flow —
      // 10:1 was a large part of what earlier rounds' feedback called
      // "smeared".
      //
      // dirConfidence, and blending the ratio itself toward isotropic as it
      // drops, exists to fix a real artifact the first version of this
      // shipped with: "direction away from a point on a sphere" is a vector
      // field with a singularity exactly at that point (the same reason you
      // can't comb a hairy ball flat at the poles) — direction rotates
      // arbitrarily fast in the small neighbourhood around every source's
      // own origin. Stretched 5:1 through the noise sample, that showed up
      // as a sharp-edged diamond artifact right at Helena's origin. flowMag
      // (the un-normalised sum, before it collapses to a unit vector) is
      // small both there AND in genuinely calm water far from any source —
      // exactly the two places a confident direction shouldn't be trusted —
      // so it doubles as the fade signal for free.
      // poleConfidence multiplies in here too: near a source's own origin,
      // away is now locked to the stable D (see above), so flowMag alone
      // reads as high confidence even though the direction is only stable
      // because it's pinned, not because the field has actually organised
      // — exactly the zone the spiral artifact came from.
      float dirConfidence = clamp(flowMag * 6.0, 0.0, 1.0) * poleConfidence;
      vec3 along = dot(vPos, f) * f;
      vec3 across = vPos - along;
      vec3 coord = along * mix(1.0, 0.35, dirConfidence) + across * mix(1.0, 1.75, dirConfidence);

      // Travel along the flow, plus a slow independent evolution so the
      // field never reads as a rigid texture sliding past.
      //
      // Both terms below multiply f by dirConfidence — without this, even
      // once the stretch ratio above correctly fades to isotropic near a
      // source's own origin, these two still fed raw (unfaded) f straight
      // into the domain warp's offset. Domain warping is *designed* to
      // amplify small input changes, so f's residual rotation there alone
      // was enough to redraw the spiral the stretch fade was supposed to
      // remove — found by testing a rotated camera angle that brought a
      // source's own origin (not just an inter-source seam) into frame.
      coord += f * (uTime * 0.025) * dirConfidence;
      vec3 evolve = f * 0.15 * dirConfidence + vec3(uTime * 0.009);

      // Moderate warp: enough for gentle S-curves and feathering, not so
      // much that it curls the streaks back into noodles. Round 7: octave
      // cap raised from a flat 3 to the tier's real budget (uOctaves, up to
      // 5 on high tier) — previously high-tier hardware paid for 5 octaves
      // in qualityTier.ts but this cap meant only 3 were ever used. Finer
      // filament detail is exactly what the reference shows more of.
      float n = warpedFbm(coord * 0.95, uOctaves, 0.45, evolve);
      n += fbm(coord * 3.0, uOctaves) * 0.06; // wispy edge detail
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
      float band = smoothstep(-0.35, 0.52, n);
      float crest = smoothstep(0.34, 0.70, n);
      crest = pow(crest, 2.0);
      // Round 13, fifth pass: the actual mismatch behind "I don't see any
      // purple" — cropping in on a real screenshot showed the misty
      // ribbon shape extending well beyond where the ocean was actually
      // being coloured, because band/crest's own visible EXTENT never
      // depended on fieldEnergy01 at all, only n's contrast did (the
      // n *= 0.75 + fieldEnergy01 * 0.9 line below). Even at zero
      // energy, n still crosses these thresholds often enough to paint a
      // visible mist — so the eye reads "the swell" as the whole misty
      // shape, most of which was never actually tinted, rather than the
      // smaller genuinely-energetic core that was. Scaling band/crest's
      // own coverage down at low energy — not just their contrast —
      // shrinks the visible cloud to actually track where the colour is,
      // instead of the two disagreeing about a swell's real extent.
      float ribbonPresence = smoothstep(0.05, 0.35, fieldEnergy01);
      band *= mix(0.2, 1.0, ribbonPresence);
      crest *= mix(0.05, 1.0, ribbonPresence);

      // Round 10: replaces the old teal patches (a regional tint driven by
      // arbitrary positional noise, unrelated to any actual swell data) with
      // a strength-coded colour ramp the user asked for directly: light blue
      // for weak local swell energy, deep purple for strong. fieldEnergy01
      // is already exactly the right per-fragment signal — zero outside
      // every source's footprint, rising toward each source's own weight
      // inside it — so this both answers the colour-scheme ask and, for
      // free, makes each source's directional cone legible as a shape: the
      // cone geometry (spread x arrived, below) already existed, it just
      // rendered in nearly the same blue as the calm water around it. Now a
      // strong swell's wedge visibly reads as purple fanning out from its
      // origin and fading to light blue at its edges, exactly where the
      // cone geometry itself already tapers to zero. The x1.4 gain lets the
      // ramp reach full strength before fieldEnergy01's own 1.0 clamp, so
      // weak-but-present swells still show visible colour instead of
      // staying indistinguishable from calm uOceanMid water.
      vec3 swellColor = mix(uSwellWeak, uSwellStrong, fieldEnergy01);
      // Round 13, third pass: the user reported seeing no purple at all in
      // the ocean body, and checking a fresh screenshot personally
      // confirmed it — purple pixels genuinely existed (verified even with
      // Bloom disabled entirely, ruling out its blur as the cause) but
      // were confined to isolated crest peaks, a handful of pixels in a
      // sea of visibly untinted blue.
      //
      // First attempt at a fix used pow(fieldEnergy01, 0.45) as a flat
      // replacement for fieldEnergy01 everywhere below, reasoning that
      // most of a swell's visible area sits at moderate energy that a
      // steep low-end curve would lift. Checked, and it overshot the other
      // way: pow with an exponent under 1 boosts EVERY energy level,
      // including the genuinely-near-zero fringes that should stay calm —
      // since low energy always means uSwellWeak (pale, near-white), the
      // whole cloud got broadly paler and larger rather than more purple
      // where it actually mattered. Wrong lever: the goal was concentrating
      // colour where energy is real, not smearing more of it everywhere.
      //
      // colourRamp uses smoothstep instead: flat zero below ~0.12 (leaves
      // genuinely calm water alone, unlike pow), then rises fast to reach
      // full strength by ~0.5 — real swell presence, not the near-1.0 raw
      // fieldEnergy01 rarely reaches, saturates the ramp, while marginal
      // noise-floor energy still doesn't tint anything.
      float colourRamp = smoothstep(0.12, 0.5, fieldEnergy01);
      vec3 midColor = mix(uOceanMid, swellColor, colourRamp);

      // Round 8: band weight 0.85 -> 0.72 so the ribbons stay translucent
      // over the base rather than fully replacing it — part of what makes
      // the reference's flow read as veils suspended over an ocean instead
      // of opaque paint on top of one.
      // Round 13: the strength ramp was reaching the ocean body in code
      // (midColor above) but not in practice — confirmed by sampling
      // rendered pixels well away from any ribbon crest, which came back
      // plain blue regardless of local energy. Root cause: colour only
      // ever entered oceanColor scaled by band (how much ribbon-noise
      // detail sits at that exact pixel), so the large low-detail areas
      // between ribbons — most of a swell's visible footprint — stayed at
      // uOceanDeep's flat blue no matter how strong the swell there was.
      // This wash applies the same fieldEnergy01 the ribbons already use,
      // but independent of band, so the base tone itself shifts with
      // strength everywhere inside a swell's footprint, not just on the
      // noise that happens to be bright at a given pixel.
      // Round 13, second pass: 0.55 -> a shared colourRamp curve (see
      // midColor above). A first theory for why colour still wasn't
      // reaching the render blamed Bloom's blur mixing in the surrounding
      // blue area — tested directly by disabling Bloom entirely and
      // comparing screenshots, and ruled out: the rendered cloud looked
      // essentially identical either way. Reusing colourRamp here (instead
      // of a separately-tuned constant) is deliberate: this wash and
      // midColor's own ramp were compounding two separate, inconsistent
      // lots of dilution at the same energy level before.
      vec3 oceanColor = mix(uOceanDeep, midColor, colourRamp);
      // Round 8c: mid weight down, crest weight up. The reference holds a
      // wide tonal range — genuinely deep navy water with delicate bright
      // filaments laid over it — whereas pushing band coverage up had
      // filled most of the ocean with a uniform mid-blue and flattened
      // exactly that range. Less fill, more highlight.
      // The colour ramp's penetration scales up with energy too — at low
      // energy this matches round 8's original 0.60 exactly (unchanged
      // look for calm/background water), but a strong swell's core needs
      // the purple to actually read as dominant, not just tint through a
      // thin veil.
      oceanColor = mix(oceanColor, midColor, band * mix(0.70, 0.97, colourRamp));
      // Round 10 tried tinting the crest highlight toward swellColor while
      // keeping uOceanBright (authored at 1.55x, deliberately overexposed
      // so only crests trip bloom) as the blend anchor — mix(uOceanBright,
      // swellColor, fieldEnergy01 * 0.8). Round 13 found this structurally
      // couldn't work: sampling actual rendered pixels across the visible
      // body (not just eyeballing one screenshot) showed crests still
      // reading as near-white at realistic energy levels (0.3-0.7, rarely
      // near the 1.0 fieldEnergy01 would need). uOceanBright's linear
      // brightness is roughly double swellColor's own, so even an 80%
      // weight toward swellColor left a 20% near-white remainder bright
      // enough to pull R and G back to parity — exactly what erases a
      // colour signal that depends on R and G staying apart (blue vs.
      // purple).
      //
      // Fixed at the root instead of re-tuning the blend weight again:
      // derive the crest colour FROM swellColor's own hue, scaling only
      // its brightness for the bloom-trigger/glint effect, rather than
      // blending toward a separately-authored neutral colour at all. Hue
      // is now exactly swellColor's hue at every energy level, full stop —
      // nothing to wash it out. First attempt at the multiplier
      // (mix(1.3, 3.0, ...), reasoning STRONG's own luminance is much
      // darker than WEAK's and needs more boost to bloom the same way)
      // overshot badly: covering the whole frame with the raw result to
      // test it showed pure white, ACES crushing saturation at the high
      // end exactly as it did at the low end in round 10 — just the
      // opposite failure mode of a colour picked too dark. This much
      // smaller range keeps the crest reading brighter than the base
      // without pushing far enough into HDR for tonemapping to erase it.
      vec3 crestColor = swellColor * mix(1.0, 1.5, fieldEnergy01);
      // Round 13, fourth pass: 0.38 -> 0.22. Even with a correctly-hued
      // crestColor, a fresh screenshot after the colourRamp fix above
      // showed a broadly WHITER cloud, not a more purple one — the mid-
      // tone underneath (now genuinely saturated at real energy levels)
      // was still being painted over by this highlight everywhere crest
      // fires, which is most of a ribbon's visible extent, not just its
      // sharpest peak. Lower weight lets more of the saturated mid-tone
      // show through; the crest still reads as a highlight, just no longer
      // one that dominates the colour signal underneath it.
      oceanColor = mix(oceanColor, crestColor, crest * 0.22);
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
  /** Hours relative to app-load time — the same value the Timeline drives (§8's scrubber), now read by the whole field, not just Helena's marker. See MASTER_BUILD_PLAN.md §11's round-9 decision-log entry for why that constraint was deliberately superseded. */
  offsetHours: number;
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
export function GlobeSphere({ radius, pulse, offsetHours, octaves = 5 }: GlobeSphereProps) {
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

  // Recomputed whenever the timeline scrubs — each source's front grows
  // (or, scrubbed backward, shrinks) with `offsetHours` per
  // angularFrontDistanceRad's Cg = 1.56 * period.
  const { frontArray, energyArray } = useMemo(() => {
    const frontArray: number[] = [];
    const energyArray: number[] = [];
    for (let i = 0; i < MAX_SWELL_SOURCES; i++) {
      const s = sources[i];
      if (!s) {
        frontArray.push(0);
        energyArray.push(0);
        continue;
      }
      frontArray.push(angularFrontDistanceRad(s.periodS, s.spawnOffsetHours, offsetHours));
      const fullEnergy = normalizeEnergy(s.heightM * s.heightM * s.periodS);
      energyArray.push(fullEnergy * spawnRamp01(s.spawnOffsetHours, offsetHours));
    }
    return { frontArray, energyArray };
  }, [sources, offsetHours]);

  const surfaceUniforms = useMemo(
    () => ({
      uLandMask: { value: landMask },
      uNightTexture: { value: nightTexture },
      uTime: { value: 0 },
      uSourceCount: { value: sources.length },
      uSourceOrigin: { value: originArray },
      uSourceDir: { value: dirArray },
      uSourceFront: { value: frontArray },
      uSourceEnergy: { value: energyArray },
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
      uLandColor: { value: new THREE.Color('#16293f') },
      uCoastColor: { value: new THREE.Color('#9fb4c6') },
      uOceanDeep: { value: new THREE.Color('#0a1c33') },
      uOceanMid: { value: new THREE.Color('#356da4') },
      uOceanBright: { value: new THREE.Color('#e6fbff').multiplyScalar(1.55) },
      uSwellWeak: { value: new THREE.Color(SWELL_WEAK) },
      uSwellStrong: { value: new THREE.Color(SWELL_STRONG) },
      uScatterColor: { value: new THREE.Color('#5aa8cc') },
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
    material.uniforms.uSourceFront.value = frontArray;
    material.uniforms.uSourceEnergy.value = energyArray;
    material.uniforms.uOctaves.value = octaves;
  }, [sources, originArray, dirArray, frontArray, energyArray, octaves]);

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
      <mesh>
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
