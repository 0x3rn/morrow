import { WorkspaceActionForm } from "@/components/workspace-feedback";
import { WorkspacePanel } from "@/components/workspace-panel";
import { auth } from "@/lib/auth";
import {
  getWorkspaceNotificationSettings,
  type WorkspaceCompetitorOption,
  type WorkspaceExternalChannelView,
} from "@/lib/notification-settings";
import { getWorkspaceEntitlements } from "@/lib/workspace-billing";
import {
  NOTIFICATION_CHANGE_CATEGORIES,
  NOTIFICATION_DIGEST_PERIODS,
  type ExternalNotificationChannelType,
  type NotificationChangeCategory,
  type NotificationDigestPeriod,
  type NotificationSignificanceLevel,
} from "@/worker/notification-routing";
import { env } from "cloudflare:workers";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  createExternalChannel,
  removeExternalChannel,
  toggleExternalChannelStatus,
  updateEmailNotificationPreferences,
  updateExternalChannel,
} from "./actions";

const CATEGORY_LABELS: Record<
  NotificationChangeCategory,
  { label: string; description: string }
> = {
  pricing: {
    label: "Pricing",
    description: "Plan tiers, prices, billing terms, and discounts",
  },
  product: {
    label: "Product",
    description: "Core product offerings, packaging, and platform updates",
  },
  feature: {
    label: "Feature",
    description: "Specific capabilities, release notes, and technical specs",
  },
  positioning: {
    label: "Positioning",
    description: "Headlines, value propositions, and target-market messaging",
  },
  promotion: {
    label: "Promotion",
    description: "Limited-time offers, trials, campaigns, and incentives",
  },
  policy: {
    label: "Policy",
    description: "Terms of service, privacy, compliance, and SLA updates",
  },
  navigation: {
    label: "Navigation",
    description: "Menus, header/footer links, and site structure",
  },
  content: {
    label: "General content",
    description: "Body copy and other substantive page updates",
  },
  other: {
    label: "Other",
    description: "Uncategorized page updates that pass noise filtering",
  },
  section_removed: {
    label: "Monitored section removed",
    description:
      "Alerts when a monitored page section is removed or its selector changes",
  },
};

const SIGNIFICANCE_LABELS: Record<
  NotificationSignificanceLevel,
  string
> = {
  minor: "All changes (Minor, Moderate & Major)",
  moderate: "Moderate & Major changes only",
  major: "Major changes only",
};

const DIGEST_PERIOD_LABELS: Record<
  NotificationDigestPeriod,
  string
> = {
  daily: "Daily digest (08:00 UTC)",
  weekly: "Weekly digest (Mondays 08:00 UTC)",
  monthly: "Monthly digest (1st of month 08:00 UTC)",
};

const CHANNEL_TYPE_LABELS: Record<
  ExternalNotificationChannelType,
  string
> = {
  slack: "Slack",
  telegram: "Telegram",
  webhook: "Webhook",
};

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

function formatTriggerSummary(channel: {
  sendChanges: boolean;
  sendDigests: boolean;
  digestPeriods: readonly NotificationDigestPeriod[];
}): string {
  const parts: string[] = [];

  if (channel.sendChanges) {
    parts.push("Instant change alerts");
  }

  if (channel.sendDigests) {
    const periods =
      channel.digestPeriods.length > 0
        ? channel.digestPeriods.join(" & ")
        : "daily & weekly";
    parts.push(`Digests (${periods})`);
  }

  return parts.length > 0 ? parts.join(" • ") : "No triggers";
}

function formatCategorySummary(
  categories: readonly NotificationChangeCategory[],
): string {
  if (
    categories.length === 0 ||
    categories.length ===
      NOTIFICATION_CHANGE_CATEGORIES.length
  ) {
    return "All categories";
  }

  return categories
    .map((category) => CATEGORY_LABELS[category]?.label ?? category)
    .join(", ");
}

function formatCompetitorSummary(
  competitorIds: readonly string[],
  competitors: readonly WorkspaceCompetitorOption[],
): string {
  if (competitorIds.length === 0) {
    return "All competitors";
  }

  const nameById = new Map(
    competitors.map((competitor) => [
      competitor.id,
      competitor.name,
    ]),
  );

  const names = competitorIds
    .map((id) => nameById.get(id))
    .filter((name): name is string => Boolean(name));

  return names.length > 0
    ? names.join(", ")
    : "All competitors";
}

