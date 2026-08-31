import handler from "vinext/server/fetch-handler";
import { launch } from "@cloudflare/playwright";

interface Env {
  DB: D1Database;
  VINEXT_KV_CACHE: KVNamespace;
  BROWSER: BrowserRun;
  IMAGES: ImagesBinding;
  ASSETS: Fetcher;
  morrow_snapshots: R2Bucket;
}

interface DueMonitoredPage {
  id: string;
  competitor_id: string;
  url: string;
  frequency_minutes: number;
  last_checked_at: string | null;
  next_check_at: string | null;
}

async function captureRenderedPage(
  browser: Awaited<ReturnType<typeof launch>>,
  pageToCapture: DueMonitoredPage
) {
  const maxAttempts = 2;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    const page = await browser.newPage();

    try {
      const response = await page.goto(
        pageToCapture.url,
      );

      const title = await page.title();
      const html = await page.content();

      return {
        status: response?.status() ?? null,
        title,
        html,
      };
    } catch (error) {
      console.warn(
        "Morrow capture attempt failed",
        {
          id: pageToCapture.id,
          url: pageToCapture.url,
          attempt,
          maxAttempts,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        }
      );

      if (attempt === maxAttempts) {
        throw error;
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  throw new Error(
    "Page capture failed after retries"
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    return handler.fetch(request, env, ctx);
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ) {
    const scheduledAt = new Date(
      controller.scheduledTime
    ).toISOString();

    console.log("Morrow scheduler fired", {
      cron: controller.cron,
      scheduledAt,
    });

    const { results: duePages } =
      await env.DB.prepare(
        `
          SELECT
            monitored_pages.id,
            monitored_pages.competitor_id,
            monitored_pages.url,
            monitored_pages.frequency_minutes,
            monitored_pages.last_checked_at,
            monitored_pages.next_check_at
          FROM monitored_pages
          INNER JOIN competitors
            ON competitors.id =
               monitored_pages.competitor_id
          WHERE monitored_pages.status = 'active'
            AND competitors.status = 'active'
            AND (
              monitored_pages.next_check_at IS NULL
              OR datetime(
                monitored_pages.next_check_at
              ) <= datetime(?)
            )
          ORDER BY
            COALESCE(
              monitored_pages.next_check_at,
              monitored_pages.created_at
            ) ASC
          LIMIT 50
        `
      )
        .bind(scheduledAt)
        .all<DueMonitoredPage>();

    console.log(
      "Morrow due monitored pages",
      {
        count: duePages.length,
        pages: duePages.map((page) => ({
          id: page.id,
          url: page.url,
          frequencyMinutes:
            page.frequency_minutes,
          lastCheckedAt:
            page.last_checked_at,
          nextCheckAt:
            page.next_check_at,
        })),
      }
    );

    const claimedPages: DueMonitoredPage[] =
      [];

    for (const page of duePages) {
      const result = await env.DB.prepare(
        `
          UPDATE monitored_pages
          SET
            next_check_at =
              datetime(?, '+10 minutes'),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = 'active'
            AND (
              next_check_at IS NULL
              OR datetime(next_check_at)
                 <= datetime(?)
            )
        `
      )
        .bind(
          scheduledAt,
          page.id,
          scheduledAt
        )
        .run();

      if (result.meta.changes > 0) {
        claimedPages.push(page);
      }
    }

    console.log(
      "Morrow claimed monitored pages",
      {
        count: claimedPages.length,
        pages: claimedPages.map((page) => ({
          id: page.id,
          url: page.url,
        })),
      }
    );

    if (claimedPages.length > 0) {
      const browser = await launch(
        env.BROWSER
      );

      try {
        for (const pageToCapture of claimedPages) {
          try {
            const {
            status,
            title,
            html,
            } = await captureRenderedPage(
            browser,
            pageToCapture
            );
            const snapshotId = crypto.randomUUID();

            const htmlObjectKey =
            `snapshots/${pageToCapture.id}/${snapshotId}/page.html`;

            await env.morrow_snapshots.put(
            htmlObjectKey,
            html,
            {
                httpMetadata: {
                contentType: "text/html; charset=utf-8",
                },
            }
            );

            await env.DB.prepare(
            `
                INSERT INTO snapshots (
                id,
                monitored_page_id,
                html_object_key,
                http_status
                )
                VALUES (?, ?, ?, ?)
            `
            )
            .bind(
                snapshotId,
                pageToCapture.id,
                htmlObjectKey,
                status
            )
            .run();

            console.log(
              "Morrow captured rendered page",
              {
                id: pageToCapture.id,
                url: pageToCapture.url,
                status,
                title,
                htmlLength:
                  html.length,
              }
            );
            const capturedAt =
            new Date().toISOString();

            await env.DB.prepare(
            `
                UPDATE monitored_pages
                SET
                last_checked_at = datetime(?),
                next_check_at = datetime(
                    ?,
                    '+' || ? || ' minutes'
                ),
                updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `
            )
            .bind(
                capturedAt,
                capturedAt,
                pageToCapture.frequency_minutes,
                pageToCapture.id
            )
            .run();

            console.log(
            "Morrow capture schedule updated",
            {
                id: pageToCapture.id,
                capturedAt,
                frequencyMinutes:
                pageToCapture.frequency_minutes,
            }
            );
          } catch (error) {
            console.error(
              "Morrow page capture failed",
              {
                id: pageToCapture.id,
                url: pageToCapture.url,
                error:
                  error instanceof Error
                    ? error.message
                    : String(error),
              }
            );
          }
        }
      } catch (error) {
        console.error("Morrow scheduler fatal error", error);
        throw error;
      } finally {
        await browser.close();
      }
    }
  },
};