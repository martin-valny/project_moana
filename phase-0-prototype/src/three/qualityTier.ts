export type QualityTier = 'high' | 'mid' | 'low';

export interface QualitySettings {
  tier: QualityTier;
  octaves: number;
  mipmapBlur: boolean;
  dpr: [number, number];
}

const SETTINGS: Record<QualityTier, QualitySettings> = {
  high: { tier: 'high', octaves: 5, mipmapBlur: true, dpr: [1, 2] },
  mid: { tier: 'mid', octaves: 3, mipmapBlur: false, dpr: [1, 1.5] },
  low: { tier: 'low', octaves: 2, mipmapBlur: false, dpr: [1, 1] },
};

/**
 * A single startup heuristic (§5.3 "adaptive quality"), not per-frame
 * branching — picking a shader variant at runtime would mean recompiling
 * it every frame, which is worse than just picking a tier once.
 */
export function detectQualityTier(): QualitySettings {
  if (typeof navigator === 'undefined') return SETTINGS.high;

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Deliberately NOT keyed on prefers-reduced-motion. That preference is
  // about vestibular comfort — it should stop things *moving* (which it
  // does: Globe.tsx disables autorotate on it), not degrade image quality.
  // Conflating the two meant anyone with reduced-motion set got a
  // 2-octave globe, and it also silently mislead this project's own
  // tooling: every screenshot/test script sets reducedMotion for
  // determinism, so all of them had been rendering the low tier rather
  // than what a typical user actually sees.
  if (cores <= 2 || memory <= 2) return SETTINGS.low;
  if (isMobile && (cores <= 4 || memory <= 4)) return SETTINGS.mid;
  return SETTINGS.high;
}
