import { auth } from "@/lib/auth";
import { ArrowLeftIcon } from "@/components/morrow-icons";
import { env } from "cloudflare:workers";
import Link from "next/link";
import { headers } from "next/headers";
import {
  notFound,
  redirect,
} from "next/navigation";

interface SnapshotHistoryProps {
  params: Promise<{
    pageId: string;
  }>;

  searchParams: Promise<{
    page?: string | string[];
  }>;
}

interface MonitoredPageContext {
  id: string;
  url: string;
  label: string | null;
  status: string;

  competitor_id: string;
  competitor_name: string;
}

interface SnapshotHistoryEntry {
  id: string;
  content_hash: string | null;
  screenshot_object_key: string | null;
  http_status: number | null;
  captured_at: string;

  change_id: string | null;
  change_category: string | null;
  change_significance: string | null;
  change_summary: string | null;
}

const SNAPSHOT_PAGE_SIZE = 25;

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
  value: string
) {
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

function getHttpStatusClasses(
  status: number | null
) {
  if (
    status !== null &&
    status >= 200 &&
    status < 300
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (
    status !== null &&
    status >= 400
  ) {
    return "border-red-200 bg-red-50 text-red-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}

export default async function SnapshotHistory({
  params,
  searchParams,
}: SnapshotHistoryProps) {
  const session =
    await auth.api.getSession({
      headers: await headers(),
    });

  if (!session) {
    redirect("/login");
  }

  const { pageId } = await params;
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

  const monitoredPage =
    await env.DB.prepare(
      `
        SELECT
          monitored_pages.id,
          monitored_pages.url,
          monitored_pages.label,
          monitored_pages.status,

          competitors.id
            AS competitor_id,

          competitors.name
            AS competitor_name

        FROM monitored_pages

        INNER JOIN competitors
          ON competitors.id =
             monitored_pages.competitor_id

        WHERE monitored_pages.id = ?

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
        pageId,
        session.user.id
      )
      .first<MonitoredPageContext>();

  if (!monitoredPage) {
    notFound();
  }

  const monitoredPageId =
    monitoredPage.id;

  const countResult =
    await env.DB.prepare(
      `
        SELECT
          COUNT(*) AS total

        FROM snapshots

        WHERE snapshots.monitored_page_id = ?
      `
    )
      .bind(
        monitoredPageId
      )
      .first<{
        total: number;
      }>();

  const totalSnapshots =
    Number(
      countResult?.total ?? 0
    );

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        totalSnapshots /
          SNAPSHOT_PAGE_SIZE
      )
    );

  const currentPage =
    Math.min(
      page,
      totalPages
    );

  const offset =
    (currentPage - 1) *
    SNAPSHOT_PAGE_SIZE;

  const {
    results: snapshots,
  } = await env.DB.prepare(
    `
      SELECT
        snapshots.id,
        snapshots.content_hash,
        snapshots.screenshot_object_key,
        snapshots.http_status,
        snapshots.captured_at,

        changes.id
          AS change_id,

        changes.category
          AS change_category,

        changes.significance
          AS change_significance,

        changes.summary
          AS change_summary

      FROM snapshots

      LEFT JOIN changes
        ON changes.current_snapshot_id =
           snapshots.id

        AND changes.monitored_page_id =
            snapshots.monitored_page_id

      WHERE snapshots.monitored_page_id = ?

      ORDER BY
        datetime(
          snapshots.captured_at
        ) DESC,
        snapshots.id DESC

      LIMIT ?
      OFFSET ?
    `
  )
    .bind(
      monitoredPageId,
      SNAPSHOT_PAGE_SIZE,
      offset
    )
    .all<SnapshotHistoryEntry>();

  function getPageUrl(
    targetPage: number
  ) {
    if (targetPage <= 1) {
      return `/dashboard/pages/${monitoredPageId}/snapshots`;
    }

    return `/dashboard/pages/${monitoredPageId}/snapshots?page=${targetPage}`;
  }

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <nav className="mb-6">
          <Link
            href={`/dashboard/pages/${monitoredPageId}/history`}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg pr-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25"
          >
            <ArrowLeftIcon />

            <span>
              Change history
            </span>
          </Link>
        </nav>

        <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-6 sm:px-7 sm:py-8 lg:px-9">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                  Snapshot history
                </div>

                <h1 className="mt-2 break-words text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
                  {monitoredPage.label ||
                    "Monitored page"}
                </h1>

                <a
                  href={monitoredPage.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block max-w-3xl break-all text-sm text-slate-500 transition-colors hover:text-indigo-600"
                >
                  {monitoredPage.url}
                </a>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {
                      monitoredPage.competitor_name
                    }
                  </span>

                  <span
                    className={
                      monitoredPage.status ===
                      "active"
                        ? "rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                        : "rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                    }
                  >
                    {monitoredPage.status ===
                    "active"
                      ? "Monitoring active"
                      : "Monitoring paused"}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <Link
                  href={`/dashboard/pages/${monitoredPageId}/history`}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Change history
                </Link>

                <Link
                  href={`/dashboard/competitors/${monitoredPage.competitor_id}`}
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Competitor profile
                </Link>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 px-5 py-5 sm:px-7">
            <div className="text-xs font-medium text-slate-500">
              Retained snapshots
            </div>

            <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {totalSnapshots}
            </div>
          </div>
        </header>

        <section className="py-8 sm:py-10">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold tracking-[-0.02em] text-slate-950">
              Captures
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              {totalSnapshots === 0 ? (
                "No retained snapshots"
              ) : (
                <>
                  Showing{" "}
                  {offset + 1}–
                  {Math.min(
                    offset +
                      snapshots.length,
                    totalSnapshots
                  )}{" "}
                  of {totalSnapshots}
                </>
              )}
            </p>
          </div>

          {snapshots.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 shadow-sm sm:px-6">
              <h3 className="text-base font-semibold text-slate-900">
                No snapshots yet
              </h3>

              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                No captures have been
                retained for this page yet.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {snapshots.map(
                (snapshot) => {
                  const hasChange =
                    Boolean(
                      snapshot.change_id
                    );

                  const hasScreenshot =
                    Boolean(
                      snapshot.screenshot_object_key
                    );

                  return (
                    <article
                      key={snapshot.id}
                      className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                    >
                      <div className="p-5 sm:p-6">
                        <div className="flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-start">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={
                                  hasChange
                                    ? "rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700"
                                    : "rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                                }
                              >
                                {hasChange
                                  ? "Meaningful change detected"
                                  : "No meaningful change recorded"}
                              </span>

                              <span
                                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${getHttpStatusClasses(
                                  snapshot.http_status
                                )}`}
                              >
                                HTTP{" "}
                                {snapshot.http_status ??
                                  "unknown"}
                              </span>
                            </div>

                            <time className="mt-3 block text-sm font-medium text-slate-700">
                              {formatDateTime(
                                snapshot.captured_at
                              )}
                            </time>
                          </div>

                          {hasScreenshot ? (
                            <a
                              href={`/api/snapshots/${encodeURIComponent(
                                snapshot.id
                              )}/screenshot`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                            >
                              Open full capture
                            </a>
                          ) : (
                            <span className="inline-flex min-h-10 shrink-0 items-center text-sm text-slate-400">
                              Capture unavailable
                            </span>
                          )}
                        </div>

                        <div className="mt-5 grid min-w-0 gap-4 border-t border-slate-100 pt-5 md:grid-cols-2">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-500">
                              Content hash
                            </div>

                            <div className="mt-2 max-w-full break-all font-mono text-xs leading-5 text-slate-700">
                              {snapshot.content_hash ||
                                "Unavailable"}
                            </div>
                          </div>

                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-500">
                              Snapshot ID
                            </div>

                            <div className="mt-2 max-w-full break-all font-mono text-xs leading-5 text-slate-700">
                              {snapshot.id}
                            </div>
                          </div>
                        </div>

                        {hasChange &&
                        snapshot.change_id ? (
                          <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 sm:p-5">
                            <div className="flex flex-wrap items-center gap-2">
                              {snapshot.change_category ? (
                                <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium capitalize text-indigo-700">
                                  {
                                    snapshot.change_category
                                  }
                                </span>
                              ) : null}

                              {snapshot.change_significance ? (
                                <span
                                  className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${getSignificanceClasses(
                                    snapshot.change_significance
                                  )}`}
                                >
                                  {
                                    snapshot.change_significance
                                  }
                                </span>
                              ) : null}
                            </div>

                            <h3 className="mt-3 break-words text-sm font-semibold leading-6 text-slate-900">
                              {snapshot.change_summary ||
                                "Meaningful change detected."}
                            </h3>

                            <Link
                              href={`/dashboard/changes/${snapshot.change_id}`}
                              className="mt-3 inline-flex min-h-10 items-center text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-500"
                            >
                              View change details
                            </Link>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                }
              )}
            </div>
          )}

          {totalPages > 1 ? (
            <nav
              aria-label="Snapshot history pagination"
              className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-sm text-slate-500">
                Page {currentPage} of{" "}
                {totalPages}
              </p>

              <div className="flex flex-wrap items-center gap-2">
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
