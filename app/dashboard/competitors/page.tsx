import { CompetitorIcon } from "@/components/competitor-icon";
import { WorkspaceActionForm } from "@/components/workspace-feedback";
import { WorkspacePanel } from "@/components/workspace-panel";
import { auth } from "@/lib/auth";
import { requireActiveWorkspaceMembership } from "@/lib/team-workspaces";
import { getWorkspaceEntitlements } from "@/lib/workspace-billing";
import { WORKSPACE_ROLE_DETAILS } from "@/lib/workspace-roles";
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
    return "border-success-border bg-success-bg text-success";
  }

  return "border-border bg-muted text-muted-foreground";
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

  const workspace =
    await requireActiveWorkspaceMembership(
      env.DB,
      session.user.id
    );

  const {
    canEditMonitoring,
    canDeleteMonitoringResources,
  } = workspace.permissions;

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

  const entitlements =
    await getWorkspaceEntitlements(
      env.DB,
      workspace.id
    );

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
      entitlements.limits
        .competitorsPerWorkspace,

    monitoredPageLimit:
      entitlements.limits
        .monitoredPagesPerWorkspace,

    perCompetitorPageLimit:
      entitlements.limits
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
    "border-border",
    "bg-card",
    "px-3.5",
    "py-2.5",
    "text-sm",
    "text-foreground",
    "outline-none",
    "transition-colors",
    "placeholder:text-muted-foreground",
    "focus-visible:border-ring",
    "focus-visible:ring-2",
    "focus-visible:ring-ring/15",
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
    "border-border",
    "bg-card",
    "px-3.5",
    "py-2",
    "text-sm",
    "font-medium",
    "text-foreground",
    "transition-colors",
    "hover:border-border",
    "hover:bg-muted",
    "focus-visible:outline-none",
    "focus-visible:ring-2",
    "focus-visible:ring-ring/25",
  ].join(
    " "
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
              Competitors
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
              Add competitors, choose which pages to monitor, and manage their schedules and history.
            </p>
          </div>

          {canEditMonitoring ? (
          <WorkspacePanel label="Add a competitor"><div>
            <div>



              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                Enter the company name and domain. You can choose which pages to monitor after it’s added.
              </p>
            </div>

            {competitorLimitReached ? (
              <div className="mt-6 rounded-xl border border-warning-border bg-warning-bg px-4 py-4">
                <div className="text-sm font-semibold text-warning">
                  Competitor limit reached
                </div>

                <p className="mt-1 text-sm leading-6 text-warning">
                  This workspace has reached its limit of{" "}
                  {
                    usage.competitorLimit
                  }{" "}
                  competitors. Remove one before adding another.
                </p>
              </div>
            ) : (
              <WorkspaceActionForm successMessage="Competitor added." action={createCompetitor}
                className="mt-6 grid gap-4 sm:grid-cols-2"
              >
                <div>
                  <label
                    htmlFor="name"
                    className="mb-1.5 block text-xs font-medium text-muted-foreground"
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
                    className="mb-1.5 block text-xs font-medium text-muted-foreground"
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
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary-border bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover active:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2"
                  >
                    <PlusIcon />

                    Add competitor
                  </button>
                </div>
              </WorkspaceActionForm>
            )}
          </div><aside className="workspace-capacity rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Workspace limits
            </div>

            <h2 className="mt-2 text-lg font-semibold text-foreground">
              Workspace usage
            </h2>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-foreground">
                  Competitors
                </span>

                <span className="text-sm font-semibold text-foreground">
                  {
                    usage.competitors
                  }
                  {" / "}
                  {
                    usage.competitorLimit
                  }
                </span>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width:
                      `${competitorPercentage}%`,
                  }}
                />
              </div>

              <div className="mt-2 text-xs text-muted-foreground">
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

            <div className="mt-6 border-t border-border pt-5">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-foreground">
                  Monitored pages
                </span>

                <span className="text-sm font-semibold text-foreground">
                  {
                    usage.monitoredPages
                  }
                  {" / "}
                  {
                    usage.monitoredPageLimit
                  }
                </span>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width:
                      `${monitoredPagePercentage}%`,
                  }}
                />
              </div>

              <div className="mt-2 text-xs text-muted-foreground">
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

            <div className="mt-6 border-t border-border pt-5">
              <div className="text-xs text-muted-foreground">
                Per competitor
              </div>

              <div className="mt-1 text-sm font-semibold text-foreground">
                Up to{" "}
                {
                  usage.perCompetitorPageLimit
                }{" "}
                monitored pages
              </div>

              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Paused competitors and pages still count toward these limits.
              </p>
            </div>
          </aside></WorkspacePanel>
          ) : (
            <span className="workspace-badge health-paused">
              {WORKSPACE_ROLE_DETAILS[workspace.role].label} • Read-only access
            </span>
          )}
        </header>



        <section className="workspace-metrics mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="workspace-metric-label">
              Competitors
            </div>

            <div className="workspace-metric-value">
              {
                usage.competitors
              }
            </div>

            <div className="workspace-meta">
              {
                activeCompetitorCount
              }{" "}
              active
            </div>
          </article>

          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="workspace-metric-label">
              Monitored pages
            </div>

            <div className="workspace-metric-value">
              {
                usage.monitoredPages
              }
            </div>

            <div className="workspace-meta">
              across this workspace
            </div>
          </article>

          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="workspace-metric-label">
              Changes
            </div>

            <div className="workspace-metric-value">
              {
                totalChanges
              }
            </div>

            <div className="workspace-meta">
              recorded
            </div>
          </article>

          <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="workspace-metric-label">
              Major changes
            </div>

            <div
              className={
                totalMajorChanges >
                0
                  ? "workspace-metric-value text-destructive"
                  : "workspace-metric-value"
              }
            >
              {
                totalMajorChanges
              }
            </div>

            <div className="workspace-meta">
              recorded as major
            </div>
          </article>
        </section>



        <section className="mt-10">
          <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>

              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-foreground">
                Your competitors
              </h2>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Open a competitor to manage its monitored pages and review recent changes.
              </p>
            </div>

            <div className="text-sm font-medium text-muted-foreground">
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
            <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
              <h3 className="text-base font-semibold text-foreground">
                No competitors yet
              </h3>

              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Add a competitor to start choosing pages to monitor.
              </p>
            </div>
          ) : (
            <div className="workspace-list space-y-4">
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
                      className="workspace-competitor-record overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                    >
                      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)] lg:items-start">
                        <div className="min-w-0">
                          <div className="flex items-start gap-4">
                            <CompetitorIcon name={competitor.name} src={competitor.favicon_url} variant="list" />

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/dashboard/competitors/${competitor.id}`}
                                  className="text-lg font-semibold text-foreground hover:text-primary-text"
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
                                className="mt-2 inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-primary-text"
                              >
                                <span className="truncate">
                                  {
                                    competitor.domain
                                  }
                                </span>

                                <ExternalLinkIcon />
                              </a>

                              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                                {competitor.description ||
                                  `Monitoring ${monitoredPageCount} ${
                                    monitoredPageCount ===
                                    1
                                      ? "page"
                                      : "pages"
                                  } for changes.`}
                              </p>

                              <div className="mt-4 text-xs text-muted-foreground">
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
                            <div className="text-xs text-muted-foreground">
                              Pages
                            </div>

                            <div className="mt-1 text-sm font-semibold text-foreground">
                              {
                                monitoredPageCount
                              }
                              {" / "}
                              {
                                usage.perCompetitorPageLimit
                              }
                            </div>

                            <div className="mt-1 text-xs text-muted-foreground">
                              {
                                perCompetitorRemaining
                              }{" "}
                              remaining
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-muted-foreground">
                              Active
                            </div>

                            <div className="mt-1 text-sm font-semibold text-success">
                              {
                                activePageCount
                              }
                            </div>

                            <div className="mt-1 text-xs text-muted-foreground">
                              {
                                pausedPageCount
                              }{" "}
                              paused
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-muted-foreground">
                              Changes
                            </div>

                            <div className="mt-1 text-sm font-semibold text-foreground">
                              {
                                changeCount
                              }
                            </div>

                            <div className="mt-1 text-xs text-destructive">
                              {
                                majorChangeCount
                              }{" "}
                              major
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-muted-foreground">
                              Last checked
                            </div>

                            <div className="mt-1 text-xs font-medium leading-5 text-foreground">
                              {formatDateTime(
                                competitor.latest_checked_at
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-muted-foreground">
                              Latest change
                            </div>

                            <div className="mt-1 text-xs font-medium leading-5 text-foreground">
                              {formatDateTime(
                                competitor.latest_change_at
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-border bg-muted px-5 py-4 sm:px-6">
                        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/dashboard/competitors/${competitor.id}`}
                              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-primary-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover active:bg-primary-active"
                            >
                              View competitor
                            </Link>

                            {canEditMonitoring ? (
                              <WorkspaceActionForm successMessage="Monitoring updated." action={toggleCompetitorStatus}
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
                              </WorkspaceActionForm>
                            ) : null}
                          </div>

                          {canEditMonitoring ? (
                            <WorkspacePanel label="Manage" title={competitor.name}><div className="workspace-manage-competitor mt-4 grid gap-6 border-t border-border pt-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                                <WorkspaceActionForm successMessage="Changes saved." action={updateCompetitor}
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
                                      className="mb-1.5 block text-xs font-medium text-muted-foreground"
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
                                      className="mb-1.5 block text-xs font-medium text-muted-foreground"
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
                                      className="workspace-primary"
                                    >
                                      Save changes
                                    </button>
                                  </div>
                                </WorkspaceActionForm>

                                <div className="workspace-destructive border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                                  <div className="text-sm font-semibold text-destructive">
                                    Remove competitor
                                  </div>

                                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                    This permanently removes the competitor and its monitored pages, captures, changes, and delivery history.
                                  </p>

                                  {canDeleteMonitoringResources ? (
                                    <WorkspaceActionForm successMessage="Competitor removed." action={removeCompetitor}
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
                                        className="inline-flex min-h-10 items-center justify-center rounded-xl border border-destructive-border bg-card px-3.5 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/20"
                                      >
                                        Remove
                                      </button>
                                    </WorkspaceActionForm>
                                  ) : (
                                    <p className="mt-3 text-xs text-muted-foreground">
                                      Only workspace Owners and Admins can permanently remove a competitor.
                                    </p>
                                  )}
                                </div>
                              </div></WorkspacePanel>
                          ) : null}
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
