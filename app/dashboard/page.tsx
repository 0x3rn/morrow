import { SignOutButton } from "@/components/sign-out-button";
import { auth } from "@/lib/auth";
import { MORROW_MVP_USAGE_LIMITS } from "@/lib/usage-limits";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

interface DashboardOverviewRow {
  competitor_count: number;
  active_competitor_count: number;

  monitored_page_count: number;
  active_page_count: number;

  healthy_page_count: number;
  overdue_page_count: number;
  awaiting_page_count: number;
  error_page_count: number;
  paused_page_count: number;

  change_count: number;
  major_change_count: number;

  latest_checked_at: string | null;
  latest_change_at: string | null;
}

interface DashboardMonitoringRow {
  id: string;

  competitor_id: string;
  competitor_name: string;
  competitor_domain: string;

  url: string;
  label: string | null;

  frequency_minutes: number;

  page_status: string;
  competitor_status: string;

  last_checked_at: string | null;
  next_check_at: string | null;

  latest_http_status: number | null;
  latest_captured_at: string | null;

  health:
    | "healthy"
    | "overdue"
    | "awaiting_first_capture"
    | "error"
    | "paused";
}

interface DashboardRecentChange {
  id: string;

  category: string;
  significance: string;

  summary: string | null;
  why_it_matters: string | null;

  detected_at: string;

  competitor_id: string;
  competitor_name: string;

  monitored_page_url: string;
  monitored_page_label: string | null;
}

function normalizeDatabaseTimestamp(
  value: string
) {
  if (
    value.endsWith("Z") ||
    /[+-]\d{2}:\d{2}$/.test(value)
  ) {
    return value;
  }

  return `${value.replace(
    " ",
    "T"
  )}Z`;
}

function formatDateTime(
  value: string | null
) {
  if (!value) {
    return "Never";
  }

  const date =
    new Date(
      normalizeDatabaseTimestamp(
        value
      )
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return `${new Intl.DateTimeFormat(
    "en-GB",
    {
      dateStyle:
        "medium",

      timeStyle:
        "short",

      timeZone:
        "UTC",
    }
  ).format(date)} UTC`;
}

function formatCompactDateTime(
  value: string | null
) {
  if (!value) {
    return "Never";
  }

  const date =
    new Date(
      normalizeDatabaseTimestamp(
        value
      )
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      day:
        "numeric",

      month:
        "short",

      hour:
        "2-digit",

      minute:
        "2-digit",

      timeZone:
        "UTC",
    }
  ).format(date);
}

