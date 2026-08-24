import type { Vec3 } from '../data/swellField';

/**
 * Real land-shadowing for the swell field — found live: a user watching the
 * app noticed swells reading straight through continents and reappearing on
 * the far side, and checking the shader confirmed why: the swell math is
 * pure spherical geometry (angular distance from a source), with land used
 * only to recolour the fragment, never to block propagation getting there.
 * `pathOcclusion` (`swellField.ts`) is the physics: how much of a source-to-
 * point path crosses land, and how much that attenuates the swell.
 *
 * This module used to also bake `pathOcclusion` into a texture atlas the
 * shader could sample cheaply (rounds "15."-"16."). Round "17." removed
 * that: a baked atlas needs a destination grid at *some* fixed resolution,
 * and no resolution the app could afford to bake in reasonable time was
 * fine enough to reliably catch a real coastline — measured directly, the
 * shipped 128x64-per-source atlas (~310km/texel) simply had no texel that
 * ever landed on Central America's ~70km Panama isthmus, so a source's
 * swell rendered straight through it regardless of how correct the
 * *sampling along the path* was. `GlobeSphere.tsx`'s shader now calls its
 * own GLSL mirror of `pathOcclusion` directly against the real land mask
 * texture per fragment, which has no such ceiling — see that file's
 * `pathOcclusion` GLSL function for the current mechanism.
 *
 * What's left here is just the CPU half `Globe.tsx`'s hit-testing needs:
 * reading real land-mask pixels into an `isLand` sampler, so tapping a
 * point still applies the identical occlusion the shader renders.
 */

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
