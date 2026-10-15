import { CompetitorIcon } from "@/components/competitor-icon";
import { WorkspaceActionForm } from "@/components/workspace-feedback";
import { WorkspacePanel } from "@/components/workspace-panel";
import { auth } from "@/lib/auth";
import { formatFrequencyIntervalLabel } from "@/lib/billing-plans";
import { analyzeMonitoringSelectors } from "@/lib/monitoring-selectors";
import { getWorkspaceEntitlements } from "@/lib/workspace-billing";
import {
  getWorkspaceRolePermissions,
  normalizeWorkspaceRole,
} from "@/lib/workspace-roles";
import { env } from "cloudflare:workers";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  createMonitoredPage,
  removeMonitoredPage,
  toggleMonitoredPageStatus,
  updateMonitoredPage,
  updateMonitoredPageFrequency,
} from "./actions";
import {
  MonitoringScopeForm,
} from "./monitoring-scope-form";

interface Competitor {
  id: string;
  workspace_id: string;
  name: string;
  domain: string;
  favicon_url: string | null;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  role: string;
}

interface MonitoredPage {
  id: string;
  url: string;
  label: string | null;
  frequency_minutes: number;
  status: string;
  last_checked_at: string | null;
  next_check_at: string | null;
  include_selectors_json: string;
  ignore_selectors_json: string;
  latest_http_status: number | null;
  latest_captured_at: string | null;
  latest_html_object_key: string | null;
  change_count: number;
}

interface CompetitorOverview {
  monitored_page_count: number;
  active_page_count: number;
  paused_page_count: number;
  change_count: number;
  major_change_count: number;
  latest_change_at: string | null;
  latest_checked_at: string | null;
}

interface RecentChange {
  id: string;
  monitored_page_id: string;
  monitored_page_url: string;
  monitored_page_label: string | null;
  category: string;
  significance: string;
  summary: string | null;
  why_it_matters: string | null;
  previous_text: string | null;
  current_text: string | null;
  detected_at: string;
}

interface CompetitorPageProps {
  params: Promise<{
    competitorId: string;
  }>;
}

function normalizeDatabaseTimestamp(value: string) {
  if (
    value.endsWith("Z") ||
    /[+-]\d{2}:\d{2}$/.test(value)
  ) {
    return value;
  }

  return `${value.replace(" ", "T")}Z`;
}

