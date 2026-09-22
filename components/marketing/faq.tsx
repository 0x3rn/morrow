import styles from "@/app/page.module.css";

const questions = [
  { question: "Do I have to monitor the whole page?", answer: "No. Whole-page monitoring is the default, but a monitored page can be narrowed to selected sections when only part of the page matters." },
  { question: "What happens when an ignored region changes?", answer: "The capture can still be preserved, but changes that exist only inside ignored regions should not become a meaningful change record." },
  { question: "Does Morrow keep evidence of the page it checked?", answer: "Yes. The monitoring pipeline preserves the captured page evidence so a recorded change can be traced back to what Morrow saw." },
  { question: "Can I change the monitoring scope later?", answer: "Yes. Monitoring scope can be updated without resetting the page's monitoring history." },
  { question: "What does Morrow show when a real change is detected?", answer: "A change record can include the category, significance, summary, previous text, current text and the underlying captured evidence." },
];

export function Faq() {
  return (
    <section className={styles.faqSection} id="faq"><div className={`${styles.container} ${styles.faqInner}`}><div className={styles.faqHeading}><p className={styles.sectionLabel}>Questions</p><h2>A few things worth knowing.</h2></div><div className={styles.faqList}>{questions.map((item) => <details key={item.question}><summary>{item.question}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</div></div></section>
  );
}
