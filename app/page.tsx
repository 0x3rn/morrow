import Link from "next/link";
import styles from "./page.module.css";

const signals = [
  {
    type: "PRICING",
    time: "12 min ago",
    title: "Annual plan repositioned",
    detail: "Offer language and plan emphasis changed",
    tone: "coral",
  },
  {
    type: "PRODUCT",
    time: "46 min ago",
    title: "New enterprise controls",
    detail: "Three capabilities added to the feature page",
    tone: "violet",
  },
  {
    type: "POSITIONING",
    time: "2 hr ago",
    title: "Homepage message shifted",
    detail: "Primary audience moved from teams to operators",
    tone: "lime",
  },
] as const;

const capabilities = [
  {
    number: "01",
    title: "Watch the pages that matter",
    description:
      "Add a competitor, choose the exact pages worth tracking, and set a monitoring cadence for each one.",
    tag: "FOCUSED MONITORING",
  },
  {
    number: "02",
    title: "Filter signal from noise",
    description:
      "Morrow compares fresh snapshots with what came before and keeps the meaningful changes visible.",
    tag: "CHANGE DETECTION",
  },
  {
    number: "03",
    title: "Understand the move",
    description:
      "Read a clear summary, the category and significance, plus the evidence behind every recorded change.",
    tag: "AI INTERPRETATION",
  },
] as const;

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}

function SignalMark() {
  return (
    <span className={styles.signalMark} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Morrow home">
          <SignalMark />
          <span>Morrow</span>
        </Link>

        <nav className={styles.nav} aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#capabilities">Capabilities</a>
        </nav>

        <div className={styles.headerActions}>
          <Link className={styles.signIn} href="/sign-in">
            Sign in
          </Link>
          <Link className={styles.navCta} href="/sign-up">
            Start monitoring
            <ArrowIcon />
          </Link>
        </div>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroTexture} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.liveDot} />
              Competitive intelligence, on watch
            </p>
            <h1>
              Know what changed.
              <br />
              <em>Understand why it matters.</em>
            </h1>
            <p className={styles.heroDescription}>
              Morrow monitors the competitor pages you care about, detects
              meaningful shifts, and turns them into intelligence your team can
              act on.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryCta} href="/sign-up">
                Start monitoring
                <ArrowIcon />
              </Link>
              <a className={styles.textLink} href="#how-it-works">
                See how it works
                <span aria-hidden="true">↓</span>
              </a>
            </div>
            <ul className={styles.proofList} aria-label="Product capabilities">
              <li>Scheduled captures</li>
              <li>Meaningful diffs</li>
              <li>Searchable history</li>
            </ul>
          </div>

          <div className={styles.observatory} aria-label="Example change feed">
            <div className={styles.observatoryGlow} aria-hidden="true" />
            <div className={styles.panelTop}>
              <div>
                <span className={styles.panelKicker}>MORROW / LIVE SIGNAL</span>
                <h2>Change intelligence</h2>
              </div>
              <div className={styles.scanning}>
                <span />
                Monitoring
              </div>
            </div>

            <div className={styles.orbit} aria-hidden="true">
              <span className={styles.orbitCore} />
              <span className={styles.orbitRingOne} />
              <span className={styles.orbitRingTwo} />
              <span className={styles.orbitSweep} />
              <span className={styles.orbitPointOne} />
              <span className={styles.orbitPointTwo} />
              <span className={styles.orbitPointThree} />
            </div>

            <div className={styles.signalList}>
              {signals.map((signal) => (
                <article className={styles.signalItem} key={signal.type}>
                  <div className={styles.signalMeta}>
                    <span
                      className={`${styles.signalType} ${styles[signal.tone]}`}
                    >
                      {signal.type}
                    </span>
                    <time>{signal.time}</time>
                  </div>
                  <h3>{signal.title}</h3>
                  <p>{signal.detail}</p>
                  <span className={styles.signalArrow} aria-hidden="true">
                    ↗
                  </span>
                </article>
              ))}
            </div>

            <div className={styles.panelFoot}>
              <span>3 signals surfaced</span>
              <span>Noise filtered automatically</span>
            </div>
          </div>
        </section>

        <section className={styles.statement} aria-label="Morrow promise">
          <p className={styles.sectionLabel}>THE MORROW SIGNAL</p>
          <p className={styles.statementText}>
            Your competitors are already telling you what comes next.
            <span> Morrow makes sure you hear it.</span>
          </p>
        </section>

        <section className={styles.process} id="how-it-works">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionLabel}>HOW IT WORKS</p>
              <h2>From web page to useful signal.</h2>
            </div>
            <p>
              A continuous evidence trail that shows what moved, when it moved,
              and why it deserves your attention.
            </p>
          </div>

          <ol className={styles.processRail}>
            <li>
              <span className={styles.stepNumber}>01</span>
              <div className={styles.stepIcon} aria-hidden="true">
                <span className={styles.crosshair} />
              </div>
              <h3>Choose your watchlist</h3>
              <p>
                Add competitor domains and select the pricing, product, or
                positioning pages that matter.
              </p>
            </li>
            <li>
              <span className={styles.stepNumber}>02</span>
              <div className={styles.stepIcon} aria-hidden="true">
                <span className={styles.compareIcon}>
                  <i />
                  <i />
                </span>
              </div>
              <h3>Morrow keeps watch</h3>
              <p>
                Scheduled checks capture new evidence and compare it with the
                last known version.
              </p>
            </li>
            <li>
              <span className={styles.stepNumber}>03</span>
              <div className={styles.stepIcon} aria-hidden="true">
                <span className={styles.sparkIcon}>✦</span>
              </div>
              <h3>Read what matters</h3>
              <p>
                Review the summary, significance, changed text, and source
                snapshots in one place.
              </p>
            </li>
          </ol>
        </section>

        <section className={styles.capabilities} id="capabilities">
          <div className={styles.capabilityIntro}>
            <p className={styles.sectionLabel}>BUILT FOR CLARITY</p>
            <h2>Less page-watching. More decision-making.</h2>
            <p>
              Replace scattered screenshots and manual spot-checks with a clear,
              durable record of competitor movement.
            </p>
          </div>

          <div className={styles.capabilityList}>
            {capabilities.map((capability) => (
              <article key={capability.number}>
                <span className={styles.capabilityNumber}>
                  {capability.number}
                </span>
                <div>
                  <p className={styles.capabilityTag}>{capability.tag}</p>
                  <h3>{capability.title}</h3>
                  <p>{capability.description}</p>
                </div>
                <span className={styles.capabilityArrow} aria-hidden="true">
                  ↗
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.finalCta}>
          <div className={styles.finalOrb} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className={styles.sectionLabel}>START WITH ONE COMPETITOR</p>
          <h2>See the market move before the meeting starts.</h2>
          <p>
            Build your watchlist and turn competitor pages into an intelligence
            feed.
          </p>
          <Link className={styles.primaryCta} href="/sign-up">
            Create your Morrow workspace
            <ArrowIcon />
          </Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link className={styles.brand} href="/" aria-label="Morrow home">
          <SignalMark />
          <span>Morrow</span>
        </Link>
        <p>Competitive intelligence for the next move.</p>
        <div>
          <Link href="/sign-in">Sign in</Link>
          <Link href="/sign-up">Create account</Link>
        </div>
      </footer>
    </div>
  );
}
