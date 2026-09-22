import styles from "@/app/page.module.css";

const examples = [
  { label: "Pricing", before: "$49 / month", after: "$79 / month" },
  { label: "Product", before: "Team permissions", after: "SSO, audit logs and role controls" },
  { label: "Positioning", before: "Built for small teams", after: "Built for enterprise operations" },
  { label: "Terms", before: "Cancel anytime", after: "Annual commitment required" },
];

export function ChangeExamples() {
  return (
    <section className={styles.problemSection}>
      <div className={styles.container}>
        <div className={styles.splitHeading}>
          <div><p className={styles.sectionLabel}>Why Morrow</p><h2>Competitor pages change quietly.</h2></div>
          <div className={styles.splitCopy}><p>Pricing moves. Feature pages grow. Positioning changes a sentence at a time.</p><p>The hard part is not finding a competitor&apos;s website. It is remembering what was there yesterday.</p></div>
        </div>
        <div className={styles.changeExamples}>
          {examples.map((example) => (
            <article className={styles.changeExample} key={example.label}>
              <p>{example.label}</p><div><span>{example.before}</span><small>becomes</small><strong>{example.after}</strong></div>
            </article>
          ))}
        </div>
        <p className={styles.sectionCaption}>Examples of the kinds of page changes a monitoring workflow can surface.</p>
      </div>
    </section>
  );
}
