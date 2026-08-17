import { useState } from 'react';
import type { SwellPathPoint, SwellPulse } from '../data/types';
import styles from './SwellPanel.module.css';

interface SwellPanelProps {
  pulse: SwellPulse;
  currentPoint: SwellPathPoint;
  isFollowed: boolean;
  onToggleFollow: () => void;
  onClose: () => void;
}

/**
 * §2.3 step 5: "Minimal panel: name, one-line description, a
 * time-based path, a Follow action." Raw numeric values stay hidden
 * behind an explicit "Details" tap — §6.1: "the only place raw
 * numbers are permitted, and only on deliberate request."
 */
export function SwellPanel({ pulse, currentPoint, isFollowed, onToggleFollow, onClose }: SwellPanelProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <p className={styles.eyebrow}>
          {pulse.category === 'groundswell' ? 'Groundswell' : 'Wind sea'} · North Atlantic
        </p>
        <h2 className={styles.name}>{pulse.name}</h2>
        <p className={styles.narrative}>{pulse.narrative_description}</p>

        {showDetails && (
          <div className={styles.meta}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Height</span>
              <span className={styles.metaValue}>{currentPoint.swell_height.toFixed(1)} m</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Period</span>
              <span className={styles.metaValue}>{currentPoint.swell_period.toFixed(0)} s</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Position</span>
              <span className={styles.metaValue}>
                {currentPoint.lat.toFixed(1)}°, {currentPoint.lon.toFixed(1)}°
              </span>
            </div>
          </div>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={isFollowed ? styles.followButtonActive : styles.followButton}
            onClick={onToggleFollow}
          >
            {isFollowed ? 'Following' : 'Follow'}
          </button>
          <button type="button" className={styles.closeButton} onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? 'Hide details' : 'Details'}
          </button>
        </div>
      </div>
    </div>
  );
}