function RoutingFilterFields({
  idPrefix,
  minSignificance,
  selectedCategories,
  selectedCompetitorIds,
  competitors,
}: {
  idPrefix: string;
  minSignificance: NotificationSignificanceLevel;
  selectedCategories: readonly NotificationChangeCategory[];
  selectedCompetitorIds: readonly string[];
  competitors: readonly WorkspaceCompetitorOption[];
}) {
  const selectedCategorySet = new Set(selectedCategories);
  const selectedCompetitorSet = new Set(
    selectedCompetitorIds,
  );

  return (
    <>
      <div>
        <label
          htmlFor={`${idPrefix}-min-significance`}
          className="mb-1.5 block text-xs font-medium text-slate-600"
        >
          Minimum significance threshold
        </label>

        <select
          id={`${idPrefix}-min-significance`}
          name="minSignificance"
          defaultValue={minSignificance}
        >
          <option value="minor">
            {SIGNIFICANCE_LABELS.minor}
          </option>
          <option value="moderate">
            {SIGNIFICANCE_LABELS.moderate}
          </option>
          <option value="major">
            {SIGNIFICANCE_LABELS.major}
          </option>
        </select>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-slate-600">
          Change categories
        </div>
        <p className="mb-2.5 text-xs text-slate-500">
          Select specific categories to route, or leave all unchecked to receive every category.
        </p>

        <div className="workspace-choice-grid">
          {NOTIFICATION_CHANGE_CATEGORIES.map((category) => (
            <label
              key={category}
              className="workspace-choice-option"
            >
              <input
                type="checkbox"
                name="categories"
                value={category}
                defaultChecked={selectedCategorySet.has(
                  category,
                )}
              />
              <span>
                <strong className="block text-sm font-medium text-slate-900">
                  {CATEGORY_LABELS[category].label}
                </strong>
                <span className="block text-xs text-slate-500">
                  {CATEGORY_LABELS[category].description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-slate-600">
          Competitors
        </div>
        <p className="mb-2.5 text-xs text-slate-500">
          Select specific competitors to route, or leave all unchecked to receive alerts across all competitors in this workspace.
        </p>

        {competitors.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
            No competitors added yet. Alerts will automatically apply to new competitors until you restrict this filter.
          </p>
        ) : (
          <div className="workspace-choice-grid">
            {competitors.map((competitor) => (
              <label
                key={competitor.id}
                className="workspace-choice-option"
              >
                <input
                  type="checkbox"
                  name="competitorIds"
                  value={competitor.id}
                  defaultChecked={selectedCompetitorSet.has(
                    competitor.id,
                  )}
                />
                <span>
                  <strong className="block text-sm font-medium text-slate-900">
                    {competitor.name}
                  </strong>
                  <span className="block text-xs text-slate-500">
                    {competitor.domain}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ChannelDestinationFields({
  idPrefix,
  channel,
}: {
  idPrefix: string;
  channel?: WorkspaceExternalChannelView;
}) {
  const isEditing = Boolean(channel);

  return (
    <div className="grid gap-4">
      {!channel || channel.channel === "slack" ? (
        <div>
          <label
            htmlFor={`${idPrefix}-slack-webhook-url`}
            className="mb-1.5 block text-xs font-medium text-slate-600"
          >
            Slack incoming webhook URL{" "}
            {isEditing
              ? "(leave blank to keep existing webhook URL)"
              : "(required for Slack)"}
          </label>
          <input
            id={`${idPrefix}-slack-webhook-url`}
            name="slackWebhookUrl"
            type="url"
            placeholder="https://hooks.slack.com/services/..."
          />
        </div>
      ) : null}

      {!channel || channel.channel === "telegram" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`${idPrefix}-telegram-bot-token`}
              className="mb-1.5 block text-xs font-medium text-slate-600"
            >
              Telegram bot token{" "}
              {isEditing
                ? "(leave blank to keep existing token)"
                : "(required for Telegram)"}
            </label>
            <input
              id={`${idPrefix}-telegram-bot-token`}
              name="telegramBotToken"
              type="password"
              autoComplete="off"
              placeholder="123456789:AAH..."
            />
          </div>

          <div>
            <label
              htmlFor={`${idPrefix}-telegram-chat-id`}
              className="mb-1.5 block text-xs font-medium text-slate-600"
            >
              Telegram chat ID{" "}
              {isEditing ? "" : "(required for Telegram)"}
            </label>
            <input
              id={`${idPrefix}-telegram-chat-id`}
              name="telegramChatId"
              type="text"
              defaultValue={channel?.telegramChatId ?? ""}
              placeholder="-1001234567890"
            />
          </div>
        </div>
      ) : null}

      {!channel || channel.channel === "webhook" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`${idPrefix}-webhook-url`}
              className="mb-1.5 block text-xs font-medium text-slate-600"
            >
              Webhook HTTPS endpoint URL{" "}
              {isEditing ? "" : "(required for Webhook)"}
            </label>
            <input
              id={`${idPrefix}-webhook-url`}
              name="webhookUrl"
              type="url"
              defaultValue={channel?.webhookUrl ?? ""}
              placeholder="https://api.example.com/webhooks/morrow"
            />
          </div>

          <div>
            <label
              htmlFor={`${idPrefix}-webhook-secret`}
              className="mb-1.5 block text-xs font-medium text-slate-600"
            >
              Webhook HMAC signing secret{" "}
              {isEditing
                ? "(leave blank to keep existing secret)"
                : "(required for Webhook)"}
            </label>
            <input
              id={`${idPrefix}-webhook-secret`}
              name="webhookSecret"
              type="password"
              autoComplete="off"
              placeholder="whsec_..."
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default async function NotificationsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const settings = await getWorkspaceNotificationSettings(
    env.DB,
    session.user.id,
  );

  const {
    workspace,
    competitors,
    emailPreferences,
    externalChannels,
    deliveryMetrics,
  } = settings;
  const entitlements = await getWorkspaceEntitlements(
    env.DB,
    workspace.id,
  );
  const allowedDigestPeriodSet = new Set<string>(
    entitlements.features.allowedDigestPeriods,
  );
  const canManageExternalChannels =
    workspace.canManageExternalChannels;

  const activeExternalChannels = externalChannels.filter(
    (channel) => channel.status === "active",
  ).length;

  const totalDeliveredCount =
    deliveryMetrics.emailChangeSentCount +
    deliveryMetrics.emailDigestSentCount +
    deliveryMetrics.externalSentCount;

  const selectedEmailDigestPeriods = new Set(
    emailPreferences.digestPeriods,
  );

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
              Delivery &amp; alerts
            </div>

            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
              Notifications &amp; routing
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500 sm:text-[15px]">
              Choose which change categories, competitors, significance levels, and digest schedules trigger alerts across email, Slack, Telegram, and custom webhooks.
            </p>
          </div>

          {canManageExternalChannels ? (
          <WorkspacePanel
            label="Add delivery channel"
            title="Add delivery channel"
          >
            <div>
              <p className="text-sm leading-6 text-slate-500">
                Connect a Slack incoming webhook, Telegram bot chat, or HMAC-signed HTTPS webhook and configure its routing rules.
              </p>

              <WorkspaceActionForm
                action={createExternalChannel}
                successMessage="Delivery channel added."
                className="mt-5 grid gap-5"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="new-channel-name"
                      className="mb-1.5 block text-xs font-medium text-slate-600"
                    >
                      Channel name
                    </label>
                    <input
                      id="new-channel-name"
                      name="name"
                      type="text"
                      required
                      maxLength={120}
                      placeholder="#competitive-intel"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="new-channel-type"
                      className="mb-1.5 block text-xs font-medium text-slate-600"
                    >
                      Integration type
                    </label>
                    <select
                      id="new-channel-type"
                      name="channel"
                      defaultValue="slack"
                    >
                      <option value="slack">
                        Slack incoming webhook
                      </option>
                      <option value="telegram">
                        Telegram bot chat
                      </option>
                      <option value="webhook">
                        Custom HTTPS webhook (HMAC-SHA256)
                      </option>
                    </select>
                  </div>
                </div>

                <ChannelDestinationFields idPrefix="new-channel" />

                <div>
                  <div className="mb-1.5 text-xs font-medium text-slate-600">
                    Delivery triggers
                  </div>
                  <div className="workspace-choice-grid">
                    <label className="workspace-choice-option">
                      <input
                        type="checkbox"
                        name="sendChanges"
                        value="1"
                        defaultChecked
                      />
                      <span>
                        <strong className="block text-sm font-medium text-slate-900">
                          Instant change alerts
                        </strong>
                        <span className="block text-xs text-slate-500">
                          Deliver immediately when a monitored page records a matching change
                        </span>
                      </span>
                    </label>

                    <label className="workspace-choice-option">
                      <input
                        type="checkbox"
                        name="sendDigests"
                        value="1"
                        defaultChecked={
                          entitlements.features
                            .scheduledDigests
                        }
                        disabled={
                          !entitlements.features
                            .scheduledDigests
                        }
                      />
                      <span>
                        <strong className="block text-sm font-medium text-slate-900">
                          Scheduled digests
                        </strong>
                        <span className="block text-xs text-slate-500">
                          {entitlements.features
                            .scheduledDigests
                            ? "Deliver scheduled rollups scoped to this channel’s filters"
                            : "Requires Personal plan or higher"}
                        </span>
                      </span>
                    </label>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-xs font-medium text-slate-600">
                    Digest schedules
                  </div>
                  <div className="workspace-choice-grid">
                    {NOTIFICATION_DIGEST_PERIODS.map(
                      (period) => {
                        const isAllowed =
                          allowedDigestPeriodSet.has(period);
                        return (
                          <label
                            key={period}
                            className="workspace-choice-option"
                          >
                            <input
                              type="checkbox"
                              name="digestPeriods"
                              value={period}
                              defaultChecked={isAllowed}
                              disabled={!isAllowed}
                            />
                            <span className="text-sm font-medium text-slate-900">
                              {DIGEST_PERIOD_LABELS[period]}
                              {!isAllowed
                                ? " (Starter+ plans)"
                                : ""}
                            </span>
                          </label>
                        );
                      },
                    )}
                  </div>
                </div>

                <RoutingFilterFields
                  idPrefix="new-channel"
                  minSignificance="minor"
                  selectedCategories={[]}
                  selectedCompetitorIds={[]}
                  competitors={competitors}
                />

                <div>
                  <button
                    type="submit"
                    className="workspace-primary"
                  >
                    Create channel
                  </button>
                </div>
              </WorkspaceActionForm>
            </div>
          </WorkspacePanel>
          ) : null}
        </header>

        <section className="workspace-metrics mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="workspace-metric-label">
              Email routing
            </div>
            <div className="workspace-metric-value">
              {emailPreferences.emailEnabled ||
              emailPreferences.digestEmailEnabled
                ? "Active"
                : "Muted"}
            </div>
            <div className="workspace-meta">
              {emailPreferences.emailEnabled
                ? "Instant alerts on"
                : "Instant alerts off"}{" "}
              •{" "}
              {emailPreferences.digestEmailEnabled
                ? "Digests on"
                : "Digests off"}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="workspace-metric-label">
              External channels
            </div>
            <div className="workspace-metric-value">
              {externalChannels.length} /{" "}
              {
                entitlements.limits
                  .externalChannelsPerWorkspace
              }
            </div>
            <div className="workspace-meta">
              {activeExternalChannels} active ({entitlements.planName} plan)
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="workspace-metric-label">
              Notifications sent
            </div>
            <div className="workspace-metric-value">
              {totalDeliveredCount}
            </div>
            <div className="workspace-meta">
              {deliveryMetrics.emailChangeSentCount +
                deliveryMetrics.emailDigestSentCount}{" "}
              email • {deliveryMetrics.externalSentCount}{" "}
              external
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="workspace-metric-label">
              Channel failures
            </div>
            <div
              className={
                deliveryMetrics.externalFailedCount > 0
                  ? "workspace-metric-value text-red-700"
                  : "workspace-metric-value"
              }
            >
              {deliveryMetrics.externalFailedCount}
            </div>
            <div className="workspace-meta">
              retried automatically on next run
            </div>
          </article>
        </section>

        <section className="mt-10">
          <div className="workspace-surface">
            <div className="workspace-section-heading">
              <div>
                <h2>Personal email preferences</h2>
                <p className="workspace-section-helper">
                  Control which detected changes and scheduled digests are sent to{" "}
                  <strong>{session.user.email}</strong>.
                </p>
              </div>
            </div>

            {!session.user.emailVerified ? (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Your account email is not verified yet. You can save your routing preferences now, and Morrow will begin sending emails as soon as you verify your address from the Account menu.
              </p>
            ) : null}

            <WorkspaceActionForm
              action={updateEmailNotificationPreferences}
              successMessage="Email notification preferences saved."
              className="mt-5 grid gap-5"
            >
              <div>
                <div className="mb-1.5 text-xs font-medium text-slate-600">
                  Email delivery triggers
                </div>
                <div className="workspace-choice-grid">
                  <label className="workspace-choice-option">
                    <input
                      type="checkbox"
                      name="emailEnabled"
                      value="1"
                      defaultChecked={
                        emailPreferences.emailEnabled
                      }
                    />
                    <span>
                      <strong className="block text-sm font-medium text-slate-900">
                        Instant change alert emails
                      </strong>
                      <span className="block text-xs text-slate-500">
                        Email me immediately when a monitored page records a change that matches my filters
                      </span>
                    </span>
                  </label>

                  <label className="workspace-choice-option">
                    <input
                      type="checkbox"
                      name="digestEmailEnabled"
                      value="1"
                      defaultChecked={
                        emailPreferences.digestEmailEnabled &&
                        entitlements.features
                          .scheduledDigests
                      }
                      disabled={
                        !entitlements.features
                          .scheduledDigests
                      }
                    />
                    <span>
                      <strong className="block text-sm font-medium text-slate-900">
                        Scheduled digest emails
                      </strong>
                      <span className="block text-xs text-slate-500">
                        {entitlements.features
                          .scheduledDigests
                          ? "Email me a curated rollup when a scheduled digest includes matching changes"
                          : "Scheduled digests require Personal plan or higher"}
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-medium text-slate-600">
                  Digest email schedules
                </div>
                <div className="workspace-choice-grid">
                  {NOTIFICATION_DIGEST_PERIODS.map(
                    (period) => {
                      const isAllowed =
                        allowedDigestPeriodSet.has(period);
                      return (
                        <label
                          key={period}
                          className="workspace-choice-option"
                        >
                          <input
                            type="checkbox"
                            name="digestPeriods"
                            value={period}
                            defaultChecked={
                              isAllowed &&
                              selectedEmailDigestPeriods.has(
                                period,
                              )
                            }
                            disabled={!isAllowed}
                          />
                          <span className="text-sm font-medium text-slate-900">
                            {DIGEST_PERIOD_LABELS[period]}
                            {!isAllowed
                              ? entitlements.features
                                  .scheduledDigests
                                ? " (Starter+ plans)"
                                : " (Personal+ plans)"
                              : ""}
                          </span>
                        </label>
                      );
                    },
                  )}
                </div>
                {!entitlements.features.scheduledDigests ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Your workspace is on the{" "}
                    <strong>{entitlements.planName}</strong>{" "}
                    plan (instant email alerts included).{" "}
                    <Link
                      href="/dashboard/billing"
                      className="font-medium text-indigo-600"
                    >
                      Upgrade in Billing
                    </Link>{" "}
                    to enable scheduled digest rollups.
                  </p>
                ) : null}
              </div>

              <RoutingFilterFields
                idPrefix="email-prefs"
                minSignificance={
                  emailPreferences.minSignificance
                }
                selectedCategories={
                  emailPreferences.categories
                }
                selectedCompetitorIds={
                  emailPreferences.competitorIds
                }
                competitors={competitors}
              />

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4">
                <span className="text-xs text-slate-500">
                  {emailPreferences.updatedAt
                    ? `Last updated ${formatDateTime(
                        emailPreferences.updatedAt,
                      )}`
                    : "Using default workspace email preferences"}
                </span>

                <button
                  type="submit"
                  className="workspace-primary"
                >
                  Save email preferences
                </button>
              </div>
            </WorkspaceActionForm>
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.02em] text-slate-950">
                Workspace delivery channels
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                Route instant change alerts and scheduled digests to Slack channels, Telegram chats, or signed HTTPS webhooks with per-channel filters.
              </p>
            </div>

            <div className="text-sm font-medium text-slate-500">
              {externalChannels.length} /{" "}
              {
                entitlements.limits
                  .externalChannelsPerWorkspace
              }{" "}
              channels ({entitlements.planName} plan)
            </div>
          </div>

          {externalChannels.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
              <h3 className="text-base font-semibold text-slate-900">
                No external delivery channels configured
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                {canManageExternalChannels
                  ? "Use “Add delivery channel” above to connect Slack, Telegram, or a custom HTTPS webhook to this workspace."
                  : "Workspace owners and admins can connect Slack, Telegram, or custom HTTPS webhooks to this workspace."}
              </p>
            </div>
          ) : (
            <div className="workspace-list space-y-4">
              {externalChannels.map((channel) => {
                const selectedDigestPeriodSet = new Set(
                  channel.digestPeriods,
                );

                return (
                  <article
                    key={channel.id}
                    className="workspace-competitor-record overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-slate-950">
                            {channel.name}
                          </h3>

                          <span className="workspace-badge">
                            {
                              CHANNEL_TYPE_LABELS[
                                channel.channel
                              ]
                            }
                          </span>

                          <span
                            className={`workspace-badge ${
                              channel.status === "active"
                                ? "health-healthy"
                                : "health-paused"
                            }`}
                          >
                            {channel.status === "active"
                              ? "Active"
                              : "Paused"}
                          </span>
                        </div>

                        <div className="workspace-url">
                          {channel.configSummary}
                        </div>

                        <dl className="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                          <div>
                            <dt className="text-slate-400">
                              Triggers
                            </dt>
                            <dd className="mt-0.5 font-medium text-slate-900">
                              {formatTriggerSummary(
                                channel,
                              )}
                            </dd>
                          </div>

                          <div>
                            <dt className="text-slate-400">
                              Significance threshold
                            </dt>
                            <dd className="mt-0.5 font-medium text-slate-900">
                              {
                                SIGNIFICANCE_LABELS[
                                  channel.minSignificance
                                ]
                              }
                            </dd>
                          </div>

                          <div>
                            <dt className="text-slate-400">
                              Categories
                            </dt>
                            <dd className="mt-0.5 font-medium text-slate-900">
                              {formatCategorySummary(
                                channel.categories,
                              )}
                            </dd>
                          </div>

                          <div>
                            <dt className="text-slate-400">
                              Competitors
                            </dt>
                            <dd className="mt-0.5 font-medium text-slate-900">
                              {formatCompetitorSummary(
                                channel.competitorIds,
                                competitors,
                              )}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <div className="text-xs text-slate-400">
                            Delivered
                          </div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {channel.sentCount}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs text-slate-400">
                            Failed
                          </div>
                          <div
                            className={`mt-1 text-sm font-semibold ${
                              channel.failedCount > 0
                                ? "text-red-700"
                                : "text-slate-900"
                            }`}
                          >
                            {channel.failedCount}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs text-slate-400">
                            Last delivered
                          </div>
                          <div className="mt-1 text-xs font-medium text-slate-700">
                            {formatDateTime(
                              channel.lastDeliveredAt,
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {canManageExternalChannels ? (
                    <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-6">
                      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                        <div className="workspace-record-actions">
                          <WorkspaceActionForm
                            action={
                              toggleExternalChannelStatus
                            }
                            successMessage="Channel status updated."
                          >
                            <input
                              type="hidden"
                              name="channelId"
                              value={channel.id}
                            />
                            <input
                              type="hidden"
                              name="currentStatus"
                              value={channel.status}
                            />
                            <button
                              type="submit"
                              className="workspace-panel-trigger workspace-panel-secondary"
                            >
                              {channel.status === "active"
                                ? "Pause"
                                : "Resume"}
                            </button>
                          </WorkspaceActionForm>
                        </div>

                        <WorkspacePanel
                          label="Manage"
                          title={channel.name}
                        >
                          <div className="grid gap-6">
                            <WorkspaceActionForm
                              action={updateExternalChannel}
                              successMessage="Channel settings saved."
                              className="grid gap-4"
                            >
                              <input
                                type="hidden"
                                name="channelId"
                                value={channel.id}
                              />
                              <input
                                type="hidden"
                                name="channel"
                                value={channel.channel}
                              />

                              <div>
                                <label
                                  htmlFor={`edit-channel-name-${channel.id}`}
                                  className="mb-1.5 block text-xs font-medium text-slate-600"
                                >
                                  Channel name
                                </label>
                                <input
                                  id={`edit-channel-name-${channel.id}`}
                                  name="name"
                                  type="text"
                                  required
                                  maxLength={120}
                                  defaultValue={
                                    channel.name
                                  }
                                />
                              </div>

                              <ChannelDestinationFields
                                idPrefix={`edit-channel-${channel.id}`}
                                channel={channel}
                              />

                              <div>
                                <div className="mb-1.5 text-xs font-medium text-slate-600">
                                  Delivery triggers
                                </div>
                                <div className="workspace-choice-grid">
                                  <label className="workspace-choice-option">
                                    <input
                                      type="checkbox"
                                      name="sendChanges"
                                      value="1"
                                      defaultChecked={
                                        channel.sendChanges
                                      }
                                    />
                                    <span>
                                      <strong className="block text-sm font-medium text-slate-900">
                                        Instant change alerts
                                      </strong>
                                    </span>
                                  </label>

                                  <label className="workspace-choice-option">
                                    <input
                                      type="checkbox"
                                      name="sendDigests"
                                      value="1"
                                      defaultChecked={
                                        channel.sendDigests
                                      }
                                    />
                                    <span>
                                      <strong className="block text-sm font-medium text-slate-900">
                                        Scheduled digests
                                      </strong>
                                    </span>
                                  </label>
                                </div>
                              </div>

                              <div>
                                <div className="mb-1.5 text-xs font-medium text-slate-600">
                                  Digest schedules
                                </div>
                                <div className="workspace-choice-grid">
                                  {NOTIFICATION_DIGEST_PERIODS.map(
                                    (period) => (
                                      <label
                                        key={period}
                                        className="workspace-choice-option"
                                      >
                                        <input
                                          type="checkbox"
                                          name="digestPeriods"
                                          value={period}
                                          defaultChecked={selectedDigestPeriodSet.has(
                                            period,
                                          )}
                                        />
                                        <span className="text-sm font-medium text-slate-900">
                                          {
                                            DIGEST_PERIOD_LABELS[
                                              period
                                            ]
                                          }
                                        </span>
                                      </label>
                                    ),
                                  )}
                                </div>
                              </div>

                              <RoutingFilterFields
                                idPrefix={`edit-channel-${channel.id}`}
                                minSignificance={
                                  channel.minSignificance
                                }
                                selectedCategories={
                                  channel.categories
                                }
                                selectedCompetitorIds={
                                  channel.competitorIds
                                }
                                competitors={competitors}
                              />

                              <div>
                                <button
                                  type="submit"
                                  className="workspace-primary"
                                >
                                  Save channel
                                </button>
                              </div>
                            </WorkspaceActionForm>

                            <div className="workspace-destructive border-t border-slate-200 pt-5">
                              <div className="text-sm font-semibold text-red-700">
                                Remove channel
                              </div>
                              <p className="mt-2 text-xs leading-5 text-slate-500">
                                This permanently removes the delivery channel and its delivery ledger entries from this workspace.
                              </p>

                              <WorkspaceActionForm
                                action={
                                  removeExternalChannel
                                }
                                successMessage="Channel removed."
                                className="mt-4"
                              >
                                <input
                                  type="hidden"
                                  name="channelId"
                                  value={channel.id}
                                />
                                <button
                                  type="submit"
                                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50"
                                >
                                  Remove channel
                                </button>
                              </WorkspaceActionForm>
                            </div>
                          </div>
                        </WorkspacePanel>
                      </div>
                    </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
