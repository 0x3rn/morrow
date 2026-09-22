import styles from "@/app/page.module.css";

export function ChangeRecordPreview() {
  return (
    <section className={styles.recordSection} id="change-record">
      <div className={`${styles.container} ${styles.recordGrid}`}>
        <div className={styles.recordCopy}><p className={styles.sectionLabel}>A change record</p><h2>The summary is only the starting point.</h2><p>Morrow keeps the old text, the new text and the source capture together so the signal can be verified.</p></div>
        <article className={styles.recordPreview} aria-label="Illustrative change record">
          <div className={styles.recordMeta}><span>Pricing</span><strong>Major</strong><time>16 Sept, 20:43</time></div>
          <h3>Enterprise pricing replaced the starter offer.</h3>
          <p className={styles.recordSummary}>The page changed from a $49 starter plan to a $999 enterprise offer with an annual contract requirement.</p>
          <div className={styles.evidenceGrid}><div><p>Previous</p><strong>Starter</strong><span>Price $49</span></div><div><p>Current</p><strong>Enterprise Launch</strong><span>Price $999 per month</span><span>Annual contract required</span></div></div>
          <div className={styles.evidenceFoot}><i aria-hidden="true" />Source evidence available</div>
        </article>
      </div>
    </section>
  );
}
