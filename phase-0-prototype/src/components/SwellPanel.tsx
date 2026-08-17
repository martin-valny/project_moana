import type { SwellPulse } from '../data/types';
import styles from './SwellPanel.module.css';

interface SwellPanelProps {
  pulse: SwellPulse;
  shortLabel: string;
  isFollowed: boolean;
  onToggleFollow: () => void;
}

/**
 * Right-side glass panel (visual-engine brief stage 7): name, one
 * uppercase descriptor, a single Follow action. The path arc itself is
 * rendered in 3D (HelenaPath) rather than duplicated here. No other
 * chrome — the brief is explicit that this panel stays exactly this
 * spare. Dismissed by tapping Helena's marker again (§8's own tap-to-
 * inspect / tap-to-select toggle), not a close icon.
 */
export function SwellPanel({ pulse, shortLabel, isFollowed, onToggleFollow }: SwellPanelProps) {
  return (
    <div className={styles.panel}>
      <p className={styles.label}>{shortLabel}</p>
      <h2 className={styles.name}>{pulse.name}</h2>
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
