import { useMemo } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { SIMPLEX_NOISE_GLSL } from './shaders/noise';
import { FBM_GLSL } from './shaders/fbm';

const SURFACE_VERTEX = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  void main() {
    vPos = normalize(position);
    vViewNormal = normalize(normalMatrix * normal);
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

  uniform sampler2D uLandMask;
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

  ${SIMPLEX_NOISE_GLSL}
  ${FBM_GLSL}

  vec2 posToUv(vec3 p) {
    float phi = acos(clamp(p.y, -1.0, 1.0));
    float theta = atan(p.z, -p.x);
    return vec2(theta / (2.0 * 3.14159265) + 0.5, phi / 3.14159265);
  }

  void main() {
    vec2 uv = posToUv(vPos);
    float land = texture2D(uLandMask, uv).r;
    // Low-opacity coastline stroke only, per the brief's exact spec
    // (rgba(150,170,190,0.12) at most) — not a crisp visible line at
    // normal viewing distance.
    float coastEdge = smoothstep(0.02, 0.22, fwidth(land) * 6.0) * 0.16;

    vec3 color;

    if (land > 0.5) {
      // Nearly the same tone as deep ocean, only a hair warmer — a
      // silhouette that rewards close inspection, not a map (§5.1/Fix 6).
      color = mix(uLandColor, uCoastColor, coastEdge);
    } else {
      color = mix(uOceanDeep, uCoastColor, coastEdge * 0.6);

      float t = uTime * 0.02;
      vec3 flowed = vPos * 1.15 + uFlowBias * t;

      // Fewer octaves feeding the warp itself keeps ribbons long and
      // clean rather than finely speckled (Fix 2); the final sample still
      // uses the full octave budget for a touch of fine detail on top.
      float n = warpedFbm(flowed, min(uOctaves, 3), 1.5, uFlowBias * 0.4);
      n = n * (0.7 + uEnergy01 * 0.95);

      // Mostly near-black, generous negative space: only the higher end
      // of the noise range lights up, so the field reads as a calm dark
      // ocean with a small number of bright ribbons, not a busy marbled
      // surface or scattered speckle.
      float lo = smoothstep(0.1, 0.44, n);
      float mid = smoothstep(0.44, 0.66, n);
      float hi = smoothstep(0.66, 0.9, n);

      vec3 oceanColor = mix(uOceanDeep, uOceanMid, lo);
      float tealMix = smoothstep(0.2, 0.45, snoise(flowed * 0.5 + 11.0)) * 0.3; // sparse accent only
      oceanColor = mix(oceanColor, uOceanTeal, mid * tealMix);
      oceanColor = mix(oceanColor, uOceanMid, mid * (1.0 - tealMix));
      oceanColor = mix(oceanColor, uOceanBright, hi);

      color = mix(color, oceanColor, 1.0 - coastEdge * 0.6);
    }

    // Fix 1: the missing piece — real curvature-driven shading, using the
    // true per-fragment view direction (not the camera's fixed forward
    // axis) so the darkening reaches genuine zero exactly at the true
    // geometric silhouette, at any zoom level. Facing the camera head-on
    // reads full brightness; toward the silhouette the surface darkens
    // and compresses, like a lit sphere, not a flat map cutout.
    vec3 viewDir = normalize(-vViewPosition);
    float facing = dot(normalize(vViewNormal), viewDir);
    float limb = mix(0.08, 1.0, smoothstep(0.0, 0.6, facing));
    color *= limb;

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
    // glow that is brightest exactly at the silhouette and fades
    // smoothly, never a flat/uniform-width ring (Fix 3).
    float facing = dot(normalize(vNormal), viewDir);
    float fresnel = pow(clamp(1.0 + facing, 0.0, 1.0), 1.6);
    gl_FragColor = vec4(uColor, fresnel * 0.6);
  }
`;

interface GlobeSphereProps {
  radius: number;
  headingDeg: number;
  energy01: number;
  octaves?: number;
}

/**
 * The globe: a real (if deliberately coarse) coastline mask for
 * orientation per §5.1, and the domain-warped fBm "swell surface" that
 * replaces Phase 0's earlier particle field — see the visual-engine brief
 * for why. Both share one shader pass so they're always in registration.
 *
 * Scope note: Phase 0 has exactly one swell (Helena), not a populated
 * field, so `uFlowBias`/`uEnergy01` are a single global bias rather than
 * the per-cell direction/energy the real `SwellFieldFrame` will provide
 * from Phase 2 onward. Truthful-not-decorative (§1.2) is still honoured —
 * the bias is Helena's real current heading/energy, not an arbitrary
 * constant — it just isn't spatially varying yet because there's nothing
 * to vary it by.
 */
export function GlobeSphere({ radius, headingDeg, energy01, octaves = 5 }: GlobeSphereProps) {
  const landMask = useLoader(THREE.TextureLoader, '/textures/land-mask.png');
  landMask.wrapS = THREE.RepeatWrapping;
  landMask.colorSpace = THREE.NoColorSpace;

  const flowBias = useMemo(() => {
    const rad = (headingDeg * Math.PI) / 180;
    return new THREE.Vector3(Math.sin(rad), 0, -Math.cos(rad));
  }, [headingDeg]);

  const surfaceUniforms = useMemo(
    () => ({
      uLandMask: { value: landMask },
      uTime: { value: 0 },
      uFlowBias: { value: flowBias },
      uEnergy01: { value: energy01 },
      uOctaves: { value: octaves },
      // Visual-remediation brief §3 — exact hex values, land/coast/deep/mid/
      // teal/atmosphere used as-is; the bloom-triggering peak is built from
      // the spec's near-white hex with headroom multiplied on top (brief:
      // "authored ABOVE standard 0-1 RGB range... or bloom will have
      // nothing to catch regardless of threshold").
      uLandColor: { value: new THREE.Color('#0c1017') },
      uCoastColor: { value: new THREE.Color('#96aabe') },
      uOceanDeep: { value: new THREE.Color('#040814') },
      uOceanMid: { value: new THREE.Color('#0f3f77') },
      uOceanBright: { value: new THREE.Color('#e0f9ff').multiplyScalar(1.85) },
      uOceanTeal: { value: new THREE.Color('#215f56') },
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
      uColor: { value: new THREE.Color('#58c4d8') },
    }),
    [],
  );

  return (
    <group>
      <mesh>
        <sphereGeometry args={[radius, 128, 128]} />
        <shaderMaterial vertexShader={SURFACE_VERTEX} fragmentShader={SURFACE_FRAGMENT} uniforms={surfaceUniforms} />
      </mesh>
      <mesh scale={1.06}>
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
