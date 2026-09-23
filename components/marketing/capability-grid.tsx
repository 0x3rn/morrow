import styles from "@/app/page.module.css";

const capabilities = [
  { title: "Monitor specific sections", text: "Monitor only the sections you want Morrow to compare.", size: "featured", detail: "Sections to monitor · .pricing-table" },
  { title: "Ignore selected regions", text: "Exclude counters, rotating content and other regions you do not want included in comparisons.", size: "side", detail: "Regions to ignore · .live-counter" },
  { title: "Keep source captures", text: "Morrow keeps the captured page so a recorded change can be checked against its source.", size: "compact", detail: "Source capture saved" },
  { title: "See what actually changed", text: "Review the previous text beside the new text instead of relying only on a generated summary.", size: "evidence", detail: "Previous: $49 / month    Current: $79 / month" },
  { title: "Category and significance", text: "Changes are grouped by what they affect and how important the difference appears to be.", size: "medium", detail: "Pricing · Major" },
  { title: "Change history", text: "Return to previously recorded changes without rebuilding the context from screenshots and notes.", size: "last", detail: "Earlier changes remain in the record" },
] as const;

export function CapabilityGrid() {
  return (
    <section className={styles.capabilitySection} id="capabilities">
      <div className={styles.container}><div className={styles.centerHeading}><h2>Keep the change and its evidence together.</h2><p>Morrow keeps the details needed to review what changed and verify it against the captured page.</p></div><div className={styles.capabilityGrid}>{capabilities.map((capability) => <article className={`${styles.capabilityCard} ${styles[capability.size]}`} key={capability.title}><h3>{capability.title}</h3><p>{capability.text}</p><div className={styles.capabilityDetail}>{capability.detail}</div></article>)}</div></div>
    </section>
  );
}
