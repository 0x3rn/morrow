import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./auth-shell.module.css";

type AuthShellProps = {
  children: ReactNode;
  mode: "login" | "register";
};

function SignalMark() {
  return (
    <span className={styles.signalMark} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}

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
      <section className={styles.story} aria-label="Morrow product overview">
        <div className={styles.grid} aria-hidden="true" />
        <Link className={styles.brand} href="/" aria-label="Morrow home">
          <SignalMark />
          <span>Morrow</span>
        </Link>

        <div className={styles.storyCopy}>
          <p className={styles.eyebrow}>
            <span />
            {isLogin ? "Your market, on watch" : "Build your watchlist"}
          </p>
          <h1>
            {isLogin ? (
              <>
                Return to
                <br />
                <em>the signal.</em>
              </>
            ) : (
              <>
                See the move
                <br />
                <em>before the meeting.</em>
              </>
            )}
          </h1>
          <p className={styles.storyDescription}>
            {isLogin
              ? "Continue where your watchlist left off and catch up on the changes that deserve your attention."
              : "Turn the competitor pages that matter into a focused, searchable stream of market intelligence."}
          </p>
        </div>

        <div className={styles.signalPanel} aria-hidden="true">
          <div className={styles.panelHeading}>
            <span>MORROW / SIGNAL PREVIEW</span>
            <span className={styles.liveState}>
              <i />
              Monitoring
            </span>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.radar}>
              <span />
              <span />
              <span />
              <i />
            </div>
            <div className={styles.panelSignal}>
              <span>POSITIONING</span>
              <strong>Homepage message shifted</strong>
              <p>Primary audience moved from teams to operators</p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.formSide}>
        <div className={styles.formTopline}>
          <Link className={styles.backLink} href="/">
            <BackIcon />
            Back to Morrow
          </Link>
          <p>
            {isLogin ? "New to Morrow?" : "Already have an account?"}
            <Link href={isLogin ? "/register" : "/login"}>
              {isLogin ? "Register" : "Log in"}
            </Link>
          </p>
        </div>

        <div className={styles.formWrap}>
          <header className={styles.formHeader}>
            <p className={styles.formKicker}>
              {isLogin ? "WELCOME BACK" : "START MONITORING"}
            </p>
            <h2>{isLogin ? "Log in to Morrow." : "Create your account."}</h2>
            <p>
              {isLogin
                ? "Enter your details to open your intelligence workspace."
                : "Set up your workspace and add your first competitor."}
            </p>
          </header>

          {children}

          <p className={styles.mobileSwitch}>
            {isLogin ? "New to Morrow?" : "Already have an account?"}
            <Link href={isLogin ? "/register" : "/login"}>
              {isLogin ? "Register" : "Log in"}
            </Link>
          </p>
        </div>

        <div className={styles.formFooter}>
          <span>Focused monitoring</span>
          <span>Meaningful changes</span>
          <span>Searchable history</span>
        </div>
      </section>
    </main>
  );
}

export function SubmitArrow() {
  return <ArrowIcon />;
}
