import styles from "@/app/page.module.css";

const capabilities = [
  { title: "Monitor specific sections", text: "Focus monitoring on the part of a page that matters instead of treating every element as equally important.", size: "wide" },
  { title: "Ignore noisy regions", text: "Exclude changing counters, rotating content and other regions that would otherwise create noise.", size: "small" },
  { title: "Keep source snapshots", text: "Morrow preserves the captured page so a recorded change can be checked against its source.", size: "small" },
  { title: "See what actually changed", text: "Review the previous text beside the new text instead of relying only on a generated summary.", size: "wide" },
  { title: "Category and significance", text: "Changes are grouped by what they affect and how important the difference appears to be.", size: "small" },
  { title: "Change history", text: "Return to previously recorded changes without rebuilding the context from screenshots and notes.", size: "small" },
] as const;

export function CapabilityGrid() {
  return (
    <section className={styles.capabilitySection} id="capabilities">
      <div className={styles.container}><div className={styles.centerHeading}><p className={styles.sectionLabel}>What Morrow keeps</p><h2>More than a notification that something changed.</h2><p>Every useful signal needs context. Morrow keeps the information needed to understand and verify the change.</p></div><div className={styles.capabilityGrid}>{capabilities.map((capability) => <article className={`${styles.capabilityCard} ${styles[capability.size]}`} key={capability.title}><h3>{capability.title}</h3><p>{capability.text}</p></article>)}</div></div>
    </section>
  );
}
