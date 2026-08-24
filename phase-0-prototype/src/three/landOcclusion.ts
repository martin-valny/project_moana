import * as THREE from 'three';
import {
  SHADOW_BEARINGS,
  buildShadowRow,
  shadowTransmission,
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
 * The physics lives in `swellField.ts` (`buildShadowRow` /
 * `shadowTransmission`) alongside every other piece of shared CPU/GPU model
 * code. This module is the browser-side plumbing around it: reading real
 * land-mask pixels into an `isLand` sampler, baking each source's shadow row
 * from it, and packing those rows into the texture the ocean shader samples.
 *
 * ## Why a per-bearing row rather than a map of the globe
 *
 * Rounds "15." and "16." baked occlusion into a lat/lon atlas per source and
 * round "17." removed it in favour of computing occlusion live per fragment,
 * because no lat/lon grid the app could afford to bake was fine enough to
 * catch a real coastline (a 128x64 band is ~310km per texel; Panama's
 * isthmus is ~70km). Both framings were wrong in the same way: they stored
 * the answer on a grid laid over the *destination*, where the interesting
 * structure is arbitrarily fine, when the quantity is actually a property of
 * a *ray*.
 *
 * Indexed by bearing instead, one source's entire shadow is 2048 floats —
 * and the distance along each ray is stored as a continuous number, so there
 * is no destination grid left to be coarser than the geography. A coastline
 * lands exactly where it is, not at the nearest texel of a globe-sized grid.
 * The whole bake is ~50KB and (measured, six real sources) about 300ms,
 * against the ~1.4s round "16." measured for its atlas.
 */

/** Rows are packed one source per texture row, so this is the map's height. */
export type ShadowMap = ReturnType<typeof buildShadowMap>;

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
    let u = theta / (2 * Math.PI); // -0.5..0.5
    const v = phi / Math.PI; // 0..1
    u = ((u % 1) + 1) % 1; // RepeatWrapping, matches the shader's uLandMask
    const px = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
    const r = data[(py * width + px) * 4];
    return r < 128; // dark = land, per earth-water.png's own convention
  };
}

/**
 * Bakes every source's shadow row and packs them into one texture: one row
 * per source, `SHADOW_BEARINGS` wide, with each bearing's blocking distance
 * stored as 16 bits across r and g (8 would quantise it to 78km — wider than
 * the isthmus this exists to resolve).
 *
 * The returned object is what both halves of the app read: `texture` goes to
 * the shader, and `transmissionAt` answers the same question on the CPU for
 * `Globe.tsx`'s hit-testing, out of the identical `Float32Array` the texture
 * was packed from. There is no second copy of the data and no second model —
 * what you tap and what you see cannot disagree.
 *
 * Sampling is `NearestFilter` with no mipmaps, deliberately:
 * `shadowTransmission` does its own reconstruction across bearings, and it
 * runs inside non-uniform control flow where mip selection is undefined.
 */
export function buildShadowMap(
  origins: readonly Vec3[],
  periods: readonly number[],
  rowCount: number,
  isLand: (p: Vec3) => boolean,
) {
  const rows = origins.map((o) => buildShadowRow(o, isLand));
  const frames = origins.map((o) => sourceFrame(o));

  const data = new Uint8Array(SHADOW_BEARINGS * rowCount * 4);
  for (let s = 0; s < rows.length; s++) {
    for (let a = 0; a < SHADOW_BEARINGS; a++) {
      const scaled = Math.max(0, Math.min(1, rows[s][a] / Math.PI)) * 255;
      const hi = Math.min(255, Math.floor(scaled));
      const lo = Math.min(255, Math.round((scaled - hi) * 255));
      const at = (s * SHADOW_BEARINGS + a) * 4;
      data[at] = hi;
      data[at + 1] = lo;
      data[at + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, SHADOW_BEARINGS, rowCount, THREE.RGBAFormat);
  // Bearings are periodic: a tap can walk off either end of a row and must
  // wrap to the other side of the compass.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  return {
    texture,
    /** Per-source basis vectors defining the zero of bearing, for the uniforms. */
    frames,
    /** The same value the shader renders, for hit-testing. */
    transmissionAt(sourceIndex: number, point: Vec3): number {
      const row = rows[sourceIndex];
      if (!row) return 1;
      const { e1, e2 } = frames[sourceIndex];
      return shadowTransmission(row, origins[sourceIndex], e1, e2, point, periods[sourceIndex]);
    },
  };
}
