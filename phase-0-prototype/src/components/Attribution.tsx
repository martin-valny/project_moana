import { useState } from 'react';
import styles from './Attribution.module.css';

/**
 * §3.3 decision (made here, in Phase 0, as instructed — see
 * MASTER_BUILD_PLAN.md §3.3/§11 and PROGRESS.md for the writeup):
 * a hairline, always-present credit at a screen edge — satisfying CC
 * BY 4.0's "visible wherever the data is displayed" requirement without
 * a permanent panel — that expands into a one-tap "About the data"
 * sheet with the full attribution and link. Both options from the plan,
 * combined rather than chosen between.
 *
 * Phase 0 has no live Open-Meteo data (Helena is hardcoded), so this
 * is a rehearsal of the treatment ahead of Phase 1/2, not a live legal
 * requirement yet — worth having settled before real data arrives.
 */
export function Attribution() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={styles.hairline} onClick={() => setOpen(true)}>
        Data: Open-Meteo
      </button>

      {open && (
        <div className={styles.backdrop} onClick={() => setOpen(false)}>
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <h3>About the data</h3>
            <p>
              Marine forecast data is provided by{' '}
              <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
                Open-Meteo
              </a>
              , licensed under{' '}
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
                CC BY 4.0
              </a>
              .
            </p>
            <p>
              This prototype (Phase 0) shows one hardcoded, illustrative swell path — "Helena" —
              not live data. Real Open-Meteo data arrives from Phase 1 onward.
            </p>
            <button type="button" className={styles.sheetClose} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
