import { auth } from "@/lib/auth";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
interface ScreenshotRouteContext {
  params: Promise<{
    changeId: string;
    side: string;
  }>;
}
interface ScreenshotLookup {
  previous_screenshot_object_key: string | null;
  current_screenshot_object_key: string | null;
}
export async function GET(
  _request: Request,
  context: ScreenshotRouteContext
) {
  const session =
    await auth.api.getSession({
      headers:
        await headers(),
    });
  if (!session) {
    return new Response(
      "Unauthorized",
      {
        status: 401,
      }
    );
  }
  const {
    changeId,
    side,
  } =
    await context.params;
  if (
    side !== "previous" &&
    side !== "current"
  ) {
    return new Response(
      "Not found",
      {
        status: 404,
      }
    );
  }
  const screenshot =
    await env.DB.prepare(
      `
        SELECT
          previous_snapshot.screenshot_object_key
            AS previous_screenshot_object_key,
          current_snapshot.screenshot_object_key
            AS current_screenshot_object_key
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
      .first<ScreenshotLookup>();
  if (!screenshot) {
    return new Response(
      "Not found",
      {
        status: 404,
      }
    );
  }
  const objectKey =
    side === "previous"
      ? screenshot
          .previous_screenshot_object_key
      : screenshot
          .current_screenshot_object_key;
  if (!objectKey) {
    return new Response(
      "Not found",
      {
        status: 404,
      }
    );
  }
  const object =
    await env.morrow_snapshots.get(
      objectKey
    );
  if (!object) {
    return new Response(
      "Not found",
      {
        status: 404,
      }
    );
  }
  const responseHeaders =
    new Headers();
  object.writeHttpMetadata(
    responseHeaders
  );
  responseHeaders.set(
    "Content-Type",
    object.httpMetadata
      ?.contentType ??
      "image/png"
  );
  responseHeaders.set(
    "Content-Disposition",
    `inline; filename="${side}-capture.png"`
  );
  responseHeaders.set(
    "Cache-Control",
    "private, max-age=300"
  );
  responseHeaders.set(
    "X-Content-Type-Options",
    "nosniff"
  );
  responseHeaders.set(
    "ETag",
    object.httpEtag
  );
  return new Response(
    object.body,
    {
      status: 200,
      headers:
        responseHeaders,
    }
  );
}
