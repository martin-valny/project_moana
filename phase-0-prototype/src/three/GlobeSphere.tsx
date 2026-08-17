import { useMemo } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { SIMPLEX_NOISE_GLSL } from './shaders/noise';
import { FBM_GLSL } from './shaders/fbm';

const SURFACE_VERTEX = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Land/ocean lookup and the fBm domain-warp swell surface, in one pass —
// avoids a second blended sphere and keeps the land mask and the flow
// shader trivially in registration with each other.
const SURFACE_FRAGMENT = /* glsl */ `
  varying vec3 vPos;

  uniform sampler2D uLandMask;
  uniform float uTime;
  uniform vec3 uFlowBias;   // Helena's current heading, as a rough global bias (see note below)
  uniform float uEnergy01;  // Helena's current energy, normalised 0..1
  uniform int uOctaves;

  uniform vec3 uLandColor;
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

    if (land > 0.5) {
      // Flat, restrained land tone — a silhouette for orientation, not a map.
      float shade = 0.85 + 0.15 * vPos.y;
      gl_FragColor = vec4(uLandColor * shade, 1.0);
      return;
    }

    float t = uTime * 0.02;
    vec3 flowed = vPos * 1.5 + uFlowBias * t;

    float n = warpedFbm(flowed, uOctaves, 0.85, uFlowBias * 0.35);
    n = n * (0.75 + uEnergy01 * 1.0); // energy scales contrast/brightness, not just colour

    // Mostly near-black, generous negative space: only the higher end of
    // the noise range lights up, so the field reads as a calm dark ocean
    // with occasional bright ribbons, not a busy marbled surface.
    float lo = smoothstep(0.2, 0.52, n);
    float mid = smoothstep(0.52, 0.74, n);
    float hi = smoothstep(0.74, 0.95, n);

    vec3 color = mix(uOceanDeep, uOceanMid, lo);
    float tealMix = smoothstep(0.15, 0.4, snoise(flowed * 0.6 + 11.0));
    color = mix(color, uOceanTeal, mid * tealMix * 0.4);
    color = mix(color, uOceanMid, mid * (1.0 - tealMix * 0.4));
    color = mix(color, uOceanBright, hi);

    gl_FragColor = vec4(color, 1.0);
  }
`;

const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  uniform vec3 uColor;
  void main() {
    float fresnel = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.6);
    gl_FragColor = vec4(uColor, clamp(fresnel, 0.0, 1.0) * 0.5);
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
      uLandColor: { value: new THREE.Color('#0b1420') },
      uOceanDeep: { value: new THREE.Color('#040814') },
      uOceanMid: { value: new THREE.Color('#134470') },
      uOceanBright: { value: new THREE.Color(1.35, 1.55, 1.65) },
      uOceanTeal: { value: new THREE.Color('#1c6f6f') },
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
      uColor: { value: new THREE.Color('#3fb6d6') },
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
