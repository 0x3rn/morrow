"use server";

import { auth } from "@/lib/auth";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

function normalizeMonitoredUrl(value: string) {
  let input = value.trim();

  if (!/^https?:\/\//i.test(input)) {
    input = `https://${input}`;
  }

  const url = new URL(input);

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    throw new Error(
      "Only HTTP and HTTPS URLs can be monitored."
    );
  }

  url.hash = "";

  return url.toString();
}

export async function createMonitoredPage(
  formData: FormData
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const competitorId = String(
    formData.get("competitorId") || ""
  ).trim();

  const rawUrl = String(
    formData.get("url") || ""
  ).trim();

  const label = String(
    formData.get("label") || ""
  ).trim();

  if (!competitorId || !rawUrl) {
    throw new Error(
      "Competitor and URL are required."
    );
  }

  let url: string;

  try {
    url = normalizeMonitoredUrl(rawUrl);
  } catch {
    throw new Error(
      "Enter a valid website URL."
    );
  }

  const competitor = await env.DB.prepare(
    `
      SELECT competitors.id
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
    .first<{ id: string }>();

  if (!competitor) {
    throw new Error(
      "Competitor not found or access denied."
    );
  }

  const existingPage = await env.DB.prepare(
    `
      SELECT id
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
    .first<{ id: string }>();

  if (existingPage) {
    throw new Error(
      "This page is already being monitored."
    );
  }

  await env.DB.prepare(
    `
      INSERT INTO monitored_pages (
        id,
        competitor_id,
        url,
        label
      )
      VALUES (?, ?, ?, ?)
    `
  )
    .bind(
      crypto.randomUUID(),
      competitorId,
      url,
      label || null
    )
    .run();

  revalidatePath(
    `/dashboard/competitors/${competitorId}`
  );
}

export async function toggleMonitoredPageStatus(
  formData: FormData
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const monitoredPageId = String(
    formData.get("monitoredPageId") || ""
  ).trim();

  const competitorId = String(
    formData.get("competitorId") || ""
  ).trim();

  if (!monitoredPageId || !competitorId) {
    throw new Error(
      "Monitored page and competitor are required."
    );
  }

  const result = await env.DB.prepare(
    `
      UPDATE monitored_pages
      SET
        status = CASE
          WHEN status = 'active' THEN 'paused'
          ELSE 'active'
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND competitor_id = ?
        AND competitor_id IN (
          SELECT competitors.id
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

  if (result.meta.changes === 0) {
    throw new Error(
      "Monitored page not found or access denied."
    );
  }

  revalidatePath(
    `/dashboard/competitors/${competitorId}`
  );
}

export async function updateMonitoredPageFrequency(
  formData: FormData
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const monitoredPageId = String(
    formData.get("monitoredPageId") || ""
  ).trim();

  const competitorId = String(
    formData.get("competitorId") || ""
  ).trim();

  const frequencyMinutes = Number(
    formData.get("frequencyMinutes")
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
    !allowedFrequencies.includes(frequencyMinutes)
  ) {
    throw new Error(
      "Invalid monitored page frequency."
    );
  }

  const result = await env.DB.prepare(
    `
      UPDATE monitored_pages
      SET
        frequency_minutes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND competitor_id = ?
        AND competitor_id IN (
          SELECT competitors.id
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

  if (result.meta.changes === 0) {
    throw new Error(
      "Monitored page not found or access denied."
    );
  }

  revalidatePath(
    `/dashboard/competitors/${competitorId}`
  );
}

export async function removeMonitoredPage(
  formData: FormData
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const monitoredPageId = String(
    formData.get("monitoredPageId") || ""
  ).trim();

  const competitorId = String(
    formData.get("competitorId") || ""
  ).trim();

  if (!monitoredPageId || !competitorId) {
    throw new Error(
      "Monitored page and competitor are required."
    );
  }

  const monitoredPage = await env.DB.prepare(
    `
      SELECT monitored_pages.id
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
    .first<{ id: string }>();

  if (!monitoredPage) {
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
    ).bind(monitoredPageId),

    env.DB.prepare(
      `
        DELETE FROM snapshots
        WHERE monitored_page_id = ?
      `
    ).bind(monitoredPageId),

    env.DB.prepare(
      `
        DELETE FROM monitored_pages
        WHERE id = ?
      `
    ).bind(monitoredPageId),
  ]);

  revalidatePath(
    `/dashboard/competitors/${competitorId}`
  );
}

export async function updateMonitoredPage(
  formData: FormData
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const monitoredPageId = String(
    formData.get("monitoredPageId") || ""
  ).trim();

  const competitorId = String(
    formData.get("competitorId") || ""
  ).trim();

  const rawUrl = String(
    formData.get("url") || ""
  ).trim();

  const label = String(
    formData.get("label") || ""
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
    url = normalizeMonitoredUrl(rawUrl);
  } catch {
    throw new Error(
      "Enter a valid website URL."
    );
  }

  const monitoredPage = await env.DB.prepare(
    `
      SELECT monitored_pages.id
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
    .first<{ id: string }>();

  if (!monitoredPage) {
    throw new Error(
      "Monitored page not found or access denied."
    );
  }

  const duplicatePage = await env.DB.prepare(
    `
      SELECT id
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
    .first<{ id: string }>();

  if (duplicatePage) {
    throw new Error(
      "This page is already being monitored."
    );
  }

  await env.DB.prepare(
    `
      UPDATE monitored_pages
      SET
        url = ?,
        label = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND competitor_id = ?
    `
  )
    .bind(
      url,
      label || null,
      monitoredPageId,
      competitorId
    )
    .run();

  revalidatePath(
    `/dashboard/competitors/${competitorId}`
  );
}