function toTimestamp(value: string | null) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = new Date(
    normalizeDatabaseTimestamp(value)
  ).getTime();

  return Number.isNaN(timestamp)
    ? Number.POSITIVE_INFINITY
    : timestamp;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Never";
  }

  const date = new Date(
    normalizeDatabaseTimestamp(value)
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

function formatCompactDateTime(
  value: string | null
) {
  if (!value) {
    return "Never";
  }

  const date = new Date(
    normalizeDatabaseTimestamp(value)
  );

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatSelectorConfiguration(
  value: string
) {
  try {
    const parsed: unknown =
      JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return "";
    }

    return parsed
      .filter(
        (
          selector
        ): selector is string =>
          typeof selector ===
          "string"
      )
      .join("\n");
  } catch {
    return "";
  }
}

function getFrequencyLabel(
  frequencyMinutes: number
) {
  switch (frequencyMinutes) {
    case 60:
      return "Hourly";

    case 360:
      return "Every 6 hours";

    case 720:
      return "Every 12 hours";

    case 1440:
      return "Daily";

    case 10080:
      return "Weekly";

    default:
      return `Every ${frequencyMinutes} min`;
  }
}

function getStatusLabel(status: string) {
  if (status === "active") {
    return "Monitoring active";
  }

  if (status === "paused") {
    return "Monitoring paused";
  }

  return status;
}

function getSignificanceClasses(
  significance: string
) {
  switch (significance) {
    case "major":
      return "border-red-200 bg-red-50 text-red-700";

    case "moderate":
      return "border-amber-200 bg-amber-50 text-amber-700";

    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function getHttpStatusClasses(
  status: number | null
) {
  if (
    status !== null &&
    status >= 200 &&
    status < 400
  ) {
    return "text-emerald-700";
  }

  if (status !== null) {
    return "text-red-700";
  }

  return "text-slate-500";
}

function ArrowLeftIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path
        d="M12.5 5 7.5 10l5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0"
    >
      <path
        d="M11 4h5v5M16 4l-7 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M15 11v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="h-4 w-4 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
    >
      <path
        d="m6 8 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default async function CompetitorPage({
  params,
}: CompetitorPageProps) {
  const session =
    await auth.api.getSession({
      headers: await headers(),
    });

  if (!session) {
    redirect("/login");
  }

  const { competitorId } = await params;

  const competitor =
    await env.DB.prepare(
      `
        SELECT
          competitors.id,
          competitors.workspace_id,
          competitors.name,
          competitors.domain,
          competitors.favicon_url,
          competitors.description,
          competitors.status,
          competitors.created_at,
          competitors.updated_at,
          workspace_members.role

        FROM competitors

        INNER JOIN workspace_members
          ON workspace_members.workspace_id =
             competitors.workspace_id

        WHERE competitors.id = ?
          AND workspace_members.user_id = ?

        LIMIT 1
      `
    )
      .bind(
        competitorId,
        session.user.id
      )
      .first<Competitor>();

  if (!competitor) {
    notFound();
  }

  const entitlements =
    await getWorkspaceEntitlements(
      env.DB,
      competitor.workspace_id
    );

  const permissions =
    getWorkspaceRolePermissions(
      normalizeWorkspaceRole(
        competitor.role,
        "viewer"
      )
    );

  const overview =
    await env.DB.prepare(
      `
        SELECT
          COUNT(
            DISTINCT monitored_pages.id
          ) AS monitored_page_count,

          COUNT(
            DISTINCT CASE
              WHEN monitored_pages.status = 'active'
              THEN monitored_pages.id
            END
          ) AS active_page_count,

          COUNT(
            DISTINCT CASE
              WHEN monitored_pages.status = 'paused'
              THEN monitored_pages.id
            END
          ) AS paused_page_count,

          COUNT(
            DISTINCT changes.id
          ) AS change_count,

          COUNT(
            DISTINCT CASE
              WHEN changes.significance = 'major'
              THEN changes.id
            END
          ) AS major_change_count,

          MAX(
            changes.detected_at
          ) AS latest_change_at,

          MAX(
            monitored_pages.last_checked_at
          ) AS latest_checked_at

        FROM monitored_pages

        LEFT JOIN changes
          ON changes.monitored_page_id =
             monitored_pages.id

        WHERE monitored_pages.competitor_id = ?
      `
    )
      .bind(competitor.id)
      .first<CompetitorOverview>();

  const {
    results: monitoredPages,
  } = await env.DB.prepare(
    `
      SELECT
        monitored_pages.id,
        monitored_pages.url,
        monitored_pages.label,
        monitored_pages.frequency_minutes,
        monitored_pages.status,
        monitored_pages.last_checked_at,
        monitored_pages.next_check_at,
        monitored_pages.include_selectors_json,
        monitored_pages.ignore_selectors_json,

        (
          SELECT snapshots.http_status

          FROM snapshots

          WHERE snapshots.monitored_page_id =
                monitored_pages.id

          ORDER BY
            datetime(
              snapshots.captured_at
            ) DESC

          LIMIT 1
        ) AS latest_http_status,

        (
          SELECT snapshots.captured_at

          FROM snapshots

          WHERE snapshots.monitored_page_id =
                monitored_pages.id

          ORDER BY
            datetime(
              snapshots.captured_at
            ) DESC

          LIMIT 1
        ) AS latest_captured_at,

        (
          SELECT snapshots.html_object_key

          FROM snapshots

          WHERE snapshots.monitored_page_id =
                monitored_pages.id
            AND snapshots.html_object_key IS NOT NULL

          ORDER BY
            datetime(
              snapshots.captured_at
            ) DESC

          LIMIT 1
        ) AS latest_html_object_key,

        (
          SELECT COUNT(*)

          FROM changes

          WHERE changes.monitored_page_id =
                monitored_pages.id
        ) AS change_count

      FROM monitored_pages

      WHERE monitored_pages.competitor_id = ?

      ORDER BY
        monitored_pages.created_at DESC
    `
  )
    .bind(competitor.id)
    .all<MonitoredPage>();

  const missingSelectorsByPageId =
    new Map<string, string[]>();

  if (
    entitlements.features
      .sectionLevelMonitoring
  ) {
    await Promise.all(
      monitoredPages.map(
        async (page) => {
          if (
            !page.latest_html_object_key
          ) {
            return;
          }

          const configuredSelectors =
            formatSelectorConfiguration(
              page.include_selectors_json
            )
              .split(/\r?\n/)
              .map((line) =>
                line.trim()
              )
              .filter(Boolean);

          if (
            configuredSelectors.length ===
            0
          ) {
            return;
          }

          try {
            const snapshotObject =
              await env.morrow_snapshots.get(
                page.latest_html_object_key
              );

            if (!snapshotObject) {
              return;
            }

            const html =
              await snapshotObject.text();

            const analysis =
              analyzeMonitoringSelectors(
                html,
                configuredSelectors,
                []
              );

            const missing =
              analysis.includeMatches
                .filter(
                  (match) =>
                    match.status ===
                      "unmatched" ||
                    match.status ===
                      "invalid"
                )
                .map(
                  (match) =>
                    match.selector
                );

            if (
              missing.length > 0
            ) {
              missingSelectorsByPageId.set(
                page.id,
                missing
              );
            }
          } catch {
            // Non-blocking UI inspection.
          }
        }
      )
    );
  }

  const {
    results: recentChanges,
  } = await env.DB.prepare(
    `
      SELECT
        changes.id,
        changes.category,
        changes.significance,
        changes.summary,
        changes.why_it_matters,
        changes.previous_text,
        changes.current_text,
        changes.detected_at,

        monitored_pages.id
          AS monitored_page_id,

        monitored_pages.url
          AS monitored_page_url,

        monitored_pages.label
          AS monitored_page_label

      FROM changes

      INNER JOIN monitored_pages
        ON monitored_pages.id =
           changes.monitored_page_id

      WHERE monitored_pages.competitor_id = ?

      ORDER BY
        datetime(
          changes.detected_at
        ) DESC

      LIMIT 10
    `
  )
    .bind(competitor.id)
    .all<RecentChange>();

  const metrics = {
    monitoredPages: Number(
      overview?.monitored_page_count ?? 0
    ),

    activePages: Number(
      overview?.active_page_count ?? 0
    ),

    pausedPages: Number(
      overview?.paused_page_count ?? 0
    ),

    changes: Number(
      overview?.change_count ?? 0
    ),

    majorChanges: Number(
      overview?.major_change_count ?? 0
    ),

    latestChangeAt:
      overview?.latest_change_at ?? null,

    latestCheckedAt:
      overview?.latest_checked_at ?? null,
  };

  const nextScheduledPage =
    [...monitoredPages]
      .filter(
        (page) =>
          page.status === "active" &&
          Boolean(page.next_check_at)
      )
      .sort(
        (left, right) =>
          toTimestamp(left.next_check_at) -
          toTimestamp(right.next_check_at)
      )[0] ?? null;

  const healthyPages =
    monitoredPages.filter(
      (page) =>
        page.latest_http_status !== null &&
        page.latest_http_status >= 200 &&
        page.latest_http_status < 400
    ).length;

  const latestCapturedPage =
    [...monitoredPages]
      .filter(
        (page) =>
          Boolean(page.latest_captured_at)
      )
      .sort(
        (left, right) =>
          toTimestamp(
            right.latest_captured_at
          ) -
          toTimestamp(
            left.latest_captured_at
          )
      )[0] ?? null;

  const inputClasses = [
    "w-full",
    "rounded-xl",
    "border",
    "border-slate-200",
    "bg-white",
    "px-3.5",
    "py-2.5",
    "text-sm",
    "text-slate-950",
    "outline-none",
    "transition-colors",
    "duration-150",
    "placeholder:text-slate-400",
    "focus-visible:border-indigo-400",
    "focus-visible:ring-2",
    "focus-visible:ring-indigo-500/15",
    "motion-reduce:transition-none",
  ].join(" ");

  const subtleButtonClasses = [
    "inline-flex",
    "min-h-10",
    "items-center",
    "justify-center",
    "rounded-xl",
    "border",
    "border-slate-200",
    "bg-white",
    "px-3.5",
    "py-2",
    "text-sm",
    "font-medium",
    "text-slate-700",
    "transition-colors",
    "duration-150",
    "hover:border-slate-300",
    "hover:bg-slate-50",
    "focus-visible:outline-none",
    "focus-visible:ring-2",
    "focus-visible:ring-indigo-500/25",
    "motion-reduce:transition-none",
  ].join(" ");

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <nav className="mb-6 sm:mb-8">
          <Link
            href="/dashboard/competitors"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg pr-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25 motion-reduce:transition-none"
          >
            <ArrowLeftIcon />

            <span>
              Competitors
            </span>
          </Link>
        </nav>

        <header className="workspace-profile-heading overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div><div className="min-w-0">
              <div className="flex items-start gap-4 sm:gap-5">
                <div className="relative shrink-0">
                  <CompetitorIcon name={competitor.name} src={competitor.favicon_url} variant="profile" />

                  {competitor.status ===
                  "active" ? (
                    <span
                      className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-[3px] border-white bg-emerald-500"
                      aria-label="Monitoring active"
                    />
                  ) : null}
                </div>

                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold uppercase tracking-[0.14em] text-indigo-600">
                      Competitor
                    </span>

                    <span className="text-slate-300">
                      /
                    </span>

                    <span className="text-slate-500">
                      Added{" "}
                      {formatCompactDateTime(
                        competitor.created_at
                      )}
                    </span>
                  </div>

                  <h1 className="break-words text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
                    {competitor.name}
                  </h1>

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <a
                      href={`https://${competitor.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25 motion-reduce:transition-none"
                    >
                      <span className="truncate">
                        {competitor.domain}
                      </span>

                      <ExternalLinkIcon />
                    </a>

                    <span
                      className={
                        competitor.status ===
                        "active"
                          ? "inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                          : "inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                      }
                    >
                      {competitor.status ===
                      "active" ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      ) : null}

                      {getStatusLabel(
                        competitor.status
                      )}
                    </span>
                  </div>

                  <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-600 sm:text-[15px]">
                    {competitor.description ||
                      `Monitoring ${
                        metrics.monitoredPages === 1
                          ? "1 page"
                          : `${metrics.monitoredPages} pages`
                      } for changes.`}
                  </p>
                </div>
              </div>
            </div></div><dl className="workspace-profile-overview">
    <div><dt>Monitoring status</dt><dd>{competitor.status === "active" ? "Monitoring active" : "Monitoring paused"}</dd></div>
    <div><dt>Active pages</dt><dd>{metrics.activePages} / {metrics.monitoredPages}</dd></div>
    <div><dt>Healthy pages</dt><dd>{healthyPages} / {metrics.monitoredPages}</dd></div>
    <div><dt>Next scheduled check</dt><dd>{nextScheduledPage ? formatDateTime(nextScheduledPage.next_check_at) : "Not scheduled"}</dd></div>
    <div><dt>Detected changes</dt><dd>{metrics.changes}<span className="workspace-meta"> recorded</span></dd></div>
    <div><dt>Major changes</dt><dd>{metrics.majorChanges}<span className="workspace-meta"> recorded as major</span></dd></div>
    <div><dt>Last checked</dt><dd>{formatDateTime(metrics.latestCheckedAt)}</dd></div>
    <div><dt>Latest change</dt><dd>{formatDateTime(metrics.latestChangeAt)}</dd></div>
    <div><dt>Monitored pages</dt><dd>{metrics.monitoredPages} / {entitlements.limits.monitoredPagesPerCompetitor}</dd></div>
    <div><dt>Paused</dt><dd>{metrics.pausedPages}</dd></div>
    <div><dt>Latest successful check</dt><dd>{latestCapturedPage ? formatDateTime(latestCapturedPage.latest_captured_at) : "Never"}</dd></div>
  </dl></header>

        <section className="workspace-profile-pages">
          <div className="workspace-section-heading">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.02em] text-slate-950">
                Monitored pages
              </h2>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                Pages Morrow checks on the schedule you set.
              </p>
            </div>
          {permissions.canEditMonitoring ? (<WorkspacePanel label="Add monitored page"><p className="text-sm text-slate-500">Enter a page URL to monitor</p><WorkspaceActionForm successMessage="Monitored page added." action={createMonitoredPage}
                className="space-y-4 border-t border-slate-100 px-5 py-5"
              >
                <input
                  type="hidden"
                  name="competitorId"
                  value={competitor.id}
                />

                <div>
                  <label
                    htmlFor="url"
                    className="mb-1.5 block text-xs font-medium text-slate-600"
                  >
                    Page URL
                  </label>

                  <input
                    id="url"
                    name="url"
                    type="text"
                    placeholder="https://stripe.com/pricing"
                    required
                    className={inputClasses}
                  />
                </div>

                <div>
                  <label
                    htmlFor="label"
                    className="mb-1.5 block text-xs font-medium text-slate-600"
                  >
                    Label
                  </label>

                  <input
                    id="label"
                    name="label"
                    type="text"
                    placeholder="Pricing"
                    className={inputClasses}
                  />
                </div>

                <button
                  type="submit"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 focus-visible:ring-offset-2 motion-reduce:transition-none"
                >
                  Add monitored page
                </button>
              </WorkspaceActionForm></WorkspacePanel>) : null}</div>

          {monitoredPages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
              <div className="text-sm font-semibold text-slate-900">
                No monitored pages
              </div>

              <p className="mt-1 text-sm text-slate-500">
                Add a page URL to start
                monitoring this competitor.
              </p>
            </div>
          ) : (
            <div className="workspace-list space-y-4">
              {monitoredPages.map(
                (page) => (
                  <article
                    key={page.id}
                    className="workspace-page-record overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(500px,1fr)] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-semibold text-slate-950">
                            {page.label ||
                              "Unlabelled page"}
                          </h3>

                          <span
                            className={
                              page.status ===
                              "active"
                                ? "inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                                : "inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                            }
                          >
                            {page.status ===
                            "active" ? (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            ) : null}

                            {page.status ===
                            "active"
                              ? "Active"
                              : "Paused"}
                          </span>
                        </div>

                        <a
                          href={page.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex max-w-full items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25 motion-reduce:transition-none"
                        >
                          <span className="truncate">
                            {page.url}
                          </span>

                          <ExternalLinkIcon />
                        </a>

                        <div className="mt-4 text-xs text-slate-400">
                          {getFrequencyLabel(
                            page.frequency_minutes
                          )}

                          {page.latest_captured_at
                            ? ` · Captured ${formatCompactDateTime(
                                page.latest_captured_at
                              )}`
                            : ""}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
                        <div>
                          <div className="text-xs text-slate-400">
                            Changes
                          </div>

                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {Number(
                              page.change_count
                            )}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs text-slate-400">
                            HTTP
                          </div>

                          <div
                            className={`mt-1 text-sm font-semibold ${getHttpStatusClasses(
                              page.latest_http_status
                            )}`}
                          >
                            {page.latest_http_status ??
                              "—"}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs text-slate-400">
                            Last checked
                          </div>

                          <div className="mt-1 text-sm font-medium leading-5 text-slate-800">
                            {formatCompactDateTime(
                              page.last_checked_at
                            )}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs text-slate-400">
                            Next check
                          </div>

                          <div className="mt-1 text-sm font-medium leading-5 text-slate-800">
                            {page.status ===
                            "active"
                              ? formatCompactDateTime(
                                  page.next_check_at
                                )
                              : "Paused"}
                          </div>
                        </div>
                      </div>
                    </div>

                    {missingSelectorsByPageId.has(
                      page.id
                    ) ? (
                      <div
                        role="alert"
                        className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-xs leading-5 text-amber-800 sm:px-6"
                      >
                        <strong>
                          Monitored section no longer found:
                        </strong>{" "}
                        {(
                          missingSelectorsByPageId.get(
                            page.id
                          ) ?? []
                        ).join(", ")}{" "}
                        was not found on the latest capture. Open{" "}
                        <strong>
                          Manage
                        </strong>{" "}
                        and scan the page again in case the section was removed or renamed.
                      </div>
                    ) : null}

                    <div className="flex flex-col justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3 sm:flex-row sm:items-center sm:px-6">
                      <div className="text-xs text-slate-500">
                        {page.latest_http_status !==
                          null &&
                        page.latest_http_status >=
                          200 &&
                        page.latest_http_status <
                          400
                          ? "Last check succeeded."
                          : page.latest_http_status !==
                              null
                            ? "Last check returned an error."
                            : "No checks have completed yet."}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/dashboard/pages/${page.id}/history`}
                          className={
                            subtleButtonClasses
                          }
                        >
                          View history
                        </Link>

                        {permissions.canEditMonitoring ? (
                        <>
                        <WorkspaceActionForm successMessage="Monitoring updated." action={toggleMonitoredPageStatus}
                        >
                          <input
                            type="hidden"
                            name="monitoredPageId"
                            value={page.id}
                          />

                          <input
                            type="hidden"
                            name="competitorId"
                            value={competitor.id}
                          />

                          <button
                            type="submit"
                            className={
                              subtleButtonClasses
                            }
                          >
                            {page.status ===
                            "active"
                              ? "Pause"
                              : "Resume"}
                          </button>
                        </WorkspaceActionForm>

                        <WorkspacePanel label="Manage" title={page.label || "Unlabelled page"}>
    <WorkspaceActionForm successMessage="Page details saved." action={updateMonitoredPage}
                              className="space-y-4"
                            >
                              <div>
                                <h4 className="text-sm font-semibold text-slate-900">
                                  Page details
                                </h4>

                                <p className="mt-1 text-xs leading-5 text-slate-500">
                                  Update this page&apos;s label or URL.
                                </p>
                              </div>

                              <input
                                type="hidden"
                                name="monitoredPageId"
                                value={page.id}
                              />

                              <input
                                type="hidden"
                                name="competitorId"
                                value={
                                  competitor.id
                                }
                              />

                              <div className="mt-4">
                                <label
                                  htmlFor={`label-${page.id}`}
                                  className="mb-1.5 block text-xs font-medium text-slate-600"
                                >
                                  Label
                                </label>

                                <input
                                  id={`label-${page.id}`}
                                  name="label"
                                  type="text"
                                  defaultValue={
                                    page.label || ""
                                  }
                                  className={
                                    inputClasses
                                  }
                                />
                              </div>

                              <div className="mt-4">
                                <label
                                  htmlFor={`url-${page.id}`}
                                  className="mb-1.5 block text-xs font-medium text-slate-600"
                                >
                                  Page URL
                                </label>

                                <input
                                  id={`url-${page.id}`}
                                  name="url"
                                  type="text"
                                  defaultValue={
                                    page.url
                                  }
                                  required
                                  className={
                                    inputClasses
                                  }
                                />
                              </div>

                              <button
                                type="submit"
                                className="workspace-primary mt-4"
                              >
                                Save details
                              </button>
                            </WorkspaceActionForm>
    <div className="workspace-panel-section"><WorkspaceActionForm successMessage="Check frequency saved." action={updateMonitoredPageFrequency}
                                className="space-y-4"
                              >
                                <div>
                                  <h4 className="text-sm font-semibold text-slate-900">
                                    Check frequency
                                  </h4>

                                  <p className="mt-1 text-xs leading-5 text-slate-500">
                                    Choose how often Morrow checks this page.
                                  </p>
                                </div>

                                <input
                                  type="hidden"
                                  name="monitoredPageId"
                                  value={page.id}
                                />

                                <input
                                  type="hidden"
                                  name="competitorId"
                                  value={
                                    competitor.id
                                  }
                                />

                                <div className="workspace-frequency mt-4">
                                  <label className="block text-center text-xs text-slate-500" htmlFor={`frequency-${page.id}`}>Check frequency</label><select
                                    id={`frequency-${page.id}`}
                                    name="frequencyMinutes"
                                    defaultValue={
                                      page.frequency_minutes
                                    }
                                    className={
                                      inputClasses
                                    }
                                  >
                                    <option
                                      value="60"
                                      disabled={
                                        !entitlements.allowedFrequencies.includes(
                                          60
                                        )
                                      }
                                    >
                                      {entitlements.allowedFrequencies.includes(
                                        60
                                      )
                                        ? "Every hour"
                                        : "Every hour (Growth & Scale plans)"}
                                    </option>

                                    <option
                                      value="360"
                                      disabled={
                                        !entitlements.allowedFrequencies.includes(
                                          360
                                        )
                                      }
                                    >
                                      {entitlements.allowedFrequencies.includes(
                                        360
                                      )
                                        ? "Every 6 hours"
                                        : "Every 6 hours (Starter+ plans)"}
                                    </option>

                                    <option
                                      value="720"
                                      disabled={
                                        !entitlements.allowedFrequencies.includes(
                                          720
                                        )
                                      }
                                    >
                                      {entitlements.allowedFrequencies.includes(
                                        720
                                      )
                                        ? "Every 12 hours"
                                        : "Every 12 hours (Personal+ plans)"}
                                    </option>

                                    <option value="1440">
                                      Every 24 hours
                                    </option>

                                    <option value="10080">
                                      Every 7 days
                                    </option>
                                  </select>

                                  <button
                                    type="submit"
                                    className="workspace-primary"
                                  >
                                    Save
                                  </button>
                                </div>
                                {!entitlements
                                  .features
                                  .hourlyMonitoring ? (
                                  <p className="mt-3 text-xs text-slate-500">
                                    Your{" "}
                                    <strong>
                                      {
                                        entitlements.planName
                                      }
                                    </strong>{" "}
                                    plan supports checks as frequent as{" "}
                                    {formatFrequencyIntervalLabel(
                                      entitlements
                                        .limits
                                        .minFrequencyMinutes
                                    ).toLowerCase()}
                                    .{" "}
                                    <Link
                                      href="/dashboard/billing"
                                      className="font-medium text-indigo-600"
                                    >
                                      Upgrade in Billing
                                    </Link>{" "}
                                    for faster monitoring.
                                  </p>
                                ) : null}
                              </WorkspaceActionForm></div>
    {entitlements.features.sectionLevelMonitoring ? (
      <MonitoringScopeForm
        monitoredPageId={page.id}
        competitorId={competitor.id}
        initialIncludeSelectors={formatSelectorConfiguration(
          page.include_selectors_json
        )}
        initialIgnoreSelectors={formatSelectorConfiguration(
          page.ignore_selectors_json
        )}
        initialMissingSelectors={
          missingSelectorsByPageId.get(
            page.id
          ) ?? []
        }
      />
    ) : (
      <div className="workspace-panel-section space-y-2">
        <h4 className="text-sm font-semibold text-slate-900">
          Monitoring scope (CSS selectors)
        </h4>
        <p className="text-xs leading-5 text-slate-500">
          Section-level CSS selector filtering is included on{" "}
          <strong>Starter</strong>, <strong>Growth</strong>, and{" "}
          <strong>Scale</strong> plans. Your workspace is currently on{" "}
          <strong>{entitlements.planName}</strong> (full-page monitoring).{" "}
          <Link
            href="/dashboard/billing"
            className="font-medium text-indigo-600"
          >
            Upgrade in Billing
          </Link>{" "}
          to target or ignore specific page sections.
        </p>
      </div>
    )}
    {permissions.canDeleteMonitoringResources ? (
    <div className="workspace-destructive">
                                <h4 className="text-sm font-semibold text-red-700">
                                  Remove monitored page
                                </h4>

                                <p className="mt-1 text-xs leading-5 text-slate-500">
                                  This permanently removes the page and its saved history.
                                </p>

                                <WorkspaceActionForm successMessage="Monitored page removed." action={removeMonitoredPage}
                                  className="mt-4"
                                >
                                  <input
                                    type="hidden"
                                    name="monitoredPageId"
                                    value={page.id}
                                  />

                                  <input
                                    type="hidden"
                                    name="competitorId"
                                    value={
                                      competitor.id
                                    }
                                  />

                                  <button
                                    type="submit"
                                    className="inline-flex min-h-10 items-center justify-center rounded-xl border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/20 motion-reduce:transition-none"
                                  >
                                    Remove page
                                  </button>
                                </WorkspaceActionForm>
                              </div>
    ) : null}
  </WorkspacePanel>
                        </>
                        ) : null}
                      </div>
                    </div>
                  </article>
                )
              )}
            </div>
          )}
        </section>

        <section className="workspace-profile-activity">
            <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                  Activity
                </div>

                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-slate-950">
                  Recent changes
                </h2>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  Changes recorded across this competitor&apos;s
                  monitored pages.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="text-xs text-slate-400">
                  Showing {recentChanges.length}
                </div>

                <Link
                  href={`/dashboard/competitors/${competitor.id}/history`}
                  className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  View full history
                </Link>
              </div>
            </div>

            {recentChanges.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 shadow-sm sm:px-6">
                <h3 className="text-base font-semibold text-slate-900">
                  No changes yet
                </h3>

                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                  Changes Morrow records will
                  appear here after a monitored
                  page changes.
                </p>
              </div>
            ) : (
              <div className="workspace-list space-y-4">
                {recentChanges.map(
                  (change) => (
                    <article
                      key={change.id}
                      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                    >
                      <div
                        className={
                          change.significance ===
                          "major"
                            ? "absolute inset-y-0 left-0 w-1 bg-red-500"
                            : change.significance ===
                                "moderate"
                              ? "absolute inset-y-0 left-0 w-1 bg-amber-500"
                              : "absolute inset-y-0 left-0 w-1 bg-indigo-500"
                        }
                      />

                      <div className="p-5 pl-6 sm:p-6 sm:pl-7">
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium capitalize text-indigo-700">
                              {change.category}
                            </span>

                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${getSignificanceClasses(
                                change.significance
                              )}`}
                            >
                              {
                                change.significance
                              }
                            </span>
                          </div>

                          <time className="shrink-0 text-xs text-slate-400">
                            {formatDateTime(
                              change.detected_at
                            )}
                          </time>
                        </div>

                        <details className="workspace-change-disclosure"><summary><h3 className="mt-5 max-w-3xl text-lg font-semibold leading-7 tracking-[-0.01em] text-slate-950">
                          {change.summary ||
                            "Change detected."}
                        </h3></summary><div className="workspace-change-description">{change.why_it_matters ? (
                          <div className="mt-5 rounded-xl bg-slate-50 px-4 py-4 sm:px-5">
                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-600">
                              Why it matters
                            </div>

                            <p className="mt-2 text-sm leading-6 text-slate-600">
                              {
                                change.why_it_matters
                              }
                            </p>
                          </div>
                        ) : null}</div></details>

                        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-4 text-xs">
                          <span className="font-medium text-slate-700">
                            {change.monitored_page_label ||
                              "Monitored page"}
                          </span>

                          <a
                            href={
                              change.monitored_page_url
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-slate-500 transition-colors hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25 motion-reduce:transition-none"
                          >
                            <span className="max-w-[240px] truncate sm:max-w-md">
                              {
                                change.monitored_page_url
                              }
                            </span>

                            <ExternalLinkIcon />
                          </a>
                        </div>

                        {change.previous_text ||
                        change.current_text ? (
                          <details className="group mt-4">
                            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25 motion-reduce:transition-none">
                              <span>
                                View before and after
                              </span>

                              <ChevronIcon />
                            </summary>

                            <div className="workspace-evidence mt-3 grid overflow-hidden rounded-xl border border-slate-200 md:grid-cols-2">
                              <div className="bg-red-50/50 p-4 sm:p-5">
                                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-red-600">
                                  Previous
                                </div>

                                <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-700">
                                  {change.previous_text ||
                                    "No previous text available."}
                                </pre>
                              </div>

                              <div className="border-t border-slate-200 bg-emerald-50/50 p-4 sm:p-5 md:border-l md:border-t-0">
                                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                                  Current
                                </div>

                                <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-700">
                                  {change.current_text ||
                                    "No current text available."}
                                </pre>
                              </div>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </article>
                  )
                )}
              </div>
            )}
          </section>
      </div>
    </main>
  );
}
