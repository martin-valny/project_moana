import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, Noise, HueSaturation, BrightnessContrast, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { NoToneMapping, Vector3, type PerspectiveCamera } from 'three';
import { GlobeSphere } from './GlobeSphere';
import { latLonToVector3 } from './geo';
import { detectQualityTier } from './qualityTier';
import { buildSwellSources, resolveSwellSources } from '../data/swellSources';
import { sourceWeightAt, type SwellSourceState, type Vec3 } from '../data/swellField';
import type { ShadowAtlas } from './landOcclusion';
import type { SwellPulse } from '../data/types';

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

/**
 * Publishes the on-screen position of Helena's brightest point for the
 * Playwright checks (`?e2e=1` only).
 *
 * Round 14 removed the drawn marker this used to track, so it now reports
 * the peak of her *packet*: the point at angular distance `rLead` along her
 * travel great circle, where the comet envelope is 1.0 and the directional
 * cone is 1.0 by construction — i.e. provably the brightest pixel she has.
 * That is a better target than the old marker was, because it is defined by
 * the same field the user is actually looking at.
 *
 * Hunting for it by sweeping screen coordinates is not viable here: every
 * synthetic click waits on a software-rendered WebGL frame, so a grid search
 * costs minutes per viewport.
 */
function MarkerProbe({ state, states }: { state: SwellSourceState | undefined; states: SwellSourceState[] }) {
  useFrame(({ camera, size }) => {
    // Lets `field-metrics.mjs` sample rendered pixels along a source's own
    // travel great circle: it needs this scene's exact projection, and
    // re-deriving a camera matrix outside the app would be one more copy of
    // a fact that already lives here. Also publishes the resolved states so
    // the harness compares pixels against the geometry actually on screen,
    // not a re-computation of it.
    (window as unknown as Record<string, unknown>).__moanaProject = (v: [number, number, number]) => {
      const world = new Vector3(...v).multiplyScalar(RADIUS);
      const ndc = world.clone().project(camera);
      return {
        x: (ndc.x * 0.5 + 0.5) * size.width,
        y: (-ndc.y * 0.5 + 0.5) * size.height,
        facing: world.dot(camera.position.clone().sub(world)) > 0,
      };
    };
    (window as unknown as Record<string, unknown>).__moanaStates = states;

    if (!state) return;
    const o = new Vector3(...state.origin);
    const d = new Vector3(...state.direction);
    const peak = o.multiplyScalar(Math.cos(state.rLead)).add(d.multiplyScalar(Math.sin(state.rLead)));
    const world = peak.clone().multiplyScalar(RADIUS);
    const ndc = world.clone().project(camera);
    (window as unknown as Record<string, unknown>).__moanaMarker = {
      x: (ndc.x * 0.5 + 0.5) * size.width,
      y: (-ndc.y * 0.5 + 0.5) * size.height,
      // Facing the camera, i.e. on the near side of the globe.
      facing: world.dot(camera.position.clone().sub(world)) > 0,
    };
  });
  return null;
}

interface GlobeProps {
  pulse: SwellPulse;
  /** App-load time — the anchor `offsetHours` is measured from. */
  startTime: Date;
  /** Hours relative to app-load time, from the Timeline — round 9 threads this
      into GlobeSphere so the whole swell field advances with the scrubber,
      not just Helena's marker. See MASTER_BUILD_PLAN.md §11's round-9 entry. */
  offsetHours: number;
  /** Index of the selected source, or -1. */
  selectedIndex: number;
  onSelectSource: (index: number) => void;
}

/**
 * Below this field weight a tap counts as open water and clears the
 * selection, rather than snapping to whichever swell happens to be least
 * far away. Sits above the noise floor but well under a packet's body, so
 * the whole visible ribbon is tappable, not just its brightest core.
 */
const PICK_THRESHOLD = 0.02;

export function Globe({ pulse, startTime, offsetHours, selectedIndex, onSelectSource }: GlobeProps) {
  const quality = useMemo(() => detectQualityTier(), []);
  // Idle rotation is decorative motion; honour a reduced-motion preference.
  // (It also makes the scene deterministic for the Playwright checks.)
  const reduceMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );

  // The same states the shader is rendering, resolved once and shared with
  // hit-testing — so tapping a swell and seeing a swell are one evaluation.
  const sources = useMemo(() => buildSwellSources(pulse), [pulse]);
  const states = useMemo(
    () => resolveSwellSources(sources, startTime, offsetHours),
    [sources, startTime, offsetHours],
  );

  const exposeMarker = useMemo(() => new URLSearchParams(window.location.search).has('e2e'), []);

  /**
   * Which swell did that tap land on? Argmax of the field's own per-source
   * weight at the tapped point — the swell that is brightest under the
   * finger wins, and open water clears the selection.
   */
  const [shadow, setShadow] = useState<ShadowAtlas | null>(null);

  const handlePick = useCallback(
    (unit: Vector3) => {
      const p: Vec3 = [unit.x, unit.y, unit.z];
      let best = -1;
      let bestWeight = PICK_THRESHOLD;
      states.forEach((s, i) => {
        const w = sourceWeightAt(s, p) * (shadow ? shadow.transmissionAt(i, p) : 1);
        if (w > bestWeight) {
          bestWeight = w;
          best = i;
        }
      });
      onSelectSource(best);
    },
    [states, shadow, onSelectSource],
  );

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
        <GlobeSphere
          radius={RADIUS}
          pulse={pulse}
          startTime={startTime}
          offsetHours={offsetHours}
          selectedIndex={selectedIndex}
          onPick={handlePick}
          onShadowReady={setShadow}
          octaves={quality.octaves}
        />
        {exposeMarker && <MarkerProbe state={states[0]} states={states} />}
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
