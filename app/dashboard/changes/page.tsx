import { WorkspaceFilters } from "@/components/workspace-filters";
import { auth } from "@/lib/auth";
import { requireActiveWorkspaceMembership } from "@/lib/team-workspaces";
import { getWorkspaceRetentionWindow } from "@/lib/workspace-billing";
import { env } from "cloudflare:workers";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

interface ChangeHistoryPageProps {
  searchParams: Promise<
    Record<
      string,
      string | string[] | undefined
    >
  >;
}

interface CompetitorOption {
  id: string;
  name: string;
}

interface MonitoredPageOption {
  id: string;
  url: string;
  label: string | null;
  competitor_id: string;
  competitor_name: string;
}

interface HistoryChange {
  id: string;
  category: string;
  significance: string;
  summary: string | null;
  why_it_matters: string | null;
  previous_text: string | null;
  current_text: string | null;
  detected_at: string;

  competitor_id: string;
  competitor_name: string;
  competitor_domain: string;

  monitored_page_id: string;
  monitored_page_url: string;
  monitored_page_label: string | null;

  previous_snapshot_id: string | null;
  current_snapshot_id: string;
}

const CHANGE_CATEGORIES = [
  "pricing",
  "product",
  "feature",
  "positioning",
  "promotion",
  "policy",
  "navigation",
  "content",
  "other",
] as const;

const CHANGE_SIGNIFICANCE = [
  "minor",
  "moderate",
  "major",
] as const;

const HISTORY_PAGE_SIZE = 25;

function getSearchParam(
  value: string | string[] | undefined
) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
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

  return `${value.replace(" ", "T")}Z`;
}

