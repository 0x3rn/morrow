import { SignOutButton } from "@/components/sign-out-button";
import { auth } from "@/lib/auth";
import { MORROW_MVP_USAGE_LIMITS } from "@/lib/usage-limits";
import { env } from "cloudflare:workers";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  createCompetitor,
  removeCompetitor,
  toggleCompetitorStatus,
  updateCompetitor,
} from "./actions";

interface Workspace {
  id: string;
  name: string;
}

interface CompetitorRow {
  id: string;
  name: string;
  domain: string;
  favicon_url: string | null;

  description: string | null;

  status: string;

  created_at: string;
  updated_at: string;

  monitored_page_count: number;
  active_page_count: number;
  paused_page_count: number;

  change_count: number;
  major_change_count: number;

  latest_checked_at: string | null;
  latest_change_at: string | null;
}

interface WorkspaceUsageRow {
  competitor_count: number;
  monitored_page_count: number;
}

function normalizeDatabaseTimestamp(
  value: string
) {
  if (
    value.endsWith("Z") ||
    /[+-]\d{2}:\d{2}$/.test(
      value
    )
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

function formatCompactDate(
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

      year:
        "numeric",

      timeZone:
        "UTC",
    }
  ).format(date);
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

function getStatusClasses(
  status: string
) {
  if (
    status ===
    "active"
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
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

function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="h-3.5 w-3.5"
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
      className="h-4 w-4 transition-transform duration-200 group-open:rotate-180"
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

export default async function CompetitorsPage() {
  const session =
    await auth.api.getSession({
      headers:
        await headers(),
    });

  if (!session) {
    redirect(
      "/login"
    );
  }

  /*
   * Morrow currently has a single-workspace MVP
   * experience and no workspace switcher.
   *
   * This selection intentionally mirrors the
   * createCompetitor server action so the list,
   * usage counts, and resource creation all refer
   * to the same workspace.
   */
  const workspace =
    await env.DB.prepare(
      `
        SELECT
          workspaces.id,
          workspaces.name

        FROM workspaces

        INNER JOIN workspace_members
          ON workspace_members.workspace_id =
             workspaces.id

        WHERE workspace_members.user_id = ?

        ORDER BY
          datetime(
            workspace_members.joined_at
          ) ASC

        LIMIT 1
      `
    )
      .bind(
        session.user.id
      )
      .first<Workspace>();

  if (
    !workspace
  ) {
    throw new Error(
      "No workspace found for this account."
    );
  }

  const usageRow =
    await env.DB.prepare(
      `
        SELECT
          (
            SELECT
              COUNT(*)

            FROM competitors

            WHERE workspace_id = ?
          ) AS competitor_count,

          (
            SELECT
              COUNT(*)

            FROM monitored_pages

            INNER JOIN competitors
              ON competitors.id =
                 monitored_pages.competitor_id

            WHERE competitors.workspace_id = ?
          ) AS monitored_page_count
      `
    )
      .bind(
        workspace.id,
        workspace.id
      )
      .first<WorkspaceUsageRow>();

  const {
    results:
      competitors,
  } =
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
          competitors.updated_at,

          (
            SELECT
              COUNT(*)

            FROM monitored_pages

            WHERE monitored_pages.competitor_id =
                  competitors.id
          ) AS monitored_page_count,

          (
            SELECT
              COUNT(*)

            FROM monitored_pages

            WHERE monitored_pages.competitor_id =
                  competitors.id

              AND monitored_pages.status =
                  'active'
          ) AS active_page_count,

          (
            SELECT
              COUNT(*)

            FROM monitored_pages

            WHERE monitored_pages.competitor_id =
                  competitors.id

              AND monitored_pages.status =
                  'paused'
          ) AS paused_page_count,

          (
            SELECT
              COUNT(*)

            FROM changes

            INNER JOIN monitored_pages
              ON monitored_pages.id =
                 changes.monitored_page_id

            WHERE monitored_pages.competitor_id =
                  competitors.id
          ) AS change_count,

          (
            SELECT
              COUNT(*)

            FROM changes

            INNER JOIN monitored_pages
              ON monitored_pages.id =
                 changes.monitored_page_id

            WHERE monitored_pages.competitor_id =
                  competitors.id

              AND changes.significance =
                  'major'
          ) AS major_change_count,

          (
            SELECT
              MAX(
                monitored_pages.last_checked_at
              )

            FROM monitored_pages

            WHERE monitored_pages.competitor_id =
                  competitors.id
          ) AS latest_checked_at,

          (
            SELECT
              MAX(
                changes.detected_at
              )

            FROM changes

            INNER JOIN monitored_pages
              ON monitored_pages.id =
                 changes.monitored_page_id

            WHERE monitored_pages.competitor_id =
                  competitors.id
          ) AS latest_change_at

        FROM competitors

        WHERE competitors.workspace_id = ?

        ORDER BY
          datetime(
            competitors.created_at
          ) DESC,
          competitors.name COLLATE NOCASE ASC
      `
    )
      .bind(
        workspace.id
      )
      .all<CompetitorRow>();

  const usage = {
    competitors:
      Number(
        usageRow?.competitor_count ??
        0
      ),

    monitoredPages:
      Number(
        usageRow?.monitored_page_count ??
        0
      ),

    competitorLimit:
      MORROW_MVP_USAGE_LIMITS
        .competitorsPerWorkspace,

    monitoredPageLimit:
      MORROW_MVP_USAGE_LIMITS
        .monitoredPagesPerWorkspace,

    perCompetitorPageLimit:
      MORROW_MVP_USAGE_LIMITS
        .monitoredPagesPerCompetitor,
  };

  const competitorRemaining =
    Math.max(
      0,

      usage.competitorLimit -
        usage.competitors
    );

  const pageRemaining =
    Math.max(
      0,

      usage.monitoredPageLimit -
        usage.monitoredPages
    );

  const competitorPercentage =
    clampPercentage(
      usage.competitors,
      usage.competitorLimit
    );

  const monitoredPagePercentage =
    clampPercentage(
      usage.monitoredPages,
      usage.monitoredPageLimit
    );

  const competitorLimitReached =
    usage.competitors >=
    usage.competitorLimit;

  const activeCompetitorCount =
    competitors.filter(
      (competitor) =>
        competitor.status ===
        "active"
    ).length;

  const totalChanges =
    competitors.reduce(
      (
        total,
        competitor
      ) =>
        total +
        Number(
          competitor.change_count
        ),

      0
    );

  const totalMajorChanges =
    competitors.reduce(
      (
        total,
        competitor
      ) =>
        total +
        Number(
          competitor.major_change_count
        ),

      0
    );

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
    "placeholder:text-slate-400",
    "focus-visible:border-indigo-400",
    "focus-visible:ring-2",
    "focus-visible:ring-indigo-500/15",
  ].join(
    " "
  );

  const secondaryButtonClasses = [
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
    "hover:border-slate-300",
    "hover:bg-slate-50",
    "focus-visible:outline-none",
    "focus-visible:ring-2",
    "focus-visible:ring-indigo-500/25",
  ].join(
    " "
  );

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg pr-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25"
            >
              <ArrowLeftIcon />

              <span>
                Dashboard
              </span>
            </Link>

            <div className="mt-5">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                Workspace
              </div>

              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
                Competitors
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500 sm:text-[15px]">
                Manage the companies Morrow
                monitors and open each profile
                to configure individual pages,
                schedules, and change history.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium text-slate-900">
                {workspace.name}
              </div>

              <div className="text-xs text-slate-400">
                {
                  session.user.email
                }
              </div>
            </div>

            <SignOutButton />
          </div>
        </header>

        <nav className="mt-8 flex flex-wrap gap-2 border-b border-slate-200 pb-5">
          <Link
            href="/dashboard"
            className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Dashboard
          </Link>

          <Link
            href="/dashboard/competitors"
            className="inline-flex min-h-10 items-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white"
          >
            Competitors
          </Link>

          <Link
            href="/dashboard/changes"
            className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Change history
          </Link>
        </nav>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
              Competitors
            </div>

            <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              {
                usage.competitors
              }
            </div>

            <div className="mt-2 text-xs text-slate-400">
              {
                activeCompetitorCount
              }{" "}
              active
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
              Monitored pages
            </div>

            <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              {
                usage.monitoredPages
              }
            </div>

            <div className="mt-2 text-xs text-slate-400">
              across this workspace
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
              Meaningful changes
            </div>

            <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              {
                totalChanges
              }
            </div>

            <div className="mt-2 text-xs text-slate-400">
              detected historically
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
              Major changes
            </div>

            <div
              className={
                totalMajorChanges >
                0
                  ? "mt-3 text-3xl font-semibold tracking-tight text-red-700"
                  : "mt-3 text-3xl font-semibold tracking-tight text-slate-950"
              }
            >
              {
                totalMajorChanges
              }
            </div>

            <div className="mt-2 text-xs text-slate-400">
              high-impact events
            </div>
          </article>
        </section>

        <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                Add competitor
              </div>

              <h2 className="mt-2 text-xl font-semibold text-slate-950">
                Start monitoring a company
              </h2>

              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                Add the competitor first,
                then open its profile to add
                the exact pricing, product,
                policy, landing, or content
                pages you want Morrow to watch.
              </p>
            </div>

            {competitorLimitReached ? (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
                <div className="text-sm font-semibold text-amber-800">
                  Workspace competitor
                  capacity reached
                </div>

                <p className="mt-1 text-sm leading-6 text-amber-700">
                  This workspace already
                  contains the MVP maximum
                  of{" "}
                  {
                    usage.competitorLimit
                  }{" "}
                  competitors. Remove an
                  existing competitor before
                  adding another one.
                </p>
              </div>
            ) : (
              <form
                action={
                  createCompetitor
                }
                className="mt-6 grid gap-4 sm:grid-cols-2"
              >
                <div>
                  <label
                    htmlFor="name"
                    className="mb-1.5 block text-xs font-medium text-slate-600"
                  >
                    Competitor name
                  </label>

                  <input
                    id="name"
                    name="name"
                    type="text"
                    placeholder="Stripe"
                    required
                    maxLength={120}
                    className={
                      inputClasses
                    }
                  />
                </div>

                <div>
                  <label
                    htmlFor="domain"
                    className="mb-1.5 block text-xs font-medium text-slate-600"
                  >
                    Domain
                  </label>

                  <input
                    id="domain"
                    name="domain"
                    type="text"
                    placeholder="stripe.com"
                    required
                    maxLength={255}
                    className={
                      inputClasses
                    }
                  />
                </div>

                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 focus-visible:ring-offset-2"
                  >
                    <PlusIcon />

                    Add competitor
                  </button>
                </div>
              </form>
            )}
          </div>

          <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              MVP capacity
            </div>

            <h2 className="mt-2 text-lg font-semibold text-slate-950">
              Workspace usage
            </h2>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-slate-700">
                  Competitors
                </span>

                <span className="text-sm font-semibold text-slate-900">
                  {
                    usage.competitors
                  }
                  {" / "}
                  {
                    usage.competitorLimit
                  }
                </span>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-600"
                  style={{
                    width:
                      `${competitorPercentage}%`,
                  }}
                />
              </div>

              <div className="mt-2 text-xs text-slate-500">
                {
                  competitorRemaining
                }{" "}
                competitor
                {competitorRemaining ===
                1
                  ? ""
                  : "s"}{" "}
                remaining
              </div>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-5">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-slate-700">
                  Monitored pages
                </span>

                <span className="text-sm font-semibold text-slate-900">
                  {
                    usage.monitoredPages
                  }
                  {" / "}
                  {
                    usage.monitoredPageLimit
                  }
                </span>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-600"
                  style={{
                    width:
                      `${monitoredPagePercentage}%`,
                  }}
                />
              </div>

              <div className="mt-2 text-xs text-slate-500">
                {
                  pageRemaining
                }{" "}
                page
                {pageRemaining ===
                1
                  ? ""
                  : "s"}{" "}
                remaining
              </div>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-5">
              <div className="text-xs text-slate-400">
                Per competitor
              </div>

              <div className="mt-1 text-sm font-semibold text-slate-900">
                Up to{" "}
                {
                  usage.perCompetitorPageLimit
                }{" "}
                monitored pages
              </div>

              <p className="mt-2 text-xs leading-5 text-slate-500">
                Paused competitors and
                paused pages still consume
                launch capacity.
              </p>
            </div>
          </aside>
        </section>

        <section className="mt-10">
          <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                Watch list
              </div>

              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-slate-950">
                Your competitors
              </h2>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                Each competitor profile
                contains its monitored pages,
                schedules, latest capture
                health, and detected changes.
              </p>
            </div>

            <div className="text-sm font-medium text-slate-500">
              {
                competitors.length
              }{" "}
              {competitors.length ===
              1
                ? "competitor"
                : "competitors"}
            </div>
          </div>

          {competitors.length ===
          0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
              <h3 className="text-base font-semibold text-slate-900">
                No competitors yet
              </h3>

              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                Add your first competitor
                above, then open the profile
                and choose which website
                pages Morrow should monitor.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {competitors.map(
                (
                  competitor
                ) => {
                  const monitoredPageCount =
                    Number(
                      competitor.monitored_page_count
                    );

                  const activePageCount =
                    Number(
                      competitor.active_page_count
                    );

                  const pausedPageCount =
                    Number(
                      competitor.paused_page_count
                    );

                  const changeCount =
                    Number(
                      competitor.change_count
                    );

                  const majorChangeCount =
                    Number(
                      competitor.major_change_count
                    );

                  const perCompetitorRemaining =
                    Math.max(
                      0,

                      usage.perCompetitorPageLimit -
                        monitoredPageCount
                    );

                  return (
                    <article
                      key={
                        competitor.id
                      }
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                    >
                      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)] lg:items-start">
                        <div className="min-w-0">
                          <div className="flex items-start gap-4">
                            {competitor.favicon_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={
                                  competitor.favicon_url
                                }
                                alt=""
                                width={
                                  48
                                }
                                height={
                                  48
                                }
                                className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-1.5"
                              />
                            ) : (
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 font-semibold text-slate-700">
                                {competitor.name
                                  .charAt(
                                    0
                                  )
                                  .toUpperCase()}
                              </div>
                            )}

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/dashboard/competitors/${competitor.id}`}
                                  className="text-lg font-semibold text-slate-950 hover:text-indigo-600"
                                >
                                  {
                                    competitor.name
                                  }
                                </Link>

                                <span
                                  className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${getStatusClasses(
                                    competitor.status
                                  )}`}
                                >
                                  {
                                    competitor.status
                                  }
                                </span>
                              </div>

                              <a
                                href={`https://${competitor.domain}`}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-flex max-w-full items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600"
                              >
                                <span className="truncate">
                                  {
                                    competitor.domain
                                  }
                                </span>

                                <ExternalLinkIcon />
                              </a>

                              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-500">
                                {competitor.description ||
                                  `Tracking ${monitoredPageCount} ${
                                    monitoredPageCount ===
                                    1
                                      ? "page"
                                      : "pages"
                                  } for meaningful competitor changes.`}
                              </p>

                              <div className="mt-4 text-xs text-slate-400">
                                Added{" "}
                                {formatCompactDate(
                                  competitor.created_at
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-3">
                          <div>
                            <div className="text-xs text-slate-400">
                              Pages
                            </div>

                            <div className="mt-1 text-sm font-semibold text-slate-900">
                              {
                                monitoredPageCount
                              }
                              {" / "}
                              {
                                usage.perCompetitorPageLimit
                              }
                            </div>

                            <div className="mt-1 text-xs text-slate-400">
                              {
                                perCompetitorRemaining
                              }{" "}
                              remaining
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-slate-400">
                              Active
                            </div>

                            <div className="mt-1 text-sm font-semibold text-emerald-700">
                              {
                                activePageCount
                              }
                            </div>

                            <div className="mt-1 text-xs text-slate-400">
                              {
                                pausedPageCount
                              }{" "}
                              paused
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-slate-400">
                              Changes
                            </div>

                            <div className="mt-1 text-sm font-semibold text-slate-900">
                              {
                                changeCount
                              }
                            </div>

                            <div className="mt-1 text-xs text-red-500">
                              {
                                majorChangeCount
                              }{" "}
                              major
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-slate-400">
                              Last checked
                            </div>

                            <div className="mt-1 text-xs font-medium leading-5 text-slate-700">
                              {formatDateTime(
                                competitor.latest_checked_at
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-slate-400">
                              Latest change
                            </div>

                            <div className="mt-1 text-xs font-medium leading-5 text-slate-700">
                              {formatDateTime(
                                competitor.latest_change_at
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-6">
                        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/dashboard/competitors/${competitor.id}`}
                              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                            >
                              View competitor
                            </Link>

                            <form
                              action={
                                toggleCompetitorStatus
                              }
                            >
                              <input
                                type="hidden"
                                name="competitorId"
                                value={
                                  competitor.id
                                }
                              />

                              <input
                                type="hidden"
                                name="currentStatus"
                                value={
                                  competitor.status
                                }
                              />

                              <button
                                type="submit"
                                className={
                                  secondaryButtonClasses
                                }
                              >
                                {competitor.status ===
                                "active"
                                  ? "Pause"
                                  : "Resume"}
                              </button>
                            </form>
                          </div>

                          <details className="group">
                            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25">
                              Manage

                              <ChevronIcon />
                            </summary>

                            <div className="mt-4 grid gap-6 border-t border-slate-200 pt-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                              <form
                                action={
                                  updateCompetitor
                                }
                                className="grid gap-4 sm:grid-cols-2"
                              >
                                <input
                                  type="hidden"
                                  name="competitorId"
                                  value={
                                    competitor.id
                                  }
                                />

                                <div>
                                  <label
                                    htmlFor={`name-${competitor.id}`}
                                    className="mb-1.5 block text-xs font-medium text-slate-600"
                                  >
                                    Name
                                  </label>

                                  <input
                                    id={`name-${competitor.id}`}
                                    name="name"
                                    type="text"
                                    defaultValue={
                                      competitor.name
                                    }
                                    required
                                    maxLength={
                                      120
                                    }
                                    className={
                                      inputClasses
                                    }
                                  />
                                </div>

                                <div>
                                  <label
                                    htmlFor={`domain-${competitor.id}`}
                                    className="mb-1.5 block text-xs font-medium text-slate-600"
                                  >
                                    Domain
                                  </label>

                                  <input
                                    id={`domain-${competitor.id}`}
                                    name="domain"
                                    type="text"
                                    defaultValue={
                                      competitor.domain
                                    }
                                    required
                                    maxLength={
                                      255
                                    }
                                    className={
                                      inputClasses
                                    }
                                  />
                                </div>

                                <div className="sm:col-span-2">
                                  <button
                                    type="submit"
                                    className={
                                      secondaryButtonClasses
                                    }
                                  >
                                    Save changes
                                  </button>
                                </div>
                              </form>

                              <div className="border-t border-slate-200 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                                <div className="text-sm font-semibold text-red-700">
                                  Remove competitor
                                </div>

                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                  This removes the
                                  competitor, its
                                  monitored pages,
                                  snapshots, changes,
                                  and related delivery
                                  history.
                                </p>

                                <form
                                  action={
                                    removeCompetitor
                                  }
                                  className="mt-4"
                                >
                                  <input
                                    type="hidden"
                                    name="competitorId"
                                    value={
                                      competitor.id
                                    }
                                  />

                                  <button
                                    type="submit"
                                    className="inline-flex min-h-10 items-center justify-center rounded-xl border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/20"
                                  >
                                    Remove
                                  </button>
                                </form>
                              </div>
                            </div>
                          </details>
                        </div>
                      </div>
                    </article>
                  );
                }
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
