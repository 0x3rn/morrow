import Link from "next/link";

import styles from "@/app/page.module.css";
import { BrandLogo } from "./brand-logo";

const productLinks = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#monitoring-scope", label: "Monitoring scope" },
  { href: "#capabilities", label: "Capabilities" },
  { href: "#use-cases", label: "Use cases" },
];

export function Footer() {
  return <footer className={styles.footer}><div className={`${styles.container} ${styles.footerMain}`}><div className={styles.footerIdentity}><Link className={styles.footerBrand} href="/" aria-label="Morrow home"><BrandLogo /><span>Morrow</span></Link><p>Competitor website monitoring for teams that want a reliable record of what changed.</p></div><nav className={styles.footerNav} aria-label="Footer navigation"><div><p>Product</p>{productLinks.map((item) => <a href={item.href} key={item.href}>{item.label}</a>)}</div><div><p>Account</p><Link href="/login">Log in</Link><Link href="/register">Register</Link></div></nav></div><div className={`${styles.container} ${styles.footerBottom}`}><p>© 2026 Morrow</p><p>morrow.corstack.dev</p></div></footer>;
}
