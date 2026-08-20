/**
 * The swell colour vocabulary — shared by the ocean shader
 * (`GlobeSphere.tsx`) and the panel's path glyph (`SwellPanel.tsx`), so a
 * swell looks like the same swell wherever it appears. Keep any change to
 * one in sync with the other.
 *
 * ## Round 14: brightness carries the information, hue carries identity
 *
 * Rounds 10-13 ran a light-blue -> deep-purple ramp keyed to swell strength.
 * It was measured this round and it never rendered: the ramp needs its input
 * above ~0.6 before green drops below red (i.e. before it reads violet at
 * all), and the field's actual working range was 0.05..0.45 with a mean of
 * 0.30 and an all-time max of 0.869. **The violet half of that ramp was
 * unreachable**, which is exactly what "you kinda just make everything look
 * blue" was reporting. Round 13 spent three tuning passes downstream of it.
 *
 * The replacement puts the signal on a channel that survives the pipeline:
 *
 * - **Luminance and saturation carry energy and recency.** Near-white at a
 *   packet's leading edge, through cyan, to deep blue in the trailing
 *   feather. This is the primary information channel, and it is robust:
 *   round 13 established that ACES tonemapping crushes *saturation* at
 *   extreme brightness (and, in round 10, in near-darkness). It does not
 *   crush luminance ordering.
 * - **Hue carries identity, in the midtones only, across a narrow range.**
 *   Long-period groundswell reads cool cyan; shorter-period reads a muted
 *   green-teal. Driven by period, so it varies slowly across the globe and
 *   never competes with the brightness signal.
 *
 * No purple. The reference image has none, and the measurement above says
 * this project never actually had any either.
 */

/** Packet core — the leading edge, brightest point of a swell. */
export const SWELL_CORE = '#eafaff';
/** Mid-tone for long-period groundswell. */
export const SWELL_MID = '#7fd4ee';
/**
 * Mid-tone for shorter-period swell.
 *
 * Started at '#6fc2a8' and had to come back toward cyan. The hue channel is
 * supposed to span a *narrow* range — it distinguishes one swell from
 * another, it is not itself the signal — and that green was far enough from
 * SWELL_MID that the +3 Days frame, where the two shortest-period sources
 * (Helena at 11.2 s and Boreas at 13 s) dominate large areas, rendered as a
 * pale mint wash reading as algae rather than water. The reference carries
 * only a hint of muted green, and never as the ocean's overall cast.
 *
 * This teal still separates from SWELL_MID when two swells sit side by side,
 * which is the whole job, without shifting the ocean's character when a
 * short-period swell happens to cover a lot of it.
 */
export const SWELL_SHORT = '#67c3bd';
/** The trailing feather, fading into open water. */
export const SWELL_DEEP = '#1b4a76';

/**
 * Period (seconds) at which hue is fully `SWELL_SHORT` / fully `SWELL_MID`.
 * Spans the app's real range: Boreas at 13.0 s to Kaimana at 17.0 s.
 */
export const PERIOD_HUE_MIN_S = 12.5;
export const PERIOD_HUE_MAX_S = 17.5;
