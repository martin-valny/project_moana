import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing';
import { GlobeSphere } from './GlobeSphere';
import { HelenaPath } from './HelenaPath';
import { detectQualityTier } from './qualityTier';
import { normalizeEnergy } from '../data/interpolate';
import type { SwellPathPoint, SwellPulse } from '../data/types';

const RADIUS = 2;

interface GlobeProps {
  pulse: SwellPulse;
  currentPoint: SwellPathPoint;
  onSelectHelena: () => void;
}

export function Globe({ pulse, currentPoint, onSelectHelena }: GlobeProps) {
  const quality = useMemo(() => detectQualityTier(), []);
  const energy01 = normalizeEnergy(currentPoint.energy);

  return (
    <Canvas camera={{ position: [0, 0.9, 7.8], fov: 42 }} gl={{ antialias: true }} dpr={quality.dpr}>
      <color attach="background" args={['#02040a']} />

      <Suspense fallback={null}>
        <Stars radius={40} depth={20} count={1200} factor={1.1} saturation={0} fade speed={0.25} />
        <GlobeSphere radius={RADIUS} headingDeg={currentPoint.heading_deg} energy01={energy01} octaves={quality.octaves} />
        <HelenaPath pulse={pulse} radius={RADIUS} currentPoint={currentPoint} onSelect={onSelectHelena} />
      </Suspense>

      <OrbitControls
        enablePan={false}
        minDistance={3.5}
        maxDistance={13}
        autoRotate
        autoRotateSpeed={0.35}
        rotateSpeed={0.5}
        enableDamping
        dampingFactor={0.08}
      />

      <EffectComposer multisampling={0}>
        <Bloom
          intensity={0.65}
          luminanceThreshold={0.85}
          luminanceSmoothing={0.15}
          mipmapBlur={quality.mipmapBlur}
          radius={0.5}
        />
        <Noise opacity={0.02} premultiply />
        <Vignette eskil={false} offset={0.3} darkness={0.65} />
      </EffectComposer>
    </Canvas>
  );
}
