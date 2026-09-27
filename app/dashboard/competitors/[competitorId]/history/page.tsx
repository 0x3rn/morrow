import { auth } from "@/lib/auth";
import { ArrowLeftIcon } from "@/components/morrow-icons";
import { env } from "cloudflare:workers";
import Link from "next/link";
import { headers } from "next/headers";
import {
  notFound,
  redirect,
} from "next/navigation";

interface CompetitorHistoryPageProps {
  params: Promise<{
    competitorId: string;
  }>;

  searchParams: Promise<{
    page?: string | string[];
  }>;
}

interface CompetitorContext {
  id: string;
  name: string;
  domain: string;
  status: string;
}

interface CompetitorHistoryChange {
  id: string;
  category: string;
  significance: string;
  summary: string | null;
  why_it_matters: string | null;
  previous_text: string | null;
  current_text: string | null;
  detected_at: string;

  monitored_page_id: string;
  monitored_page_url: string;
  monitored_page_label: string | null;
}

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

export default async function CompetitorHistoryPage({
  params,
  searchParams,
}: CompetitorHistoryPageProps) {
  const session =
    await auth.api.getSession({
      headers: await headers(),
    });

  if (!session) {
    redirect("/login");
  }

  const { competitorId } = await params;
  const query = await searchParams;

  const requestedPageValue =
    getSearchParam(
      query.page
    ).trim();

  const requestedPage =
    /^\d+$/.test(
      requestedPageValue
    )
      ? Number(
          requestedPageValue
        )
      : 1;

  const page =
    Number.isSafeInteger(
      requestedPage
    ) &&
    requestedPage > 0
      ? requestedPage
      : 1;

  const competitor =
    await env.DB.prepare(
      `
        SELECT
          competitors.id,
          competitors.name,
          competitors.domain,
          competitors.status

        FROM competitors

        WHERE competitors.id = ?

          AND EXISTS (
            SELECT 1

            FROM workspace_members

            WHERE workspace_members.workspace_id =
                  competitors.workspace_id

              AND workspace_members.user_id = ?
          )

        LIMIT 1
      `
    )
      .bind(
        competitorId,
        session.user.id
      )
      .first<CompetitorContext>();

  if (!competitor) {
    notFound();
  }

  const countResult =
    await env.DB.prepare(
      `
        SELECT
          COUNT(*) AS total

        FROM changes

        INNER JOIN monitored_pages
          ON monitored_pages.id =
             changes.monitored_page_id

        INNER JOIN competitors
          ON competitors.id =
             monitored_pages.competitor_id

        WHERE competitors.id = ?
      `
    )
      .bind(
        competitor.id
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

  const {
    results: changes,
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

      INNER JOIN competitors
        ON competitors.id =
           monitored_pages.competitor_id

      WHERE competitors.id = ?

      ORDER BY
        datetime(
          changes.detected_at
        ) DESC,
        changes.id DESC

      LIMIT ?
      OFFSET ?
    `
  )
    .bind(
      competitor.id,
      HISTORY_PAGE_SIZE,
      offset
    )
    .all<CompetitorHistoryChange>();

  const historyCompetitorId =
    competitor.id;

  function getPageUrl(
    targetPage: number
  ) {
    const historyUrl =
      `/dashboard/competitors/${historyCompetitorId}/history`;

    if (targetPage <= 1) {
      return historyUrl;
    }

    return `${historyUrl}?page=${targetPage}`;
  }

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <nav className="mb-6">
          <Link
            href={`/dashboard/competitors/${competitor.id}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg pr-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25"
          >
            <ArrowLeftIcon />

            <span>
              {competitor.name}
            </span>
          </Link>
        </nav>

        <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-6 sm:px-7 sm:py-8 lg:px-9">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                  Competitor history
                </div>

                <h1 className="mt-2 break-words text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
                  {competitor.name}
                </h1>

                <p className="mt-3 break-all text-sm text-slate-500">
                  {competitor.domain}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span
                    className={
                      competitor.status ===
                      "active"
                        ? "rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                        : "rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                    }
                  >
                    {competitor.status ===
                    "active"
                      ? "Monitoring active"
                      : "Monitoring paused"}
                  </span>
                </div>
              </div>

              <Link
                href={`/dashboard/changes?competitor=${encodeURIComponent(
                  competitor.id
                )}`}
                className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Open in Change history
              </Link>
            </div>
          </div>

          <div className="border-t border-slate-200 px-5 py-5 sm:px-7">
            <div className="text-xs font-medium text-slate-500">
              Recorded changes
            </div>

            <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {totalChanges}
            </div>
          </div>
        </header>

        <section className="py-8 sm:py-10">
          <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.02em] text-slate-950">
                Timeline
              </h2>

              <p className="mt-2 text-sm text-slate-500">
                {totalChanges === 0 ? (
                  "No recorded changes"
                ) : (
                  <>
                    Showing{" "}
                    {offset + 1}–
                    {Math.min(
                      offset +
                        changes.length,
                      totalChanges
                    )}{" "}
                    of {totalChanges}
                  </>
                )}
              </p>
            </div>
          </div>

          {changes.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 shadow-sm sm:px-6">
              <h3 className="text-base font-semibold text-slate-900">
                No changes yet
              </h3>

              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                No meaningful changes have
                been detected for this
                competitor yet.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {changes.map(
                (change) => (
                  <article
                    key={change.id}
                    className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="p-5 sm:p-6">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
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

                        <time className="shrink-0 text-xs text-slate-400">
                          {formatDateTime(
                            change.detected_at
                          )}
                        </time>
                      </div>

                      <h3 className="mt-5 break-words text-lg font-semibold leading-7 tracking-[-0.01em] text-slate-950">
                        {change.summary ||
                          "Change detected."}
                      </h3>

                      {change.why_it_matters ? (
                        <div className="mt-5 rounded-xl bg-slate-50 px-4 py-4 sm:px-5">
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-600">
                            Why it matters
                          </div>

                          <p className="mt-2 break-words text-sm leading-6 text-slate-600">
                            {
                              change.why_it_matters
                            }
                          </p>
                        </div>
                      ) : null}

                      <div className="mt-5 min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 sm:px-5">
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                          Monitored page
                        </div>

                        <Link
                          href={`/dashboard/pages/${change.monitored_page_id}/history`}
                          className="mt-2 block break-words text-sm font-semibold text-slate-900 transition-colors hover:text-indigo-600"
                        >
                          {change.monitored_page_label ||
                            "Monitored page"}
                        </Link>

                        <a
                          href={
                            change.monitored_page_url
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block max-w-full break-all text-xs leading-5 text-slate-500 transition-colors hover:text-indigo-600"
                        >
                          {
                            change.monitored_page_url
                          }
                        </a>
                      </div>

                      {change.previous_text ||
                      change.current_text ? (
                        <details className="group mt-5">
                          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                            View before and after
                          </summary>

                          <div className="mt-3 grid min-w-0 overflow-hidden rounded-xl border border-slate-200 md:grid-cols-2">
                            <div className="min-w-0 bg-red-50/50 p-4 sm:p-5">
                              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-red-600">
                                Previous
                              </div>

                              <pre className="mt-3 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-700">
                                {change.previous_text ||
                                  "No previous text available."}
                              </pre>
                            </div>

                            <div className="min-w-0 border-t border-slate-200 bg-emerald-50/50 p-4 sm:p-5 md:border-l md:border-t-0">
                              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                                Current
                              </div>

                              <pre className="mt-3 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-700">
                                {change.current_text ||
                                  "No current text available."}
                              </pre>
                            </div>
                          </div>
                        </details>
                      ) : null}

                      <div className="mt-5 border-t border-slate-100 pt-4">
                        <Link
                          href={`/dashboard/changes/${change.id}`}
                          className="inline-flex min-h-10 items-center text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-500"
                        >
                          View change details
                        </Link>
                      </div>
                    </div>
                  </article>
                )
              )}
            </div>
          )}

          {totalPages > 1 ? (
            <nav
              aria-label="Competitor history pagination"
              className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-sm text-slate-500">
                Page {currentPage} of{" "}
                {totalPages}
              </p>

              <div className="flex items-center gap-2">
                {currentPage > 1 ? (
                  <Link
                    href={getPageUrl(
                      currentPage - 1
                    )}
                    className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Previous
                  </Link>
                ) : null}

                {currentPage <
                totalPages ? (
                  <Link
                    href={getPageUrl(
                      currentPage + 1
                    )}
                    className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Next
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </section>
      </div>
    </main>
  );
}
