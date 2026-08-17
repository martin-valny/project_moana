import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { fibonacciSphere, hash2 } from './geo';
import { SIMPLEX_NOISE_GLSL } from './shaders/noise';

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uRadius;
  uniform float uPixelRatio;
  attribute float aSeed;
  varying float vIntensity;

  ${SIMPLEX_NOISE_GLSL}

  void main() {
    vec3 base = normalize(position);

    // Tangent basis so the drift stays on the sphere surface, not radial.
    vec3 arbitrary = abs(base.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 tangentA = normalize(cross(arbitrary, base));
    vec3 tangentB = cross(base, tangentA);

    float t = uTime * 0.035 + aSeed * 6.2831;
    float flowFreq = 1.6;

    float nA = snoise(base * flowFreq + vec3(0.0, 0.0, t));
    float nB = snoise(base * flowFreq + vec3(t, 5.2, 1.3));

    float amplitude = 0.05;
    vec3 drifted = base + tangentA * nA * amplitude + tangentB * nB * amplitude;
    drifted = normalize(drifted) * uRadius;

    float pulse = snoise(base * 2.3 + vec3(t * 1.4));
    vIntensity = clamp(0.35 + pulse * 0.65, 0.0, 1.0);

    vec4 mvPosition = modelViewMatrix * vec4(drifted, 1.0);
    // Reference distance ~3.2 (camera-to-near-surface) maps to a few px, not tens of px.
    gl_PointSize = (2.4 + vIntensity * 3.2) * (3.2 / -mvPosition.z) * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColorDeep;
  uniform vec3 uColorBright;
  varying float vIntensity;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float alpha = smoothstep(0.5, 0.0, d);
    alpha *= alpha;

    vec3 color = mix(uColorDeep, uColorBright, vIntensity);
    gl_FragColor = vec4(color, alpha * (0.28 + vIntensity * 0.5));
  }
`;

interface AmbientFieldProps {
  radius: number;
  count?: number;
}

/**
 * The globally-visible "slow flowing light" ambient swell field (§2.3
 * step 3). This is deliberately not tied to any real data — Phase 0 has
 * none beyond Helena — it exists purely to sell "a living ocean," with
 * Helena's own path rendered separately and more brightly as the one
 * thing that's actually data-driven and followable.
 */
export function AmbientField({ radius, count = 3200 }: AmbientFieldProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const pixelRatio = useThree((state) => state.viewport.dpr);

  const { positions, seeds } = useMemo(() => {
    const positions = fibonacciSphere(count, radius);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = hash2(i * 0.618, i * 1.324);
    return { positions, seeds };
  }, [count, radius]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uRadius: { value: radius * 1.012 }, // lifted just above the opaque globe to avoid z-fighting
      uPixelRatio: { value: pixelRatio },
      uColorDeep: { value: new THREE.Color('#12406b') },
      uColorBright: { value: new THREE.Color('#5fd8e8') },
    }),
    [radius, pixelRatio],
  );

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
