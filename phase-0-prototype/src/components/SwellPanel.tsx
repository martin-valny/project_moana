import { useMemo } from 'react';
import { SWELL_CORE, SWELL_MID } from '../three/swellPalette';
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
    const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const [cx, cy] = project(currentPoint.lon, currentPoint.lat);
    return { d, cx, cy };
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
          scrubber is showing. Same palette as the ocean's own packet cores,
          so it reads as part of the same world. */}
      <svg className={styles.arc} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="arcStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={SWELL_MID} stopOpacity="0" />
            <stop offset="55%" stopColor={SWELL_MID} stopOpacity="0.45" />
            <stop offset="100%" stopColor={SWELL_CORE} stopOpacity="0.95" />
          </linearGradient>
          <radialGradient id="arcDot">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor={SWELL_MID} stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d={glyph.d} stroke="url(#arcStroke)" strokeWidth="1.1" fill="none" strokeLinejoin="round" />
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
