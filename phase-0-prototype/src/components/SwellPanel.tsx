import type { SwellPulse } from '../data/types';
import styles from './SwellPanel.module.css';

interface SwellPanelProps {
  pulse: SwellPulse;
  shortLabel: string;
  isFollowed: boolean;
  onToggleFollow: () => void;
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
export function SwellPanel({ pulse, shortLabel, isFollowed, onToggleFollow }: SwellPanelProps) {
  return (
    <div className={styles.panel}>
      <h2 className={styles.name}>{pulse.name}</h2>
      <p className={styles.label}>{shortLabel}</p>

      {/* Schematic of the pulse's arc across the ocean, with its current
          position as the bright point. Same palette family as the globe's
          ribbon crests so it reads as part of the same world. */}
      <svg className={styles.arc} viewBox="0 0 200 74" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="arcStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#9fd8e8" stopOpacity="0" />
            <stop offset="55%" stopColor="#9fd8e8" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#eafaff" stopOpacity="0.95" />
          </linearGradient>
          <radialGradient id="arcDot">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#9fd8e8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d="M2 68 Q 96 2 191 33" stroke="url(#arcStroke)" strokeWidth="1.1" fill="none" />
        <circle cx="191" cy="33" r="11" fill="url(#arcDot)" />
        <circle cx="191" cy="33" r="2.4" fill="#ffffff" />
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
