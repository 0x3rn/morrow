"use server";

import { auth } from "@/lib/auth";
import { MORROW_MVP_USAGE_LIMITS } from "@/lib/usage-limits";
import { env } from "cloudflare:workers";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

interface OwnedCompetitorRow {
  id: string;
  workspace_id: string;
}

interface IdRow {
  id: string;
}

interface UsageCountRow {
  workspace_page_count: number;
  competitor_page_count: number;
}

function normalizeMonitoredUrl(
  value: string
) {
  let input =
    value.trim();

  if (
    !/^https?:\/\//i.test(
      input
    )
  ) {
    input =
      `https://${input}`;
  }

  const url =
    new URL(
      input
    );

  if (
    url.protocol !==
      "http:" &&
    url.protocol !==
      "https:"
  ) {
    throw new Error(
      "Only HTTP and HTTPS URLs can be monitored."
    );
  }

  url.hash = "";

  return url.toString();
}

function isUniqueConstraintError(
  error: unknown
) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  return /unique constraint/i.test(
    message
  );
}

async function getOwnedCompetitor(
  competitorId: string,
  userId: string
) {
  return env.DB.prepare(
    `
      SELECT
        competitors.id,
        competitors.workspace_id

      FROM competitors

      INNER JOIN workspace_members
        ON workspace_members.workspace_id =
           competitors.workspace_id

      WHERE competitors.id = ?
        AND workspace_members.user_id = ?

      LIMIT 1
    `
  )
    .bind(
      competitorId,
      userId
    )
    .first<OwnedCompetitorRow>();
}

async function getPageUsage(
  workspaceId: string,
  competitorId: string
) {
  const usage =
    await env.DB.prepare(
      `
        SELECT
          (
            SELECT
              COUNT(*)

            FROM monitored_pages

            INNER JOIN competitors
              ON competitors.id =
                 monitored_pages.competitor_id

            WHERE competitors.workspace_id = ?
          ) AS workspace_page_count,

          (
            SELECT
              COUNT(*)

            FROM monitored_pages

            WHERE competitor_id = ?
          ) AS competitor_page_count
      `
    )
      .bind(
        workspaceId,
        competitorId
      )
      .first<UsageCountRow>();

  return {
    workspacePages:
      Number(
        usage?.workspace_page_count ??
        0
      ),

    competitorPages:
      Number(
        usage?.competitor_page_count ??
        0
      ),
  };
}

function revalidateCompetitorViews(
  competitorId: string
) {
  revalidatePath(
    "/dashboard"
  );

  revalidatePath(
    "/dashboard/competitors"
  );

  revalidatePath(
    `/dashboard/competitors/${competitorId}`
  );
}

export async function createMonitoredPage(
  formData: FormData
) {
  const session =
    await auth.api.getSession({
      headers:
        await headers(),
    });

  if (
    !session
  ) {
    throw new Error(
      "Unauthorized"
    );
  }

  const competitorId =
    String(
      formData.get(
        "competitorId"
      ) || ""
    ).trim();

  const rawUrl =
    String(
      formData.get(
        "url"
      ) || ""
    ).trim();

  const label =
    String(
      formData.get(
        "label"
      ) || ""
    ).trim();

  if (
    !competitorId ||
    !rawUrl
  ) {
    throw new Error(
      "Competitor and URL are required."
    );
  }

  let url: string;

  try {
    url =
      normalizeMonitoredUrl(
        rawUrl
      );
  } catch {
    throw new Error(
      "Enter a valid website URL."
    );
  }

  const competitor =
    await getOwnedCompetitor(
      competitorId,
      session.user.id
    );

  if (
    !competitor
  ) {
    throw new Error(
      "Competitor not found or access denied."
    );
  }

  const existingPage =
    await env.DB.prepare(
      `
        SELECT
          id

        FROM monitored_pages

        WHERE competitor_id = ?
          AND url = ?

        LIMIT 1
      `
    )
      .bind(
        competitorId,
        url
      )
      .first<IdRow>();

  if (
    existingPage
  ) {
    throw new Error(
      "This page is already being monitored."
    );
  }

  /*
   * Friendly preflight usage check.
   *
   * The actual INSERT below repeats both checks
   * atomically and remains the real enforcement
   * boundary.
   */
  const usage =
    await getPageUsage(
      competitor.workspace_id,
      competitorId
    );

  if (
    usage.competitorPages >=
    MORROW_MVP_USAGE_LIMITS
      .monitoredPagesPerCompetitor
  ) {
    throw new Error(
      `This competitor has reached the MVP limit of ${MORROW_MVP_USAGE_LIMITS.monitoredPagesPerCompetitor} monitored pages.`
    );
  }

  if (
    usage.workspacePages >=
    MORROW_MVP_USAGE_LIMITS
      .monitoredPagesPerWorkspace
  ) {
    throw new Error(
      `This workspace has reached the MVP limit of ${MORROW_MVP_USAGE_LIMITS.monitoredPagesPerWorkspace} monitored pages.`
    );
  }

  const monitoredPageId =
    crypto.randomUUID();

  let result;

  try {
    /*
     * Both resource limits are checked inside the
     * same INSERT statement.
     *
     * Paused pages are intentionally included in
     * the counts. Pausing is not a way to obtain
     * additional resource capacity.
     */
    result =
      await env.DB.prepare(
        `
          INSERT INTO monitored_pages (
            id,
            competitor_id,
            url,
            label
          )

          SELECT
            ?,
            ?,
            ?,
            ?

          WHERE (
            SELECT
              COUNT(*)

            FROM monitored_pages

            INNER JOIN competitors
              ON competitors.id =
                 monitored_pages.competitor_id

            WHERE competitors.workspace_id = ?
          ) < ?

          AND (
            SELECT
              COUNT(*)

            FROM monitored_pages

            WHERE competitor_id = ?
          ) < ?
        `
      )
        .bind(
          monitoredPageId,
          competitorId,
          url,
          label || null,

          competitor.workspace_id,

          MORROW_MVP_USAGE_LIMITS
            .monitoredPagesPerWorkspace,

          competitorId,

          MORROW_MVP_USAGE_LIMITS
            .monitoredPagesPerCompetitor
        )
        .run();
  } catch (error) {
    if (
      isUniqueConstraintError(
        error
      )
    ) {
      throw new Error(
        "This page is already being monitored."
      );
    }

    throw error;
  }

  if (
    (
      result.meta?.changes ??
      0
    ) === 0
  ) {
    /*
     * Re-read the authoritative counts so the
     * user receives the correct reason even if
     * another request filled a slot between the
     * preflight read and the atomic INSERT.
     */
    const currentUsage =
      await getPageUsage(
        competitor.workspace_id,
        competitorId
      );

    if (
      currentUsage.competitorPages >=
      MORROW_MVP_USAGE_LIMITS
        .monitoredPagesPerCompetitor
    ) {
      throw new Error(
        `This competitor has reached the MVP limit of ${MORROW_MVP_USAGE_LIMITS.monitoredPagesPerCompetitor} monitored pages.`
      );
    }

    throw new Error(
      `This workspace has reached the MVP limit of ${MORROW_MVP_USAGE_LIMITS.monitoredPagesPerWorkspace} monitored pages.`
    );
  }

  revalidateCompetitorViews(
    competitorId
  );
}

