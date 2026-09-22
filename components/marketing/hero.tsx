import Link from "next/link";

import styles from "@/app/page.module.css";

const proofPoints = ["Rendered captures", "Selected-section monitoring", "Noise filtering", "Change history"];
const signals = [
  { category: "PRICING", time: "12 min ago", title: "Annual plan pricing changed", detail: "Starter plan moved from $49 to $79 per month.", tone: "coral" },
  { category: "PRODUCT", time: "46 min ago", title: "Enterprise permissions added", detail: "Three new controls appeared on the feature page.", tone: "purple" },
  { category: "POSITIONING", time: "2 hr ago", title: "Homepage audience changed", detail: "Messaging shifted from small teams to larger organizations.", tone: "lime" },
] as const;

export function Hero() {
  return (
    <section className={styles.hero} id="product">
      <div className={styles.container}>
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Competitor website monitoring</p>
            <h1>Know when a competitor page changes and what changed.</h1>
            <p className={styles.heroDescription}>Morrow checks the pages you choose on a schedule, filters out configured noise, and keeps the evidence behind every change worth reviewing.</p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryCta} href="/register">Start monitoring</Link>
              <a className={styles.secondaryCta} href="#change-record">See an example change</a>
            </div>
            <ul className={styles.proofRow} aria-label="Morrow capabilities">
              {proofPoints.map((point) => <li key={point}>{point}</li>)}
            </ul>
          </div>
          <div className={styles.changeFeed} aria-label="Illustrative change feed">
            <div className={styles.feedTopbar}>
              <span>MORROW</span>
              <span className={styles.feedLiveState}><i aria-hidden="true" /> Monitoring</span>
            </div>
            <div className={styles.feedHeading}><p>Live monitoring</p><h2>Changes worth reviewing</h2></div>
            <div className={styles.feedRows}>
              {signals.map((signal) => (
                <article className={styles.feedRow} key={signal.category}>
                  <div className={styles.feedMeta}><span className={`${styles.feedCategory} ${styles[signal.tone]}`}>{signal.category}</span><time>{signal.time}</time></div>
                  <h3>{signal.title}</h3><p>{signal.detail}</p>
                </article>
              ))}
            </div>
            <div className={styles.feedFooter}>3 changes recorded today</div>
          </div>
        </div>
      </div>
    </section>
  );
}
