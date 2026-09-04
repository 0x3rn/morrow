import { auth } from "@/lib/auth";
import { env } from "cloudflare:workers";
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
      return "border-red-200 bg-red-50 text-red-700";

    case "moderate":
      return "border-amber-200 bg-amber-50 text-amber-700";

    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
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

  const {
    results: competitors,
  } = await env.DB.prepare(
    `
      SELECT
        competitors.id,
        competitors.name

      FROM competitors

      WHERE EXISTS (
        SELECT 1

        FROM workspace_members

        WHERE workspace_members.workspace_id =
              competitors.workspace_id

          AND workspace_members.user_id = ?
      )

      ORDER BY
        competitors.name COLLATE NOCASE ASC
    `
  )
    .bind(
      session.user.id
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

  const conditions: string[] = [
    `
      EXISTS (
        SELECT 1

        FROM workspace_members

        WHERE workspace_members.workspace_id =
              competitors.workspace_id

          AND workspace_members.user_id = ?
      )
    `,
  ];

  const bindings: string[] = [
    session.user.id,
  ];

  if (competitorId) {
    conditions.push(
      "competitors.id = ?"
    );

    bindings.push(
      competitorId
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

    LIMIT 100
  `;

  const {
    results: changes,
  } = await env.DB.prepare(
    historySql
  )
    .bind(
      ...bindings
    )
    .all<HistoryChange>();

  const hasFilters =
    Boolean(
      keyword ||
      competitorId ||
      category ||
      significance ||
      dateFrom ||
      dateTo
    );

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <a
            href="/dashboard"
            className="text-sm font-medium text-slate-500 hover:text-slate-950"
          >
            ← Dashboard
          </a>

          <div className="mt-6">
            <h1 className="text-3xl font-semibold tracking-tight">
              Change history
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Search meaningful competitor
              changes that Morrow has already
              detected, classified, and
              summarized.
            </p>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <form
            method="get"
            className="grid gap-4 lg:grid-cols-6"
          >
            <div className="lg:col-span-2">
              <label
                htmlFor="q"
                className="mb-1.5 block text-xs font-medium text-slate-600"
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
                placeholder="Pricing, feature, competitor..."
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
              />
            </div>

            <div>
              <label
                htmlFor="competitor"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Competitor
              </label>

              <select
                id="competitor"
                name="competitor"
                defaultValue={
                  competitorId
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-indigo-400"
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

            <div>
              <label
                htmlFor="category"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Category
              </label>

              <select
                id="category"
                name="category"
                defaultValue={
                  category
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-indigo-400"
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
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Significance
              </label>

              <select
                id="significance"
                name="significance"
                defaultValue={
                  significance
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-indigo-400"
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

            <div className="grid grid-cols-2 gap-3 lg:col-span-2">
              <div>
                <label
                  htmlFor="from"
                  className="mb-1.5 block text-xs font-medium text-slate-600"
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
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
                />
              </div>

              <div>
                <label
                  htmlFor="to"
                  className="mb-1.5 block text-xs font-medium text-slate-600"
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
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
                />
              </div>
            </div>

            <div className="flex items-end gap-2 lg:col-span-4">
              <button
                type="submit"
                className="min-h-10 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Apply filters
              </button>

              {hasFilters ? (
                <a
                  href="/dashboard/changes"
                  className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Clear
                </a>
              ) : null}
            </div>
          </form>
        </section>

        <section className="mt-8">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">
                Timeline
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {changes.length}{" "}
                {changes.length === 1
                  ? "change"
                  : "changes"}
                {changes.length === 100
                  ? " shown, limited to the latest 100"
                  : ""}
              </p>
            </div>
          </div>

          {changes.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 shadow-sm">
              <h3 className="font-semibold text-slate-900">
                No changes found
              </h3>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                There are no persisted
                changes matching the current
                filters.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {changes.map(
                (change) => (
                  <article
                    key={change.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
                  >
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div>
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

                        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <a
                            href={`/dashboard/competitors/${change.competitor_id}`}
                            className="font-semibold text-slate-900 hover:text-indigo-600"
                          >
                            {
                              change.competitor_name
                            }
                          </a>

                          <span className="text-slate-300">
                            /
                          </span>

                          <span className="text-slate-500">
                            {change.monitored_page_label ||
                              change.monitored_page_url}
                          </span>
                        </div>
                      </div>

                      <time className="shrink-0 text-xs text-slate-400">
                        {formatDateTime(
                          change.detected_at
                        )}
                      </time>
                    </div>

                    <h3 className="mt-5 max-w-4xl text-lg font-semibold leading-7 text-slate-950">
                      {change.summary ||
                        "A meaningful competitor change was detected."}
                    </h3>

                    {change.why_it_matters ? (
                      <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-600">
                        {
                          change.why_it_matters
                        }
                      </p>
                    ) : null}

                    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                      <a
                        href={`/dashboard/changes/${change.id}`}
                        className="inline-flex min-h-10 items-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                      >
                        View change
                      </a>

                      <a
                        href={
                          change.monitored_page_url
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Open monitored page
                      </a>
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
