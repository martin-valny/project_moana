import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Line } from '@react-three/drei';
import * as THREE from 'three';
import { latLonToVector3 } from './geo';
import { normalizeEnergy } from '../data/interpolate';
import { SWELL_WEAK, SWELL_STRONG } from './swellPalette';
import type { SwellPathPoint, SwellPulse } from '../data/types';

interface HelenaPathProps {
  pulse: SwellPulse;
  radius: number;
  currentPoint: SwellPathPoint;
  onSelect: () => void;
}

// Same ramp as the ocean shader's own uSwellWeak/uSwellStrong (round 10) —
// round 11 moved Helena's trail onto it too, replacing an unrelated
// cobalt-to-white gradient. Same meaning (local swell strength), same
// colours, wherever it shows up: the trail now reads as one more swell in
// the same system rather than a separately-coloured line-chart overlay.
const WEAK = new THREE.Color(SWELL_WEAK);
const STRONG = new THREE.Color(SWELL_STRONG);

// A soft radial glow, not a lit sphere with a silhouette — see the marker
// comment below for why the previous solid dot had to go.
const GLOW_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const GLOW_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float d = length(vUv - 0.5) * 2.0; // 0 at centre, 1 at the plane's edge
    float core = smoothstep(0.4, 0.0, d);
    float halo = smoothstep(1.0, 0.0, d) * 0.5;
    float alpha = clamp(core + halo, 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/**
 * Helena's path and current-position marker.
 *
 * Round 11: the user disliked both as originally styled — a crisp, opaque
 * white line and a flat white dot, reading as a line-chart overlay dropped
 * onto the painting rather than part of it. Restyled to match the ocean
 * shader's own soft-gradient, no-hard-edges language: the trail is now
 * additively blended (it glows into the water instead of being drawn over
 * it) and fades in/out at both ends instead of stopping abruptly, and the
 * marker is a soft radial glow billboard rather than a solid-silhouette
 * sphere. Both now use the same strength-coded colour ramp as the ocean
 * field itself (swellPalette.ts).
 */
export function HelenaPath({ pulse, radius, currentPoint, onSelect }: HelenaPathProps) {
  const glowRef = useRef<THREE.Mesh>(null);
  const glowMaterialRef = useRef<THREE.ShaderMaterial>(null);

  const { trailPoints, trailColors } = useMemo(() => {
    const n = pulse.path.length;

    // The raw waypoints (data/helena.ts) are ~6h apart and only 20 in
    // number — rendered as a straight-segment polyline through them
    // directly, the path visibly kinks at each waypoint, most noticeably
    // near the current marker. CatmullRomCurve3 passes through every
    // waypoint exactly (so nothing about the underlying path data changes)
    // but interpolates a smooth curve between them; 'centripetal'
    // parameterization avoids the loop/overshoot artifacts chordal or
    // uniform Catmull-Rom can produce when waypoint spacing is uneven.
    const controlPoints = pulse.path.map((p, i) => {
      const bow = Math.sin((i / (n - 1)) * Math.PI) * 0.045; // rises mid-path, settles at the ends
      const lift = radius * (1.006 + bow);
      return latLonToVector3(p.lat, p.lon, lift);
    });
    const waypointColors = pulse.path.map((p) => {
      const e = normalizeEnergy(p.energy);
      return WEAK.clone().lerp(STRONG, e);
    });

    const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal');
    const divisions = Math.max(120, (n - 1) * 8);
    const points = curve.getPoints(divisions);

    // CatmullRomCurve3.getPoint(t) maps t uniformly by waypoint index
    // (t=0 -> waypoint 0, t=1 -> waypoint n-1) regardless of curve type, so
    // sample k's fractional waypoint index is just k/divisions * (n-1) —
    // used here to interpolate the same per-waypoint energy colour the
    // straight-segment version used, just at curve resolution instead of
    // waypoint resolution.
    //
    // Round 11: each sample's colour is also scaled by a fade-in/fade-out
    // envelope (soft over the first ~8% and last ~14% of the curve) rather
    // than left at full brightness right up to two hard endpoints — with
    // additive blending below, a dim colour is visually almost nothing, so
    // this reads as the trail dissolving into the water at both ends
    // instead of stopping at a drawn line-cap. Full strength through the
    // middle, where "the path" is actually the useful information.
    const colors = points.map((_, k) => {
      const t = k / divisions;
      const floatIdx = t * (n - 1);
      const lo = Math.floor(floatIdx);
      const hi = Math.min(lo + 1, n - 1);
      const frac = floatIdx - lo;
      const base = waypointColors[lo].clone().lerp(waypointColors[hi], frac);
      const fadeIn = THREE.MathUtils.smoothstep(t, 0.0, 0.08);
      const fadeOut = 1.0 - THREE.MathUtils.smoothstep(t, 0.86, 1.0);
      return base.multiplyScalar(fadeIn * fadeOut);
    });

    return { trailPoints: points, trailColors: colors };
  }, [pulse, radius]);

  const currentPos = useMemo(() => latLonToVector3(currentPoint.lat, currentPoint.lon, radius * 1.01), [currentPoint, radius]);
  const markerColor = useMemo(() => WEAK.clone().lerp(STRONG, normalizeEnergy(currentPoint.energy)), [currentPoint]);

  // Off by default; the automated checks opt in with ?e2e=1. Hunting for a
  // moving 3D marker by sweeping screen coordinates is far too slow when
  // every synthetic click waits on a software-rendered WebGL frame.
  const exposeMarker = useMemo(
    () => new URLSearchParams(window.location.search).has('e2e'),
    [],
  );

  // Same R3F gotcha round 9 found in GlobeSphere.tsx: <shaderMaterial
  // uniforms={x}> clones x once at mount, so material.uniforms is never a
  // live reference to glowUniforms — updates have to go through the
  // material instance via a ref instead.
  useEffect(() => {
    if (glowMaterialRef.current) glowMaterialRef.current.uniforms.uColor.value = markerColor;
  }, [markerColor]);

  useFrame((state) => {
    const pulseScale = 1 + Math.sin(state.clock.elapsedTime * 1.6) * 0.18;
    if (glowRef.current) glowRef.current.scale.setScalar(pulseScale);

    if (exposeMarker) {
      const ndc = currentPos.clone().project(state.camera);
      const toCamera = state.camera.position.clone().sub(currentPos);
      (window as unknown as Record<string, unknown>).__moanaMarker = {
        x: (ndc.x * 0.5 + 0.5) * state.size.width,
        y: (-ndc.y * 0.5 + 0.5) * state.size.height,
        // Facing the camera (i.e. on the near side of the globe, not occluded).
        facing: currentPos.dot(toCamera) > 0,
      };
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect();
  };

  const glowUniforms = useMemo(
    () => ({ uColor: { value: markerColor }, uOpacity: { value: 0.85 } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <group>
      {/* Two passes, same points/colours: a soft wide halo underneath a
          thin bright core, like a brush stroke rather than a drawn
          line-chart line. Normal (not additive) blending deliberately —
          where the curve bends toward/away from the camera, many samples
          project into a handful of screen pixels, and additive blending
          stacked their brightness into a small blown-out flare right at
          Helena's path tip in testing; normal alpha compositing caps at
          the vertex colour itself instead of summing overlapping
          segments. */}
      <Line points={trailPoints} vertexColors={trailColors} lineWidth={7} transparent opacity={0.18} depthWrite={false} />
      <Line points={trailPoints} vertexColors={trailColors} lineWidth={2.2} transparent opacity={0.7} depthWrite={false} />

      {/* Larger invisible hit target so the marker is easy to tap on a phone. */}
      <mesh position={currentPos} onClick={handleClick}>
        <sphereGeometry args={[radius * 0.05, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Round 11: replaces a solid opaque sphere (a flat, hard-edged white
          circle with no falloff) with a camera-facing soft radial glow —
          a light source rather than a drawn dot, matching how the ocean
          shader itself represents energy as feathered gradients, never a
          hard silhouette. */}
      <Billboard position={currentPos}>
        <mesh ref={glowRef} onClick={handleClick}>
          <planeGeometry args={[radius * 0.05, radius * 0.05]} />
          <shaderMaterial
            ref={glowMaterialRef}
            vertexShader={GLOW_VERTEX}
            fragmentShader={GLOW_FRAGMENT}
            uniforms={glowUniforms}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </Billboard>
    </group>
  );
}
