import { auth } from "@/lib/auth";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import {
  createMonitoredPage,
  removeMonitoredPage,
  toggleMonitoredPageStatus,
  updateMonitoredPage,
  updateMonitoredPageFrequency,
} from "./actions";

interface Competitor {
  id: string;
  name: string;
  domain: string;
  favicon_url: string | null;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface MonitoredPage {
  id: string;
  url: string;
  label: string | null;
  frequency_minutes: number;
  status: string;
  last_checked_at: string | null;
  next_check_at: string | null;
  latest_http_status: number | null;
  latest_captured_at: string | null;
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

function PulseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path
        d="M3 12h4l2-5 4 10 2-5h6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path
        d="M10 4v12M4 10h12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
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
          competitors.name,
          competitors.domain,
          competitors.favicon_url,
          competitors.description,
          competitors.status,
          competitors.created_at,
          competitors.updated_at

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
          <a
            href="/dashboard/competitors"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg pr-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25 motion-reduce:transition-none"
          >
            <ArrowLeftIcon />

            <span>
              Competitors
            </span>
          </a>
        </nav>

        <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-8 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:px-9 lg:py-9">
            <div className="min-w-0">
              <div className="flex items-start gap-4 sm:gap-5">
                <div className="relative shrink-0">
                  {competitor.favicon_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={
                        competitor.favicon_url
                      }
                      alt=""
                      width={64}
                      height={64}
                      className="h-14 w-14 rounded-2xl border border-slate-200 bg-white object-contain p-2 sm:h-16 sm:w-16"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-xl font-semibold text-slate-700 sm:h-16 sm:w-16">
                      {competitor.name
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}

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
                      `Tracking ${
                        metrics.monitoredPages ===
                        1
                          ? "1 competitor page"
                          : `${metrics.monitoredPages} competitor pages`
                      } for meaningful pricing, product, positioning, policy, and content changes.`}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-indigo-600">
                    <PulseIcon />

                    <span className="text-xs font-semibold uppercase tracking-[0.12em]">
                      Live monitoring
                    </span>
                  </div>

                  <div className="mt-2 text-base font-semibold text-slate-950">
                    {competitor.status ===
                    "active"
                      ? "Watching for changes"
                      : "Monitoring paused"}
                  </div>
                </div>

                <span
                  className={
                    competitor.status ===
                    "active"
                      ? "mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500"
                      : "mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400"
                  }
                />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-indigo-100 pt-4">
                <div>
                  <div className="text-xs text-slate-500">
                    Active pages
                  </div>

                  <div className="mt-1 text-xl font-semibold text-slate-950">
                    {metrics.activePages}
                    <span className="ml-1 text-sm font-normal text-slate-400">
                      / {metrics.monitoredPages}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-500">
                    Healthy pages
                  </div>

                  <div className="mt-1 text-xl font-semibold text-slate-950">
                    {healthyPages}
                    <span className="ml-1 text-sm font-normal text-slate-400">
                      / {metrics.monitoredPages}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 border-t border-indigo-100 pt-4">
                <div className="text-xs text-slate-500">
                  Next scheduled check
                </div>

                <div className="mt-1 text-sm font-medium text-slate-800">
                  {nextScheduledPage
                    ? formatDateTime(
                        nextScheduledPage.next_check_at
                      )
                    : "Not scheduled"}
                </div>
              </div>
            </div>
          </div>

          <div className="grid border-t border-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            <div className="border-b border-slate-200 px-5 py-5 sm:border-r sm:px-7 lg:border-b-0">
              <div className="text-xs font-medium text-slate-500">
                Detected changes
              </div>

              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight text-slate-950">
                  {metrics.changes}
                </span>

                <span className="text-xs text-slate-400">
                  meaningful
                </span>
              </div>
            </div>

            <div className="border-b border-slate-200 px-5 py-5 sm:px-7 lg:border-b-0 lg:border-r">
              <div className="text-xs font-medium text-slate-500">
                Major changes
              </div>

              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight text-slate-950">
                  {metrics.majorChanges}
                </span>

                <span className="text-xs font-medium text-red-600">
                  high impact
                </span>
              </div>
            </div>

            <div className="border-b border-slate-200 px-5 py-5 sm:border-b-0 sm:border-r sm:px-7">
              <div className="text-xs font-medium text-slate-500">
                Last checked
              </div>

              <div className="mt-2 text-sm font-semibold leading-6 text-slate-900">
                {formatDateTime(
                  metrics.latestCheckedAt
                )}
              </div>
            </div>

            <div className="px-5 py-5 sm:px-7">
              <div className="text-xs font-medium text-slate-500">
                Latest change
              </div>

              <div className="mt-2 text-sm font-semibold leading-6 text-slate-900">
                {formatDateTime(
                  metrics.latestChangeAt
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="grid gap-8 py-8 sm:py-10 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-10">
          <section className="min-w-0">
            <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                  Intelligence
                </div>

                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-slate-950">
                  Recent activity
                </h2>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  Important changes detected
                  across this competitor&apos;s
                  monitored pages.
                </p>
              </div>

              <div className="text-xs text-slate-400">
                Latest {recentChanges.length}
              </div>
            </div>

            {recentChanges.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 shadow-sm sm:px-6">
                <h3 className="text-base font-semibold text-slate-900">
                  No meaningful changes yet
                </h3>

                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                  Morrow will surface
                  classified competitor
                  changes here once a monitored
                  page changes in a meaningful
                  way.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
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

                        <h3 className="mt-5 max-w-3xl text-lg font-semibold leading-7 tracking-[-0.01em] text-slate-950">
                          {change.summary ||
                            "A meaningful competitor change was detected."}
                        </h3>

                        {change.why_it_matters ? (
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
                        ) : null}

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
                                View change evidence
                              </span>

                              <ChevronIcon />
                            </summary>

                            <div className="mt-3 grid overflow-hidden rounded-xl border border-slate-200 md:grid-cols-2">
                              <div className="bg-red-50/50 p-4 sm:p-5">
                                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-red-600">
                                  Previous
                                </div>

                                <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-700">
                                  {change.previous_text ||
                                    "No previous text evidence."}
                                </pre>
                              </div>

                              <div className="border-t border-slate-200 bg-emerald-50/50 p-4 sm:p-5 md:border-l md:border-t-0">
                                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                                  Current
                                </div>

                                <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-700">
                                  {change.current_text ||
                                    "No current text evidence."}
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

          <aside className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                Monitoring health
              </div>

              <h2 className="mt-2 text-lg font-semibold text-slate-950">
                Watch status
              </h2>

              <dl className="mt-5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-sm text-slate-500">
                    Monitored pages
                  </dt>

                  <dd className="text-sm font-semibold text-slate-900">
                    {metrics.monitoredPages}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <dt className="text-sm text-slate-500">
                    Active
                  </dt>

                  <dd className="text-sm font-semibold text-emerald-700">
                    {metrics.activePages}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <dt className="text-sm text-slate-500">
                    Healthy
                  </dt>

                  <dd className="text-sm font-semibold text-emerald-700">
                    {healthyPages}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <dt className="text-sm text-slate-500">
                    Paused
                  </dt>

                  <dd className="text-sm font-semibold text-slate-700">
                    {metrics.pausedPages}
                  </dd>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <dt className="text-xs text-slate-400">
                    Latest successful capture
                  </dt>

                  <dd className="mt-1 text-sm font-medium leading-6 text-slate-800">
                    {latestCapturedPage
                      ? formatDateTime(
                          latestCapturedPage.latest_captured_at
                        )
                      : "Never"}
                  </dd>
                </div>
              </dl>
            </section>

            <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <PlusIcon />
                  </span>

                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      Add monitored page
                    </div>

                    <div className="mt-0.5 text-xs text-slate-500">
                      Expand the watch list
                    </div>
                  </div>
                </div>

                <ChevronIcon />
              </summary>

              <form
                action={createMonitoredPage}
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
              </form>
            </details>
          </aside>
        </div>

        <section className="border-t border-slate-200 pt-8 sm:pt-10">
          <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                Watch list
              </div>

              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-slate-950">
                Monitored pages
              </h2>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                URLs Morrow captures,
                compares, and evaluates for
                meaningful competitor changes.
              </p>
            </div>

            <div className="text-sm font-medium text-slate-500">
              {metrics.monitoredPages}{" "}
              {metrics.monitoredPages === 1
                ? "page"
                : "pages"}
            </div>
          </div>

          {monitoredPages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
              <div className="text-sm font-semibold text-slate-900">
                No monitored pages
              </div>

              <p className="mt-1 text-sm text-slate-500">
                Add the first competitor URL
                using the form above.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {monitoredPages.map(
                (page) => (
                  <article
                    key={page.id}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
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

                    <div className="flex flex-col justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3 sm:flex-row sm:items-center sm:px-6">
                      <div className="text-xs text-slate-500">
                        {page.latest_http_status !==
                          null &&
                        page.latest_http_status >=
                          200 &&
                        page.latest_http_status <
                          400
                          ? "Latest capture is healthy."
                          : page.latest_http_status !==
                              null
                            ? "Latest capture returned an error status."
                            : "No capture status available yet."}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <form
                          action={
                            toggleMonitoredPageStatus
                          }
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
                        </form>

                        <details className="group">
                          <summary className="inline-flex min-h-10 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25 motion-reduce:transition-none">
                            Manage

                            <ChevronIcon />
                          </summary>

                          <div className="mt-4 grid gap-6 border-t border-slate-200 pt-5 lg:grid-cols-2">
                            <form
                              action={
                                updateMonitoredPage
                              }
                              className="space-y-4"
                            >
                              <div>
                                <h4 className="text-sm font-semibold text-slate-900">
                                  Page details
                                </h4>

                                <p className="mt-1 text-xs leading-5 text-slate-500">
                                  Update the label or URL
                                  Morrow monitors.
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

                              <div>
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

                              <div>
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
                                className={
                                  subtleButtonClasses
                                }
                              >
                                Save details
                              </button>
                            </form>

                            <div className="space-y-6">
                              <form
                                action={
                                  updateMonitoredPageFrequency
                                }
                                className="space-y-4"
                              >
                                <div>
                                  <h4 className="text-sm font-semibold text-slate-900">
                                    Monitoring cadence
                                  </h4>

                                  <p className="mt-1 text-xs leading-5 text-slate-500">
                                    Choose how often this
                                    page should be checked.
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

                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <select
                                    id={`frequency-${page.id}`}
                                    name="frequencyMinutes"
                                    defaultValue={
                                      page.frequency_minutes
                                    }
                                    className={
                                      inputClasses
                                    }
                                  >
                                    <option value="60">
                                      Every hour
                                    </option>

                                    <option value="360">
                                      Every 6 hours
                                    </option>

                                    <option value="720">
                                      Every 12 hours
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
                                    className={
                                      subtleButtonClasses
                                    }
                                  >
                                    Save
                                  </button>
                                </div>
                              </form>

                              <div className="border-t border-slate-200 pt-5">
                                <h4 className="text-sm font-semibold text-red-700">
                                  Remove monitored page
                                </h4>

                                <p className="mt-1 text-xs leading-5 text-slate-500">
                                  This removes the page and
                                  its stored monitoring
                                  history.
                                </p>

                                <form
                                  action={
                                    removeMonitoredPage
                                  }
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
                                </form>
                              </div>
                            </div>
                          </div>
                        </details>
                      </div>
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
