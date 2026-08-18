import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { latLonToVector3 } from './geo';
import { normalizeEnergy } from '../data/interpolate';
import type { SwellPathPoint, SwellPulse } from '../data/types';

interface HelenaPathProps {
  pulse: SwellPulse;
  radius: number;
  currentPoint: SwellPathPoint;
  onSelect: () => void;
}

// Same palette family as the surface shader's ocean-mid/bright stops
// (Fix 9) — the arc reads as an extension of the ribbon shader, not a
// separately-styled line-chart overlay. BRIGHT carries the same HDR
// headroom as the ocean's peak colour so it blooms consistently.
const DEEP = new THREE.Color('#0f3f77');
const BRIGHT = new THREE.Color('#e0f9ff').multiplyScalar(1.85);

/**
 * Helena's path, restyled (visual-engine brief stage 6) as a thin raised
 * arc in the same cobalt-to-white gradient family as the surface shader —
 * part of one visual language, not a separate line-chart-style overlay.
 */
export function HelenaPath({ pulse, radius, currentPoint, onSelect }: HelenaPathProps) {
  const markerRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

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
      return DEEP.clone().lerp(BRIGHT, 0.25 + e * 0.6);
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
    const colors = points.map((_, k) => {
      const floatIdx = (k / divisions) * (n - 1);
      const lo = Math.floor(floatIdx);
      const hi = Math.min(lo + 1, n - 1);
      const frac = floatIdx - lo;
      return waypointColors[lo].clone().lerp(waypointColors[hi], frac);
    });

    return { trailPoints: points, trailColors: colors };
  }, [pulse, radius]);

  const currentPos = useMemo(() => latLonToVector3(currentPoint.lat, currentPoint.lon, radius * 1.01), [currentPoint, radius]);

  // Off by default; the automated checks opt in with ?e2e=1. Hunting for a
  // moving 3D marker by sweeping screen coordinates is far too slow when
  // every synthetic click waits on a software-rendered WebGL frame.
  const exposeMarker = useMemo(
    () => new URLSearchParams(window.location.search).has('e2e'),
    [],
  );

  useFrame((state) => {
    const pulseScale = 1 + Math.sin(state.clock.elapsedTime * 1.6) * 0.18;
    if (markerRef.current) markerRef.current.scale.setScalar(pulseScale);
    if (glowRef.current) glowRef.current.scale.setScalar(pulseScale * 1.6);

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

  return (
    <group>
      <Line points={trailPoints} vertexColors={trailColors} lineWidth={1.1} transparent opacity={0.45} />

      {/* Larger invisible hit target so the marker is easy to tap on a phone. */}
      <mesh position={currentPos} onClick={handleClick}>
        <sphereGeometry args={[radius * 0.05, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh ref={glowRef} position={currentPos}>
        <sphereGeometry args={[radius * 0.011, 16, 16]} />
        <meshBasicMaterial color={BRIGHT} transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      <mesh ref={markerRef} position={currentPos} onClick={handleClick}>
        <sphereGeometry args={[radius * 0.0052, 16, 16]} />
        <meshBasicMaterial color={BRIGHT} toneMapped={false} />
      </mesh>
    </group>
  );
}
