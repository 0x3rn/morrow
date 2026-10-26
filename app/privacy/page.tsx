import type { Metadata } from "next";
import Link from "next/link";
import { LegalPageShell, type TocItem } from "@/components/legal/legal-page-shell";
import styles from "@/components/legal/legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy — Morrow",
  description:
    "Data protection policy and comprehensive retention schedule for Morrow (morrow.corstack.dev), detailing personal data handling, processing roles, and sub-processors.",
};

const TOC: TocItem[] = [
  { id: "roles-scope", label: "1. Scope & Data Processing Roles" },
  { id: "data-categories", label: "2. Categories of Processed Data" },
  { id: "purposes-legal-bases", label: "3. Purposes & Legal Bases for Processing" },
  { id: "subprocessors", label: "4. Infrastructure & Sub-processors" },
  { id: "retention-schedule", label: "5. Comprehensive Data Retention Schedule" },
  { id: "data-subject-rights", label: "6. Data Subject Rights & Procedures" },
  { id: "cookies-storage", label: "7. Cookies & Session Storage" },
  { id: "security-measures", label: "8. Technical & Security Architecture" },
  { id: "international-transfers", label: "9. International Data Transfers" },
  { id: "policy-updates", label: "10. Policy Amendments" },
  { id: "contact-dpo", label: "11. Data Protection Contact" },
];

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      subtitle="This Privacy Policy describes the processing, storage, and retention lifecycle of personal data within the Morrow platform operated at morrow.corstack.dev."
      lastUpdated="October 16, 2026"
      activeSlug="privacy"
      toc={TOC}
    >
      <section id="roles-scope" className={styles.section}>
        <h2>1. Scope &amp; Data Processing Roles</h2>
        <p className={styles.bodyText}>
          This Privacy Policy governs the processing of personal data by Corstack
          (&ldquo;Operator,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) in
          connection with the operation of Morrow at <code>morrow.corstack.dev</code> (the
          &ldquo;Platform&rdquo;).
        </p>
        <p className={styles.bodyText}>
          Under applicable data protection legislation, including the General Data Protection
          Regulation (Regulation (EU) 2016/679, &ldquo;GDPR&rdquo;) and equivalent national laws:
        </p>
        <ul className={styles.bulletList}>
          <li>
            <strong>Data Controller:</strong> Corstack acts as a Data Controller regarding account
            registration credentials, account holder identity records, direct support
            communications, and commercial transaction records.
          </li>
          <li>
            <strong>Data Processor:</strong> Corstack acts as a Data Processor on behalf of the
            Customer with respect to Workspace configurations, designated Target URLs, custom CSS
            selectors, and the automated retrieval and storage of public web page Snapshots executed
            pursuant to Customer instructions.
          </li>
        </ul>
      </section>

      <section id="data-categories" className={styles.section}>
        <h2>2. Categories of Processed Data</h2>
        <p className={styles.bodyText}>
          We process personal and operational data across the following defined categories:
        </p>
        <ul className={styles.bulletList}>
          <li>
            <strong>Account &amp; Identity Data:</strong> User full name, email address, password
            hashes, account status, and Workspace membership role designations.
          </li>
          <li>
            <strong>Billing &amp; Transaction Metadata:</strong> Subscription plan identifier,
            billing frequency (monthly or annual), subscription status, Lemon Squeezy customer and
            subscription reference keys, and invoice history. Morrow does not store full credit card
            numbers, expiration dates, or security codes (CVVs).
          </li>
          <li>
            <strong>Workspace Monitoring Configurations:</strong> Names assigned to competitor
            entities, submitted Target URLs, CSS section selectors, frequency intervals, and
            external integration endpoints (including Slack webhook URLs, Discord webhook URLs, or
            designated alert email addresses).
          </li>
          <li>
            <strong>Automated Snapshot Assets:</strong> Rendered PNG visual screenshots, extracted
            DOM trees, text nodes, and calculated visual and structural diff artifacts captured from
            publicly available Target URLs.
          </li>
          <li>
            <strong>Telemetry &amp; Access Logs:</strong> Client IP addresses, HTTP request headers,
            user agent strings, timestamped API interaction logs, and security telemetry captured by
            our edge routing infrastructure.
          </li>
        </ul>
      </section>

      <section id="purposes-legal-bases" className={styles.section}>
        <h2>3. Purposes &amp; Legal Bases for Processing</h2>
        <p className={styles.bodyText}>
          We process personal data strictly in accordance with lawful processing bases under Article
          6 of the GDPR:
        </p>
        <ul className={styles.bulletList}>
          <li>
            <strong>Performance of Contract (Art. 6(1)(b)):</strong> Executing scheduled automated
            crawls, rendering Snapshots, calculating DOM differences, generating Change Records, and
            transmitting alert notifications in fulfillment of our{" "}
            <Link href="/terms" className="underline font-medium text-foreground">
              Terms of Service
            </Link>
            .
          </li>
          <li>
            <strong>Legitimate Interests (Art. 6(1)(f)):</strong> Enforcing infrastructure rate
            limits, preventing malicious crawling and denial-of-service attempts, diagnosing system
            faults, and ensuring cross-tenant Workspace data isolation.
          </li>
          <li>
            <strong>Legal Obligation (Art. 6(1)(c)):</strong> Maintaining statutory accounting, tax,
            and commercial records required by applicable regulatory authorities.
          </li>
        </ul>
      </section>

      <section id="subprocessors" className={styles.section}>
        <h2>4. Infrastructure &amp; Sub-processors</h2>
        <p className={styles.bodyText}>
          Corstack does not sell, lease, or monetize personal data under any circumstances. We share
          data only with vetted infrastructure sub-processors under enforceable Data Processing
          Agreements:
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Sub-processor</th>
                <th>Service Scope</th>
                <th>Data Categories Processed</th>
                <th>Processing Region</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Cloudflare, Inc.</strong></td>
                <td>Edge worker computing, Cloudflare D1 database, Cloudflare R2 object storage, WAF</td>
                <td>Encrypted database records, visual screenshot files, edge routing logs</td>
                <td>Global Edge / EU &amp; North America</td>
              </tr>
              <tr>
                <td><strong>Lemon Squeezy, LLC</strong></td>
                <td>Merchant of Record, payment gateway, subscription management, tax compliance</td>
                <td>Customer email, billing address, payment instrument tokenization</td>
                <td>United States / International</td>
              </tr>
              <tr>
                <td><strong>Transactional Email Provider</strong></td>
                <td>Delivery of authentication emails, change alerts, and scheduled digests</td>
                <td>Recipient email address, notification summary data</td>
                <td>EU / International</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="retention-schedule" className={styles.section}>
        <h2>5. Comprehensive Data Retention Schedule</h2>
        <p className={styles.bodyText}>
          We adhere to strict data minimization principles. Data is retained only for the duration
          necessary to fulfill contractual monitoring services or statutory obligations:
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data Category</th>
                <th>Storage Medium</th>
                <th>Retention Window</th>
                <th>Purging / Deletion Mechanism</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Account Profile &amp; Credentials</strong></td>
                <td>Cloudflare D1 (Encrypted)</td>
                <td>Active account duration + 30 days</td>
                <td>Hard deletion upon user account closure</td>
              </tr>
              <tr>
                <td><strong>Free Tier Snapshots &amp; Images</strong></td>
                <td>Cloudflare R2 Object Storage</td>
                <td>7 calendar days</td>
                <td>Automated daily cron pruning job</td>
              </tr>
              <tr>
                <td><strong>Personal Tier Snapshots &amp; Images</strong></td>
                <td>Cloudflare R2 Object Storage</td>
                <td>14 calendar days</td>
                <td>Automated daily cron pruning job</td>
              </tr>
              <tr>
                <td><strong>Starter Tier Snapshots &amp; Images</strong></td>
                <td>Cloudflare R2 Object Storage</td>
                <td>30 calendar days</td>
                <td>Automated daily cron pruning job</td>
              </tr>
              <tr>
                <td><strong>Growth Tier Snapshots &amp; Images</strong></td>
                <td>Cloudflare R2 Object Storage</td>
                <td>90 calendar days</td>
                <td>Automated daily cron pruning job</td>
              </tr>
              <tr>
                <td><strong>Scale Tier Snapshots &amp; Images</strong></td>
                <td>Cloudflare R2 Object Storage</td>
                <td>Contractual (up to 365 days)</td>
                <td>Automated lifecycle expiration rule</td>
              </tr>
              <tr>
                <td><strong>Structured Change Records &amp; Diffs</strong></td>
                <td>Cloudflare D1 Database</td>
                <td>Active Workspace lifetime</td>
                <td>Cascading deletion on Workspace removal</td>
              </tr>
              <tr>
                <td><strong>Webhook Delivery &amp; Alert Logs</strong></td>
                <td>Edge volatile cache</td>
                <td>14 calendar days</td>
                <td>Rolling FIFO expiration</td>
              </tr>
              <tr>
                <td><strong>Security &amp; Edge HTTP Access Logs</strong></td>
                <td>Cloudflare WAF / Workers</td>
                <td>Up to 90 calendar days</td>
                <td>Automated log rotation and purge</td>
              </tr>
              <tr>
                <td><strong>Commercial Invoices &amp; Transactions</strong></td>
                <td>Lemon Squeezy &amp; D1 Billing table</td>
                <td>7 statutory financial years</td>
                <td>Retained for tax and audit compliance</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={styles.bodyText}>
          When a Snapshot exceeds its designated retention cutoff date, the associated raw image
          files and HTML payloads in Cloudflare R2 are permanently purged and unrecoverable.
          High-level metadata records (such as date, target domain, and classification tag) remain
          in Workspace history until the Workspace is deleted.
        </p>
      </section>

      <section id="data-subject-rights" className={styles.section}>
        <h2>6. Data Subject Rights &amp; Procedures</h2>
        <p className={styles.bodyText}>
          In accordance with Chapter III of the GDPR and equivalent international privacy standards,
          individuals maintain specific statutory rights regarding their personal data:
        </p>
        <ul className={styles.bulletList}>
          <li>
            <strong>Right to Access (Art. 15 GDPR):</strong> You have the right to obtain
            confirmation of whether your personal data is processed, alongside an export of such
            data.
          </li>
          <li>
            <strong>Right to Rectification (Art. 16 GDPR):</strong> You may correct inaccurate or
            incomplete profile data through your account settings or by submitting a written
            request.
          </li>
          <li>
            <strong>Right to Erasure (Art. 17 GDPR):</strong> You may request the permanent deletion
            of your account, associated Workspaces, and monitoring configurations.
          </li>
          <li>
            <strong>Right to Restriction of Processing (Art. 18 GDPR):</strong> You may request the
            suspension of data processing under specific statutory conditions.
          </li>
          <li>
            <strong>Right to Data Portability (Art. 20 GDPR):</strong> You may receive your personal
            and monitoring configuration data in a structured, commonly used, and machine-readable
            format.
          </li>
          <li>
            <strong>Right to Object (Art. 21 GDPR):</strong> You hold the right to object to
            processing operations founded upon legitimate interests.
          </li>
        </ul>
        <p className={styles.bodyText}>
          To exercise any statutory right, transmit a formal request to{" "}
          <a href="mailto:morrow@corstack.dev" className="underline font-medium text-foreground">
            morrow@corstack.dev
          </a>
          . We acknowledge and respond to verified requests within thirty (30) calendar days without
          charge.
        </p>
      </section>

      <section id="cookies-storage" className={styles.section}>
        <h2>7. Cookies &amp; Session Storage</h2>
        <p className={styles.bodyText}>
          Morrow deploys strictly essential cookies and session storage mechanisms required to
          render and secure authenticated sessions:
        </p>
        <ul className={styles.bulletList}>
          <li>
            <strong>Authentication Session Cookies:</strong> First-party, HttpOnly, SameSite
            encrypted tokens managed via Better Auth to maintain your login state.
          </li>
          <li>
            <strong>CSRF Protection Tokens:</strong> Cryptographic tokens to prevent cross-site
            request forgery across authenticated dashboard routes.
          </li>
        </ul>
        <p className={styles.bodyText}>
          We do not deploy third-party advertising cookies, social media tracking pixels, or
          behavioral analytics scripts.
        </p>
      </section>

      <section id="security-measures" className={styles.section}>
        <h2>8. Technical &amp; Security Architecture</h2>
        <p className={styles.bodyText}>
          We implement industry-standard technical and organizational security measures to protect
          Customer data:
        </p>
        <ul className={styles.bulletList}>
          <li>
            <strong>Encryption in Transit:</strong> All web, API, and worker communications are
            enforced over TLS 1.3 encryption.
          </li>
          <li>
            <strong>Encryption at Rest:</strong> Database tables, configuration secrets, and visual
            assets stored in Cloudflare R2 are encrypted at rest utilizing AES-256 standards.
          </li>
          <li>
            <strong>Tenant Isolation:</strong> Customer Workspace data is isolated via relational
            keys; cross-tenant queries are blocked at the application and query layers.
          </li>
          <li>
            <strong>Access Restrictions:</strong> Infrastructure access is restricted to authorized
            personnel governed by strict role-based access controls and multi-factor
            authentication.
          </li>
        </ul>
      </section>

      <section id="international-transfers" className={styles.section}>
        <h2>9. International Data Transfers</h2>
        <p className={styles.bodyText}>
          Morrow infrastructure utilizes Cloudflare&rsquo;s global distributed edge network. Where
          personal data is processed outside the European Economic Area or your local jurisdiction,
          such transfers are governed by appropriate safeguards, including European Commission
          Standard Contractual Clauses (SCCs) executed with our infrastructure partners.
        </p>
      </section>

      <section id="policy-updates" className={styles.section}>
        <h2>10. Policy Amendments</h2>
        <p className={styles.bodyText}>
          Corstack reserves the right to amend this Privacy Policy to reflect technical updates,
          sub-processor modifications, or regulatory requirements. Any amendments will be published
          on this page with a revised &ldquo;Effective Date&rdquo;.
        </p>
      </section>

      <section id="contact-dpo" className={styles.section}>
        <h2>11. Data Protection Contact</h2>
        <p className={styles.bodyText}>
          For data protection requests, privacy questions, or regulatory communications, please
          contact:
        </p>
        <div className={styles.noticePanel}>
          <h4>Corstack — Data Protection &amp; Privacy</h4>
          <p>
            Email:{" "}
            <a href="mailto:morrow@corstack.dev" className="underline font-medium text-foreground">
              morrow@corstack.dev
            </a>
            <br />
            Platform: morrow.corstack.dev
            <br />
            Operator: corstack.dev
          </p>
        </div>
      </section>
    </LegalPageShell>
  );
}
