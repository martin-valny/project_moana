// Shared between the ocean shader's per-fragment swell colouring
// (GlobeSphere.tsx's uSwellWeak/uSwellStrong) and Helena's own path/marker
// (HelenaPath.tsx) — round 11 put both on the same light-blue-to-purple
// strength ramp deliberately, so Helena's trail reads as one more swell in
// the same system rather than a separately-coloured line-chart overlay.
// Keep any future change to one in sync with the other.
export const SWELL_WEAK = '#8fd6f0';
export const SWELL_STRONG = '#a855f7';