function getFrequencyLabel(
  frequencyMinutes: number
) {
  switch (
    frequencyMinutes
  ) {
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

function getHealthLabel(
  health:
    DashboardMonitoringRow["health"]
) {
  switch (health) {
    case "healthy":
      return "Healthy";

    case "overdue":
      return "Overdue";

    case "awaiting_first_capture":
      return "Awaiting first capture";

    case "error":
      return "Capture error";

    case "paused":
      return "Paused";
  }
}

function getHealthClasses(
  health:
    DashboardMonitoringRow["health"]
) {
  switch (health) {
    case "healthy":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";

    case "overdue":
      return "border-amber-200 bg-amber-50 text-amber-700";

    case "awaiting_first_capture":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";

    case "error":
      return "border-red-200 bg-red-50 text-red-700";

    case "paused":
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function getSignificanceClasses(
  significance: string
) {
  switch (
    significance
  ) {
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

  if (
    status !== null
  ) {
    return "text-red-700";
  }

  return "text-slate-400";
}

function clampPercentage(
  current: number,
  limit: number
) {
  if (
    limit <= 0
  ) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(
      0,
      Math.round(
        (
          current /
          limit
        ) * 100
      )
    )
  );
}

export default async function DashboardPage() {
  const session =
    await auth.api.getSession({
      headers:
        await headers(),
    });

  if (!session) {
    redirect(
      "/sign-in"
    );
  }

  const overview =
    await env.DB.prepare(
      `
        WITH authorized_competitors AS (
          SELECT
            competitors.id,
            competitors.status

          FROM competitors

          WHERE EXISTS (
            SELECT 1

            FROM workspace_members

            WHERE workspace_members.workspace_id =
                  competitors.workspace_id

              AND workspace_members.user_id = ?
          )
        ),

        page_state AS (
          SELECT
            monitored_pages.id,

            monitored_pages.status
              AS page_status,

            authorized_competitors.status
              AS competitor_status,

            monitored_pages.last_checked_at,
            monitored_pages.next_check_at,

            (
              SELECT
                snapshots.http_status

              FROM snapshots

              WHERE snapshots.monitored_page_id =
                    monitored_pages.id

              ORDER BY
                datetime(
                  snapshots.captured_at
                ) DESC

              LIMIT 1
            ) AS latest_http_status

          FROM monitored_pages

          INNER JOIN authorized_competitors
            ON authorized_competitors.id =
               monitored_pages.competitor_id
        ),

        page_health AS (
          SELECT
            page_state.*,

            CASE
              WHEN competitor_status <> 'active'
                OR page_status <> 'active'
                THEN 'paused'

              WHEN last_checked_at IS NULL
                THEN 'awaiting_first_capture'

              WHEN next_check_at IS NOT NULL
                AND datetime(
                  next_check_at
                ) < datetime(
                  'now'
                )
                THEN 'overdue'

              WHEN latest_http_status IS NOT NULL
                AND (
                  latest_http_status < 200
                  OR latest_http_status >= 400
                )
                THEN 'error'

              ELSE 'healthy'
            END AS health

          FROM page_state
        )

        SELECT
          (
            SELECT COUNT(*)

            FROM authorized_competitors
          ) AS competitor_count,

          (
            SELECT COUNT(*)

            FROM authorized_competitors

            WHERE status = 'active'
          ) AS active_competitor_count,

          (
            SELECT COUNT(*)

            FROM page_health
          ) AS monitored_page_count,

          (
            SELECT COUNT(*)

            FROM page_health

            WHERE competitor_status = 'active'
              AND page_status = 'active'
          ) AS active_page_count,

          (
            SELECT COUNT(*)

            FROM page_health

            WHERE health = 'healthy'
          ) AS healthy_page_count,

          (
            SELECT COUNT(*)

            FROM page_health

            WHERE health = 'overdue'
          ) AS overdue_page_count,

          (
            SELECT COUNT(*)

            FROM page_health

            WHERE health =
                  'awaiting_first_capture'
          ) AS awaiting_page_count,

          (
            SELECT COUNT(*)

            FROM page_health

            WHERE health = 'error'
          ) AS error_page_count,

          (
            SELECT COUNT(*)

            FROM page_health

            WHERE health = 'paused'
          ) AS paused_page_count,

          (
            SELECT COUNT(*)

            FROM changes

            INNER JOIN monitored_pages
              ON monitored_pages.id =
                 changes.monitored_page_id

            INNER JOIN authorized_competitors
              ON authorized_competitors.id =
                 monitored_pages.competitor_id
          ) AS change_count,

          (
            SELECT COUNT(*)

            FROM changes

            INNER JOIN monitored_pages
              ON monitored_pages.id =
                 changes.monitored_page_id

            INNER JOIN authorized_competitors
              ON authorized_competitors.id =
                 monitored_pages.competitor_id

            WHERE changes.significance =
                  'major'
          ) AS major_change_count,

          (
            SELECT MAX(
              monitored_pages.last_checked_at
            )

            FROM monitored_pages

            INNER JOIN authorized_competitors
              ON authorized_competitors.id =
                 monitored_pages.competitor_id
          ) AS latest_checked_at,

          (
            SELECT MAX(
              changes.detected_at
            )

            FROM changes

            INNER JOIN monitored_pages
              ON monitored_pages.id =
                 changes.monitored_page_id

            INNER JOIN authorized_competitors
              ON authorized_competitors.id =
                 monitored_pages.competitor_id
          ) AS latest_change_at
      `
    )
      .bind(
        session.user.id
      )
      .first<DashboardOverviewRow>();

  const {
    results:
      monitoringRows,
  } =
    await env.DB.prepare(
      `
        WITH authorized_pages AS (
          SELECT
            monitored_pages.id,

            monitored_pages.url,
            monitored_pages.label,
            monitored_pages.frequency_minutes,

            monitored_pages.status
              AS page_status,

            monitored_pages.last_checked_at,
            monitored_pages.next_check_at,

            competitors.id
              AS competitor_id,

            competitors.name
              AS competitor_name,

            competitors.domain
              AS competitor_domain,

            competitors.status
              AS competitor_status,

            (
              SELECT
                snapshots.http_status

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
              SELECT
                snapshots.captured_at

              FROM snapshots

              WHERE snapshots.monitored_page_id =
                    monitored_pages.id

              ORDER BY
                datetime(
                  snapshots.captured_at
                ) DESC

              LIMIT 1
            ) AS latest_captured_at

          FROM monitored_pages

          INNER JOIN competitors
            ON competitors.id =
               monitored_pages.competitor_id

          WHERE EXISTS (
            SELECT 1

            FROM workspace_members

            WHERE workspace_members.workspace_id =
                  competitors.workspace_id

              AND workspace_members.user_id = ?
          )
        ),

        page_health AS (
          SELECT
            authorized_pages.*,

            CASE
              WHEN competitor_status <> 'active'
                OR page_status <> 'active'
                THEN 'paused'

              WHEN last_checked_at IS NULL
                THEN 'awaiting_first_capture'

              WHEN next_check_at IS NOT NULL
                AND datetime(
                  next_check_at
                ) < datetime(
                  'now'
                )
                THEN 'overdue'

              WHEN latest_http_status IS NOT NULL
                AND (
                  latest_http_status < 200
                  OR latest_http_status >= 400
                )
                THEN 'error'

              ELSE 'healthy'
            END AS health

          FROM authorized_pages
        )

        SELECT
          *

        FROM page_health

        ORDER BY
          CASE health
            WHEN 'error' THEN 1
            WHEN 'overdue' THEN 2
            WHEN 'awaiting_first_capture' THEN 3
            WHEN 'healthy' THEN 4
            WHEN 'paused' THEN 5
            ELSE 6
          END ASC,

          CASE
            WHEN next_check_at IS NULL
              THEN 1
            ELSE 0
          END ASC,

          datetime(
            next_check_at
          ) ASC,

          competitor_name COLLATE NOCASE ASC

        LIMIT 20
      `
    )
      .bind(
        session.user.id
      )
      .all<DashboardMonitoringRow>();

  const {
    results:
      recentChanges,
  } =
    await env.DB.prepare(
      `
        SELECT
          changes.id,
          changes.category,
          changes.significance,
          changes.summary,
          changes.why_it_matters,
          changes.detected_at,

          competitors.id
            AS competitor_id,

          competitors.name
            AS competitor_name,

          monitored_pages.url
            AS monitored_page_url,

          monitored_pages.label
            AS monitored_page_label

        FROM changes

        INNER JOIN monitored_pages
          ON monitored_pages.id =
             changes.monitored_page_id

        INNER JOIN competitors
          ON competitors.id =
             monitored_pages.competitor_id

        WHERE EXISTS (
          SELECT 1

          FROM workspace_members

          WHERE workspace_members.workspace_id =
                competitors.workspace_id

            AND workspace_members.user_id = ?
        )

        ORDER BY
          datetime(
            changes.detected_at
          ) DESC,
          changes.id DESC

        LIMIT 8
      `
    )
      .bind(
        session.user.id
      )
      .all<DashboardRecentChange>();

  const metrics = {
    competitors:
      Number(
        overview?.competitor_count ??
        0
      ),

    activeCompetitors:
      Number(
        overview?.active_competitor_count ??
        0
      ),

    monitoredPages:
      Number(
        overview?.monitored_page_count ??
        0
      ),

    activePages:
      Number(
        overview?.active_page_count ??
        0
      ),

    healthyPages:
      Number(
        overview?.healthy_page_count ??
        0
      ),

    overduePages:
      Number(
        overview?.overdue_page_count ??
        0
      ),

    awaitingPages:
      Number(
        overview?.awaiting_page_count ??
        0
      ),

    errorPages:
      Number(
        overview?.error_page_count ??
        0
      ),

    pausedPages:
      Number(
        overview?.paused_page_count ??
        0
      ),

    changes:
      Number(
        overview?.change_count ??
        0
      ),

    majorChanges:
      Number(
        overview?.major_change_count ??
        0
      ),

    latestCheckedAt:
      overview?.latest_checked_at ??
      null,

    latestChangeAt:
      overview?.latest_change_at ??
      null,
  };

  const attentionCount =
    metrics.overduePages +
    metrics.errorPages;

  const usage = {
    competitorLimit:
      MORROW_MVP_USAGE_LIMITS
        .competitorsPerWorkspace,

    pageLimit:
      MORROW_MVP_USAGE_LIMITS
        .monitoredPagesPerWorkspace,

    perCompetitorPageLimit:
      MORROW_MVP_USAGE_LIMITS
        .monitoredPagesPerCompetitor,

    competitorRemaining:
      Math.max(
        0,

        MORROW_MVP_USAGE_LIMITS
          .competitorsPerWorkspace -
          metrics.competitors
      ),

    pageRemaining:
      Math.max(
        0,

        MORROW_MVP_USAGE_LIMITS
          .monitoredPagesPerWorkspace -
          metrics.monitoredPages
      ),

    competitorPercentage:
      clampPercentage(
        metrics.competitors,

        MORROW_MVP_USAGE_LIMITS
          .competitorsPerWorkspace
      ),

    pagePercentage:
      clampPercentage(
        metrics.monitoredPages,

        MORROW_MVP_USAGE_LIMITS
          .monitoredPagesPerWorkspace
      ),
  };

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
              Morrow
            </div>

            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
              Intelligence dashboard
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500 sm:text-[15px]">
              Monitor competitor activity,
              review meaningful changes, and
              see which pages need attention.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium text-slate-900">
                {session.user.name ||
                  "Morrow user"}
              </div>

              <div className="text-xs text-slate-400">
                {session.user.email}
              </div>
            </div>

            <SignOutButton />
          </div>
        </header>

        <nav className="mt-8 flex flex-wrap gap-2 border-b border-slate-200 pb-5">
          <a
            href="/dashboard"
            className="inline-flex min-h-10 items-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white"
          >
            Dashboard
          </a>

          <a
            href="/dashboard/competitors"
            className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Competitors
          </a>

          <a
            href="/dashboard/changes"
            className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Change history
          </a>
        </nav>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
              Competitors
            </div>

            <div className="mt-3 text-3xl font-semibold tracking-tight">
              {metrics.competitors}
            </div>

            <div className="mt-2 text-xs text-slate-400">
              {metrics.activeCompetitors}{" "}
              active
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
              Monitored pages
            </div>

            <div className="mt-3 text-3xl font-semibold tracking-tight">
              {metrics.monitoredPages}
            </div>

            <div className="mt-2 text-xs text-slate-400">
              {metrics.activePages}{" "}
              actively scheduled
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
              Meaningful changes
            </div>

            <div className="mt-3 text-3xl font-semibold tracking-tight">
              {metrics.changes}
            </div>

            <div className="mt-2 text-xs text-slate-400">
              {metrics.majorChanges}{" "}
              major
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
              Needs attention
            </div>

            <div
              className={
                attentionCount > 0
                  ? "mt-3 text-3xl font-semibold tracking-tight text-red-700"
                  : "mt-3 text-3xl font-semibold tracking-tight text-emerald-700"
              }
            >
              {attentionCount}
            </div>

            <div className="mt-2 text-xs text-slate-400">
              overdue or failing pages
            </div>
          </article>
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-5">
            <div className="border-b border-slate-100 px-5 py-4 sm:border-r lg:border-b-0">
              <div className="text-xs text-slate-400">
                Healthy
              </div>

              <div className="mt-1 text-lg font-semibold text-emerald-700">
                {metrics.healthyPages}
              </div>
            </div>

            <div className="border-b border-slate-100 px-5 py-4 lg:border-b-0 lg:border-r">
              <div className="text-xs text-slate-400">
                Overdue
              </div>

              <div className="mt-1 text-lg font-semibold text-amber-700">
                {metrics.overduePages}
              </div>
            </div>

            <div className="border-b border-slate-100 px-5 py-4 sm:border-r lg:border-b-0">
              <div className="text-xs text-slate-400">
                Awaiting first capture
              </div>

              <div className="mt-1 text-lg font-semibold text-indigo-700">
                {metrics.awaitingPages}
              </div>
            </div>

            <div className="border-b border-slate-100 px-5 py-4 lg:border-b-0 lg:border-r">
              <div className="text-xs text-slate-400">
                Capture errors
              </div>

              <div className="mt-1 text-lg font-semibold text-red-700">
                {metrics.errorPages}
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="text-xs text-slate-400">
                Paused
              </div>

              <div className="mt-1 text-lg font-semibold text-slate-700">
                {metrics.pausedPages}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-5">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              MVP capacity
            </div>

            <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-slate-950">
              Workspace usage
            </h2>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              These are launch safety caps,
              not subscription or billing
              limits. The same values are
              enforced by the server actions
              that create competitors and
              monitored pages.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Competitors
                  </div>

                  <div className="mt-1 text-xs text-slate-500">
                    Workspace total
                  </div>
                </div>

                <div className="text-sm font-semibold text-slate-900">
                  {metrics.competitors}
                  {" / "}
                  {usage.competitorLimit}
                </div>
              </div>

              <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-600"
                  style={{
                    width:
                      `${usage.competitorPercentage}%`,
                  }}
                />
              </div>

              <div className="mt-3 text-xs text-slate-500">
                {usage.competitorRemaining}{" "}
                competitor
                {usage.competitorRemaining ===
                1
                  ? ""
                  : "s"}{" "}
                remaining
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Monitored pages
                  </div>

                  <div className="mt-1 text-xs text-slate-500">
                    Workspace total
                  </div>
                </div>

                <div className="text-sm font-semibold text-slate-900">
                  {metrics.monitoredPages}
                  {" / "}
                  {usage.pageLimit}
                </div>
              </div>

              <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-600"
                  style={{
                    width:
                      `${usage.pagePercentage}%`,
                  }}
                />
              </div>

              <div className="mt-3 text-xs text-slate-500">
                {usage.pageRemaining}{" "}
                page
                {usage.pageRemaining ===
                1
                  ? ""
                  : "s"}{" "}
                remaining
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">
                Per-competitor page cap
              </div>

              <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                {
                  usage.perCompetitorPageLimit
                }
              </div>

              <p className="mt-3 text-xs leading-5 text-slate-500">
                Each competitor can contain
                up to{" "}
                {
                  usage.perCompetitorPageLimit
                }{" "}
                monitored pages. Paused pages
                still count toward capacity.
              </p>
            </article>
          </div>
        </section>

        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
          <section className="min-w-0">
            <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                  Monitoring
                </div>

                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
                  Monitoring status
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Current health derived from
                  scheduler state and the latest
                  capture.
                </p>
              </div>

              <a
                href="/dashboard/competitors"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                Manage competitors →
              </a>
            </div>

            {monitoringRows.length ===
            0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 shadow-sm">
                <h3 className="font-semibold text-slate-900">
                  Nothing is being monitored yet
                </h3>

                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                  Add a competitor and monitored
                  page to start building your
                  intelligence feed.
                </p>

                <a
                  href="/dashboard/competitors"
                  className="mt-5 inline-flex min-h-10 items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                >
                  Add competitor
                </a>
              </div>
            ) : (
              <div className="space-y-3">
                {monitoringRows.map(
                  (page) => (
                    <article
                      key={page.id}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href={`/dashboard/competitors/${page.competitor_id}`}
                              className="font-semibold text-slate-950 hover:text-indigo-600"
                            >
                              {
                                page.competitor_name
                              }
                            </a>

                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${getHealthClasses(
                                page.health
                              )}`}
                            >
                              {getHealthLabel(
                                page.health
                              )}
                            </span>
                          </div>

                          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                            <span className="font-medium text-slate-700">
                              {page.label ||
                                "Unlabelled page"}
                            </span>

                            <span className="text-slate-300">
                              /
                            </span>

                            <a
                              href={
                                page.url
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="max-w-xl truncate text-slate-500 hover:text-indigo-600"
                            >
                              {
                                page.url
                              }
                            </a>
                          </div>
                        </div>

                        <div className="shrink-0 text-xs text-slate-400">
                          {getFrequencyLabel(
                            Number(
                              page.frequency_minutes
                            )
                          )}
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
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

                          <div className="mt-1 text-sm font-medium text-slate-800">
                            {formatCompactDateTime(
                              page.last_checked_at
                            )}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs text-slate-400">
                            Latest capture
                          </div>

                          <div className="mt-1 text-sm font-medium text-slate-800">
                            {formatCompactDateTime(
                              page.latest_captured_at
                            )}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs text-slate-400">
                            Next check
                          </div>

                          <div className="mt-1 text-sm font-medium text-slate-800">
                            {page.health ===
                            "paused"
                              ? "Paused"
                              : formatCompactDateTime(
                                  page.next_check_at
                                )}
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                )}
              </div>
            )}
          </section>

          <aside className="min-w-0">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                  Intelligence
                </div>

                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
                  Recent changes
                </h2>
              </div>

              <a
                href="/dashboard/changes"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                View all →
              </a>
            </div>

            {recentChanges.length ===
            0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="font-semibold text-slate-900">
                  No meaningful changes yet
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Monitoring is running, but no
                  persisted meaningful competitor
                  changes are currently available.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentChanges.map(
                  (change) => (
                    <article
                      key={change.id}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium capitalize text-indigo-700">
                          {
                            change.category
                          }
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

                      <div className="mt-4 text-sm font-semibold text-slate-900">
                        {
                          change.competitor_name
                        }
                      </div>

                      <h3 className="mt-2 text-base font-semibold leading-6 text-slate-950">
                        {change.summary ||
                          "A meaningful competitor change was detected."}
                      </h3>

                      {change.why_it_matters ? (
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          {
                            change.why_it_matters
                          }
                        </p>
                      ) : null}

                      <div className="mt-4 border-t border-slate-100 pt-4">
                        <div className="text-xs text-slate-400">
                          {change.monitored_page_label ||
                            change.monitored_page_url}
                        </div>

                        <div className="mt-1 text-xs text-slate-400">
                          {formatDateTime(
                            change.detected_at
                          )}
                        </div>

                        <a
                          href={`/dashboard/changes/${change.id}`}
                          className="mt-3 inline-flex text-sm font-medium text-indigo-600 hover:text-indigo-500"
                        >
                          View change →
                        </a>
                      </div>
                    </article>
                  )
                )}
              </div>
            )}
          </aside>
        </div>

        <section className="mt-8 grid gap-4 border-t border-slate-200 pt-8 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium text-slate-400">
              Latest monitoring check
            </div>

            <div className="mt-2 text-sm font-semibold leading-6 text-slate-900">
              {formatDateTime(
                metrics.latestCheckedAt
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium text-slate-400">
              Latest meaningful change
            </div>

            <div className="mt-2 text-sm font-semibold leading-6 text-slate-900">
              {formatDateTime(
                metrics.latestChangeAt
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}