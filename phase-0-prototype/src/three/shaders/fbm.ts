/**
 * Fractal Brownian motion + domain warp — the technique behind the
 * swirling, marbled ribbon look (as opposed to blotchy plain noise).
 * Depends on `snoise(vec3)` from noise.ts being concatenated before this.
 */
export const FBM_GLSL = /* glsl */ `
float fbm(vec3 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    value += amplitude * snoise(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

/**
 * Folds fbm's own output back into its input before a final sample, twice
 * (Iñigo Quilez's "domain warping" technique) — a single warp still reads
 * as blobby clouds; the second warp layer is specifically what turns that
 * into long, self-similar, marbled, curling ribbons.
 */
float warpedFbm(vec3 p, int octaves, float warpStrength, vec3 flowBias) {
  vec3 q = vec3(
    fbm(p + vec3(0.0, 0.0, 0.0), octaves),
    fbm(p + vec3(5.2, 1.3, 2.8), octaves),
    fbm(p + vec3(1.7, 9.2, 3.3), octaves)
  );

  vec3 r = vec3(
    fbm(p + warpStrength * q + vec3(1.7, 9.2, 3.3) + flowBias, octaves),
    fbm(p + warpStrength * q + vec3(8.3, 2.8, 0.4) + flowBias, octaves),
    fbm(p + warpStrength * q + vec3(4.1, 6.6, 5.7) + flowBias, octaves)
  );

  return fbm(p + warpStrength * r, octaves);
}
`;
