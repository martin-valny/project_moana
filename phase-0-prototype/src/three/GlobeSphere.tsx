import { useMemo } from 'react';
import * as THREE from 'three';

const SURFACE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Self-contained lighting so the globe's look doesn't depend on three.js's
// physically-correct light-intensity units (a real trap here: with a
// near-black base colour, modest scene lights left it essentially invisible).
const SURFACE_FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  uniform vec3 uDeep;
  uniform vec3 uLit;
  uniform vec3 uLightDir;

  void main() {
    float ndotl = max(dot(vNormal, uLightDir), 0.0);
    float wrapped = ndotl * 0.5 + 0.5; // soft wrap lighting, no hard terminator
    vec3 color = mix(uDeep, uLit, pow(wrapped, 2.2));

    float spec = pow(max(dot(reflect(-uLightDir, vNormal), vViewDir), 0.0), 140.0);
    color += vec3(0.55, 0.85, 0.95) * spec * 0.1;

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
    float fresnel = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.4);
    gl_FragColor = vec4(uColor, clamp(fresnel, 0.0, 1.0) * 0.55);
  }
`;

interface GlobeSphereProps {
  radius: number;
}

/**
 * The dark navy planet itself, near-black per §3.1, plus a restrained
 * cobalt/cyan atmospheric rim glow — no literal continents rendered
 * (§5.1: "enough for orientation, not enough to read as an atlas").
 * Orientation comes from Helena's own path and the ambient field's
 * global spread, not from a coastline texture.
 */
export function GlobeSphere({ radius }: GlobeSphereProps) {
  const surfaceUniforms = useMemo(
    () => ({
      uDeep: { value: new THREE.Color('#040a16') },
      uLit: { value: new THREE.Color('#12283f') },
      uLightDir: { value: new THREE.Vector3(0.5, 0.45, 0.6).normalize() },
    }),
    [],
  );

  const atmosphereUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color('#3fb6d6') },
    }),
    [],
  );

  return (
    <group>
      <mesh>
        <sphereGeometry args={[radius, 96, 96]} />
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
