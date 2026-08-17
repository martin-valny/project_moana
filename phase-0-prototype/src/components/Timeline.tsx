import { useCallback, useRef } from 'react';
import styles from './Timeline.module.css';

export interface TimelineStop {
  label: string;
  hours: number;
}

interface TimelineProps {
  hours: number;
  minHours: number;
  maxHours: number;
  stops: TimelineStop[];
  onChange: (hours: number) => void;
}

const SNAP_WINDOW_HOURS = 3;

/**
 * Stage 7's "thin, understated horizontal timeline... draggable to scrub
 * time" — continuous drag across Helena's full path, with Now/Tomorrow/3
 * Days as labelled reference stops (§8's own three states) rather than
 * the only reachable positions. Still moves only Helena's displayed
 * position (§8), nothing else in the scene.
 */
export function Timeline({ hours, minHours, maxHours, stops, onChange }: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const fractionToHours = useCallback(
    (fraction: number) => minHours + Math.min(1, Math.max(0, fraction)) * (maxHours - minHours),
    [minHours, maxHours],
  );

  const handlePointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const fraction = (clientX - rect.left) / rect.width;
      let next = fractionToHours(fraction);

      const nearestStop = stops.find((s) => Math.abs(s.hours - next) < SNAP_WINDOW_HOURS);
      if (nearestStop) next = nearestStop.hours;

      onChange(next);
    },
    [fractionToHours, stops, onChange],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    handlePointer(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.buttons !== 1) return;
    handlePointer(e.clientX);
  };

  const fraction = (hours - minHours) / (maxHours - minHours);
  const percent = `${fraction * 100}%`;

  return (
    <div className={styles.wrap}>
      <div
        ref={trackRef}
        className={styles.track}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        <div className={styles.fill} style={{ width: percent }} />
        <div className={styles.dot} style={{ left: percent }} />
      </div>
      <div className={styles.stops}>
        {stops.map((stop) => (
          <button
            key={stop.label}
            type="button"
            className={Math.abs(stop.hours - hours) < SNAP_WINDOW_HOURS ? styles.stopLabelActive : styles.stopLabel}
            style={{ left: `${((stop.hours - minHours) / (maxHours - minHours)) * 100}%` }}
            onClick={() => onChange(stop.hours)}
          >
            {stop.label}
          </button>
        ))}
      </div>
    </div>
  );
}
