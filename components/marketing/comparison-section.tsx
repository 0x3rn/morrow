import styles from "@/app/page.module.css";

const withoutMorrow = ["Open competitor sites manually.", "Try to remember what looked different.", "Compare screenshots in folders.", "Send a message with no source attached.", "Lose the context a few weeks later."];
const withMorrow = ["Keep a defined list of monitored pages.", "Check pages on a schedule.", "Ignore selected page regions.", "Review previous and current evidence.", "Keep the source attached to the change."];

function ComparisonList({ label, items }: { label: string; items: string[] }) {
  return <div className={styles.comparisonList}><p>{label}</p><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

export function ComparisonSection() {
  return (
    <section className={styles.comparisonSection}><div className={styles.container}><div className={styles.comparisonHeading}><h2>Stop rebuilding the history by hand.</h2></div><div className={styles.comparisonGrid}><ComparisonList label="Without Morrow" items={withoutMorrow} /><ComparisonList label="With Morrow" items={withMorrow} /></div></div></section>
  );
}
