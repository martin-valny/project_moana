#!/usr/bin/env node
/**
 * One-time asset generator, not part of the app build/runtime.
 *
 * Rasterizes world-atlas's 110m land topology into a low-res equirectangular
 * PNG (public/textures/land-mask.png) — real coastlines, but deliberately
 * coarse (per MASTER_BUILD_PLAN.md §5.1: "enough for orientation, not enough
 * to read as an atlas"), rasterized with a plain scanline polygon fill so it
 * needs no native canvas dependency.
 *
 * The result is then BLURRED. That matters: the shader derives its coastline
 * stroke from a narrow band around the 0.5 contour, which requires a smooth
 * 0..1 field. An unblurred hard 0/1 mask (what earlier rounds shipped) forces
 * the shader to use fwidth() instead, and that produces visibly jagged,
 * stair-stepped outlines.
 *
 * Pixel (x, y) -> lon = x/width*360-180, lat = 90-y/height*180 — the standard
 * equirectangular layout matching src/three/geo.ts's latLonToVector3, which
 * itself matches the shader's posToUv().
 *
 * Re-run with: node scripts/generate-land-mask.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PNG } from 'pngjs';
import { feature } from 'topojson-client';
import topology from 'world-atlas/land-110m.json' with { type: 'json' };

const WIDTH = 2048;
const HEIGHT = 1024;
const BLUR_RADIUS = 1;
const BLUR_PASSES = 3;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '../public/textures/land-mask.png');

const geo = feature(topology, topology.objects.land);

/** All polygon rings as flat arrays of [lon, lat], one array per ring. */
function collectRings(geometry) {
  const rings = [];
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  for (const polygon of polygons) {
    for (const ring of polygon) rings.push(ring);
  }
  return rings;
}

const rings = geo.features.flatMap((f) => collectRings(f.geometry));

const pixelRings = rings.map((ring) =>
  ring.map(([lon, lat]) => [((lon + 180) / 360) * WIDTH, ((90 - lat) / 180) * HEIGHT]),
);

let mask = new Float32Array(WIDTH * HEIGHT); // 0 = ocean, 1 = land

// Standard scanline polygon fill, one ring at a time (landmasses don't
// overlap, so per-ring fill is equivalent to a combined even-odd fill).
// Edges whose longitude span is implausibly large (antimeridian wraparound,
// e.g. far-eastern Russia) are skipped rather than special-cased — an
// acceptable gap for a deliberately coarse orientation mask.
for (const ring of pixelRings) {
  for (let y = 0; y < HEIGHT; y++) {
    const scanY = y + 0.5;
    const intersections = [];

    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      if (Math.abs(x1 - x2) > WIDTH * 0.5) continue; // dateline wraparound guard
      if (y1 === y2) continue;
      const crosses = (y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY);
      if (!crosses) continue;
      const t = (scanY - y1) / (y2 - y1);
      intersections.push(x1 + t * (x2 - x1));
    }

    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const xStart = Math.max(0, Math.round(intersections[i]));
      const xEnd = Math.min(WIDTH - 1, Math.round(intersections[i + 1]));
      for (let x = xStart; x <= xEnd; x++) mask[y * WIDTH + x] = 1;
    }
  }
}

const landPixels = mask.reduce((sum, v) => sum + (v > 0.5 ? 1 : 0), 0);

/** Separable box blur. X wraps (equirectangular); Y clamps at the poles. */
function boxBlur(src) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = BLUR_RADIUS * 2 + 1;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let sum = 0;
      for (let d = -BLUR_RADIUS; d <= BLUR_RADIUS; d++) {
        sum += src[y * WIDTH + ((x + d + WIDTH) % WIDTH)];
      }
      tmp[y * WIDTH + x] = sum / span;
    }
  }

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let sum = 0;
      for (let d = -BLUR_RADIUS; d <= BLUR_RADIUS; d++) {
        const yy = Math.min(HEIGHT - 1, Math.max(0, y + d));
        sum += tmp[yy * WIDTH + x];
      }
      out[y * WIDTH + x] = sum / span;
    }
  }

  return out;
}

for (let i = 0; i < BLUR_PASSES; i++) mask = boxBlur(mask);

const png = new PNG({ width: WIDTH, height: HEIGHT, colorType: 0 });
for (let i = 0; i < mask.length; i++) {
  png.data[i] = Math.round(Math.min(1, Math.max(0, mask[i])) * 255);
}

writeFileSync(outPath, PNG.sync.write(png, { colorType: 0, inputColorType: 0, bitDepth: 8 }));

console.log(`Wrote ${outPath}`);
console.log(`${WIDTH}x${HEIGHT}, land coverage: ${((landPixels / mask.length) * 100).toFixed(1)}%`);
console.log(`blurred: radius ${BLUR_RADIUS}, ${BLUR_PASSES} passes`);
