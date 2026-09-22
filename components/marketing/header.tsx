import Link from "next/link";

import styles from "@/app/page.module.css";
import { BrandLogo } from "./brand-logo";
import { MobileMenu } from "./mobile-menu";

const navigation = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#faq", label: "FAQ" },
];

export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link className={styles.brand} href="/" aria-label="Morrow home">
          <BrandLogo />
          <span>Morrow</span>
        </Link>
        <nav className={styles.desktopNav} aria-label="Primary navigation">
          {navigation.map((item) => (
            <a href={item.href} key={item.href}>{item.label}</a>
          ))}
        </nav>
        <div className={styles.desktopActions}>
          <Link className={styles.loginLink} href="/login">Log in</Link>
          <Link className={styles.navCta} href="/register">Start monitoring</Link>
        </div>
        <MobileMenu navigation={navigation} />
      </div>
    </header>
  );
}
