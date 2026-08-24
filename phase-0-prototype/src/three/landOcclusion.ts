import { pathOcclusion, type Vec3 } from '../data/swellField';
import type { SwellSource } from '../data/swellSources';

/**
 * Real land-shadowing for the swell field — found live: a user watching the
 * app noticed swells reading straight through continents and reappearing on
 * the far side, and checking the shader confirmed why: the swell math is
 * pure spherical geometry (angular distance from a source), with land used
 * only to recolour the fragment, never to block propagation getting there.
 * `pathOcclusion` (swellField.ts) is the physics: how much of a source-to-
 * point path crosses land, and how much that attenuates the swell. This
 * module is the browser-specific half — reading real land-mask pixels and
 * baking `pathOcclusion` into a texture the shader can sample cheaply.
 *
 * **Why precomputed, not per-frame:** every source's origin is fixed for
 * the whole session (`buildSwellSources` never moves one), so "how shadowed
 * is each point on the globe from this source" never changes after the
 * sources are built — computing it once at that point, rather than walking
 * `pathOcclusion`'s own land-mask lookups per source per *fragment* every
 * single frame, is the same answer for a fraction of the cost.
 *
 * **One packed atlas, with padding, not one texture per source.** An array
 * of per-source textures (`uniform sampler2D uOcclusion[MAX_SOURCES]`,
 * indexed by the loop variable) was tried first and rejected before it ever
 * rendered: this shader compiles under a GLSL profile that only allows
 * *constant* sampler-array indices, and threw "array index for samplers
 * must be constant integral expressions" the moment it hit a real browser.
 * Packed into one shared texture, sources stacked in vertical bands, needs
 * only a single `sampler2D` with a computed V coordinate — no per-source
 * indexing at all. That reintroduces the *other* problem an earlier packed
 * attempt hit: `LinearFilter` blending across a band boundary into the
 * neighbouring source's data, which read as a staircase along coastlines
 * under the `NearestFilter` used to avoid it. Fixed properly this time with
 * `PAD` rows of duplicated edge data on both sides of every source's true
 * rows (see `buildOcclusionAtlas`) — bilinear filtering only ever reaches
 * one texel in either direction, so sampling at a band's true edge blends
 * with a *copy of its own* edge value, never a different source's.
 */

/** Texels per source map, per axis — smooth `LinearFilter` interpolation
 * is what removes the staircase (see module comment), not raw resolution,
 * so this is deliberately modest. */
export const ATLAS_WIDTH = 128;
export const ATLAS_HEIGHT_PER_SOURCE = 64;

/** Duplicated-edge padding rows on each side of a source's true rows.
 * `LinearFilter` samples at most 1 texel either side of the exact
 * coordinate, so 1 row is sufficient; 2 is one row of margin for it. */
const PAD = 2;
const BAND_HEIGHT = ATLAS_HEIGHT_PER_SOURCE + 2 * PAD;

/** Total atlas height in texels for `sourceCount` packed bands — what the
 * `THREE.DataTexture` wrapping `buildOcclusionAtlas`'s output must be
 * constructed with, so that sizing can't drift out of sync with the
 * padding baked in here. */
export function atlasHeight(sourceCount: number): number {
  return BAND_HEIGHT * sourceCount;
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
    let u = theta / (2 * Math.PI); // -0.5..0.5
    const v = phi / Math.PI; // 0..1
    u = ((u % 1) + 1) % 1; // RepeatWrapping, matches the shader's uLandMask
    const px = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
    const r = data[(py * width + px) * 4];
    return r < 128; // dark = land, per earth-water.png's own convention
  };
}

/** Inverse of `posToUv` in `GlobeSphere.tsx` — atlas (u,v) -> unit vector. */
function uvToVec3(u: number, v: number): Vec3 {
  const theta = u * 2 * Math.PI;
  const phi = v * Math.PI;
  const sinPhi = Math.sin(phi);
  return [-sinPhi * Math.cos(theta), Math.cos(phi), sinPhi * Math.sin(theta)];
}

