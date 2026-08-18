import styles from './Attribution.module.css';

interface AttributionProps {
  open: boolean;
  onClose: () => void;
}

/**
 * §3.3 decision, revised (visual-remediation brief v3, Fix 8: "remove
 * debug/attribution text from the main experience entirely... place it
 * in a separate settings/about screen only"). No standalone "Data:
 * Open-Meteo" label sits in the main view any more — the wordmark
 * (`Masthead`) is the tap target that opens this sheet instead, so the
 * credit stays reachable without adding a visible element.
 *
 * Phase 0 has no live Open-Meteo data (Helena is hardcoded), so this
 * doesn't trip CC BY 4.0's "visible wherever the data is displayed"
 * requirement yet — that requirement returns for real once Phase 1
 * wires in live data, and at that point this treatment should be
 * revisited (see PROGRESS.md) rather than assumed to still be enough.
 */
export function Attribution({ open, onClose }: AttributionProps) {
  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
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
          This prototype (Phase 0) shows one hardcoded, illustrative swell path — "Helena" — not
          live data. Real Open-Meteo data arrives from Phase 1 onward.
        </p>
        <button type="button" className={styles.sheetClose} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