export async function toggleMonitoredPageStatus(
  formData: FormData
) {
  const session =
    await auth.api.getSession({
      headers:
        await headers(),
    });

  if (
    !session
  ) {
    throw new Error(
      "Unauthorized"
    );
  }

  const monitoredPageId =
    String(
      formData.get(
        "monitoredPageId"
      ) || ""
    ).trim();

  const competitorId =
    String(
      formData.get(
        "competitorId"
      ) || ""
    ).trim();

  if (
    !monitoredPageId ||
    !competitorId
  ) {
    throw new Error(
      "Monitored page and competitor are required."
    );
  }

  const result =
    await env.DB.prepare(
      `
        UPDATE monitored_pages

        SET
          status =
            CASE
              WHEN status =
                   'active'
                THEN 'paused'

              ELSE 'active'
            END,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
          AND competitor_id = ?

          AND competitor_id IN (
            SELECT
              competitors.id

            FROM competitors

            INNER JOIN workspace_members
              ON workspace_members.workspace_id =
                 competitors.workspace_id

            WHERE workspace_members.user_id = ?
          )
      `
    )
      .bind(
        monitoredPageId,
        competitorId,
        session.user.id
      )
      .run();

  if (
    (
      result.meta?.changes ??
      0
    ) === 0
  ) {
    throw new Error(
      "Monitored page not found or access denied."
    );
  }

  revalidateCompetitorViews(
    competitorId
  );
}

export async function updateMonitoredPageFrequency(
  formData: FormData
) {
  const session =
    await auth.api.getSession({
      headers:
        await headers(),
    });

  if (
    !session
  ) {
    throw new Error(
      "Unauthorized"
    );
  }

  const monitoredPageId =
    String(
      formData.get(
        "monitoredPageId"
      ) || ""
    ).trim();

  const competitorId =
    String(
      formData.get(
        "competitorId"
      ) || ""
    ).trim();

  const frequencyMinutes =
    Number(
      formData.get(
        "frequencyMinutes"
      )
    );

  const allowedFrequencies = [
    60,
    360,
    720,
    1440,
    10080,
  ];

  if (
    !monitoredPageId ||
    !competitorId ||
    !allowedFrequencies.includes(
      frequencyMinutes
    )
  ) {
    throw new Error(
      "Invalid monitored page frequency."
    );
  }

  const result =
    await env.DB.prepare(
      `
        UPDATE monitored_pages

        SET
          frequency_minutes = ?,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
          AND competitor_id = ?

          AND competitor_id IN (
            SELECT
              competitors.id

            FROM competitors

            INNER JOIN workspace_members
              ON workspace_members.workspace_id =
                 competitors.workspace_id

            WHERE workspace_members.user_id = ?
          )
      `
    )
      .bind(
        frequencyMinutes,
        monitoredPageId,
        competitorId,
        session.user.id
      )
      .run();

  if (
    (
      result.meta?.changes ??
      0
    ) === 0
  ) {
    throw new Error(
      "Monitored page not found or access denied."
    );
  }

  revalidateCompetitorViews(
    competitorId
  );
}

