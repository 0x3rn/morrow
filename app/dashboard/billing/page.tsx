import { WorkspaceActionForm } from "@/components/workspace-feedback";
import { auth } from "@/lib/auth";
import {
  formatFrequencyIntervalLabel,
  getBillingPlanDefinition,
} from "@/lib/billing-plans";
import {
  getWorkspaceBillingSnapshot,
  type WorkspaceBillingEventType,
} from "@/lib/workspace-billing";
import { WORKSPACE_ROLE_DETAILS } from "@/lib/workspace-roles";
import { env } from "cloudflare:workers";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  changeSubscriptionPlanAction,
  toggleSubscriptionCancellationAction,
  updateBillingIntervalAction,
} from "./actions";

function normalizeDatabaseTimestamp(value: string): string {
  if (
    value.endsWith("Z") ||
    /[+-]\d{2}:\d{2}$/.test(value)
  ) {
    return value;
  }

  return `${value.replace(" ", "T")}Z`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Never";
  }

  const date = new Date(
    normalizeDatabaseTimestamp(value),
  );

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

function formatDateOnly(value: string | null): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(
    normalizeDatabaseTimestamp(value),
  );

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function getSubscriptionStatusBadge(
  status: string,
  cancelAtPeriodEnd: boolean,
): {
  label: string;
  className: string;
} {
  if (status === "canceled") {
    return {
      label: "Canceled (Free fallback)",
      className: "workspace-badge health-paused",
    };
  }

  if (cancelAtPeriodEnd) {
    return {
      label: "Cancels at period end",
      className: "workspace-badge significance-moderate",
    };
  }

  if (status === "past_due") {
    return {
      label: "Past due",
      className: "workspace-badge significance-major",
    };
  }

  if (status === "trialing") {
    return {
      label: "Trialing",
      className: "workspace-badge health-healthy",
    };
  }

  return {
    label: "Active subscription",
    className: "workspace-badge health-healthy",
  };
}

