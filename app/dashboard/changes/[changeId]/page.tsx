import { CaptureImage } from "@/components/capture-image";

import { auth } from "@/lib/auth";
import { ArrowLeftIcon } from "@/components/morrow-icons";
import { env } from "cloudflare:workers";
import Link from "next/link";
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
      return "border-destructive-border bg-destructive-bg text-destructive";

    case "moderate":
      return "border-warning-border bg-warning-bg text-warning";

    default:
      return "border-border bg-muted text-muted-foreground";
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
    return "text-success";
  }

  if (status !== null) {
    return "text-destructive";
  }

  return "text-muted-foreground";
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

  const previousScreenshotUrl =
    change.previous_snapshot_id &&
    change.previous_snapshot_screenshot_object_key
      ? `/api/changes/${encodeURIComponent(
          change.id
        )}/screenshot/previous`
      : null;

  const currentScreenshotUrl =
    change.current_snapshot_screenshot_object_key
      ? `/api/changes/${encodeURIComponent(
          change.id
        )}/screenshot/current`
      : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <nav className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <Link
            href="/dashboard/changes"
            className="inline-flex items-center gap-2 font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon />
            <span>Change history</span>
          </Link>

          <span className="text-muted-foreground">
            /
          </span>

          <a
            href={`/dashboard/competitors/${change.competitor_id}`}
            className="font-medium text-muted-foreground hover:text-primary-text"
          >
            {change.competitor_name}
          </a>
        </nav>

        <header className="workspace-change-detail-header rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <div className="workspace-detail-badges">
                <span className="workspace-badge workspace-category bg-primary-subtle text-primary-text">
                  {change.category}
                </span>

                <span
                  className={`workspace-badge workspace-category ${getSignificanceClasses(
                    change.significance
                  )}`}
                >
                  {change.significance}
                </span>
              </div>

              <h1 className="mt-5 max-w-4xl text-2xl font-semibold leading-9 tracking-tight text-foreground sm:text-3xl">
                {change.summary ||
                  "Change detected"}
              </h1>

              {change.why_it_matters ? (
                <p className="mt-4 max-w-4xl text-sm leading-7 text-muted-foreground sm:text-[15px]">
                  {
                    change.why_it_matters
                  }
                </p>
              ) : null}
            </div>

            <time className="shrink-0 text-xs text-muted-foreground">
              {formatDateTime(
                change.detected_at
              )}
            </time>
          </div>

          <div className="mt-7 grid gap-5 border-t border-border pt-6 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-muted-foreground">
                Competitor
              </div>

              <a
                href={`/dashboard/competitors/${change.competitor_id}`}
                className="mt-1 block font-semibold text-foreground hover:text-primary-text"
              >
                {
                  change.competitor_name
                }
              </a>

              <div className="mt-1 text-sm text-muted-foreground">
                {
                  change.competitor_domain
                }
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-muted-foreground">
                Monitored page
              </div>

              <div className="mt-1 font-semibold text-foreground">
                {change.monitored_page_label ||
                  "Unlabelled page"}
              </div>

              <a
                href={
                  change.monitored_page_url
                }
                target="_blank"
                rel="noreferrer"
                className="mt-1 block break-all text-sm text-primary-text hover:underline"
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

            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The text Morrow recorded before
              and after this change.
            </p>
          </div>

          <div className="workspace-evidence grid overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:grid-cols-2">
            <div className="bg-destructive-bg p-5 sm:p-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-destructive">
                Previous
              </div>

              <pre className="mt-4 whitespace-pre-wrap break-words font-mono text-sm leading-7 text-foreground">
                {change.previous_text ||
                  "No previous text is available for this change."}
              </pre>
            </div>

            <div className="border-t border-border bg-success-bg p-5 sm:p-6 lg:border-l lg:border-t-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-success">
                Current
              </div>

              <pre className="mt-4 whitespace-pre-wrap break-words font-mono text-sm leading-7 text-foreground">
                {change.current_text ||
                  "No current text is available for this change."}
              </pre>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">
              Visual comparison
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Captured page before and after
              this change.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <article className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
                <div>
                  <h3 className="font-semibold text-foreground">
                    Previous capture
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(
                      change.previous_snapshot_captured_at
                    )}
                  </p>
                </div>
                {previousScreenshotUrl ? (
                  <a
                    href={previousScreenshotUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    Open full capture
                  </a>
                ) : null}
              </div>
              {previousScreenshotUrl ? (
                <CaptureImage
                  src={previousScreenshotUrl}
                  alt={`Previous capture of ${
                    change.monitored_page_label ||
                    change.monitored_page_url
                  }`}
                />
              ) : (
                <div className="flex min-h-64 items-center justify-center p-6 text-center text-sm leading-6 text-muted-foreground">
                  No previous screenshot is
                  available for this change.
                </div>
              )}
            </article>
            <article className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
                <div>
                  <h3 className="font-semibold text-foreground">
                    Current capture
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(
                      change.current_snapshot_captured_at
                    )}
                  </p>
                </div>
                {currentScreenshotUrl ? (
                  <a
                    href={currentScreenshotUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    Open full capture
                  </a>
                ) : null}
              </div>
              {currentScreenshotUrl ? (
                <CaptureImage
                  src={currentScreenshotUrl}
                  alt={`Current capture of ${
                    change.monitored_page_label ||
                    change.monitored_page_url
                  }`}
                />
              ) : (
                <div className="flex min-h-64 items-center justify-center p-6 text-center text-sm leading-6 text-muted-foreground">
                  No current screenshot is
                  available for this change.
                </div>
              )}
            </article>
          </div>
        </section>

        <details className="workspace-source-captures workspace-secondary-disclosure"><summary><h2 className="text-xl font-semibold">
              Source captures
            </h2></summary><p className="mt-1 text-sm leading-6 text-muted-foreground">
              Capture details for the page
              versions used to record this
              change.
            </p><div className="grid gap-5 lg:grid-cols-2">
            <article className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <h3 className="font-semibold text-foreground">
                Previous capture
              </h3>

              {change.previous_snapshot_id ? (
                <dl className="mt-5 space-y-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Capture ID
                    </dt>

                    <dd className="mt-1 break-all font-mono text-xs text-foreground">
                      {
                        change.previous_snapshot_id
                      }
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Captured
                    </dt>

                    <dd className="mt-1 text-sm font-medium text-foreground">
                      {formatDateTime(
                        change.previous_snapshot_captured_at
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-muted-foreground">
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
                    <dt className="text-xs text-muted-foreground">
                      Content hash
                    </dt>

                    <dd className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {change.previous_snapshot_hash ||
                        "Not available"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  No previous capture is available
                  for this change.
                </p>
              )}
            </article>

            <article className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <h3 className="font-semibold text-foreground">
                Current capture
              </h3>

              <dl className="mt-5 space-y-4">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Capture ID
                  </dt>

                  <dd className="mt-1 break-all font-mono text-xs text-foreground">
                    {
                      change.current_snapshot_id
                    }
                  </dd>
                </div>

                <div>
                  <dt className="text-xs text-muted-foreground">
                    Captured
                  </dt>

                  <dd className="mt-1 text-sm font-medium text-foreground">
                    {formatDateTime(
                      change.current_snapshot_captured_at
                    )}
                  </dd>
                </div>

                <div>
                  <dt className="text-xs text-muted-foreground">
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
                  <dt className="text-xs text-muted-foreground">
                    Content hash
                  </dt>

                  <dd className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {change.current_snapshot_hash ||
                      "Not available"}
                  </dd>
                </div>
              </dl>
            </article>
          </div></details>
      </div>
    </main>
  );
}
