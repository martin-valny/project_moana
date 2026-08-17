import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { GlobeSphere } from './GlobeSphere';
import { AmbientField } from './AmbientField';
import { HelenaPath } from './HelenaPath';
import type { SwellPathPoint, SwellPulse } from '../data/types';

const RADIUS = 2;

interface GlobeProps {
  pulse: SwellPulse;
  currentPoint: SwellPathPoint;
  onSelectHelena: () => void;
}

export function Globe({ pulse, currentPoint, onSelectHelena }: GlobeProps) {
  return (
    <Canvas
      camera={{ position: [0, 0.9, 7.8], fov: 42 }}
      gl={{ antialias: true }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#02040a']} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 3, 5]} intensity={0.9} color="#bcd9ff" />

      <Suspense fallback={null}>
        <Stars radius={40} depth={20} count={1200} factor={1.1} saturation={0} fade speed={0.25} />
        <GlobeSphere radius={RADIUS} />
        <AmbientField radius={RADIUS} />
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
        <Bloom intensity={0.5} luminanceThreshold={0.25} luminanceSmoothing={0.25} radius={0.35} />
        <Vignette eskil={false} offset={0.3} darkness={0.6} />
      </EffectComposer>
    </Canvas>
  );
}
