import styles from "@/app/page.module.css";

const supportingPoints = ["Monitor an entire page by default.", "Narrow monitoring to selected sections when needed.", "Ignore regions that update constantly.", "Keep the original page snapshot as source evidence."];

export function MonitoringScopePreview() {
  return (
    <section className={styles.scopeSection} id="monitoring-scope">
      <div className={`${styles.container} ${styles.scopeGrid}`}>
        <div className={styles.scopeCopy}><p className={styles.sectionLabel}>Control the scope</p><h2>Watch the part of the page you actually care about.</h2><p>A changing footer, rotating testimonial or live counter should not become a strategy alert.</p><p>Monitor specific sections and tell Morrow which regions to ignore.</p><ul>{supportingPoints.map((point) => <li key={point}>{point}</li>)}</ul></div>
        <div className={styles.scopePreview} aria-label="Illustrative monitoring scope interface">
          <div className={styles.previewTop}><span>Monitoring scope</span><span>Example</span></div>
          <p className={styles.previewQuestion}>What should Morrow monitor?</p>
          <div className={styles.radioRows}><div><i aria-hidden="true" />Whole page</div><div className={styles.selected}><i aria-hidden="true" />Selected sections</div></div>
          <div className={styles.scopeColumns}><div><p>Sections to monitor</p><span>Pricing table</span><span>Plan comparison</span><span>Enterprise features</span></div><div><p>Regions to ignore</p><span>Customer counter</span><span>Rotating testimonial</span></div></div>
          <div className={styles.scopeFoot}><span>1 selector matched</span><span>2 ignored regions matched</span></div>
        </div>
      </div>
    </section>
  );
}
