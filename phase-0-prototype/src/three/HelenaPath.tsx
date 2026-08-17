import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { latLonToVector3 } from './geo';
import type { SwellPathPoint, SwellPulse } from '../data/types';

interface HelenaPathProps {
  pulse: SwellPulse;
  radius: number;
  currentPoint: SwellPathPoint;
  onSelect: () => void;
}

const TRAIL_LIFT = 1.004; // keep the trail a hair above the sphere surface

/**
 * Helena's own path — the one thing in Phase 0 that's actually
 * data-driven and followable, rendered visually distinct from the
 * ambient field (§2.3 step 4: "user taps a visually distinct,
 * coherent-moving region").
 */
export function HelenaPath({ pulse, radius, currentPoint, onSelect }: HelenaPathProps) {
  const markerRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  const trailPoints = useMemo(
    () => pulse.path.map((p) => latLonToVector3(p.lat, p.lon, radius * TRAIL_LIFT)),
    [pulse, radius],
  );

  const currentPos = useMemo(
    () => latLonToVector3(currentPoint.lat, currentPoint.lon, radius * TRAIL_LIFT),
    [currentPoint, radius],
  );

  useFrame((state) => {
    const pulseScale = 1 + Math.sin(state.clock.elapsedTime * 1.6) * 0.18;
    if (markerRef.current) markerRef.current.scale.setScalar(pulseScale);
    if (glowRef.current) glowRef.current.scale.setScalar(pulseScale * 1.6);
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect();
  };

  return (
    <group>
      <Line points={trailPoints} color="#bdeeff" lineWidth={1.6} transparent opacity={0.55} />

      {/* Larger invisible hit target so the marker is easy to tap on a phone. */}
      <mesh position={currentPos} onClick={handleClick}>
        <sphereGeometry args={[radius * 0.045, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh ref={glowRef} position={currentPos}>
        <sphereGeometry args={[radius * 0.018, 16, 16]} />
        <meshBasicMaterial color="#7fe8ff" transparent opacity={0.25} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      <mesh ref={markerRef} position={currentPos} onClick={handleClick}>
        <sphereGeometry args={[radius * 0.009, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}
