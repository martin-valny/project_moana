import styles from './Masthead.module.css';

interface MastheadProps {
  onOpenInfo: () => void;
}

/**
 * Top-left wordmark + one line of editorial copy (§2.3 step 2). The
 * wordmark doubles as the tap target for the "About the data" sheet —
 * per the visual-remediation brief's Fix 8, no standalone attribution
 * label sits in the main view any more, so this is the discoverable
 * (not hidden, just not a separate visible element) way back to it.
 */
export function Masthead({ onOpenInfo }: MastheadProps) {
  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.wordmark} onClick={onOpenInfo}>
        MOANA
      </button>
      <p className={styles.tagline}>The ocean is moving.</p>
    </div>
  );
}