/**
 * One texel per (source, output uv), each holding `pathOcclusion` from
 * that source's own origin to that point. RGBA (not a single-channel
 * format) for universal WebGL1/2 + software-renderer compatibility — the
 * occlusion value is replicated into all four channels, the shader only
 * reads `.r`. Sources stacked vertically, each given `BAND_HEIGHT` rows:
 * `PAD` rows duplicating its own top edge, `ATLAS_HEIGHT_PER_SOURCE` real
 * rows, `PAD` rows duplicating its own bottom edge (see module comment for
 * why). `GlobeSphere.tsx`'s shader must map its V coordinate through this
 * same padded layout — `bandHeightNormalized`/`sampleBandV` below are also
 * exported so that mapping can't drift out of sync with this one.
 */
export function buildOcclusionAtlas(sources: readonly SwellSource[], isLand: (p: Vec3) => boolean): Uint8Array {
  const totalHeight = BAND_HEIGHT * sources.length;
  const atlas = new Uint8Array(ATLAS_WIDTH * totalHeight * 4);

  const setTexel = (col: number, atlasRow: number, byte: number) => {
    const idx = (atlasRow * ATLAS_WIDTH + col) * 4;
    atlas[idx] = byte;
    atlas[idx + 1] = byte;
    atlas[idx + 2] = byte;
    atlas[idx + 3] = 255;
  };

  sources.forEach((source, sourceIndex) => {
    const origin: Vec3 = [source.origin.x, source.origin.y, source.origin.z];
    const bandStart = sourceIndex * BAND_HEIGHT;
    const rowBytes = new Uint8Array(ATLAS_WIDTH); // this source's just-computed row, reused for padding

    for (let row = 0; row < ATLAS_HEIGHT_PER_SOURCE; row++) {
      const v = (row + 0.5) / ATLAS_HEIGHT_PER_SOURCE;
      for (let col = 0; col < ATLAS_WIDTH; col++) {
        const u = (col + 0.5) / ATLAS_WIDTH;
        const occlusion = pathOcclusion(origin, uvToVec3(u, v), isLand);
        rowBytes[col] = Math.round(Math.max(0, Math.min(1, occlusion)) * 255);
      }
      const atlasRow = bandStart + PAD + row;
      for (let col = 0; col < ATLAS_WIDTH; col++) setTexel(col, atlasRow, rowBytes[col]);

      // Duplicate row 0 into the top padding, and the last row into the
      // bottom padding, once each -- overwritten harmlessly on later
      // iterations until the true edge row is reached.
      if (row === 0) {
        for (let p = 0; p < PAD; p++) {
          for (let col = 0; col < ATLAS_WIDTH; col++) setTexel(col, bandStart + p, rowBytes[col]);
        }
      }
      if (row === ATLAS_HEIGHT_PER_SOURCE - 1) {
        for (let p = 0; p < PAD; p++) {
          for (let col = 0; col < ATLAS_WIDTH; col++) setTexel(col, bandStart + PAD + ATLAS_HEIGHT_PER_SOURCE + p, rowBytes[col]);
        }
      }
    }
  });

  return atlas;
}

/**
 * Maps a source index and this fragment's own `uv.y` (0..1, from
 * `posToUv(vPos)`) to the V coordinate of that source's band inside the
 * padded atlas `buildOcclusionAtlas` builds — the GLSL mirror of this
 * lives inline in `GlobeSphere.tsx`'s fragment shader (kept in comments in
 * sync with this rather than templated in, since it's three short lines
 * used exactly once).
 */
export function sampleBandV(sourceIndex: number, uvY: number, sourceCount: number): number {
  const bandStart = sourceIndex * BAND_HEIGHT;
  const rowInBand = PAD + uvY * ATLAS_HEIGHT_PER_SOURCE;
  return (bandStart + rowInBand) / (BAND_HEIGHT * sourceCount);
}
