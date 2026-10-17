import type { Metadata } from "next";
import Link from "next/link";
import { LegalPageShell, type TocItem } from "@/components/legal/legal-page-shell";
import styles from "@/components/legal/legal.module.css";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy — Morrow",
  description:
    "Refund and Cancellation Policy for Morrow at morrow.corstack.dev. Outlines criteria for unresolvable technical issues, self-serve cancellations, and renewal terms.",
};

const TOC: TocItem[] = [
  { id: "evaluation-sufficiency", label: "1. Free Tier Evaluation Sufficiency" },
  { id: "non-refundable-scope", label: "2. Non-Refundable Circumstances" },
  { id: "unresolvable-failure", label: "3. Refund Eligibility (Unresolvable Technical Issues)" },
  { id: "billing-errors", label: "4. System Billing Errors & Duplicate Charges" },
  { id: "cancellation-terms", label: "5. Self-Serve Subscription Cancellation" },
  { id: "automatic-renewals", label: "6. Automatic Renewals & Notice" },
  { id: "disbursement-method", label: "7. Payment Method & Banking Timelines" },
  { id: "disputes-chargebacks", label: "8. Chargebacks & Inquiries" },
  { id: "contact-billing", label: "9. Billing & Support Contact" },
];

export default function RefundPolicyPage() {
  return (
    <LegalPageShell
      title="Refund &amp; Cancellation Policy"
      subtitle="This policy governs commercial subscription terms, self-serve cancellation mechanisms, and refund conditions for the Morrow platform at morrow.corstack.dev."
      lastUpdated="October 16, 2026"
      activeSlug="refund"
      toc={TOC}
    >
      <section id="evaluation-sufficiency" className={styles.section}>
        <h2>1. Free Tier Evaluation Sufficiency</h2>
        <p className={styles.bodyText}>
          Morrow provides a permanently available Free tier to all registered accounts. The Free
          tier grants complete access to our core crawler engine, enabling any prospective subscriber
          to monitor one (1) competitor across up to three (3) Target URLs with automated 24-hour checks,
          visual diff rendering, and email notifications without entering credit card or payment
          credentials.
        </p>
        <p className={styles.bodyText}>
          Because the Free tier operates on identical headless rendering workers and difference
          calculation pipelines as paid plans, Customers are expected to utilize the Free tier to
          evaluate crawler compatibility, DOM extraction fidelity, and visual snapshot quality on
          their specific target websites before purchasing a paid subscription.
        </p>
      </section>

      <section id="non-refundable-scope" className={styles.section}>
        <h2>2. Non-Refundable Circumstances</h2>
        <p className={styles.bodyText}>
          Except as expressly set forth in Section 3 of this Policy, all payments processed for
          Morrow subscriptions are final and strictly non-refundable.
        </p>
        <p className={styles.bodyText}>
          Refunds are <strong>not</strong> granted under any of the following circumstances:
        </p>
        <ul className={styles.bulletList}>
          <li>
            <strong>Subjective Preference or Change of Mind:</strong> We do not issue refunds because
            a Customer no longer likes the product, decides it is unneeded, or prefers an alternative
            workflow. The Free tier exists specifically for prospective customers to form an informed
            assessment prior to purchasing.
          </li>
          <li>
            <strong>Inactivity or Lack of Usage:</strong> Failure by Customer to add Target URLs,
            configure notification channels, or log into the Workspace during an active billing
            period does not constitute grounds for a refund.
          </li>
          <li>
            <strong>Third-Party Target Alterations:</strong> If a monitored third-party website
            subsequently implements CAPTCHAs, Cloudflare Turnstile, IP bans, or structural redesigns
            after a subscription is initiated, such occurrences are beyond our control and do not
            entitle the Customer to a discretionary refund.
          </li>
          <li>
            <strong>Omission to Cancel Prior to Renewal:</strong> Failure to cancel a subscription
            before the scheduled recurring billing date does not qualify for a refund.
          </li>
        </ul>
      </section>

      <section id="unresolvable-failure" className={styles.section}>
        <h2>3. Refund Eligibility (Unresolvable Technical Issues)</h2>
        <p className={styles.bodyText}>
          A refund of the most recent subscription charge will only be evaluated and granted if the
          Customer encounters verified, unresolvable technical defects within the Morrow platform.
        </p>
        <p className={styles.bodyText}>
          To qualify for a refund under this provision, <strong>all</strong> of the following
          conditions must be satisfied:
        </p>
        <ul className={styles.bulletList}>
          <li>
            <strong>Condition A (Demonstrable Platform Failure):</strong> Morrow&rsquo;s worker
            infrastructure consistently fails to capture, render, or calculate differences for the
            Customer&rsquo;s designated public Target URLs due to an internal defect, bug, or outage in
            the Platform.
          </li>
          <li>
            <strong>Condition B (Timely Notification):</strong> The Customer must submit a formal
            technical ticket to{" "}
            <a href="mailto:morrow@corstack.dev" className="underline font-medium text-slate-900">
              morrow@corstack.dev
            </a>{" "}
            within seven (7) calendar days of the initial subscription charge or incident,
            identifying the Workspace ID, the affected Target URLs, and relevant error logs.
          </li>
          <li>
            <strong>Condition C (Inability to Remediate):</strong> Corstack engineering is unable to
            rectify the capture failure or provide a viable technical workaround within five (5)
            business days following receipt of the notification.
          </li>
        </ul>
        <p className={styles.bodyText}>
          If our engineering team confirms that the technical issue cannot be resolved, Corstack will
          issue a full 100% refund of the subscription fee paid for the affected billing period back
          to the original payment instrument.
        </p>
      </section>

      <section id="billing-errors" className={styles.section}>
        <h2>4. System Billing Errors &amp; Duplicate Charges</h2>
        <p className={styles.bodyText}>
          In the event of a verified technical billing error, system malfunction, or duplicate charge
          processed by our Merchant of Record (Lemon Squeezy), Corstack will immediately authorize and
          issue a full refund of the erroneous amount upon notification and internal verification.
        </p>
      </section>

      <section id="cancellation-terms" className={styles.section}>
        <h2>5. Self-Serve Subscription Cancellation</h2>
        <p className={styles.bodyText}>
          Customers are never locked into long-term service commitments. The Workspace Owner may
          cancel subscription renewal at any time directly through the self-serve management console:
        </p>
        <ol className={styles.bulletList}>
          <li>
            Navigate to the Workspace billing console at{" "}
            <Link href="/dashboard/billing" className="underline font-medium text-slate-900">
              morrow.corstack.dev/dashboard/billing
            </Link>
            .
          </li>
          <li>
            Select <strong>&ldquo;Cancel Subscription&rdquo;</strong> and confirm the action.
          </li>
        </ol>
        <p className={styles.bodyText}>
          <strong>Operational effects of cancellation:</strong>
        </p>
        <ul className={styles.bulletList}>
          <li>
            <strong>Access Maintained:</strong> Your Workspace remains active on the subscribed plan
            tier with all monitoring frequencies and quotas preserved until the conclusion of the
            current prepaid billing interval.
          </li>
          <li>
            <strong>Cessation of Recurring Invoicing:</strong> Your subscription will terminate at the
            conclusion of the billing period. No future automatic renewal payments will be charged.
          </li>
          <li>
            <strong>Graceful Transition to Free Plan:</strong> Upon period expiration, the Workspace
            reverts to the Free tier. Your baseline competitor profile remains active; secondary
            monitors are paused and preserved in state rather than deleted.
          </li>
          <li>
            <strong>No Proration on Early Cancellation:</strong> Cancellation stops future renewals
            only. It does not generate prorated, partial, or retrospective refunds for the remainder of
            an active paid period.
          </li>
        </ul>
      </section>

      <section id="automatic-renewals" className={styles.section}>
        <h2>6. Automatic Renewals &amp; Notice</h2>
        <p className={styles.bodyText}>
          Paid subscriptions (whether monthly or annual) renew automatically at the expiration of each
          billing term unless cancelled by the Customer prior to the renewal timestamp. It is the sole
          responsibility of the Customer to manage recurring renewal settings.
        </p>
        <p className={styles.bodyText}>
          Renewal payments are non-refundable once processed, subject solely to the unresolvable
          technical failure provisions set forth in Section 3.
        </p>
      </section>

      <section id="disbursement-method" className={styles.section}>
        <h2>7. Payment Method &amp; Banking Timelines</h2>
        <p className={styles.bodyText}>
          All approved refunds are submitted through our Merchant of Record, Lemon Squeezy, directly
          to the original payment instrument utilized at checkout:
        </p>
        <ul className={styles.bulletList}>
          <li>
            Refunds cannot be disbursed to alternate credit cards, third-party bank accounts, or in
            cash.
          </li>
          <li>
            Upon authorization by Corstack, processing times are governed by card networks and bank
            settlement clearinghouses, typically requiring between five (5) and ten (10) business days
            to reflect on your statement.
          </li>
          <li>
            An electronic refund receipt is issued via email by Lemon Squeezy upon transaction
            execution.
          </li>
        </ul>
      </section>

      <section id="disputes-chargebacks" className={styles.section}>
        <h2>8. Chargebacks &amp; Inquiries</h2>
        <p className={styles.bodyText}>
          If you identify an unrecognized charge or suspect a billing error, you agree to contact
          Corstack at{" "}
          <a href="mailto:morrow@corstack.dev" className="underline font-medium text-slate-900">
            morrow@corstack.dev
          </a>{" "}
          prior to opening a dispute or chargeback with your bank or credit card issuer.
        </p>
        <p className={styles.bodyText}>
          Bank chargeback disputes freeze funds and can take sixty (60) to ninety (90) days to
          adjudicate through financial intermediaries. In contrast, our support team can verify billing
          discrepancies and execute authorized remedies within one to two business days.
        </p>
        <p className={styles.bodyText}>
          Corstack reserves the right to immediately suspend Workspace access for any account that
          initiates a fraudulent or bad-faith chargeback while actively consuming platform resources.
        </p>
      </section>

      <section id="contact-billing" className={styles.section}>
        <h2>9. Billing &amp; Support Contact</h2>
        <p className={styles.bodyText}>
          For billing questions, technical failure tickets, or cancellation inquiries, contact:
        </p>
        <div className={styles.noticePanel}>
          <h4>Corstack — Morrow Billing &amp; Support</h4>
          <p>
            Email:{" "}
            <a href="mailto:morrow@corstack.dev" className="underline font-medium text-slate-900">
              morrow@corstack.dev
            </a>
            <br />
            Platform: morrow.corstack.dev
            <br />
            Billing Console:{" "}
            <Link href="/dashboard/billing" className="underline font-medium text-slate-900">
              morrow.corstack.dev/dashboard/billing
            </Link>
          </p>
        </div>
      </section>
    </LegalPageShell>
  );
}
