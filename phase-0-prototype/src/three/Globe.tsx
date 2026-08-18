import { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing';
import { NoToneMapping, type PerspectiveCamera } from 'three';
import { GlobeSphere } from './GlobeSphere';
import { latLonToVector3 } from './geo';
import { HelenaPath } from './HelenaPath';
import { detectQualityTier } from './qualityTier';
import { normalizeEnergy } from '../data/interpolate';
import type { SwellPathPoint, SwellPulse } from '../data/types';

const RADIUS = 2;

// Open looking at the North Atlantic — the basin Helena crosses, so she is
// on screen from the first frame rather than round the far side.
const INITIAL_VIEW = latLonToVector3(24, -48, 8).toArray() as [number, number, number];
// Narrow, telephoto-ish FOV. The reference shows a near-full hemisphere
// *and* a globe that overflows the frame — only a long lens gives both. A
// wide FOV pulled in close fills the frame too, but crops to a small patch
// of geography with heavy perspective, which is not what it looks like.
const FOV = 8;

/**
 * Pulls the camera in so the globe overflows the frame rather than sitting
 * inside it as a small object in a field of black — a large part of what
 * makes the reference read as "a planet you are close to."
 *
 * The needed angular diameter is set by whichever screen axis is *wider* in
 * angle, so the sphere covers both; a small factor over that gives the
 * overflow. Recomputed on resize, so one rule handles desktop landscape and
 * phone portrait without separate breakpoints. OrbitControls picks the new
 * position up on its next update (it derives its spherical state from
 * camera.position each frame), so no explicit re-sync is needed.
 */
function FillFrameCamera({ radius }: { radius: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);

  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    const needed = Math.min(Math.max(vFov, hFov) * 0.97, Math.PI * 0.85);
    const distance = Math.max(radius * 1.35, radius / Math.sin(needed / 2));

    camera.position.setLength(distance);
    camera.updateProjectionMatrix();
  }, [camera, size, radius]);

  return null;
}

interface GlobeProps {
  pulse: SwellPulse;
  currentPoint: SwellPathPoint;
  onSelectHelena: () => void;
}

export function Globe({ pulse, currentPoint, onSelectHelena }: GlobeProps) {
  const quality = useMemo(() => detectQualityTier(), []);
  // Idle rotation is decorative motion; honour a reduced-motion preference.
  // (It also makes the scene deterministic for the Playwright checks.)
  const reduceMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );
  const energy01 = normalizeEnergy(currentPoint.energy);

  return (
    <Canvas
      camera={{ position: INITIAL_VIEW, fov: FOV, near: 0.5, far: 400 }}
      gl={{ antialias: true, toneMapping: NoToneMapping }}
      dpr={quality.dpr}
    >
      <color attach="background" args={['#02040a']} />
      <FillFrameCamera radius={RADIUS} />

      <Suspense fallback={null}>
        {/* Sparse, low-opacity, intentional — not scattered debug dots. */}
        <Stars radius={140} depth={60} count={500} factor={0.6} saturation={0} fade speed={0.2} />
        <GlobeSphere radius={RADIUS} lat={currentPoint.lat} lon={currentPoint.lon} headingDeg={currentPoint.heading_deg} energy01={energy01} octaves={quality.octaves} />
        <HelenaPath pulse={pulse} radius={RADIUS} currentPoint={currentPoint} onSelect={onSelectHelena} />
      </Suspense>

      <OrbitControls
        enablePan={false}
        minDistance={8}
        maxDistance={48}
        autoRotate={!reduceMotion}
        autoRotateSpeed={0.3}
        rotateSpeed={0.42}
        enableDamping
        dampingFactor={0.07}
      />

      <EffectComposer multisampling={0}>
        <Bloom
          intensity={0.6}
          luminanceThreshold={0.6}
          luminanceSmoothing={0.25}
          mipmapBlur={quality.mipmapBlur}
          radius={0.6}
        />
        <Noise opacity={0.018} premultiply />
        <Vignette eskil={false} offset={0.32} darkness={0.55} />
      </EffectComposer>
    </Canvas>
  );
}