export async function removeMonitoredPage(
  formData: FormData
) {
  const session =
    await auth.api.getSession({
      headers:
        await headers(),
    });

  if (
    !session
  ) {
    throw new Error(
      "Unauthorized"
    );
  }

  const monitoredPageId =
    String(
      formData.get(
        "monitoredPageId"
      ) || ""
    ).trim();

  const competitorId =
    String(
      formData.get(
        "competitorId"
      ) || ""
    ).trim();

  if (
    !monitoredPageId ||
    !competitorId
  ) {
    throw new Error(
      "Monitored page and competitor are required."
    );
  }

  const monitoredPage =
    await env.DB.prepare(
      `
        SELECT
          monitored_pages.id

        FROM monitored_pages

        INNER JOIN competitors
          ON competitors.id =
             monitored_pages.competitor_id

        INNER JOIN workspace_members
          ON workspace_members.workspace_id =
             competitors.workspace_id

        WHERE monitored_pages.id = ?
          AND competitors.id = ?
          AND workspace_members.user_id = ?

        LIMIT 1
      `
    )
      .bind(
        monitoredPageId,
        competitorId,
        session.user.id
      )
      .first<IdRow>();

  if (
    !monitoredPage
  ) {
    throw new Error(
      "Monitored page not found or access denied."
    );
  }

  await env.DB.batch([
    env.DB.prepare(
      `
        DELETE FROM changes

        WHERE monitored_page_id = ?
      `
    ).bind(
      monitoredPageId
    ),

    env.DB.prepare(
      `
        DELETE FROM snapshots

        WHERE monitored_page_id = ?
      `
    ).bind(
      monitoredPageId
    ),

    env.DB.prepare(
      `
        DELETE FROM monitored_pages

        WHERE id = ?
      `
    ).bind(
      monitoredPageId
    ),
  ]);

  revalidateCompetitorViews(
    competitorId
  );
}

export async function updateMonitoredPage(
  formData: FormData
) {
  const session =
    await auth.api.getSession({
      headers:
        await headers(),
    });

  if (
    !session
  ) {
    throw new Error(
      "Unauthorized"
    );
  }

  const monitoredPageId =
    String(
      formData.get(
        "monitoredPageId"
      ) || ""
    ).trim();

  const competitorId =
    String(
      formData.get(
        "competitorId"
      ) || ""
    ).trim();

  const rawUrl =
    String(
      formData.get(
        "url"
      ) || ""
    ).trim();

  const label =
    String(
      formData.get(
        "label"
      ) || ""
    ).trim();

  if (
    !monitoredPageId ||
    !competitorId ||
    !rawUrl
  ) {
    throw new Error(
      "Monitored page, competitor, and URL are required."
    );
  }

  let url: string;

  try {
    url =
      normalizeMonitoredUrl(
        rawUrl
      );
  } catch {
    throw new Error(
      "Enter a valid website URL."
    );
  }

  const monitoredPage =
    await env.DB.prepare(
      `
        SELECT
          monitored_pages.id

        FROM monitored_pages

        INNER JOIN competitors
          ON competitors.id =
             monitored_pages.competitor_id

        INNER JOIN workspace_members
          ON workspace_members.workspace_id =
             competitors.workspace_id

        WHERE monitored_pages.id = ?
          AND competitors.id = ?
          AND workspace_members.user_id = ?

        LIMIT 1
      `
    )
      .bind(
        monitoredPageId,
        competitorId,
        session.user.id
      )
      .first<IdRow>();

  if (
    !monitoredPage
  ) {
    throw new Error(
      "Monitored page not found or access denied."
    );
  }

  const duplicatePage =
    await env.DB.prepare(
      `
        SELECT
          id

        FROM monitored_pages

        WHERE competitor_id = ?
          AND url = ?
          AND id != ?

        LIMIT 1
      `
    )
      .bind(
        competitorId,
        url,
        monitoredPageId
      )
      .first<IdRow>();

  if (
    duplicatePage
  ) {
    throw new Error(
      "This page is already being monitored."
    );
  }

  let result;

  try {
    result =
      await env.DB.prepare(
        `
          UPDATE monitored_pages

          SET
            url = ?,
            label = ?,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id = ?
            AND competitor_id = ?

            AND competitor_id IN (
              SELECT
                competitors.id

              FROM competitors

              INNER JOIN workspace_members
                ON workspace_members.workspace_id =
                   competitors.workspace_id

              WHERE workspace_members.user_id = ?
            )
        `
      )
        .bind(
          url,
          label || null,
          monitoredPageId,
          competitorId,
          session.user.id
        )
        .run();
  } catch (error) {
    if (
      isUniqueConstraintError(
        error
      )
    ) {
      throw new Error(
        "This page is already being monitored."
      );
    }

    throw error;
  }

  if (
    (
      result.meta?.changes ??
      0
    ) === 0
  ) {
    throw new Error(
      "Monitored page not found or access denied."
    );
  }

  revalidateCompetitorViews(
    competitorId
  );
}