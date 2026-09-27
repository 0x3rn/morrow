import { auth } from "@/lib/auth";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";

interface SnapshotScreenshotRouteContext {
  params: Promise<{
    snapshotId: string;
  }>;
}

interface SnapshotScreenshotLookup {
  screenshot_object_key: string | null;
}

export async function GET(
  _request: Request,
  context: SnapshotScreenshotRouteContext
) {
  const session =
    await auth.api.getSession({
      headers: await headers(),
    });

  if (!session) {
    return new Response(
      "Unauthorized",
      {
        status: 401,
      }
    );
  }

  const { snapshotId } =
    await context.params;

  const snapshot =
    await env.DB.prepare(
      `
        SELECT
          snapshots.screenshot_object_key

        FROM snapshots

        INNER JOIN monitored_pages
          ON monitored_pages.id =
             snapshots.monitored_page_id

        INNER JOIN competitors
          ON competitors.id =
             monitored_pages.competitor_id

        WHERE snapshots.id = ?

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
        snapshotId,
        session.user.id
      )
      .first<SnapshotScreenshotLookup>();

  if (!snapshot) {
    return new Response(
      "Not found",
      {
        status: 404,
      }
    );
  }

  const objectKey =
    snapshot.screenshot_object_key;

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
    `inline; filename="snapshot-capture.png"`
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