function formatDateTime(
  value: string | null
) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(
    normalizeDatabaseTimestamp(value)
  );

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${new Intl.DateTimeFormat(
    "en-GB",
    {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }
  ).format(date)} UTC`;
}

function isValidDateInput(
  value: string
) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    value
  );
}

function escapeLikePattern(
  value: string
) {
  return value.replace(
    /[\\%_]/g,
    "\\$&"
  );
}

function getSignificanceClasses(
  significance: string
) {
  switch (significance) {
    case "major":
      return "border-destructive-border bg-destructive-bg text-destructive";

    case "moderate":
      return "border-warning-border bg-warning-bg text-warning";

    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export default async function ChangeHistoryPage({
  searchParams,
}: ChangeHistoryPageProps) {
  const session =
    await auth.api.getSession({
      headers: await headers(),
    });

  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;

  const keyword = getSearchParam(
    params.q
  )
    .trim()
    .slice(0, 200);

  const requestedCompetitorId =
    getSearchParam(
      params.competitor
    ).trim();

  const requestedMonitoredPageId =
    getSearchParam(
      params.monitoredPage
    ).trim();

  const requestedCategory =
    getSearchParam(
      params.category
    ).trim();

  const requestedSignificance =
    getSearchParam(
      params.significance
    ).trim();

  const requestedDateFrom =
    getSearchParam(
      params.from
    ).trim();

  const requestedDateTo =
    getSearchParam(
      params.to
    ).trim();

  const requestedPage =
    Number.parseInt(
      getSearchParam(
        params.page
      ),
      10
    );

  const page =
    Number.isSafeInteger(
      requestedPage
    ) &&
    requestedPage > 0
      ? requestedPage
      : 1;

  const category =
    CHANGE_CATEGORIES.includes(
      requestedCategory as
        (typeof CHANGE_CATEGORIES)[number]
    )
      ? requestedCategory
      : "";

  const significance =
    CHANGE_SIGNIFICANCE.includes(
      requestedSignificance as
        (typeof CHANGE_SIGNIFICANCE)[number]
    )
      ? requestedSignificance
      : "";

  const dateFrom =
    isValidDateInput(
      requestedDateFrom
    )
      ? requestedDateFrom
      : "";

  const dateTo =
    isValidDateInput(
      requestedDateTo
    )
      ? requestedDateTo
      : "";

  const workspace =
    await requireActiveWorkspaceMembership(
      env.DB,
      session.user.id
    );

  const {
    results: competitors,
  } = await env.DB.prepare(
    `
      SELECT
        competitors.id,
        competitors.name

      FROM competitors

      WHERE competitors.workspace_id = ?

      ORDER BY
        competitors.name COLLATE NOCASE ASC
    `
  )
    .bind(
      workspace.id
    )
    .all<CompetitorOption>();

  const allowedCompetitorIds =
    new Set(
      competitors.map(
        (competitor) =>
          competitor.id
      )
    );

  const competitorId =
    allowedCompetitorIds.has(
      requestedCompetitorId
    )
      ? requestedCompetitorId
      : "";

  const {
    results: monitoredPages,
  } = await env.DB.prepare(
    `
      SELECT
        monitored_pages.id,
        monitored_pages.url,
        monitored_pages.label,

        competitors.id
          AS competitor_id,

        competitors.name
          AS competitor_name

      FROM monitored_pages

      INNER JOIN competitors
        ON competitors.id =
           monitored_pages.competitor_id

      WHERE competitors.workspace_id = ?

      ORDER BY
        competitors.name COLLATE NOCASE ASC,
        COALESCE(
          monitored_pages.label,
          monitored_pages.url
        ) COLLATE NOCASE ASC
    `
  )
    .bind(
      workspace.id
    )
    .all<MonitoredPageOption>();

  const allowedMonitoredPageIds =
    new Set(
      monitoredPages
        .filter(
          (monitoredPage) =>
            !competitorId ||
            monitoredPage.competitor_id ===
              competitorId
        )
        .map(
          (monitoredPage) =>
            monitoredPage.id
        )
    );

  const monitoredPageId =
    allowedMonitoredPageIds.has(
      requestedMonitoredPageId
    )
      ? requestedMonitoredPageId
      : "";

  const retentionWindow =
    await getWorkspaceRetentionWindow(
      env.DB,
      workspace.id
    );

  const conditions: string[] = [
    "competitors.workspace_id = ?",
    "datetime(changes.detected_at) >= datetime(?)",
  ];

  const bindings: string[] = [
    workspace.id,
    retentionWindow.cutoffIso,
  ];

  if (competitorId) {
    conditions.push(
      "competitors.id = ?"
    );

    bindings.push(
      competitorId
    );
  }

  if (monitoredPageId) {
    conditions.push(
      "monitored_pages.id = ?"
    );

    bindings.push(
      monitoredPageId
    );
  }

  if (category) {
    conditions.push(
      "changes.category = ?"
    );

    bindings.push(
      category
    );
  }

  if (significance) {
    conditions.push(
      "changes.significance = ?"
    );

    bindings.push(
      significance
    );
  }

  if (dateFrom) {
    conditions.push(
      `
        datetime(
          changes.detected_at
        ) >= datetime(?)
      `
    );

    bindings.push(
      dateFrom
    );
  }

  if (dateTo) {
    conditions.push(
      `
        datetime(
          changes.detected_at
        ) < datetime(
          ?,
          '+1 day'
        )
      `
    );

    bindings.push(
      dateTo
    );
  }

  if (keyword) {
    const searchPattern =
      `%${escapeLikePattern(
        keyword
      )}%`;

    conditions.push(
      `
        (
          COALESCE(
            changes.summary,
            ''
          ) LIKE ? ESCAPE '\\'

          OR COALESCE(
            changes.why_it_matters,
            ''
          ) LIKE ? ESCAPE '\\'

          OR COALESCE(
            changes.previous_text,
            ''
          ) LIKE ? ESCAPE '\\'

          OR COALESCE(
            changes.current_text,
            ''
          ) LIKE ? ESCAPE '\\'

          OR competitors.name
             LIKE ? ESCAPE '\\'

          OR monitored_pages.url
             LIKE ? ESCAPE '\\'

          OR COALESCE(
            monitored_pages.label,
            ''
          ) LIKE ? ESCAPE '\\'
        )
      `
    );

    bindings.push(
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern
    );
  }

  const countSql = `
    SELECT
      COUNT(*) AS total

    FROM changes

    INNER JOIN monitored_pages
      ON monitored_pages.id =
         changes.monitored_page_id

    INNER JOIN competitors
      ON competitors.id =
         monitored_pages.competitor_id

    WHERE
      ${conditions.join(
        "\nAND "
      )}
  `;

  const countResult =
    await env.DB.prepare(
      countSql
    )
      .bind(
        ...bindings
      )
      .first<{
        total: number;
      }>();

  const totalChanges =
    Number(
      countResult?.total ?? 0
    );

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        totalChanges /
          HISTORY_PAGE_SIZE
      )
    );

  const currentPage =
    Math.min(
      page,
      totalPages
    );

  const offset =
    (currentPage - 1) *
    HISTORY_PAGE_SIZE;

  const historySql = `
    SELECT
      changes.id,
      changes.category,
      changes.significance,
      changes.summary,
      changes.why_it_matters,
      changes.previous_text,
      changes.current_text,
      changes.detected_at,
      changes.previous_snapshot_id,
      changes.current_snapshot_id,

      competitors.id
        AS competitor_id,

      competitors.name
        AS competitor_name,

      competitors.domain
        AS competitor_domain,

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

    INNER JOIN competitors
      ON competitors.id =
         monitored_pages.competitor_id

    WHERE
      ${conditions.join(
        "\nAND "
      )}

    ORDER BY
      datetime(
        changes.detected_at
      ) DESC,
      changes.id DESC

    LIMIT ?
    OFFSET ?
  `;

  const {
    results: changes,
  } = await env.DB.prepare(
    historySql
  )
    .bind(
      ...bindings,
      HISTORY_PAGE_SIZE,
      offset
    )
    .all<HistoryChange>();

  function getHistoryPageUrl(
    targetPage: number
  ) {
    const nextParams =
      new URLSearchParams();

    if (keyword) {
      nextParams.set(
        "q",
        keyword
      );
    }

    if (competitorId) {
      nextParams.set(
        "competitor",
        competitorId
      );
    }

    if (monitoredPageId) {
      nextParams.set(
        "monitoredPage",
        monitoredPageId
      );
    }

    if (category) {
      nextParams.set(
        "category",
        category
      );
    }

    if (significance) {
      nextParams.set(
        "significance",
        significance
      );
    }

    if (dateFrom) {
      nextParams.set(
        "from",
        dateFrom
      );
    }

    if (dateTo) {
      nextParams.set(
        "to",
        dateTo
      );
    }

    if (targetPage > 1) {
      nextParams.set(
        "page",
        String(targetPage)
      );
    }

    const query =
      nextParams.toString();

    return query
      ? `/dashboard/changes?${query}`
      : "/dashboard/changes";
  }

  const hasFilters =
    Boolean(
      keyword ||
      competitorId ||
      monitoredPageId ||
      category ||
      significance ||
      dateFrom ||
      dateTo
    );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Change history
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Search and filter the changes
              Morrow has recorded across your
              monitored pages
            </p>
          </div>
        </header>

        <section className="workspace-filters rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <form method="get"><div className="lg:col-span-2">
              <label
                htmlFor="q"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Search
              </label>

              <input
                id="q"
                name="q"
                type="search"
                defaultValue={
                  keyword
                }
                placeholder="Search changes, competitors, or page URLs"
                className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
              />
            </div><WorkspaceFilters active={hasFilters}><div>
              <label
                htmlFor="competitor"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Competitor
              </label>

              <select
                id="competitor"
                name="competitor"
                defaultValue={
                  competitorId
                }
                className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-ring"
              >
                <option value="">
                  All competitors
                </option>

                {competitors.map(
                  (competitor) => (
                    <option
                      key={
                        competitor.id
                      }
                      value={
                        competitor.id
                      }
                    >
                      {
                        competitor.name
                      }
                    </option>
                  )
                )}
              </select>
            </div>
<div className="lg:col-span-2">
              <label
                htmlFor="monitoredPage"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Monitored page
              </label>

              <select
                id="monitoredPage"
                name="monitoredPage"
                defaultValue={
                  monitoredPageId
                }
                className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-ring"
              >
                <option value="">
                  All monitored pages
                </option>

                {monitoredPages
                  .filter(
                    (monitoredPage) =>
                      !competitorId ||
                      monitoredPage.competitor_id ===
                        competitorId
                  )
                  .map(
                    (monitoredPage) => (
                      <option
                        key={
                          monitoredPage.id
                        }
                        value={
                          monitoredPage.id
                        }
                      >
                        {`${monitoredPage.competitor_name} — ${
                          monitoredPage.label ||
                          monitoredPage.url
                        }`}
                      </option>
                    )
                  )}
              </select>
            </div>
<div>
              <label
                htmlFor="category"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Category
              </label>

              <select
                id="category"
                name="category"
                defaultValue={
                  category
                }
                className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-ring"
              >
                <option value="">
                  All categories
                </option>

                {CHANGE_CATEGORIES.map(
                  (value) => (
                    <option
                      key={value}
                      value={value}
                    >
                      {value}
                    </option>
                  )
                )}
              </select>
            </div>
<div>
              <label
                htmlFor="significance"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Significance
              </label>

              <select
                id="significance"
                name="significance"
                defaultValue={
                  significance
                }
                className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-ring"
              >
                <option value="">
                  All levels
                </option>

                {CHANGE_SIGNIFICANCE.map(
                  (value) => (
                    <option
                      key={value}
                      value={value}
                    >
                      {value}
                    </option>
                  )
                )}
              </select>
            </div>
<div className="workspace-date-range">
              <div>
                <label
                  htmlFor="from"
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
                  From
                </label>

                <input
                  id="from"
                  name="from"
                  type="date"
                  defaultValue={
                    dateFrom
                  }
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-ring"
                />
              </div>

              <div>
                <label
                  htmlFor="to"
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
                  To
                </label>

                <input
                  id="to"
                  name="to"
                  type="date"
                  defaultValue={
                    dateTo
                  }
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-ring"
                />
              </div>
            </div>
<div className="flex items-end gap-2 lg:col-span-4">
              <button
                type="submit"
                className="min-h-10 rounded-xl border border-primary-border bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover active:bg-primary-active"
              >
                Apply filters
              </button>

              {hasFilters ? (
                <Link
                  href="/dashboard/changes"
                  className="inline-flex min-h-10 items-center rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
                >
                  Clear
                </Link>
              ) : null}
            </div></WorkspaceFilters></form>
        </section>

        <section className="mt-8">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">
                Recorded changes
              </h2>

              <p className="mt-1 text-sm text-muted-foreground">
                {totalChanges === 0 ? (
                  "No changes"
                ) : (
                  <>
                    Showing{" "}
                    {offset + 1}–
                    {Math.min(
                      offset +
                        changes.length,
                      totalChanges
                    )}{" "}
                    of {totalChanges}{" "}
                    {totalChanges === 1
                      ? "change"
                      : "changes"}
                  </>
                )}
              </p>
            </div>
          </div>

          {changes.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card px-6 py-10 shadow-sm">
              <h3 className="font-semibold text-foreground">
                No changes found
              </h3>

              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                No changes match the current
                filters.
              </p>
            </div>
          ) : (
            <div className="workspace-list space-y-4">
              {changes.map(
                (change) => (
                  <article
                    key={change.id}
                    className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
                  >
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-border bg-primary-subtle px-2.5 py-1 text-xs font-medium capitalize text-primary-text">
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

                        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <a
                            href={`/dashboard/competitors/${change.competitor_id}`}
                            className="font-semibold text-foreground hover:text-primary-text"
                          >
                            {
                              change.competitor_name
                            }
                          </a>

                          <span className="text-muted-foreground">
                            /
                          </span>

                          <span className="text-muted-foreground">
                            {change.monitored_page_label ||
                              change.monitored_page_url}
                          </span>
                        </div>
                      </div>

                      <time className="shrink-0 text-xs text-muted-foreground">
                        {formatDateTime(
                          change.detected_at
                        )}
                      </time>
                    </div>

                    <details className="workspace-change-disclosure"><summary><h3 className="mt-5 max-w-4xl text-lg font-semibold leading-7 text-foreground">
                      {change.summary ||
                        "Change detected."}
                    </h3></summary><div className="workspace-change-description">{change.why_it_matters ? (
                      <p className="mt-3 max-w-4xl text-sm leading-6 text-muted-foreground">
                        {
                          change.why_it_matters
                        }
                      </p>
                    ) : null}</div></details>

                    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
                      <a
                        href={`/dashboard/changes/${change.id}`}
                        className="inline-flex min-h-10 items-center rounded-xl border border-primary-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover active:bg-primary-active"
                      >
                        View change
                      </a>

                      <a
                        href={
                          change.monitored_page_url
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-10 items-center rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
                      >
                        Open monitored page
                      </a>
                    </div>
                  </article>
                )
              )}
            </div>
          )}

          {totalPages > 1 ? (
            <nav
              aria-label="Change history pagination"
              className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of{" "}
                {totalPages}
              </p>

              <div className="flex items-center gap-2">
                {currentPage > 1 ? (
                  <a
                    href={getHistoryPageUrl(
                      currentPage - 1
                    )}
                    className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
                  >
                    Previous
                  </a>
                ) : (
                  <span
                    aria-disabled="true"
                    className="inline-flex min-h-10 cursor-not-allowed items-center rounded-xl border border-border bg-muted px-4 py-2 text-sm font-medium text-disabled"
                  >
                    Previous
                  </span>
                )}

                {currentPage <
                totalPages ? (
                  <a
                    href={getHistoryPageUrl(
                      currentPage + 1
                    )}
                    className="inline-flex min-h-10 items-center rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
                  >
                    Next
                  </a>
                ) : (
                  <span
                    aria-disabled="true"
                    className="inline-flex min-h-10 cursor-not-allowed items-center rounded-xl border border-border bg-muted px-4 py-2 text-sm font-medium text-disabled"
                  >
                    Next
                  </span>
                )}
              </div>
            </nav>
          ) : null}
        </section>
      </div>
    </main>
  );
}
