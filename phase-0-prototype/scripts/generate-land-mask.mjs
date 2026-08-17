#!/usr/bin/env node
/**
 * One-time asset generator, not part of the app build/runtime.
 *
 * Rasterizes world-atlas's 110m land topology into a low-res, single-channel
 * equirectangular PNG (public/textures/land-mask.png) — a real coastline
 * silhouette, but deliberately coarse (per MASTER_BUILD_PLAN.md §5.1: "enough
 * for orientation, not enough to read as an atlas"), and rasterized with a
 * plain scanline polygon fill so it doesn't need a native canvas dependency.
 *
 * Pixel (x, y) -> lon = x/width*360-180, lat = 90-y/height*180 — the standard
 * equirectangular layout matching src/three/geo.ts's latLonToVector3, which
 * itself matches THREE.SphereGeometry's default UV mapping.
 *
 * Re-run with: node scripts/generate-land-mask.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PNG } from 'pngjs';
import { feature } from 'topojson-client';
import topology from 'world-atlas/land-110m.json' with { type: 'json' };

const WIDTH = 1024;
const HEIGHT = 512;

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

// Convert to pixel space once.
const pixelRings = rings.map((ring) =>
  ring.map(([lon, lat]) => [((lon + 180) / 360) * WIDTH, ((90 - lat) / 180) * HEIGHT]),
);

const mask = new Uint8Array(WIDTH * HEIGHT); // 0 = ocean, 1 = land

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

const png = new PNG({ width: WIDTH, height: HEIGHT, colorType: 0 }); // greyscale
for (let i = 0; i < mask.length; i++) {
  png.data[i] = mask[i] ? 255 : 0;
}

writeFileSync(outPath, PNG.sync.write(png, { colorType: 0, inputColorType: 0, bitDepth: 8 }));

const landPixels = mask.reduce((sum, v) => sum + v, 0);
console.log(`Wrote ${outPath}`);
console.log(`${WIDTH}x${HEIGHT}, land coverage: ${((landPixels / mask.length) * 100).toFixed(1)}%`);