function formatBillingEventDescription(input: {
  eventType: WorkspaceBillingEventType;
  previousPlanId: string | null;
  newPlanId: string;
  billingInterval: string;
  adjustedPageFrequencies: number;
}): {
  title: string;
  detail: string;
} {
  const newPlan = getBillingPlanDefinition(
    input.newPlanId,
  );
  const previousPlan = input.previousPlanId
    ? getBillingPlanDefinition(input.previousPlanId)
    : null;
  const intervalLabel =
    input.billingInterval === "annual"
      ? "annual billing"
      : "monthly billing";

  switch (input.eventType) {
    case "checkout_initiated":
      return {
        title: `Started Lemon Squeezy checkout for ${newPlan.name}`,
        detail: `Checkout session created for ${newPlan.name} on ${intervalLabel}. Plan activates once payment is confirmed.`,
      };

    case "payment_succeeded":
      return {
        title: `Confirmed Lemon Squeezy payment for ${newPlan.name}`,
        detail: `Subscription verified on ${intervalLabel}.`,
      };

    case "payment_failed":
      return {
        title: `Payment failed for ${newPlan.name}`,
        detail:
          "Lemon Squeezy reported a failed renewal charge. Update your payment method to avoid interruption.",
      };

    case "plan_upgraded":
      return {
        title: `Upgraded workspace plan to ${newPlan.name}`,
        detail: previousPlan
          ? `Switched from ${previousPlan.name} to ${newPlan.name} on ${intervalLabel}.`
          : `Activated ${newPlan.name} on ${intervalLabel}.`,
      };

    case "plan_downgraded":
      return {
        title: `Downgraded workspace plan to ${newPlan.name}`,
        detail: [
          previousPlan
            ? `Switched from ${previousPlan.name} to ${newPlan.name} on ${intervalLabel}.`
            : `Switched to ${newPlan.name} on ${intervalLabel}.`,
          input.adjustedPageFrequencies > 0
            ? `Automatically normalized ${input.adjustedPageFrequencies} monitored page(s) to ${formatFrequencyIntervalLabel(
                newPlan.limits.minFrequencyMinutes,
              ).toLowerCase()}.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      };

    case "billing_interval_changed":
      return {
        title: `Updated billing cycle to ${input.billingInterval}`,
        detail: `${newPlan.name} plan is now billed on an ${intervalLabel} cycle.`,
      };

    case "cancellation_scheduled":
      return {
        title: "Scheduled cancellation at period end",
        detail: `Workspace retains ${newPlan.name} entitlements until the current billing period ends.`,
      };

    case "subscription_reactivated":
      return {
        title: `Reactivated ${newPlan.name} subscription`,
        detail: `Automatic renewal restored on ${intervalLabel}.`,
      };

    case "subscription_canceled":
      return {
        title: "Subscription canceled",
        detail: [
          "Workspace fell back to Free plan limits.",
          input.adjustedPageFrequencies > 0
            ? `Adjusted ${input.adjustedPageFrequencies} monitored page(s) to 24-hour checks.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      };

    case "subscription_initialized":
    default:
      return {
        title: `Initialized ${newPlan.name} plan`,
        detail: `Workspace subscription provisioned on ${intervalLabel}.`,
      };
  }
}

export default async function BillingPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const snapshot = await getWorkspaceBillingSnapshot(
    env.DB,
    session.user.id,
  );

  const {
    activeWorkspace,
    subscription,
    entitlements,
    usage,
    planOptions,
    recentEvents,
  } = snapshot;

  const canManageBilling =
    activeWorkspace.permissions
      .canManageWorkspaceBilling;
  const statusBadge = getSubscriptionStatusBadge(
    subscription.status,
    subscription.cancelAtPeriodEnd,
  );

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
              Subscription &amp; entitlements
            </div>

            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
              Billing &amp; plan limits
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500 sm:text-[15px]">
              Manage subscription tiers, monitored page capacity, minimum check intervals, and historical retention windows for{" "}
              <strong>{activeWorkspace.name}</strong>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="workspace-badge">
              {entitlements.planName} plan
            </span>
            <span className={statusBadge.className}>
              {statusBadge.label}
            </span>
            <span className="workspace-badge">
              Your role:{" "}
              {
                WORKSPACE_ROLE_DETAILS[
                  activeWorkspace.role
                ].label
              }
            </span>
          </div>
        </header>

        <section
          className="workspace-metrics mt-6"
          aria-label="Workspace plan and capacity summary"
        >
          <article>
            <div className="workspace-metric-label">
              Active plan
            </div>
            <div className="workspace-metric-value">
              {entitlements.planName}
            </div>
            <div className="workspace-meta">
              ${entitlements.effectiveMonthlyPriceUsd}/mo
              {entitlements.effectivePlanId === "free"
                ? " · Free tier"
                : ` (${entitlements.billingInterval} billing) · period ends ${formatDateOnly(
                    subscription.currentPeriodEnd,
                  )}`}
            </div>
          </article>

          <article>
            <div className="workspace-metric-label">
              Monitored pages
            </div>
            <div className="workspace-metric-value">
              {usage.monitoredPages} /{" "}
              {
                entitlements.limits
                  .monitoredPagesPerWorkspace
              }
            </div>
            <div className="workspace-meta">
              {usage.competitors} /{" "}
              {
                entitlements.limits
                  .competitorsPerWorkspace
              }{" "}
              competitors · up to{" "}
              {
                entitlements.limits
                  .monitoredPagesPerCompetitor
              }{" "}
              pages/competitor
            </div>
          </article>

          <article>
            <div className="workspace-metric-label">
              Minimum check interval
            </div>
            <div className="workspace-metric-value">
              {entitlements.limits.minFrequencyMinutes ===
              60
                ? "1h"
                : `${
                    entitlements.limits
                      .minFrequencyMinutes / 60
                  }h`}
            </div>
            <div className="workspace-meta">
              {formatFrequencyIntervalLabel(
                entitlements.limits.minFrequencyMinutes,
              )}{" "}
              ·{" "}
              {entitlements.features.hourlyMonitoring
                ? "Hourly checks enabled"
                : "Upgrade to Growth for hourly checks"}
            </div>
          </article>

          <article>
            <div className="workspace-metric-label">
              History retention
            </div>
            <div className="workspace-metric-value">
              {entitlements.limits.historyRetentionDays}d
            </div>
            <div className="workspace-meta">
              {usage.outsideRetentionChanges > 0 ||
              usage.outsideRetentionSnapshots > 0
                ? `${usage.outsideRetentionChanges} older changes · ${usage.outsideRetentionSnapshots} snapshots outside window`
                : `All recorded history within ${entitlements.limits.historyRetentionDays}-day window`}
            </div>
          </article>
        </section>

        <section className="mt-8">
          <div className="workspace-surface">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                  Subscription tiers
                </div>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">
                  Compare plans for {activeWorkspace.name}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Plan changes take effect immediately. Upgrading unlocks higher page caps, faster check intervals, CSS selector scoping, and extended historical retention.
                </p>
              </div>

              {canManageBilling ? (
                <div className="flex flex-wrap items-center gap-2">
                  <WorkspaceActionForm
                    action={updateBillingIntervalAction}
                    successMessage="Billing cycle updated."
                  >
                    <input
                      type="hidden"
                      name="billingInterval"
                      value={
                        subscription.billingInterval ===
                        "annual"
                          ? "monthly"
                          : "annual"
                      }
                    />
                    <button
                      type="submit"
                      className="workspace-panel-trigger workspace-panel-secondary"
                    >
                      {subscription.billingInterval ===
                      "annual"
                        ? "Switch to monthly billing"
                        : "Switch to annual billing (save ~20%)"}
                    </button>
                  </WorkspaceActionForm>
                </div>
              ) : null}
            </div>

            {!canManageBilling ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                You are viewing billing details as a workspace{" "}
                <strong>
                  {
                    WORKSPACE_ROLE_DETAILS[
                      activeWorkspace.role
                    ].label
                  }
                </strong>
                . Only workspace{" "}
                <strong>Owners</strong> can upgrade, downgrade, or modify subscription billing intervals.
              </div>
            ) : null}

            <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
              {planOptions.map(
                ({
                  plan,
                  isCurrentPlan,
                  transition,
                }) => {
                  const displayedMonthlyPrice =
                    subscription.billingInterval ===
                    "annual"
                      ? plan.annualMonthlyPriceUsd
                      : plan.monthlyPriceUsd;

                  return (
                    <article
                      key={plan.id}
                      className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-lg font-semibold text-slate-950">
                            {plan.name}
                          </h3>

                          {isCurrentPlan ? (
                            <span className="workspace-badge health-healthy">
                              Current plan
                            </span>
                          ) : transition.direction ===
                            "upgrade" ? (
                            <span className="workspace-badge">
                              Upgrade
                            </span>
                          ) : (
                            <span className="workspace-badge health-paused">
                              Downgrade
                            </span>
                          )}
                        </div>

                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          {plan.tagline}
                        </p>

                        <div className="mt-4 border-t border-b border-slate-200 py-4">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-3xl font-semibold tracking-tight text-slate-950">
                              ${displayedMonthlyPrice}
                            </span>
                            <span className="text-xs text-slate-500">
                              / month
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {plan.id === "free"
                              ? "Free forever · No credit card required"
                              : subscription.billingInterval ===
                                  "annual"
                                ? `Billed annually ($${
                                    plan.annualMonthlyPriceUsd *
                                    12
                                  }/yr) · $${
                                    plan.monthlyPriceUsd
                                  }/mo monthly`
                                : `Billed monthly · or $${plan.annualMonthlyPriceUsd}/mo billed annually`}
                          </div>
                        </div>

                        <dl className="workspace-usage-summary">
                          <div>
                            <dt>Workspaces</dt>
                            <dd>
                              <strong>
                                {plan.limits
                                  .workspacesPerAccount ===
                                1
                                  ? "1 workspace"
                                  : `Up to ${plan.limits.workspacesPerAccount}`}
                              </strong>
                            </dd>
                          </div>
                          <div>
                            <dt>Competitors</dt>
                            <dd>
                              <strong>
                                Up to{" "}
                                {
                                  plan.limits
                                    .competitorsPerWorkspace
                                }
                              </strong>
                            </dd>
                          </div>
                          <div>
                            <dt>Monitored pages</dt>
                            <dd>
                              <strong>
                                Up to{" "}
                                {
                                  plan.limits
                                    .monitoredPagesPerWorkspace
                                }
                              </strong>
                              <span className="workspace-meta">
                                {
                                  plan.limits
                                    .monitoredPagesPerCompetitor
                                }{" "}
                                per competitor
                              </span>
                            </dd>
                          </div>
                          <div>
                            <dt>Fastest check interval</dt>
                            <dd>
                              <strong>
                                {formatFrequencyIntervalLabel(
                                  plan.limits
                                    .minFrequencyMinutes,
                                )}
                              </strong>
                            </dd>
                          </div>
                          <div>
                            <dt>History retention</dt>
                            <dd>
                              <strong>
                                {
                                  plan.limits
                                    .historyRetentionDays
                                }{" "}
                                days
                              </strong>
                            </dd>
                          </div>
                          <div>
                            <dt>Team seats</dt>
                            <dd>
                              <strong>
                                {plan.limits
                                  .teamMembersPerWorkspace ===
                                1
                                  ? "1 (owner only)"
                                  : `Up to ${plan.limits.teamMembersPerWorkspace}`}
                              </strong>
                            </dd>
                          </div>
                          <div>
                            <dt>External channels</dt>
                            <dd>
                              <strong>
                                {plan.limits
                                  .externalChannelsPerWorkspace ===
                                0
                                  ? "Disabled"
                                  : `Up to ${plan.limits.externalChannelsPerWorkspace}`}
                              </strong>
                            </dd>
                          </div>
                          <div>
                            <dt>CSS selector scope</dt>
                            <dd>
                              <strong>
                                {plan.features
                                  .sectionLevelMonitoring
                                  ? "Included"
                                  : "Full-page only"}
                              </strong>
                            </dd>
                          </div>
                          <div>
                            <dt>Scheduled digests</dt>
                            <dd>
                              <strong>
                                {!plan.features
                                  .scheduledDigests
                                  ? "Instant email only"
                                  : plan.features
                                        .allowedDigestPeriods
                                        .length === 1
                                    ? "Weekly digest"
                                    : "Daily, weekly & monthly"}
                              </strong>
                            </dd>
                          </div>
                        </dl>

                        {!isCurrentPlan &&
                        transition.pagesRequiringFrequencyAdjustment >
                          0 ? (
                          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                            Switching to{" "}
                            <strong>{plan.name}</strong>{" "}
                            will automatically adjust{" "}
                            <strong>
                              {
                                transition.pagesRequiringFrequencyAdjustment
                              }{" "}
                              page(s)
                            </strong>{" "}
                            to{" "}
                            {formatFrequencyIntervalLabel(
                              plan.limits
                                .minFrequencyMinutes,
                            ).toLowerCase()}
                            .
                          </div>
                        ) : null}

                        {!isCurrentPlan &&
                        (transition.pagesRequiringSelectorClear ??
                          0) > 0 ? (
                          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                            Switching to{" "}
                            <strong>{plan.name}</strong>{" "}
                            will clear CSS selectors on{" "}
                            <strong>
                              {
                                transition.pagesRequiringSelectorClear
                              }{" "}
                              page(s)
                            </strong>{" "}
                            (reverts to full-page monitoring).
                          </div>
                        ) : null}

                        {!isCurrentPlan &&
                        !transition.allowed ? (
                          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                            <div className="font-semibold">
                              Current usage exceeds{" "}
                              {plan.name} limits:
                            </div>
                            <ul className="mt-1.5 list-disc space-y-1 pl-4">
                              {transition.blockingReasons.map(
                                (reason) => (
                                  <li key={reason}>
                                    {reason}
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-6 pt-4 border-t border-slate-200">
                        {isCurrentPlan ? (
                          <div className="text-xs font-medium text-slate-500">
                            Active on{" "}
                            <strong>
                              {activeWorkspace.name}
                            </strong>{" "}
                            {plan.id === "free"
                              ? "(Free tier)"
                              : `(${subscription.billingInterval} billing)`}
                          </div>
                        ) : canManageBilling ? (
                          <WorkspaceActionForm
                            action={
                              changeSubscriptionPlanAction
                            }
                            successMessage={`Workspace plan updated to ${plan.name}.`}
                          >
                            <input
                              type="hidden"
                              name="planId"
                              value={plan.id}
                            />
                            <input
                              type="hidden"
                              name="billingInterval"
                              value={
                                subscription.billingInterval
                              }
                            />
                            <button
                              type="submit"
                              disabled={
                                !transition.allowed
                              }
                              className={
                                transition.direction ===
                                "upgrade"
                                  ? "workspace-primary w-full"
                                  : "workspace-panel-trigger workspace-panel-secondary w-full"
                              }
                            >
                              {transition.direction ===
                              "upgrade"
                                ? `Upgrade to ${plan.name}`
                                : `Switch to ${plan.name}`}
                            </button>
                          </WorkspaceActionForm>
                        ) : (
                          <div className="text-xs text-slate-500">
                            Ask a workspace Owner to switch to {plan.name}.
                          </div>
                        )}
                      </div>
                    </article>
                  );
                },
              )}
            </div>
          </div>
        </section>

        <div className="dashboard-columns mt-8">
          <section className="dashboard-changes">
            <div className="workspace-surface">
              <div className="workspace-section-heading">
                <h2>Metered usage &amp; entitlements</h2>
                <span className="workspace-meta">
                  {entitlements.planName} limits
                </span>
              </div>
              <p className="workspace-section-helper">
                All resource caps, minimum check frequencies, and retention rules are enforced server-side for{" "}
                <strong>{activeWorkspace.name}</strong>.
              </p>

              <dl className="workspace-usage-summary">
                <div>
                  <dt>
                    Workspaces owned
                    <span className="workspace-meta">
                      Workspaces created or owned by this workspace&apos;s Owner account
                    </span>
                  </dt>
                  <dd>
                    <strong>
                      {usage.ownedWorkspaces} /{" "}
                      {
                        entitlements.limits
                          .workspacesPerAccount
                      }
                    </strong>
                    <span className="workspace-meta">
                      <Link href="/dashboard/team">
                        Manage workspaces
                      </Link>
                    </span>
                  </dd>
                </div>

                <div>
                  <dt>
                    Competitors
                    <span className="workspace-meta">
                      Active and paused competitor profiles in this workspace
                    </span>
                  </dt>
                  <dd>
                    <strong>
                      {usage.competitors} /{" "}
                      {
                        entitlements.limits
                          .competitorsPerWorkspace
                      }
                    </strong>
                    <span className="workspace-meta">
                      {Math.max(
                        0,
                        entitlements.limits
                          .competitorsPerWorkspace -
                          usage.competitors,
                      )}{" "}
                      remaining
                    </span>
                  </dd>
                </div>

                <div>
                  <dt>
                    Monitored pages
                    <span className="workspace-meta">
                      Total monitored URLs across all competitors
                    </span>
                  </dt>
                  <dd>
                    <strong>
                      {usage.monitoredPages} /{" "}
                      {
                        entitlements.limits
                          .monitoredPagesPerWorkspace
                      }
                    </strong>
                    <span className="workspace-meta">
                      {Math.max(
                        0,
                        entitlements.limits
                          .monitoredPagesPerWorkspace -
                          usage.monitoredPages,
                      )}{" "}
                      remaining
                    </span>
                  </dd>
                </div>

                <div>
                  <dt>
                    Per-competitor page density
                    <span className="workspace-meta">
                      Highest number of monitored pages on any single competitor
                    </span>
                  </dt>
                  <dd>
                    <strong>
                      {usage.maxPagesOnSingleCompetitor} /{" "}
                      {
                        entitlements.limits
                          .monitoredPagesPerCompetitor
                      }
                    </strong>
                    <span className="workspace-meta">
                      Max{" "}
                      {
                        entitlements.limits
                          .monitoredPagesPerCompetitor
                      }{" "}
                      pages per competitor
                    </span>
                  </dd>
                </div>

                <div>
                  <dt>
                    Team seats
                    <span className="workspace-meta">
                      {usage.activeMembers} active member(s) +{" "}
                      {usage.pendingInvitations} pending invitation(s)
                    </span>
                  </dt>
                  <dd>
                    <strong>
                      {usage.teamSeats} /{" "}
                      {
                        entitlements.limits
                          .teamMembersPerWorkspace
                      }
                    </strong>
                    <span className="workspace-meta">
                      <Link href="/dashboard/team">
                        Manage team
                      </Link>
                    </span>
                  </dd>
                </div>

                <div>
                  <dt>
                    External notification channels
                    <span className="workspace-meta">
                      Slack, Telegram, and signed webhook destinations
                    </span>
                  </dt>
                  <dd>
                    <strong>
                      {usage.externalChannels} /{" "}
                      {
                        entitlements.limits
                          .externalChannelsPerWorkspace
                      }
                    </strong>
                    <span className="workspace-meta">
                      <Link href="/dashboard/notifications">
                        Manage channels
                      </Link>
                    </span>
                  </dd>
                </div>

                <div>
                  <dt>
                    Historical retention window
                    <span className="workspace-meta">
                      Changes and snapshots since{" "}
                      {formatDateTime(
                        usage.retentionCutoffIso,
                      )}
                    </span>
                  </dt>
                  <dd>
                    <strong>
                      {
                        entitlements.limits
                          .historyRetentionDays
                      }{" "}
                      days
                    </strong>
                    <span className="workspace-meta">
                      {usage.outsideRetentionChanges}{" "}
                      older changes ·{" "}
                      {usage.outsideRetentionSnapshots}{" "}
                      older snapshots archived
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <div className="dashboard-operations">
            <section className="workspace-surface">
              <div className="workspace-section-heading">
                <h2>Subscription lifecycle</h2>
                <span className={statusBadge.className}>
                  {statusBadge.label}
                </span>
              </div>

              <dl className="workspace-usage-summary">
                <div>
                  <dt>Configured tier</dt>
                  <dd>
                    <strong>
                      {
                        getBillingPlanDefinition(
                          subscription.planId,
                        ).name
                      }
                    </strong>
                  </dd>
                </div>
                <div>
                  <dt>Payment provider</dt>
                  <dd>
                    <strong>
                      {subscription.providerSubscriptionId
                        ? `Lemon Squeezy (#${subscription.providerSubscriptionId})`
                        : "Lemon Squeezy (not yet subscribed)"}
                    </strong>
                  </dd>
                </div>
                <div>
                  <dt>Billing cycle</dt>
                  <dd className="workspace-category">
                    <strong>
                      {subscription.billingInterval}
                    </strong>
                  </dd>
                </div>
                <div>
                  <dt>Current period start</dt>
                  <dd>
                    {formatDateOnly(
                      subscription.currentPeriodStart,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>
                    {subscription.cancelAtPeriodEnd
                      ? "Access ends"
                      : "Next renewal"}
                  </dt>
                  <dd>
                    {formatDateOnly(
                      subscription.currentPeriodEnd,
                    )}
                  </dd>
                </div>
              </dl>

              {canManageBilling ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                  {subscription.providerSubscriptionId &&
                  subscription.status !== "canceled" ? (
                    subscription.cancelAtPeriodEnd ? (
                      <WorkspaceActionForm
                        action={
                          toggleSubscriptionCancellationAction
                        }
                        successMessage="Subscription reactivated."
                      >
                        <input
                          type="hidden"
                          name="mode"
                          value="reactivate"
                        />
                        <button
                          type="submit"
                          className="workspace-primary"
                        >
                          Resume subscription renewal
                        </button>
                      </WorkspaceActionForm>
                    ) : (
                      <WorkspaceActionForm
                        action={
                          toggleSubscriptionCancellationAction
                        }
                        successMessage="Cancellation scheduled for the end of the current period."
                      >
                        <input
                          type="hidden"
                          name="mode"
                          value="schedule_cancel"
                        />
                        <button
                          type="submit"
                          className="workspace-panel-trigger workspace-panel-secondary"
                        >
                          Cancel at period end
                        </button>
                      </WorkspaceActionForm>
                    )
                  ) : (
                    <p className="text-xs text-slate-500">
                      Select a plan above to open a secure Lemon Squeezy checkout session.
                    </p>
                  )}

                  {subscription.providerUpdatePaymentUrl ? (
                    <a
                      href={
                        subscription.providerUpdatePaymentUrl
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="workspace-panel-trigger workspace-panel-secondary"
                    >
                      Update payment method
                    </a>
                  ) : null}

                  {subscription.providerCustomerPortalUrl ? (
                    <a
                      href={
                        subscription.providerCustomerPortalUrl
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="workspace-panel-trigger workspace-panel-secondary"
                    >
                      Lemon Squeezy customer portal
                    </a>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="workspace-surface">
              <div className="workspace-section-heading">
                <h2>Billing activity</h2>
                <span className="workspace-meta">
                  {recentEvents.length} recent
                </span>
              </div>

              {recentEvents.length === 0 ? (
                <div className="workspace-empty">
                  <h3>No plan changes recorded yet</h3>
                  <p>
                    Upgrades, downgrades, and billing interval updates for{" "}
                    <strong>{activeWorkspace.name}</strong>{" "}
                    will appear here.
                  </p>
                </div>
              ) : (
                <div className="workspace-records">
                  {recentEvents.map((event) => {
                    const formatted =
                      formatBillingEventDescription({
                        eventType: event.eventType,
                        previousPlanId:
                          event.previousPlanId,
                        newPlanId: event.newPlanId,
                        billingInterval:
                          event.billingInterval,
                        adjustedPageFrequencies:
                          event.adjustedPageFrequencies,
                      });

                    return (
                      <article
                        key={event.id}
                        className="workspace-record"
                      >
                        <div className="font-semibold text-slate-900">
                          {formatted.title}
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          {formatted.detail}
                        </p>
                        <div className="workspace-record-meta">
                          <span>{event.actorLabel}</span>
                          <span>·</span>
                          <time>
                            {formatDateTime(
                              event.createdAt,
                            )}
                          </time>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
