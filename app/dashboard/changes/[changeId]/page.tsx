import { auth } from "@/lib/auth";
import { ArrowLeftIcon } from "@/components/morrow-icons";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import {
  notFound,
  redirect,
} from "next/navigation";

interface ChangeDetailPageProps {
  params: Promise<{
    changeId: string;
  }>;
}

interface ChangeDetail {
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
  previous_snapshot_hash: string | null;
  previous_snapshot_http_status: number | null;
  previous_snapshot_captured_at: string | null;
  previous_snapshot_text_object_key: string | null;
  previous_snapshot_html_object_key: string | null;
  previous_snapshot_screenshot_object_key: string | null;

  current_snapshot_id: string;
  current_snapshot_hash: string | null;
  current_snapshot_http_status: number | null;
  current_snapshot_captured_at: string | null;
  current_snapshot_text_object_key: string | null;
  current_snapshot_html_object_key: string | null;
  current_snapshot_screenshot_object_key: string | null;
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
    return "Not available";
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

export default async function ChangeDetailPage({
  params,
}: ChangeDetailPageProps) {
  const session =
    await auth.api.getSession({
      headers: await headers(),
    });

  if (!session) {
    redirect("/login");
  }

  const { changeId } = await params;

  const change =
    await env.DB.prepare(
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
            AS monitored_page_label,

          previous_snapshot.id
            AS previous_snapshot_id,

          previous_snapshot.content_hash
            AS previous_snapshot_hash,

          previous_snapshot.http_status
            AS previous_snapshot_http_status,

          previous_snapshot.captured_at
            AS previous_snapshot_captured_at,

          previous_snapshot.text_object_key
            AS previous_snapshot_text_object_key,

          previous_snapshot.html_object_key
            AS previous_snapshot_html_object_key,

          previous_snapshot.screenshot_object_key
            AS previous_snapshot_screenshot_object_key,

          current_snapshot.id
            AS current_snapshot_id,

          current_snapshot.content_hash
            AS current_snapshot_hash,

          current_snapshot.http_status
            AS current_snapshot_http_status,

          current_snapshot.captured_at
            AS current_snapshot_captured_at,

          current_snapshot.text_object_key
            AS current_snapshot_text_object_key,

          current_snapshot.html_object_key
            AS current_snapshot_html_object_key,

          current_snapshot.screenshot_object_key
            AS current_snapshot_screenshot_object_key

        FROM changes

        INNER JOIN monitored_pages
          ON monitored_pages.id =
             changes.monitored_page_id

        INNER JOIN competitors
          ON competitors.id =
             monitored_pages.competitor_id

        LEFT JOIN snapshots
          AS previous_snapshot

          ON previous_snapshot.id =
             changes.previous_snapshot_id

        LEFT JOIN snapshots
          AS current_snapshot

          ON current_snapshot.id =
             changes.current_snapshot_id

        WHERE changes.id = ?

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
        changeId,
        session.user.id
      )
      .first<ChangeDetail>();

  if (!change) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#f7f8fb] text-slate-950">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <nav className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <a
            href="/dashboard/changes"
            className="inline-flex items-center gap-2 font-medium text-slate-500 hover:text-slate-950"
          >
            <ArrowLeftIcon />
            <span>Change history</span>
          </a>

          <span className="text-slate-300">
            /
          </span>

          <a
            href={`/dashboard/competitors/${change.competitor_id}`}
            className="font-medium text-slate-500 hover:text-indigo-600"
          >
            {change.competitor_name}
          </a>
        </nav>

        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium capitalize text-indigo-700">
                  {change.category}
                </span>

                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${getSignificanceClasses(
                    change.significance
                  )}`}
                >
                  {change.significance}
                </span>
              </div>

              <h1 className="mt-5 max-w-4xl text-2xl font-semibold leading-9 tracking-tight text-slate-950 sm:text-3xl">
                {change.summary ||
                  "Meaningful competitor change"}
              </h1>

              {change.why_it_matters ? (
                <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-600 sm:text-[15px]">
                  {
                    change.why_it_matters
                  }
                </p>
              ) : null}
            </div>

            <time className="shrink-0 text-xs text-slate-400">
              {formatDateTime(
                change.detected_at
              )}
            </time>
          </div>

          <div className="mt-7 grid gap-5 border-t border-slate-100 pt-6 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-slate-400">
                Competitor
              </div>

              <a
                href={`/dashboard/competitors/${change.competitor_id}`}
                className="mt-1 block font-semibold text-slate-900 hover:text-indigo-600"
              >
                {
                  change.competitor_name
                }
              </a>

              <div className="mt-1 text-sm text-slate-500">
                {
                  change.competitor_domain
                }
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-400">
                Monitored page
              </div>

              <div className="mt-1 font-semibold text-slate-900">
                {change.monitored_page_label ||
                  "Unlabelled page"}
              </div>

              <a
                href={
                  change.monitored_page_url
                }
                target="_blank"
                rel="noreferrer"
                className="mt-1 block break-all text-sm text-indigo-600 hover:text-indigo-500"
              >
                {
                  change.monitored_page_url
                }
              </a>
            </div>
          </div>
        </header>

        <section className="mt-8">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">
              Before and after
            </h2>

            <p className="mt-1 text-sm leading-6 text-slate-500">
              Bounded changed-only evidence
              persisted when this meaningful
              change was recorded.
            </p>
          </div>

          <div className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-2">
            <div className="bg-red-50/40 p-5 sm:p-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-red-700">
                Previous
              </div>

              <pre className="mt-4 whitespace-pre-wrap break-words font-mono text-sm leading-7 text-slate-700">
                {change.previous_text ||
                  "No previous changed-text evidence was stored."}
              </pre>
            </div>

            <div className="border-t border-slate-200 bg-emerald-50/40 p-5 sm:p-6 lg:border-l lg:border-t-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Current
              </div>

              <pre className="mt-4 whitespace-pre-wrap break-words font-mono text-sm leading-7 text-slate-700">
                {change.current_text ||
                  "No current changed-text evidence was stored."}
              </pre>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">
              Source snapshots
            </h2>

            <p className="mt-1 text-sm leading-6 text-slate-500">
              Snapshot metadata links this
              interpreted change back to the
              source captures that produced it.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h3 className="font-semibold text-slate-900">
                Previous snapshot
              </h3>

              {change.previous_snapshot_id ? (
                <dl className="mt-5 space-y-4">
                  <div>
                    <dt className="text-xs text-slate-400">
                      Snapshot ID
                    </dt>

                    <dd className="mt-1 break-all font-mono text-xs text-slate-700">
                      {
                        change.previous_snapshot_id
                      }
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-slate-400">
                      Captured
                    </dt>

                    <dd className="mt-1 text-sm font-medium text-slate-800">
                      {formatDateTime(
                        change.previous_snapshot_captured_at
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-slate-400">
                      HTTP status
                    </dt>

                    <dd
                      className={`mt-1 text-sm font-semibold ${getHttpStatusClasses(
                        change.previous_snapshot_http_status
                      )}`}
                    >
                      {change.previous_snapshot_http_status ??
                        "Not available"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-slate-400">
                      Content hash
                    </dt>

                    <dd className="mt-1 break-all font-mono text-xs text-slate-600">
                      {change.previous_snapshot_hash ||
                        "Not available"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-4 text-sm leading-6 text-slate-500">
                  This change does not have a
                  previous snapshot reference.
                </p>
              )}
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h3 className="font-semibold text-slate-900">
                Current snapshot
              </h3>

              <dl className="mt-5 space-y-4">
                <div>
                  <dt className="text-xs text-slate-400">
                    Snapshot ID
                  </dt>

                  <dd className="mt-1 break-all font-mono text-xs text-slate-700">
                    {
                      change.current_snapshot_id
                    }
                  </dd>
                </div>

                <div>
                  <dt className="text-xs text-slate-400">
                    Captured
                  </dt>

                  <dd className="mt-1 text-sm font-medium text-slate-800">
                    {formatDateTime(
                      change.current_snapshot_captured_at
                    )}
                  </dd>
                </div>

                <div>
                  <dt className="text-xs text-slate-400">
                    HTTP status
                  </dt>

                  <dd
                    className={`mt-1 text-sm font-semibold ${getHttpStatusClasses(
                      change.current_snapshot_http_status
                    )}`}
                  >
                    {change.current_snapshot_http_status ??
                      "Not available"}
                  </dd>
                </div>

                <div>
                  <dt className="text-xs text-slate-400">
                    Content hash
                  </dt>

                  <dd className="mt-1 break-all font-mono text-xs text-slate-600">
                    {change.current_snapshot_hash ||
                      "Not available"}
                  </dd>
                </div>
              </dl>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
