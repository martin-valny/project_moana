import { useMemo } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { latLonToVector3 } from './geo';
import { SIMPLEX_NOISE_GLSL } from './shaders/noise';
import { FBM_GLSL } from './shaders/fbm';

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
  uniform vec3 uFlowBias;   // Helena's current heading, as a rough global bias (see note below)
  uniform float uEnergy01;  // Helena's current energy, normalised 0..1
  uniform int uOctaves;

  uniform vec3 uLandColor;
  uniform vec3 uCoastColor;
  uniform vec3 uOceanDeep;
  uniform vec3 uOceanMid;
  uniform vec3 uOceanBright; // authored >1.0 so only ribbon crests trip the bloom threshold
  uniform vec3 uOceanTeal;
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
      color = uLandColor + vec3(0.42, 0.40, 0.37) * pow(nightLum, 1.35) * 1.15;
    } else {
      // --- Anisotropic noise domain -----------------------------------
      // The single most important line in this shader. Splitting the sample
      // position into components along and across the flow direction and
      // scaling them unequally makes features ~8x longer along the flow
      // than across it. Sampling isotropically (as previous rounds did)
      // can only ever produce curly, equal-sided blobs — no colour-ramp or
      // threshold tuning turns those into long streaks.
      vec3 f = normalize(uFlowBias);
      vec3 along = dot(vPos, f) * f;
      vec3 across = vPos - along;
      vec3 coord = along * 0.2 + across * 2.0;

      // Travel along the flow, plus a slow independent evolution so the
      // field never reads as a rigid texture sliding past.
      coord += f * (uTime * 0.025);
      vec3 evolve = f * 0.15 + vec3(uTime * 0.009);

      // Moderate warp: enough for gentle S-curves and feathering, not so
      // much that it curls the streaks back into noodles. Round 7: octave
      // cap raised from a flat 3 to the tier's real budget (uOctaves, up to
      // 5 on high tier) — previously high-tier hardware paid for 5 octaves
      // in qualityTier.ts but this cap meant only 3 were ever used. Finer
      // filament detail is exactly what the reference shows more of.
      float n = warpedFbm(coord * 0.95, uOctaves, 0.45, evolve);
      n += fbm(coord * 3.0, uOctaves) * 0.06; // wispy edge detail
      n *= 0.75 + uEnergy01 * 0.9;                    // energy drives contrast

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

      // Teal shows up as broad regional patches, as in the reference —
      // low frequency and tied to position, not to the ribbon noise.
      // Round 7: raised the frequency (0.55 -> 1.7, so a whole visible
      // hemisphere can't land entirely inside one "zero" region of this
      // field) — but that alone didn't fix it. The REAL bug, found only by
      // reasoning through the blend chain after screenshots kept showing
      // zero teal at every camera angle: this used to be two independent
      // sequential mix() calls (deep -> teal, then separately deep -> mid),
      // and the second one's weight (up to 0.85) overwrote almost all of
      // what the first one set, structurally, regardless of tealPatch's
      // value. Fixed by blending mid/teal into ONE colour first, then
      // mixing that single result in once.
      // Round 8b: once the blend bug above was fixed and the bands were
      // softened, this went straight past "present" to "vivid emerald
      // blotches over half the ocean". Threshold raised (smaller, rarer
      // patches) and the blend itself capped at 0.6 so even a full patch
      // only tints toward green rather than replacing the blue outright —
      // in the reference the green is a regional tint within the water,
      // never its own colour field.
      float tealPatch = smoothstep(0.28, 0.78, snoise(vPos * 1.35 + 17.0));
      vec3 midOrTeal = mix(uOceanMid, uOceanTeal, tealPatch * 0.6);

      // Round 8: band weight 0.85 -> 0.72 so the ribbons stay translucent
      // over the base rather than fully replacing it — part of what makes
      // the reference's flow read as veils suspended over an ocean instead
      // of opaque paint on top of one.
      vec3 oceanColor = uOceanDeep;
      // Round 8c: mid weight down, crest weight up. The reference holds a
      // wide tonal range — genuinely deep navy water with delicate bright
      // filaments laid over it — whereas pushing band coverage up had
      // filled most of the ocean with a uniform mid-blue and flattened
      // exactly that range. Less fill, more highlight.
      oceanColor = mix(oceanColor, midOrTeal, band * 0.60);
      oceanColor = mix(oceanColor, uOceanBright, crest * 0.38);
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
    color += uScatterColor * pow(1.0 - facing, 3.0) * 0.28;

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
  void main() {
    vec3 viewDir = normalize(-vViewPosition);
    // This shell is rendered BackSide, so every visible fragment has
    // facing <= 0 by construction (0 exactly at the true silhouette,
    // more negative further round the far side) — remap that to a 0..1
    // glow brightest at the silhouette, never a flat/uniform ring.
    float facing = dot(normalize(vNormal), viewDir);
    // Round 7: round 5 cut this to a near-whisper specifically because the
    // shading underneath was still camera-relative and competing with the
    // ribbons for attention — that problem is gone now that round 5 itself
    // replaced it with world-space directional lighting. The reference
    // shows a genuinely prominent limb glow; broadened (lower power) and
    // brightened (higher peak alpha) to match.
    //
    // Round 8b: a first attempt at "broader" (shell 1.085, power 2.0,
    // alpha 0.45) overshot into a distinct teal *ring* floating around the
    // planet with its own visible outer edge — at whole-disc framing an
    // 8.5%-of-radius shell is simply a large object in frame, not a haze.
    // The reference's halo hugs the limb and fades out within a few
    // percent of the radius, so: smaller shell, tighter falloff, lower
    // peak. Brightness at the limb now comes mostly from the in-scattering
    // term on the planet surface itself, which cannot ring by construction.
    float fresnel = pow(clamp(1.0 + facing, 0.0, 1.0), 2.6);
    gl_FragColor = vec4(uColor, fresnel * 0.30);
  }
`;

interface GlobeSphereProps {
  radius: number;
  lat: number;
  lon: number;
  headingDeg: number;
  energy01: number;
  octaves?: number;
}

/**
 * The globe: a real (if deliberately coarse) coastline mask for
 * orientation per §5.1, and the domain-warped fBm "swell surface" that
 * replaces Phase 0's earlier particle field. Both share one shader pass
 * so they're always in registration.
 *
 * Scope note: Phase 0 has exactly one swell (Helena), not a populated
 * field, so `uFlowBias`/`uEnergy01` are a single global bias rather than
 * the per-cell direction/energy the real `SwellFieldFrame` will provide
 * from Phase 2 onward. Truthful-not-decorative (§1.2) is still honoured —
 * the bias is Helena's real current heading/energy, not an arbitrary
 * constant — it just isn't spatially varying yet because there's nothing
 * to vary it by. The ribbons therefore run along her real travel
 * direction, which is what makes the anisotropy above meaningful rather
 * than merely decorative.
 */
export function GlobeSphere({ radius, lat, lon, headingDeg, energy01, octaves = 5 }: GlobeSphereProps) {
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

  // A compass bearing is only meaningful relative to a position: the same
  // bearing points in a different 3D direction at every point on the globe.
  // Build the real surface-tangent vector at Helena's current location by
  // differencing the sphere mapping, then combining local north/east by the
  // bearing. The previous version collapsed every bearing into the equatorial
  // plane, which is why the ribbons always ran dead horizontal regardless of
  // where Helena was or which way she was heading.
  const flowBias = useMemo(() => {
    const eps = 0.35;
    const here = latLonToVector3(lat, lon, 1);
    const north = latLonToVector3(lat + eps, lon, 1).sub(here).normalize();
    const east = latLonToVector3(lat, lon + eps, 1).sub(here).normalize();
    const bearing = (headingDeg * Math.PI) / 180;
    return north
      .multiplyScalar(Math.cos(bearing))
      .add(east.multiplyScalar(Math.sin(bearing)))
      .normalize();
  }, [lat, lon, headingDeg]);

  const surfaceUniforms = useMemo(
    () => ({
      uLandMask: { value: landMask },
      uNightTexture: { value: nightTexture },
      uTime: { value: 0 },
      uFlowBias: { value: flowBias },
      uEnergy01: { value: energy01 },
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
      uOceanTeal: { value: new THREE.Color('#3c6a52') },
      uScatterColor: { value: new THREE.Color('#5aa8cc') },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [landMask, nightTexture],
  );

  useFrame((state) => {
    surfaceUniforms.uTime.value = state.clock.elapsedTime;
    surfaceUniforms.uFlowBias.value = flowBias;
    surfaceUniforms.uEnergy01.value = energy01;
    surfaceUniforms.uOctaves.value = octaves;
  });

  const atmosphereUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color('#9fd8e8') },
    }),
    [],
  );

  return (
    <group>
      <mesh>
        <sphereGeometry args={[radius, 128, 128]} />
        <shaderMaterial vertexShader={SURFACE_VERTEX} fragmentShader={SURFACE_FRAGMENT} uniforms={surfaceUniforms} />
      </mesh>
      <mesh scale={1.05}>
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
