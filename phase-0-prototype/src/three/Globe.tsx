import { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, Noise, HueSaturation, BrightnessContrast, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
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
 * Frames the globe as a whole planet: the full disc across the *wider*
 * screen axis with real black margin either side, overflowing only the
 * narrower axis.
 *
 * Round 8: this factor was 0.97, which made the sphere span ~100% of the
 * frame width — a close-up of a patch of ocean, not a planet. Measured
 * against the reference image directly (sphere spans ~74% of frame width,
 * black space clearly visible past both limbs, cropped only top/bottom)
 * and matched to it. This is the single largest reason earlier rounds
 * didn't read like the reference: at 0.97 the visible area is a ~60° arc
 * of globe, so whatever landmass happens to be near the camera axis fills
 * the screen; at 0.74 the same camera target shows the whole Atlantic
 * hemisphere the way the reference does.
 *
 * FOV stays telephoto (8°) — that's what gives a near-full hemisphere with
 * little perspective distortion, which the reference also shows. Only the
 * distance changes. Recomputed on resize, so one rule handles desktop
 * landscape and phone portrait without separate breakpoints. OrbitControls
 * picks the new position up on its next update (it derives its spherical
 * state from camera.position each frame), so no explicit re-sync needed.
 */
const DISC_COVERAGE = 0.74;
function FillFrameCamera({ radius }: { radius: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);

  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    const needed = Math.min(Math.max(vFov, hFov) * DISC_COVERAGE, Math.PI * 0.85);
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
          luminanceThreshold={0.5}
          luminanceSmoothing={0.25}
          mipmapBlur={quality.mipmapBlur}
          radius={0.6}
        />
        {/* Round 7: a cinematic colour-grade pass using postprocessing
            effects already installed but previously unused. Applied here,
            after Bloom in the composer chain — not via renderer.toneMapping,
            which round 3 already found clamps HDR colours before Bloom ever
            sees them. Bloom still reads the pre-graded HDR scene colour, so
            this doesn't reintroduce that bug. */}
        {/* Round 8b: saturation dialled back 0.18 -> 0.05. A global
            saturation boost multiplies whatever the shader already
            produced, so it was compounding with the palette's own
            saturation rather than grading it — the ocean came out vivid
            cyan and the green patches came out neon. The grade should be
            the last few percent, not a second colour decision. */}
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <HueSaturation saturation={0.05} />
        <BrightnessContrast brightness={0.02} contrast={0.06} />
        <Noise opacity={0.018} premultiply />
        <Vignette eskil={false} offset={0.32} darkness={0.32} />
      </EffectComposer>
    </Canvas>
  );
}
