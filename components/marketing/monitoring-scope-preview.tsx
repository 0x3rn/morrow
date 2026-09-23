import styles from "@/app/page.module.css";

const supportingPoints = ["Monitor an entire page by default.", "Narrow monitoring to selected sections when needed.", "Ignore regions that update constantly.", "Keep each captured page as source evidence."];

export function MonitoringScopePreview() {
  return (
    <section className={styles.scopeSection} id="monitoring-scope">
      <div className={`${styles.container} ${styles.scopeGrid}`}>
        <div className={styles.scopeCopy}><p className={styles.sectionLabel}>Control the scope</p><h2>Watch the part of the page you actually care about.</h2><p>A changing footer, rotating testimonial or live counter should not create a change record.</p><p>Monitor specific sections and tell Morrow which regions to ignore.</p><ul>{supportingPoints.map((point) => <li key={point}>{point}</li>)}</ul></div>
        <div className={styles.scopePreview} aria-label="Illustrative monitoring scope interface">
          <div className={styles.previewTop}><strong>Monitoring scope</strong><span>Selected sections</span></div>
          <p className={styles.previewDescription}>Choose which parts of this page Morrow should compare and which parts to ignore.</p>
          <div className={styles.scopeColumns}>
            <div><p>Sections to monitor</p><div className={styles.selectorField}>.pricing-table</div><small>One CSS selector per line. Leave empty to monitor the whole page.</small></div>
            <div><p>Regions to ignore</p><div className={styles.selectorField}>.live-counter</div><small>Changes inside these regions are ignored, even when they are inside a monitored section.</small></div>
          </div>
          <div className={styles.scopeTestBar}><span>Test against the latest capture.</span><span className={styles.scopeTestButton}>Test selectors</span></div>
          <div className={styles.scopeResults}>
            <p>Selector test results <span>Latest captured version</span></p>
            <div><code>.pricing-table</code><strong>1 match</strong><span>Pricing table · Enterprise plan</span></div>
            <div><code>.live-counter</code><strong>1 match</strong><span>Live customer counter</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}
