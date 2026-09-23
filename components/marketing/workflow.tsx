import styles from "@/app/page.module.css";

const stages = [
  { verb: "Choose", title: "Choose what to monitor", text: "Add a competitor page, monitor the whole page or narrow the watch to specific sections. Mark regions that should be ignored.", detail: "Whole page  /  Selected sections", icon: "crosshair" },
  { verb: "Watch", title: "Morrow runs the checks", text: "Scheduled captures preserve the rendered page and compare it with the previous snapshot.", detail: "Last checked  09:42", icon: "scan" },
  { verb: "Review", title: "Review the change", text: "Open the summary, significance, changed text and source evidence from one change record.", detail: "Pricing · Major", icon: "compare" },
] as const;

function WorkflowIcon({ type }: { type: (typeof stages)[number]["icon"] }) {
  if (type === "crosshair") return <svg aria-hidden="true" viewBox="0 0 32 32"><circle cx="16" cy="16" r="7" /><path d="M16 3v6M16 23v6M3 16h6M23 16h6" /></svg>;
  if (type === "scan") return <svg aria-hidden="true" viewBox="0 0 32 32"><path d="M7 8.5V6h5M20 6h5v5M25 23.5V26h-5M12 26H7v-5" /><path d="M10 16h12" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 32 32"><path d="M6 8h9M6 16h20M17 24h9" /><circle cx="20" cy="8" r="3" /><circle cx="12" cy="24" r="3" /></svg>;
}

export function Workflow() {
  return (
    <section className={styles.workflow} id="how-it-works">
      <div className={styles.container}>
        <div className={styles.darkHeading}><h2>Set the pages once.<br />Morrow keeps checking.</h2><p>Choose what deserves attention and leave the repeated checking to Morrow.</p></div>
        <div className={styles.workflowStages}>
          {stages.map((stage) => (
            <article className={styles.workflowStage} key={stage.verb}>
              <div className={styles.stageTop}><WorkflowIcon type={stage.icon} /><p>{stage.verb}</p></div>
              <h3>{stage.title}</h3><p>{stage.text}</p><span>{stage.detail}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
