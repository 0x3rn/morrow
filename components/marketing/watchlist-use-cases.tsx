import styles from "@/app/page.module.css";

const useCases = [
  { title: "Pricing & packaging", items: ["plan prices", "billing periods", "usage limits", "plan names", "enterprise terms"] },
  { title: "Product & features", items: ["feature pages", "solution pages", "enterprise capabilities", "new product positioning"] },
  { title: "Homepage & positioning", items: ["main headline", "target audience", "value proposition", "proof points", "CTA language"] },
  { title: "Policies & terms", items: ["contract language", "cancellation wording", "service terms", "public policy updates"] },
];

export function WatchlistUseCases() {
  return (
    <section className={styles.useCases} id="use-cases"><div className={styles.container}><div className={styles.useCaseHeading}><p className={styles.sectionLabel}>Common watchlists</p><h2>Keep an eye on the pages that tell you where a competitor is going.</h2></div><div className={styles.useCaseGrid}>{useCases.map((useCase) => <article key={useCase.title}><h3>{useCase.title}</h3><p>Watch</p><ul>{useCase.items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div></div></section>
  );
}
