import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./auth-shell.module.css";
import { BrandLogo } from "./marketing/brand-logo";

type AuthShellProps = {
  children: ReactNode;
  mode: "login" | "register";
};

function BackIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M16 10H5M9 5l-5 5 5 5" />
    </svg>
  );
}

export function AuthShell({ children, mode }: AuthShellProps) {
  const isLogin = mode === "login";

  return (
    <main className={styles.shell}>
      <section className={styles.brandPanel} aria-label="Morrow product overview">
        <Link className={styles.brand} href="/" aria-label="Morrow home">
          <BrandLogo className={styles.brandLogo} />
          <span>Morrow</span>
        </Link>

        <div className={styles.brandCopy}>
          <p className={styles.eyebrow}>COMPETITOR WEBSITE MONITORING</p>
          <h2>
            Monitor the competitor pages
            <br />
            <em>you care about.</em>
          </h2>
          <p>Morrow checks the pages you choose and keeps a record when they change.</p>
        </div>

        <div className={styles.changePanel} aria-label="Example change detected">
          <div className={styles.changeMeta}>
            <span>CHANGE DETECTED</span>
            <span>12 MIN AGO</span>
          </div>
          <p>Pricing</p>
          <strong>Starter plan</strong>
          <div className={styles.changeValue}>
            $49 <span aria-hidden="true">→</span> $79 / month
          </div>
        </div>
      </section>

      <section className={styles.authPanel}>
        <header className={styles.authHeader}>
          <Link className={styles.mobileBrand} href="/" aria-label="Morrow home">
            <BrandLogo className={styles.brandLogo} />
            <span>Morrow</span>
          </Link>
          <Link className={styles.backLink} href="/">
            <BackIcon />
            <span className={styles.desktopBack}>Back to Morrow</span>
            <span className={styles.mobileHome}>Home</span>
          </Link>
        </header>

        <div className={styles.authContent}>
          <header className={styles.formHeader}>
            <p className={styles.formKicker}>
              {isLogin ? "WELCOME BACK" : "CREATE ACCOUNT"}
            </p>
            <h1>
              {isLogin ? "Log in to " : "Create your "}
              <br className={styles.mobileTitleBreak} />
              {isLogin ? "Morrow." : "Morrow account."}
            </h1>
            <p>
              {isLogin
                ? "Open your workspace and continue monitoring."
                : "Set up your workspace and add your first competitor."}
            </p>
          </header>

          {children}

          <p className={styles.accountSwitch}>
            {isLogin ? "New to Morrow?" : "Already have an account?"}
            <Link href={isLogin ? "/register" : "/login"}>
              {isLogin ? "Create an account" : "Log in"}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
