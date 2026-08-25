import * as THREE from 'three';
import {
  SHADOW_BEARINGS,
  SHADOW_RADIUS_RINGS,
  bakeShadowGrid,
  sampleShadowGrid,
  shadowTransmissionAt,
  sourceFrame,
  type Vec3,
} from '../data/swellField';

/**
 * Land shadowing for the swell field — found live: a user watching the app
 * noticed swells reading straight through continents and reappearing on the
 * far side, and checking the shader confirmed why: the swell math is pure
 * spherical geometry (angular distance from a source), with land used only
 * to recolour the fragment, never to block propagation getting there.
 *
 * Rounds 15-18 all modelled this per-ray (walk the source-to-point arc, see
 * how much land it crosses) and all four were reverted — the shadow
 * boundaries a per-ray model draws are geometrically straight lines, which
 * reads as "sharp edges" at the zoom the app is actually used at even once
 * softened by a physically accurate amount. The physics and the reasoning
 * for the replacement are in `swellField.ts`'s "Land shadowing" section;
 * this module is the browser-side plumbing around it: reading real
 * land-mask pixels into an `isLand` sampler, baking each source's
 * (bearing x radius) grid from it, and packing those grids into the one
 * texture the ocean shader samples.
 *
 * ## Why a packed atlas with padding
 *
 * This GLSL profile rejects dynamic sampler-array indexing (found the hard
 * way in round 15: "array index for samplers must be constant integral
 * expressions"), so every source's grid has to live in one `sampler2D`,
 * addressed by a v-coordinate range per source rather than a separate
 * texture unit. `LinearFilter` (real bilinear, wanted here since the baked
 * grid is deliberately soft and blocky sampling would reintroduce exactly
 * the hard edges this replaced) blends across whatever is adjacent in the
 * texture, so without a gap, sampling near one source's row 0 or last row
 * would blend in its neighbour's data. `PAD` rows of duplicated edge data
 * on each side removes that: at a band's true top/bottom edge, `LinearFilter`
 * now blends with a *copy of its own* edge value instead of a different
 * source's, so there's a single `sampler2D`, no dynamic indexing, and no
 * cross-source bleed.
 */

const PAD = 2;
const ROWS_PER_SOURCE = SHADOW_RADIUS_RINGS + 2 * PAD;

/** Height of the packed atlas for a given source count — exported so the
 * caller sizing the `DataTexture` and this module's own packer cannot drift
 * out of sync about how much padding is baked in. */
export function atlasHeight(sourceCount: number): number {
  return ROWS_PER_SOURCE * sourceCount;
}

/** The v-coordinate range (0 = SHADOW_R_MIN, 1 = SHADOW_R_MAX) for one
 * source's band within the packed atlas — the same range the shader's
 * `moanaShadow` needs as its `rowV0`/`rowV1` arguments. */
export function bandV(sourceIndex: number, sourceCount: number): { v0: number; v1: number } {
  const height = atlasHeight(sourceCount);
  const top = sourceIndex * ROWS_PER_SOURCE + PAD;
  const bottom = top + SHADOW_RADIUS_RINGS - 1;
  return { v0: (top + 0.5) / height, v1: (bottom + 0.5) / height };
}

/**
 * Builds an `isLand` sampler from the same land-mask image the ocean
 * shader itself samples (`earth-water.png`: white(1)=ocean, black(0)=land),
 * read via an offscreen canvas since WebGL texture contents aren't
 * readable back into plain JS. Uses `posToUv`'s exact convention
 * (`GlobeSphere.tsx`) so a given unit vector maps to the same pixel here as
 * it would sampling the live GPU texture.
 */
export function buildIsLand(image: CanvasImageSource, width: number, height: number): (p: Vec3) => boolean {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return () => false;
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  return (p: Vec3) => {
    const phi = Math.acos(Math.max(-1, Math.min(1, p[1])));
    const theta = Math.atan2(p[2], -p[0]);
    let u = theta / (2 * Math.PI);
    const v = phi / Math.PI;
    u = ((u % 1) + 1) % 1;
    const px = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
    const r = data[(py * width + px) * 4];
    return r < 128;
  };
}

/**
 * Bakes every source's shadow grid and packs them into one texture — see
 * the module comment above for the padded-band layout and why. Returned
 * object is what both halves of the app read: `texture` goes to the shader,
 * and `transmissionAt` answers the same question on the CPU for
 * `Globe.tsx`'s hit-testing, out of the identical `Float32Array` grids the
 * texture was packed from. There is no second copy of the data and no
 * second model — what you tap and what you see cannot disagree.
 */
export function buildShadowAtlas(origins: readonly Vec3[], periods: readonly number[], isLand: (p: Vec3) => boolean) {
  const grids = origins.map((o, i) => bakeShadowGrid(o, periods[i], isLand));
  const frames = origins.map((o) => sourceFrame(o));
  const height = atlasHeight(origins.length);

  const data = new Uint8Array(SHADOW_BEARINGS * height);
  for (let s = 0; s < grids.length; s++) {
    const grid = grids[s];
    const base = s * ROWS_PER_SOURCE;
    for (let localRing = 0; localRing < ROWS_PER_SOURCE; localRing++) {
      // Clamp into [0, RADIUS_RINGS) so the PAD rows duplicate this band's
      // own edge ring rather than reading past it.
      const srcRing = Math.min(SHADOW_RADIUS_RINGS - 1, Math.max(0, localRing - PAD));
      for (let b = 0; b < SHADOW_BEARINGS; b++) {
        const v = grid[srcRing * SHADOW_BEARINGS + b];
        data[(base + localRing) * SHADOW_BEARINGS + b] = Math.round(Math.max(0, Math.min(1, v)) * 255);
      }
    }
  }

  const texture = new THREE.DataTexture(data, SHADOW_BEARINGS, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  return {
    texture,
    frames,
    bands: origins.map((_, i) => bandV(i, origins.length)),
    /** The same value the shader renders, for hit-testing. */
    transmissionAt(sourceIndex: number, point: Vec3): number {
      const grid = grids[sourceIndex];
      if (!grid) return 1;
      const { e1, e2 } = frames[sourceIndex];
      return shadowTransmissionAt(grid, origins[sourceIndex], e1, e2, point);
    },
  };
}

// sampleShadowGrid is re-exported for callers (e.g. debug tooling) that want
// to sample a single source's grid directly without going through the atlas.
export { sampleShadowGrid };
export type ShadowAtlas = ReturnType<typeof buildShadowAtlas>;
