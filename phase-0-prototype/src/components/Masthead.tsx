import styles from './Masthead.module.css';

/** Top-left wordmark + one line of editorial copy (§2.3 step 2, visual-engine brief stage 7). */
export function Masthead() {
  return (
    <div className={styles.wrap}>
      <p className={styles.wordmark}>MOANA.</p>
      <p className={styles.tagline}>The ocean is moving.</p>
    </div>
  );
}
