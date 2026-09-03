"use server";

import { auth } from "@/lib/auth";
import { MORROW_MVP_USAGE_LIMITS } from "@/lib/usage-limits";
import { env } from "cloudflare:workers";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

interface WorkspaceRow {
  id: string;
}

interface IdRow {
  id: string;
}

interface CountRow {
  count: number;
}

function normalizeDomain(
  value: string
) {
  let domain =
    value
      .trim()
      .toLowerCase();

  domain =
    domain.replace(
      /^https?:\/\//,
      ""
    );

  domain =
    domain.replace(
      /^www\./,
      ""
    );

  domain =
    domain.split(
      "/"
    )[0];

  domain =
    domain.replace(
      /\/+$/,
      ""
    );

  return domain;
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

async function findFaviconUrl(
  domain: string
) {
  const homepageUrl =
    `https://${domain}`;

  const fallbackUrl =
    `${homepageUrl}/favicon.ico`;

  try {
    const response =
      await fetch(
        homepageUrl,
        {
          redirect:
            "follow",

          headers: {
            "User-Agent":
              "Morrow favicon fetcher",
          },
        }
      );

    if (
      !response.ok
    ) {
      return fallbackUrl;
    }

    const html =
      await response.text();

    const linkTags =
      html.match(
        /<link\b[^>]*>/gi
      ) || [];

    for (
      const tag
      of linkTags
    ) {
      const relMatch =
        tag.match(
          /\brel=["']([^"']+)["']/i
        );

      if (
        !relMatch ||
        !relMatch[1]
          .toLowerCase()
          .includes(
            "icon"
          )
      ) {
        continue;
      }

      const hrefMatch =
        tag.match(
          /\bhref=["']([^"']+)["']/i
        );

      if (
        !hrefMatch
      ) {
        continue;
      }

      const faviconUrl =
        new URL(
          hrefMatch[1],
          response.url
        );

      if (
        faviconUrl.protocol ===
          "http:" ||
        faviconUrl.protocol ===
          "https:"
      ) {
        return faviconUrl.toString();
      }
    }
  } catch {
    /*
     * Favicon discovery is best-effort.
     *
     * Network or parsing problems must never
     * prevent competitor creation/editing.
     */
  }

  return fallbackUrl;
}

async function getUserWorkspace(
  userId: string
) {
  return env.DB.prepare(
    `
      SELECT
        workspaces.id

      FROM workspaces

      INNER JOIN workspace_members
        ON workspace_members.workspace_id =
           workspaces.id

      WHERE workspace_members.user_id = ?

      ORDER BY
        datetime(
          workspace_members.joined_at
        ) ASC

      LIMIT 1
    `
  )
    .bind(
      userId
    )
    .first<WorkspaceRow>();
}

async function getWorkspaceCompetitorCount(
  workspaceId: string
) {
  const result =
    await env.DB.prepare(
      `
        SELECT
          COUNT(*) AS count

        FROM competitors

        WHERE workspace_id = ?
      `
    )
      .bind(
        workspaceId
      )
      .first<CountRow>();

  return Number(
    result?.count ??
    0
  );
}

export async function createCompetitor(
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

  const name =
    String(
      formData.get(
        "name"
      ) || ""
    ).trim();

  const domain =
    normalizeDomain(
      String(
        formData.get(
          "domain"
        ) || ""
      )
    );

  if (
    !name ||
    !domain
  ) {
    throw new Error(
      "Name and domain are required."
    );
  }

  const workspace =
    await getUserWorkspace(
      session.user.id
    );

  if (
    !workspace
  ) {
    throw new Error(
      "No workspace found for this account."
    );
  }

  /*
   * Duplicate detection happens before favicon
   * discovery so we do not perform unnecessary
   * external requests.
   */
  const duplicate =
    await env.DB.prepare(
      `
        SELECT
          id

        FROM competitors

        WHERE workspace_id = ?
          AND domain = ?

        LIMIT 1
      `
    )
      .bind(
        workspace.id,
        domain
      )
      .first<IdRow>();

  if (
    duplicate
  ) {
    throw new Error(
      "A competitor with this domain is already being monitored."
    );
  }

  /*
   * Fast friendly limit check.
   *
   * The actual INSERT below also checks the limit
   * atomically so this is not the security boundary.
   */
  const currentCount =
    await getWorkspaceCompetitorCount(
      workspace.id
    );

  if (
    currentCount >=
    MORROW_MVP_USAGE_LIMITS
      .competitorsPerWorkspace
  ) {
    throw new Error(
      `This workspace has reached the MVP limit of ${MORROW_MVP_USAGE_LIMITS.competitorsPerWorkspace} competitors.`
    );
  }

  const faviconUrl =
    await findFaviconUrl(
      domain
    );

  const competitorId =
    randomUUID();

  let result;

  try {
    /*
     * The limit is enforced inside the INSERT
     * statement itself.
     *
     * This prevents a client from bypassing the UI
     * and also protects against the common
     * count-then-insert race.
     */
    result =
      await env.DB.prepare(
        `
          INSERT INTO competitors (
            id,
            workspace_id,
            name,
            domain,
            favicon_url,
            status
          )

          SELECT
            ?,
            ?,
            ?,
            ?,
            ?,
            'active'

          WHERE (
            SELECT
              COUNT(*)

            FROM competitors

            WHERE workspace_id = ?
          ) < ?
        `
      )
        .bind(
          competitorId,
          workspace.id,
          name,
          domain,
          faviconUrl,
          workspace.id,

          MORROW_MVP_USAGE_LIMITS
            .competitorsPerWorkspace
        )
        .run();
  } catch (error) {
    if (
      isUniqueConstraintError(
        error
      )
    ) {
      throw new Error(
        "A competitor with this domain is already being monitored."
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
      `This workspace has reached the MVP limit of ${MORROW_MVP_USAGE_LIMITS.competitorsPerWorkspace} competitors.`
    );
  }

  revalidatePath(
    "/dashboard"
  );

  revalidatePath(
    "/dashboard/competitors"
  );
}

export async function toggleCompetitorStatus(
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

  const currentStatus =
    String(
      formData.get(
        "currentStatus"
      ) || ""
    ).trim();

  if (
    !competitorId
  ) {
    throw new Error(
      "Competitor ID is required."
    );
  }

  const nextStatus =
    currentStatus ===
    "active"
      ? "paused"
      : "active";

  const result =
    await env.DB.prepare(
      `
        UPDATE competitors

        SET
          status = ?,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?

          AND workspace_id IN (
            SELECT
              workspace_id

            FROM workspace_members

            WHERE user_id = ?
          )
      `
    )
      .bind(
        nextStatus,
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
      "Competitor not found or access denied."
    );
  }

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

export async function updateCompetitor(
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

  const name =
    String(
      formData.get(
        "name"
      ) || ""
    ).trim();

  const domain =
    normalizeDomain(
      String(
        formData.get(
          "domain"
        ) || ""
      )
    );

  if (
    !competitorId ||
    !name ||
    !domain
  ) {
    throw new Error(
      "Competitor ID, name, and domain are required."
    );
  }

  const competitor =
    await env.DB.prepare(
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
        session.user.id
      )
      .first<{
        id: string;
        workspace_id: string;
      }>();

  if (
    !competitor
  ) {
    throw new Error(
      "Competitor not found or access denied."
    );
  }

  const duplicate =
    await env.DB.prepare(
      `
        SELECT
          id

        FROM competitors

        WHERE workspace_id = ?
          AND domain = ?
          AND id != ?

        LIMIT 1
      `
    )
      .bind(
        competitor.workspace_id,
        domain,
        competitorId
      )
      .first<IdRow>();

  if (
    duplicate
  ) {
    throw new Error(
      "Another competitor in this workspace already uses this domain."
    );
  }

  const faviconUrl =
    await findFaviconUrl(
      domain
    );

  let result;

  try {
    result =
      await env.DB.prepare(
        `
          UPDATE competitors

          SET
            name = ?,
            domain = ?,
            favicon_url = ?,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id = ?

            AND workspace_id IN (
              SELECT
                workspace_id

              FROM workspace_members

              WHERE user_id = ?
            )
        `
      )
        .bind(
          name,
          domain,
          faviconUrl,
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
        "Another competitor in this workspace already uses this domain."
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
      "Competitor not found or access denied."
    );
  }

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

export async function removeCompetitor(
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

  if (
    !competitorId
  ) {
    throw new Error(
      "Competitor ID is required."
    );
  }

  const competitor =
    await env.DB.prepare(
      `
        SELECT
          competitors.id

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
        session.user.id
      )
      .first<IdRow>();

  if (
    !competitor
  ) {
    throw new Error(
      "Competitor not found or access denied."
    );
  }

  /*
   * Changes are removed before snapshots because
   * changes reference their source snapshots with
   * ON DELETE RESTRICT.
   *
   * notification_deliveries cascade through changes.
   */
  await env.DB.batch([
    env.DB.prepare(
      `
        DELETE FROM changes

        WHERE monitored_page_id IN (
          SELECT
            id

          FROM monitored_pages

          WHERE competitor_id = ?
        )
      `
    ).bind(
      competitorId
    ),

    env.DB.prepare(
      `
        DELETE FROM snapshots

        WHERE monitored_page_id IN (
          SELECT
            id

          FROM monitored_pages

          WHERE competitor_id = ?
        )
      `
    ).bind(
      competitorId
    ),

    env.DB.prepare(
      `
        DELETE FROM monitored_pages

        WHERE competitor_id = ?
      `
    ).bind(
      competitorId
    ),

    env.DB.prepare(
      `
        DELETE FROM competitors

        WHERE id = ?
      `
    ).bind(
      competitorId
    ),
  ]);

  revalidatePath(
    "/dashboard"
  );

  revalidatePath(
    "/dashboard/competitors"
  );
}