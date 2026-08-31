"use server";

import { auth } from "@/lib/auth";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";

function normalizeDomain(value: string) {
  let domain = value.trim().toLowerCase();

  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");
  domain = domain.split("/")[0];
  domain = domain.replace(/\/+$/, "");

  return domain;
}

async function findFaviconUrl(domain: string) {
  const homepageUrl = `https://${domain}`;
  const fallbackUrl = `${homepageUrl}/favicon.ico`;

  try {
    const response = await fetch(homepageUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Morrow favicon fetcher",
      },
    });

    if (!response.ok) {
      return fallbackUrl;
    }

    const html = await response.text();

    const linkTags =
      html.match(/<link\b[^>]*>/gi) || [];

    for (const tag of linkTags) {
      const relMatch = tag.match(
        /\brel=["']([^"']+)["']/i
      );

      if (
        !relMatch ||
        !relMatch[1]
          .toLowerCase()
          .includes("icon")
      ) {
        continue;
      }

      const hrefMatch = tag.match(
        /\bhref=["']([^"']+)["']/i
      );

      if (!hrefMatch) {
        continue;
      }

      const faviconUrl = new URL(
        hrefMatch[1],
        response.url
      );

      if (
        faviconUrl.protocol === "http:" ||
        faviconUrl.protocol === "https:"
      ) {
        return faviconUrl.toString();
      }
    }
  } catch {
    // Favicon discovery should never prevent
    // competitor creation or editing.
  }

  return fallbackUrl;
}

export async function createCompetitor(formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const name = String(formData.get("name") || "").trim();
  const domain = normalizeDomain(
    String(formData.get("domain") || "")
  );

  if (!name || !domain) {
    throw new Error("Name and domain are required.");
  }
  const faviconUrl =
  await findFaviconUrl(domain);

  const workspace = await env.DB.prepare(
    `
      SELECT workspaces.id
      FROM workspaces
      INNER JOIN workspace_members
        ON workspace_members.workspace_id = workspaces.id
      WHERE workspace_members.user_id = ?
      LIMIT 1
    `
  )
    .bind(session.user.id)
    .first<{ id: string }>();

  if (!workspace) {
    throw new Error("No workspace found for this account.");
  }

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
      VALUES (?, ?, ?, ?, ?, 'active')
    `
  )
    .bind(
      randomUUID(),
      workspace.id,
      name,
      domain,
      faviconUrl
    )
    .run();
};

revalidatePath("/dashboard/competitors");

export async function toggleCompetitorStatus(formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const competitorId = String(
    formData.get("competitorId") || ""
  ).trim();

  const currentStatus = String(
    formData.get("currentStatus") || ""
  ).trim();

  if (!competitorId) {
    throw new Error("Competitor ID is required.");
  }

  const nextStatus =
    currentStatus === "active"
      ? "paused"
      : "active";

  const result = await env.DB.prepare(
    `
      UPDATE competitors
      SET
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND workspace_id IN (
          SELECT workspace_id
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

  if (result.meta.changes === 0) {
    throw new Error(
      "Competitor not found or access denied."
    );
  }

  revalidatePath("/dashboard/competitors");
};

export async function updateCompetitor(formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const competitorId = String(
    formData.get("competitorId") || ""
  ).trim();

  const name = String(
    formData.get("name") || ""
  ).trim();

  const domain = normalizeDomain(
    String(formData.get("domain") || "")
  );

  if (!competitorId || !name || !domain) {
    throw new Error(
      "Competitor ID, name, and domain are required."
    );
  }

  const faviconUrl =
  await findFaviconUrl(domain);

  const result = await env.DB.prepare(
    `
      UPDATE competitors
      SET
        name = ?,
        domain = ?,
        favicon_url = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND workspace_id IN (
          SELECT workspace_id
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

  if (result.meta.changes === 0) {
    throw new Error(
      "Competitor not found or access denied."
    );
  }

  revalidatePath("/dashboard/competitors");
};

export async function removeCompetitor(formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const competitorId = String(
    formData.get("competitorId") || ""
  ).trim();

  if (!competitorId) {
    throw new Error("Competitor ID is required.");
  }

  const competitor = await env.DB.prepare(
    `
      SELECT competitors.id
      FROM competitors
      INNER JOIN workspace_members
        ON workspace_members.workspace_id = competitors.workspace_id
      WHERE competitors.id = ?
        AND workspace_members.user_id = ?
      LIMIT 1
    `
  )
    .bind(
      competitorId,
      session.user.id
    )
    .first<{ id: string }>();

  if (!competitor) {
    throw new Error(
      "Competitor not found or access denied."
    );
  }

  await env.DB.batch([
    env.DB.prepare(
      `
        DELETE FROM changes
        WHERE monitored_page_id IN (
          SELECT id
          FROM monitored_pages
          WHERE competitor_id = ?
        )
      `
    ).bind(competitorId),

    env.DB.prepare(
      `
        DELETE FROM snapshots
        WHERE monitored_page_id IN (
          SELECT id
          FROM monitored_pages
          WHERE competitor_id = ?
        )
      `
    ).bind(competitorId),

    env.DB.prepare(
      `
        DELETE FROM monitored_pages
        WHERE competitor_id = ?
      `
    ).bind(competitorId),

    env.DB.prepare(
      `
        DELETE FROM competitors
        WHERE id = ?
      `
    ).bind(competitorId),
  ]);

  revalidatePath("/dashboard/competitors");
};