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

  uniform sampler2D uLandMask;
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
    // The mask is pre-blurred (see scripts/generate-land-mask.mjs), so it
    // arrives as a smooth 0..1 field rather than hard 0/1. That lets the
    // coastline be a narrow band around the 0.5 contour — thin and smooth
    // at any zoom — instead of fwidth() on a hard mask, which produced the
    // jagged stair-stepped outlines of the previous round.
    float m = texture2D(uLandMask, uv).r;
    float stroke = smoothstep(0.30, 0.5, m) * smoothstep(0.70, 0.5, m) * 0.10;

    vec3 color;

    if (m > 0.5) {
      // Barely distinguishable from deep ocean — a silhouette that rewards
      // close inspection, never a map (§5.1).
      color = uLandColor;
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
      // much that it curls the streaks back into noodles.
      float n = warpedFbm(coord * 0.95, min(uOctaves, 3), 0.45, evolve);
      n += fbm(coord * 3.0, min(uOctaves, 3)) * 0.06; // wispy edge detail
      n *= 0.75 + uEnergy01 * 0.9;                    // energy drives contrast

      // Broad soft bands with a small bright core. Two failure modes to
      // stay between: a threshold low enough to light the whole sphere
      // (flat blue ball), and a ridged/contour transform, which gives
      // thin wiry filaments rather than the reference's feathery wisps.
      float band = smoothstep(-0.08, 0.42, n);
      float crest = smoothstep(0.32, 0.64, n);
      crest = pow(crest, 1.8);

      // Teal shows up as broad regional patches, as in the reference —
      // low frequency and tied to position, not to the ribbon noise.
      float tealPatch = smoothstep(0.25, 0.7, snoise(vPos * 0.55 + 17.0));

      vec3 oceanColor = uOceanDeep;
      oceanColor = mix(oceanColor, uOceanTeal, tealPatch * band * 0.3);
      oceanColor = mix(oceanColor, uOceanMid, band * (1.0 - tealPatch * 0.4) * 0.85);
      oceanColor = mix(oceanColor, uOceanBright, crest * 0.34);

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
    color *= mix(0.62, 1.12, lit);

    // What used to carry the "sphere" read on its own is now just a
    // whisper: a near-imperceptible grazing-angle falloff, and a thin
    // rim catch-light rather than a bright halo competing with the
    // ribbons for attention.
    vec3 viewDir = normalize(-vViewPosition);
    float facing = clamp(dot(normalize(vViewNormal), viewDir), 0.0, 1.0);
    color *= mix(0.88, 1.0, smoothstep(0.0, 0.25, facing));
    color += uScatterColor * pow(1.0 - facing, 4.0) * 0.2;

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
    float fresnel = pow(clamp(1.0 + facing, 0.0, 1.0), 3.5);
    gl_FragColor = vec4(uColor, fresnel * 0.22);
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
  const landMask = useLoader(THREE.TextureLoader, '/textures/land-mask.png');
  landMask.wrapS = THREE.RepeatWrapping;
  landMask.colorSpace = THREE.NoColorSpace;
  landMask.minFilter = THREE.LinearMipmapLinearFilter;
  landMask.magFilter = THREE.LinearFilter;
  landMask.generateMipmaps = true;
  landMask.anisotropy = 4;

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
      uTime: { value: 0 },
      uFlowBias: { value: flowBias },
      uEnergy01: { value: energy01 },
      uOctaves: { value: octaves },
      // World-space key light direction — soft upper-left bias, matching
      // the reference's gentle overall brightness gradient. Fixed, not
      // camera-relative (see the shading comment in SURFACE_FRAGMENT).
      uLightDir: { value: new THREE.Vector3(-0.4, 0.55, 0.5).normalize() },
      uLandColor: { value: new THREE.Color('#0a1524') },
      uCoastColor: { value: new THREE.Color('#9fb4c6') },
      uOceanDeep: { value: new THREE.Color('#071528') },
      uOceanMid: { value: new THREE.Color('#1a5aa4') },
      uOceanBright: { value: new THREE.Color('#e6fbff').multiplyScalar(1.9) },
      uOceanTeal: { value: new THREE.Color('#1d6b62') },
      uScatterColor: { value: new THREE.Color('#4d9fc4') },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [landMask],
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
      <mesh scale={1.045}>
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
