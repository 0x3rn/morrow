import { auth } from "@/lib/auth";
import { MORROW_MVP_USAGE_LIMITS } from "@/lib/usage-limits";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardOverview, type DashboardOverviewRow, type DashboardMonitoringRow, type DashboardRecentChange } from "./overview";

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
      "/login"
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

  return <DashboardOverview metrics={metrics} usage={usage} monitoringRows={monitoringRows} recentChanges={recentChanges} />;
}
