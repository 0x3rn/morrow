import Link from "next/link";

import styles from "@/app/page.module.css";

export function FinalCta() {
  return <section className={styles.finalCta}><div className={`${styles.container} ${styles.finalCtaInner}`}><p className={styles.sectionLabel}>Start with one page</p><h2>Add the competitor page you check most often.</h2><p>Morrow will keep the record from there.</p><div><Link className={styles.primaryCta} href="/register">Create a workspace</Link><Link className={styles.finalLogin} href="/login">Log in</Link></div></div></section>;
}
