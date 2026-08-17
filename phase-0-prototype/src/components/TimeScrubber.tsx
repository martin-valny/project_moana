import { SCRUBBER_LABELS, type ScrubberStop } from '../data/types';
import styles from './TimeScrubber.module.css';

const STOPS: ScrubberStop[] = ['now', 'tomorrow', 'three_days'];

interface TimeScrubberProps {
  value: ScrubberStop;
  onChange: (stop: ScrubberStop) => void;
}

/**
 * §8 Phase 0: "Time scrubber (Now / Tomorrow / 3 Days) moves the
 * hard-coded path's displayed position only." Nothing else reacts to it.
 */
export function TimeScrubber({ value, onChange }: TimeScrubberProps) {
  return (
    <div className={styles.wrap}>
      {STOPS.map((stop) => (
        <button
          key={stop}
          type="button"
          className={value === stop ? styles.stopActive : styles.stop}
          onClick={() => onChange(stop)}
        >
          {SCRUBBER_LABELS[stop]}
        </button>
      ))}
    </div>
  );
}
