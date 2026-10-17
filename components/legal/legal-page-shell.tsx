import Link from "next/link";
import { BrandLogo } from "@/components/marketing/brand-logo";
import styles from "./legal.module.css";

export interface TocItem {
  id: string;
  label: string;
}

interface LegalPageShellProps {
  title: string;
  subtitle: string;
  lastUpdated: string;
  activeSlug: "terms" | "privacy" | "refund";
  toc: TocItem[];
  children: React.ReactNode;
}

const LEGAL_TABS = [
  { href: "/terms", slug: "terms", label: "Terms of Service" },
  { href: "/privacy", slug: "privacy", label: "Privacy Policy" },
  { href: "/refund", slug: "refund", label: "Refund Policy" },
] as const;

const PRODUCT_NAV = [
  { href: "/#product", label: "Product" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#capabilities", label: "Capabilities" },
  { href: "/#use-cases", label: "Use cases" },
  { href: "/#faq", label: "FAQ" },
];

export function LegalPageShell({
  title,
  subtitle,
  lastUpdated,
  activeSlug,
  toc,
  children,
}: LegalPageShellProps) {
  return (
    <div className={styles.legalWrapper}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label="Morrow home">
            <BrandLogo />
            <span>Morrow</span>
          </Link>
          <nav className={styles.desktopNav} aria-label="Primary navigation">
            {PRODUCT_NAV.map((item) => (
              <a href={item.href} key={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className={styles.desktopActions}>
            <Link className={styles.loginLink} href="/login">
              Log in
            </Link>
            <Link className={styles.navCta} href="/register">
              Start monitoring
            </Link>
          </div>
        </div>
      </header>

      <header className={styles.banner}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Compliance &amp; Contracts · morrow.corstack.dev</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{subtitle}</p>

          <div className={styles.metaRow}>
            <div className={styles.metaItem}>
              Platform: <strong>morrow.corstack.dev</strong>
            </div>
            <div className={styles.metaItem}>
              Operator: <strong>Corstack</strong>
            </div>
            <div className={styles.metaItem}>
              Effective Date: <strong>{lastUpdated}</strong>
            </div>
            <div className={styles.metaItem}>
              Contact: <strong>morrow@corstack.dev</strong>
            </div>
          </div>

          <nav className={styles.tabsNav} aria-label="Legal document switcher">
            {LEGAL_TABS.map((tab) => {
              const isActive = tab.slug === activeSlug;
              return (
                <Link
                  key={tab.slug}
                  href={tab.href}
                  className={`${styles.tab} ${isActive ? styles.activeTab : ""}`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className={styles.container}>
        <div className={styles.contentGrid}>
          <aside className={styles.sidebar} aria-label="Table of contents">
            <div className={styles.sidebarTitle}>Contents</div>
            <ul className={styles.tocList}>
              {toc.map((item) => (
                <li key={item.id} className={styles.tocItem}>
                  <a href={`#${item.id}`}>{item.label}</a>
                </li>
              ))}
            </ul>
          </aside>

          <article className={styles.mainContent}>
            {children}

            <div className={styles.contactBox}>
              <h3>Support &amp; Legal Notices</h3>
              <p>
                For technical support, contract questions, data protection requests, or billing
                inquiries regarding Morrow, contact us directly at our unified support address:
              </p>
              <div className={styles.contactDetails}>
                <div>
                  <span>General Support &amp; Billing</span>
                  <a href="mailto:morrow@corstack.dev">morrow@corstack.dev</a>
                </div>
                <div>
                  <span>Platform Domain</span>
                  <a href="https://morrow.corstack.dev">morrow.corstack.dev</a>
                </div>
                <div>
                  <span>Operator</span>
                  <span>Corstack (corstack.dev)</span>
                </div>
              </div>
            </div>
          </article>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerMain}`}>
          <div className={styles.footerIdentity}>
            <Link className={styles.footerBrand} href="/" aria-label="Morrow home">
              <BrandLogo />
              <span>Morrow</span>
            </Link>
            <p>Monitor competitor pages and keep a record of what changed.</p>
          </div>
          <nav className={styles.footerNav} aria-label="Footer navigation">
            <div>
              <p>Product</p>
              <a href="/#how-it-works">How it works</a>
              <a href="/#monitoring-scope">Monitoring scope</a>
              <a href="/#capabilities">Capabilities</a>
              <a href="/#use-cases">Use cases</a>
            </div>
            <div>
              <p>Legal</p>
              <Link href="/terms">Terms of Service</Link>
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/refund">Refund Policy</Link>
            </div>
            <div>
              <p>Account</p>
              <Link href="/login">Log in</Link>
              <Link href="/register">Register</Link>
            </div>
          </nav>
        </div>
        <div className={`${styles.container} ${styles.footerBottom}`}>
          <p>© 2026 Morrow (morrow.corstack.dev). All rights reserved.</p>
          <p>Operated by Corstack · Contact: morrow@corstack.dev</p>
        </div>
      </footer>
    </div>
  );
}
