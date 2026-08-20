import { useMemo } from 'react';
import { SWELL_CORE, SWELL_DEEP, SWELL_MID } from '../three/swellPalette';
import type { SwellPathPoint, SwellPulse } from '../data/types';
import styles from './SwellPanel.module.css';

interface SwellPanelProps {
  pulse: SwellPulse;
  currentPoint: SwellPathPoint;
  shortLabel: string;
  isFollowed: boolean;
  onToggleFollow: () => void;
}

const VIEW_W = 200;
const VIEW_H = 74;
const PAD = 9;

/**
 * Catmull-Rom through every point, emitted as cubic beziers.
 *
 * The waypoints are 6 h apart and only 20 in number, so a straight-segment
 * polyline visibly kinks at each one at this scale. This passes through
 * every waypoint exactly — the track is not being smoothed *away*, only
 * drawn without corners. Same technique, and the same reason, as the curve
 * the globe's own path used before round 14 deleted it.
 */
function smoothPath(pts: readonly [number, number][]): string {
  if (pts.length < 2) return '';
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/**
 * Projects the pulse's real waypoints into the glyph's viewBox.
 *
 * Equirectangular, fitted to the path's own bounding box — the glyph is a
 * schematic of one swell's journey at thumbnail scale, not a map, so a
 * projection that preserves the track's *shape* matters and absolute
 * geography does not. Y is flipped because SVG counts downward while
 * latitude counts up.
 */
function projectPath(path: readonly SwellPathPoint[]) {
  const lons = path.map((p) => p.lon);
  const lats = path.map((p) => p.lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const spanLon = Math.max(maxLon - minLon, 1e-6);
  const spanLat = Math.max(maxLat - minLat, 1e-6);

  return (lon: number, lat: number): [number, number] => [
    PAD + ((lon - minLon) / spanLon) * (VIEW_W - PAD * 2),
    VIEW_H - PAD - ((lat - minLat) / spanLat) * (VIEW_H - PAD * 2),
  ];
}

/**
 * Right-side detail for the selected swell: name, one uppercase descriptor,
 * a small path arc, a single Follow action — and nothing else.
 *
 * Deliberately not a panel: no card, no border box, no frosted-glass fill.
 * A thin vertical hairline is the only structural mark, over a scrim faint
 * enough that the globe still reads through it. Dismissed by tapping
 * Helena's marker again, not by a close affordance.
 */
export function SwellPanel({ pulse, currentPoint, shortLabel, isFollowed, onToggleFollow }: SwellPanelProps) {
  const glyph = useMemo(() => {
    const project = projectPath(pulse.path);
    const points = pulse.path.map((p) => project(p.lon, p.lat));
    const [cx, cy] = project(currentPoint.lon, currentPoint.lat);

    // Where "now" sits, measured along the gradient's OWN axis.
    //
    // A linearGradient with x1=0,x2=1 interpolates across the element's
    // horizontal extent, so its stop offsets are fractions of x — not of arc
    // length along the path. Measuring progress any other way lands the
    // bright point near the dot rather than on it, which on a glyph this
    // small is the difference between the highlight meaning "here" and
    // meaning nothing.
    const xs = points.map(([x]) => x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const progress = maxX > minX ? Math.max(0.02, Math.min(0.98, (cx - minX) / (maxX - minX))) : 0.5;

    return { d: smoothPath(points), cx, cy, progress };
  }, [pulse, currentPoint]);

  return (
    <div className={styles.panel}>
      <h2 className={styles.name}>{pulse.name}</h2>
      <p className={styles.label}>{shortLabel}</p>

      {/* Helena's actual track, at thumbnail scale.

          Round 14: this is where the path lives now. The globe no longer
          draws a line or a marker — the swell's own body says where it is
          and which way it is going — so the one place a *route* is still
          worth showing is here, small, beside the name it belongs to.
          Previously this was a hardcoded decorative curve
          (`M2 68 Q 96 2 191 33`) that had nothing to do with the data; it is
          now projected from `pulse.path` with the bright point at the
          interpolated current position, so it cannot disagree with what the
          scrubber is showing.

          The gradient is keyed to `progress` — where "now" actually sits
          along the track — rather than to a fixed offset. That makes the
          glyph obey the globe's own grammar instead of merely borrowing its
          colours: brightest exactly at the present, feathering back into the
          past behind it, dim ahead into forecast the swell has not reached
          yet. It is the same sentence the ocean is saying, at thumbnail
          scale, and it now moves as the scrubber moves. */}
      <svg className={styles.arc} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="arcStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={SWELL_DEEP} stopOpacity="0.05" />
            <stop offset={`${Math.max(0, glyph.progress - 0.45) * 100}%`} stopColor={SWELL_MID} stopOpacity="0.34" />
            <stop offset={`${glyph.progress * 100}%`} stopColor={SWELL_CORE} stopOpacity="0.95" />
            <stop offset={`${Math.min(1, glyph.progress + 0.12) * 100}%`} stopColor={SWELL_MID} stopOpacity="0.46" />
            <stop offset="100%" stopColor={SWELL_MID} stopOpacity="0.3" />
          </linearGradient>
          <radialGradient id="arcDot">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor={SWELL_MID} stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* A wide, faint pass under a thin bright one — a glow rather than a
            drawn line, matching how the ocean renders energy. */}
        <path d={glyph.d} stroke="url(#arcStroke)" strokeWidth="3.4" strokeOpacity="0.3" fill="none" strokeLinecap="round" />
        <path d={glyph.d} stroke="url(#arcStroke)" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        <circle cx={glyph.cx} cy={glyph.cy} r="11" fill="url(#arcDot)" />
        <circle cx={glyph.cx} cy={glyph.cy} r="2.4" fill="#ffffff" />
      </svg>

      <button
        type="button"
        className={isFollowed ? styles.followButtonActive : styles.followButton}
        onClick={onToggleFollow}
      >
        {isFollowed ? 'Following' : 'Follow Swell'}
      </button>
    </div>
  );
}
