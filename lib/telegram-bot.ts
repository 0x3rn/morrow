import { randomBytes, randomUUID } from "node:crypto";

import { resolveWorkspaceEntitlements } from "./billing-plans.ts";
import { getActiveWorkspaceMembership } from "./team-workspaces.ts";
import {
  assertWorkspaceDigestScheduleAllowed,
  assertWorkspaceExternalChannelCapacity,
} from "./workspace-billing.ts";
import type { FetchLike } from "../worker/external-delivery.ts";
import type { D1DatabaseLike } from "../worker/external-notifications.ts";
import {
  normalizeSignificanceLevel,
  parseAllowedCategoriesJson,
  parseAllowedCompetitorIdsJson,
  parseAllowedDigestPeriodsJson,
  serializeAllowedCategories,
  serializeAllowedCompetitorIds,
  serializeAllowedDigestPeriods,
  type NotificationChangeCategory,
  type NotificationDigestPeriod,
  type NotificationSignificanceLevel,
} from "../worker/notification-routing.ts";

export const TELEGRAM_LINK_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface TelegramBotEnv {
  DB: D1DatabaseLike;
  MORROW_TELEGRAM_BOT_TOKEN?: string;
  MORROW_TELEGRAM_BOT_USERNAME?: string;
  MORROW_TELEGRAM_WEBHOOK_SECRET?: string;
}

export interface TelegramBotHandshakeRow {
  chat_id: string;
  username: string | null;
  chat_title: string | null;
  start_token: string | null;
  updated_at: string;
}

export interface ResolvedTelegramChat {
  chatId: string;
  username: string | null;
}

export interface TelegramLinkCodeView {
  code: string;
  workspaceId: string;
  userId: string;
  channelName: string;
  sendChanges: boolean;
  sendDigests: boolean;
  minSignificance: NotificationSignificanceLevel;
  categories: NotificationChangeCategory[];
  competitorIds: string[];
  digestPeriods: NotificationDigestPeriod[];
  expiresAt: string;
  createdAt: string;
}

export interface GenerateTelegramLinkCodeInput {
  userId: string;
  name?: string;
  sendChanges?: boolean;
  sendDigests?: boolean;
  minSignificance?: string;
  categories?: readonly string[];
  competitorIds?: readonly string[];
  digestPeriods?: readonly string[];
  now?: Date;
}

export type ValidateTelegramLinkCodeResult =
  | {
      ok: true;
      channelId: string;
      workspaceId: string;
      workspaceName: string;
      channelName: string;
      chatId: string;
      username: string | null;
    }
  | {
      ok: false;
      reason:
        | "invalid_code"
        | "expired_code"
        | "ineligible_plan"
        | "capacity_exceeded";
      message: string;
    };

interface TelegramLinkCodeRow {
  code: string;
  workspace_id: string;
  user_id: string;
  channel_name: string;
  send_changes: number;
  send_digests: number;
  min_significance: string;
  categories_json: string;
  competitor_ids_json: string;
  digest_periods_json: string;
  expires_at: string;
  consumed_at: string | null;
  linked_chat_id: string | null;
  created_at: string;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  my_chat_member?: {
    chat?: TelegramChat;
    from?: TelegramUser;
  };
}

interface TelegramMessage {
  message_id?: number;
  text?: string;
  chat?: TelegramChat;
  from?: TelegramUser;
}

interface TelegramChat {
  id?: number | string;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramUser {
  id?: number | string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

const TELEGRAM_USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,64}$/;
const NUMERIC_CHAT_ID_PATTERN = /^-?\d+$/;
const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function parseTimestampMs(raw?: string | null): number | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const normalized =
    trimmed.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(trimmed)
      ? trimmed
      : `${trimmed.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function generateRandomLinkCodeString(): string {
  const bytes = randomBytes(8);
  let suffix = "";
  for (let i = 0; i < 8; i++) {
    suffix += LINK_CODE_ALPHABET[bytes[i] % LINK_CODE_ALPHABET.length];
  }
  return `MRW-${suffix}`;
}

export function normalizeTelegramLinkCode(
  raw?: string | null,
): string | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!cleaned) {
    return null;
  }

  const withoutPrefix = cleaned.startsWith("MRW-")
    ? cleaned.slice(4)
    : cleaned.startsWith("MRW") && cleaned.length === 11
      ? cleaned.slice(3)
      : cleaned;

  if (!/^[A-Z0-9]{6,16}$/.test(withoutPrefix)) {
    return null;
  }

  return `MRW-${withoutPrefix}`;
}

export function normalizeTelegramBotUsername(
  raw?: string | null,
): string | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  const trimmed = raw
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@+/, "")
    .replace(/\/+$/, "")
    .trim();

  if (!trimmed || !TELEGRAM_USERNAME_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function normalizeTelegramUsername(
  raw?: string | null,
): string | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  const trimmed = raw
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@+/, "")
    .replace(/\/+$/, "")
    .trim();

  if (
    !trimmed ||
    NUMERIC_CHAT_ID_PATTERN.test(trimmed) ||
    !TELEGRAM_USERNAME_PATTERN.test(trimmed)
  ) {
    return null;
  }

  return trimmed.toLowerCase();
}

export function isNumericTelegramChatId(
  value: string,
): boolean {
  return NUMERIC_CHAT_ID_PATTERN.test(value.trim());
}

export function buildTelegramBotDeepLink(
  botUsername: string,
  startToken?: string,
): string {
  const normalized =
    normalizeTelegramBotUsername(botUsername) ?? botUsername;
  const base = `https://t.me/${encodeURIComponent(normalized)}`;
  if (!startToken || !startToken.trim()) {
    return base;
  }
  return `${base}?start=${encodeURIComponent(startToken.trim())}`;
}

export async function ensureTelegramHandshakesTable(
  db: D1DatabaseLike,
): Promise<void> {
  await db
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS telegram_bot_handshakes (
          chat_id TEXT PRIMARY KEY,
          username TEXT,
          chat_title TEXT,
          start_token TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
    )
    .run();
}

export async function ensureTelegramLinkCodesTable(
  db: D1DatabaseLike,
): Promise<void> {
  await db
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS telegram_link_codes (
          code TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          channel_name TEXT NOT NULL,
          send_changes INTEGER NOT NULL DEFAULT 1,
          send_digests INTEGER NOT NULL DEFAULT 0,
          min_significance TEXT NOT NULL DEFAULT 'minor',
          categories_json TEXT NOT NULL DEFAULT '[]',
          competitor_ids_json TEXT NOT NULL DEFAULT '[]',
          digest_periods_json TEXT NOT NULL DEFAULT '["weekly"]',
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          linked_chat_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
    )
    .run();
}

/**
 * Revokes Telegram delivery channels for a workspace ONLY when its effective subscription
 * plan does not accommodate Telegram use (i.e., Free plan where externalChannelsPerWorkspace === 0,
 * or when a canceled subscription has reached the end of its active billing period).
 *
 * - Never revokes when a user downgrades from a higher plan to a lower paid plan that still
 *   accommodates Telegram use (e.g., Scale -> Growth -> Starter -> Personal).
 * - Never revokes when a user cancels their subscription (cancel_at_period_end = 1) while
 *   their current billing period is still active (current_period_end > referenceDate).
 */
export async function revokeWorkspaceTelegramChannelsIfIneligible(
  db: D1DatabaseLike,
  workspaceId: string,
  referenceDate: Date = new Date(),
): Promise<{ revokedCount: number }> {
  const trimmedWorkspaceId = workspaceId.trim();
  if (!trimmedWorkspaceId) {
    return { revokedCount: 0 };
  }

  let subRow: {
    workspace_id: string;
    plan_id: string;
    status: string;
    billing_interval: string;
    cancel_at_period_end: number;
    current_period_end: string | null;
  } | null = null;

  try {
    subRow = await db
      .prepare(
        `
          SELECT
            workspace_id,
            plan_id,
            status,
            billing_interval,
            cancel_at_period_end,
            current_period_end
          FROM workspace_subscriptions
          WHERE workspace_id = ?
             OR workspace_id IN (
               SELECT w_peer.id
               FROM workspaces w_self
               INNER JOIN workspaces w_peer
                 ON w_peer.created_by = w_self.created_by
               WHERE w_self.id = ?
                 AND w_self.created_by IS NOT NULL
             )
          ORDER BY
            CASE
              WHEN status != 'canceled' THEN 1
              ELSE 0
            END DESC,
            CASE plan_id
              WHEN 'scale' THEN 5
              WHEN 'growth' THEN 4
              WHEN 'starter' THEN 3
              WHEN 'personal' THEN 2
              ELSE 1
            END DESC,
            CASE
              WHEN workspace_id = ? THEN 1
              ELSE 0
            END DESC,
            datetime(updated_at) DESC
          LIMIT 1
        `,
      )
      .bind(
        trimmedWorkspaceId,
        trimmedWorkspaceId,
        trimmedWorkspaceId,
      )
      .first();
  } catch {
    return { revokedCount: 0 };
  }

  // If no subscription record exists in D1 (e.g. minimal unit test fixtures that don't seed subscriptions),
  // do not delete channels prematurely.
  if (!subRow) {
    return { revokedCount: 0 };
  }

  const entitlements = resolveWorkspaceEntitlements({
    planId: subRow.plan_id,
    subscriptionStatus: subRow.status,
    billingInterval: subRow.billing_interval,
    cancelAtPeriodEnd:
      Number(subRow.cancel_at_period_end) === 1,
    currentPeriodEnd: subRow.current_period_end,
    referenceDate,
  });

  // Any plan that accommodates external/Telegram channels (Personal, Starter, Growth, Scale)
  // or a canceled subscription still within its active billing period retains its Telegram channels.
  if (entitlements.limits.externalChannelsPerWorkspace > 0) {
    return { revokedCount: 0 };
  }

  const deleteResult = await db
    .prepare(
      `
        DELETE FROM external_notification_channels
        WHERE workspace_id = ?
          AND channel = 'telegram'
      `,
    )
    .bind(trimmedWorkspaceId)
    .run();

  try {
    await db
      .prepare(
        `
          DELETE FROM telegram_link_codes
          WHERE workspace_id = ?
            AND consumed_at IS NULL
        `,
      )
      .bind(trimmedWorkspaceId)
      .run();
  } catch {
    // Ignore if telegram_link_codes table has not been created yet
  }

  return {
    revokedCount: Number(deleteResult.meta?.changes ?? 0),
  };
}

export async function generateTelegramLinkCode(
  db: D1DatabaseLike,
  input: GenerateTelegramLinkCodeInput,
): Promise<TelegramLinkCodeView> {
  const now = input.now ?? new Date();
  const activeWorkspace = await getActiveWorkspaceMembership(
    db,
    input.userId,
  );

  if (!activeWorkspace) {
    throw new Error("No workspace found for this account.");
  }

  if (
    !activeWorkspace.permissions.canManageWorkspaceChannels
  ) {
    throw new Error(
      "Only workspace Owners and Admins can manage external delivery channels.",
    );
  }

  await revokeWorkspaceTelegramChannelsIfIneligible(
    db,
    activeWorkspace.id,
    now,
  );

  // Verify the workspace is on an eligible plan that accommodates Telegram and has channel capacity
  await assertWorkspaceExternalChannelCapacity(
    db,
    activeWorkspace.id,
  );

  const channelName =
    (input.name ?? "").trim() || "Telegram";
  const sendChanges = input.sendChanges ?? true;
  const sendDigests = input.sendDigests ?? false;

  if (!sendChanges && !sendDigests) {
    throw new Error(
      "Enable at least one delivery trigger (instant change alerts or scheduled digests) for this channel.",
    );
  }

  const normalizedDigestPeriods =
    parseAllowedDigestPeriodsJson(
      JSON.stringify(input.digestPeriods ?? ["weekly"]),
    );

  if (
    sendDigests &&
    normalizedDigestPeriods.length === 0
  ) {
    throw new Error(
      "Choose at least one digest schedule when scheduled digests are enabled for this channel.",
    );
  }

  await assertWorkspaceDigestScheduleAllowed(db, {
    workspaceId: activeWorkspace.id,
    enabled: sendDigests,
    digestPeriods: normalizedDigestPeriods,
  });

  const minSignificance = normalizeSignificanceLevel(
    input.minSignificance,
    "minor",
  );
  const categoriesJson = serializeAllowedCategories(
    input.categories ?? [],
  );
  const competitorIdsJson = serializeAllowedCompetitorIds(
    input.competitorIds ?? [],
  );
  const digestPeriodsJson = serializeAllowedDigestPeriods(
    normalizedDigestPeriods,
    ["weekly"],
  );

  await ensureTelegramLinkCodesTable(db);

  // Remove any previously unconsumed codes for this workspace so only the latest 10-minute code is active
  await db
    .prepare(
      `
        DELETE FROM telegram_link_codes
        WHERE workspace_id = ?
          AND consumed_at IS NULL
      `,
    )
    .bind(activeWorkspace.id)
    .run();

  const code = generateRandomLinkCodeString();
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + TELEGRAM_LINK_CODE_TTL_MS,
  ).toISOString();

  await db
    .prepare(
      `
        INSERT INTO telegram_link_codes (
          code,
          workspace_id,
          user_id,
          channel_name,
          send_changes,
          send_digests,
          min_significance,
          categories_json,
          competitor_ids_json,
          digest_periods_json,
          expires_at,
          consumed_at,
          linked_chat_id,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      `,
    )
    .bind(
      code,
      activeWorkspace.id,
      input.userId,
      channelName,
      sendChanges ? 1 : 0,
      sendDigests ? 1 : 0,
      minSignificance,
      categoriesJson,
      competitorIdsJson,
      digestPeriodsJson,
      expiresAt,
      createdAt,
    )
    .run();

  return {
    code,
    workspaceId: activeWorkspace.id,
    userId: input.userId,
    channelName,
    sendChanges,
    sendDigests,
    minSignificance,
    categories: parseAllowedCategoriesJson(categoriesJson),
    competitorIds:
      parseAllowedCompetitorIdsJson(competitorIdsJson),
    digestPeriods:
      parseAllowedDigestPeriodsJson(digestPeriodsJson),
    expiresAt,
    createdAt,
  };
}

export async function getActiveTelegramLinkCodeForWorkspace(
  db: D1DatabaseLike,
  workspaceId: string,
  now: Date = new Date(),
): Promise<TelegramLinkCodeView | null> {
  const trimmedWorkspaceId = workspaceId.trim();
  if (!trimmedWorkspaceId) {
    return null;
  }

  await ensureTelegramLinkCodesTable(db);

  const row = await db
    .prepare(
      `
        SELECT
          code,
          workspace_id,
          user_id,
          channel_name,
          send_changes,
          send_digests,
          min_significance,
          categories_json,
          competitor_ids_json,
          digest_periods_json,
          expires_at,
          consumed_at,
          linked_chat_id,
          created_at
        FROM telegram_link_codes
        WHERE workspace_id = ?
          AND consumed_at IS NULL
        ORDER BY datetime(created_at) DESC
        LIMIT 1
      `,
    )
    .bind(trimmedWorkspaceId)
    .first<TelegramLinkCodeRow>();

  if (!row) {
    return null;
  }

  const expiresAtMs = parseTimestampMs(row.expires_at);
  if (expiresAtMs === null || expiresAtMs <= now.getTime()) {
    return null;
  }

  return {
    code: row.code,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    channelName: row.channel_name,
    sendChanges: row.send_changes === 1,
    sendDigests: row.send_digests === 1,
    minSignificance: normalizeSignificanceLevel(
      row.min_significance,
      "minor",
    ),
    categories: parseAllowedCategoriesJson(
      row.categories_json,
    ),
    competitorIds: parseAllowedCompetitorIdsJson(
      row.competitor_ids_json,
    ),
    digestPeriods: parseAllowedDigestPeriodsJson(
      row.digest_periods_json,
    ),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export async function cancelTelegramLinkCode(
  db: D1DatabaseLike,
  input: {
    userId: string;
    code?: string | null;
  },
): Promise<void> {
  const activeWorkspace = await getActiveWorkspaceMembership(
    db,
    input.userId,
  );
  if (
    !activeWorkspace ||
    !activeWorkspace.permissions.canManageWorkspaceChannels
  ) {
    throw new Error(
      "Only workspace Owners and Admins can manage external delivery channels.",
    );
  }

  await ensureTelegramLinkCodesTable(db);

  const normalizedCode = normalizeTelegramLinkCode(
    input.code,
  );
  if (normalizedCode) {
    await db
      .prepare(
        `
          DELETE FROM telegram_link_codes
          WHERE workspace_id = ?
            AND code = ?
            AND consumed_at IS NULL
        `,
      )
      .bind(activeWorkspace.id, normalizedCode)
      .run();
    return;
  }

  await db
    .prepare(
      `
        DELETE FROM telegram_link_codes
        WHERE workspace_id = ?
          AND consumed_at IS NULL
      `,
    )
    .bind(activeWorkspace.id)
    .run();
}

export async function validateTelegramLinkCode(
  db: D1DatabaseLike,
  input: {
    code: string;
    chatId: string;
    username?: string | null;
    now?: Date;
  },
): Promise<ValidateTelegramLinkCodeResult> {
  const now = input.now ?? new Date();
  const chatId = String(input.chatId ?? "").trim();
  const username = normalizeTelegramUsername(input.username);
  const normalizedCode = normalizeTelegramLinkCode(
    input.code,
  );

  if (!normalizedCode || !chatId) {
    return {
      ok: false,
      reason: "invalid_code",
      message:
        "Invalid temporary link ID. Please generate a temporary link ID in Morrow → Notifications and send it here.",
    };
  }

  await ensureTelegramLinkCodesTable(db);

  const row = await db
    .prepare(
      `
        SELECT
          code,
          workspace_id,
          user_id,
          channel_name,
          send_changes,
          send_digests,
          min_significance,
          categories_json,
          competitor_ids_json,
          digest_periods_json,
          expires_at,
          consumed_at,
          linked_chat_id,
          created_at
        FROM telegram_link_codes
        WHERE code = ?
        LIMIT 1
      `,
    )
    .bind(normalizedCode)
    .first<TelegramLinkCodeRow>();

  if (!row) {
    return {
      ok: false,
      reason: "invalid_code",
      message:
        "Invalid temporary link ID. Please check the ID from Morrow → Notifications and try again.",
    };
  }

  if (row.consumed_at) {
    return {
      ok: false,
      reason: "expired_code",
      message:
        "This temporary link ID has already been used. Generate a new ID in Morrow → Notifications if you need to link another chat.",
    };
  }

  const expiresAtMs = parseTimestampMs(row.expires_at);
  const createdAtMs = parseTimestampMs(row.created_at);
  const isExpiredByExpiry =
    expiresAtMs === null || expiresAtMs <= now.getTime();
  const isExpiredByTtl =
    createdAtMs !== null &&
    now.getTime() - createdAtMs > TELEGRAM_LINK_CODE_TTL_MS;

  if (isExpiredByExpiry || isExpiredByTtl) {
    return {
      ok: false,
      reason: "expired_code",
      message:
        "This temporary link ID has expired (IDs are valid for 10 minutes). Please generate a new ID in Morrow → Notifications.",
    };
  }

  // Check workspace subscription eligibility at validation time
  await revokeWorkspaceTelegramChannelsIfIneligible(
    db,
    row.workspace_id,
    now,
  );

  const subRow = await db
    .prepare(
      `
        SELECT
          plan_id,
          status,
          billing_interval,
          cancel_at_period_end,
          current_period_end
        FROM workspace_subscriptions
        WHERE workspace_id = ?
           OR workspace_id IN (
             SELECT w_peer.id
             FROM workspaces w_self
             INNER JOIN workspaces w_peer
               ON w_peer.created_by = w_self.created_by
             WHERE w_self.id = ?
               AND w_self.created_by IS NOT NULL
           )
        ORDER BY
          CASE
            WHEN status != 'canceled' THEN 1
            ELSE 0
          END DESC,
          CASE plan_id
            WHEN 'scale' THEN 5
            WHEN 'growth' THEN 4
            WHEN 'starter' THEN 3
            WHEN 'personal' THEN 2
            ELSE 1
          END DESC,
          CASE
            WHEN workspace_id = ? THEN 1
            ELSE 0
          END DESC,
          datetime(updated_at) DESC
        LIMIT 1
      `,
    )
    .bind(
      row.workspace_id,
      row.workspace_id,
      row.workspace_id,
    )
    .first<{
      plan_id: string;
      status: string;
      billing_interval: string;
      cancel_at_period_end: number;
      current_period_end: string | null;
    }>();

  const entitlements = resolveWorkspaceEntitlements({
    planId: subRow?.plan_id ?? "free",
    subscriptionStatus: subRow?.status ?? "active",
    billingInterval: subRow?.billing_interval ?? "monthly",
    cancelAtPeriodEnd:
      Number(subRow?.cancel_at_period_end ?? 0) === 1,
    currentPeriodEnd: subRow?.current_period_end ?? null,
    referenceDate: now,
  });

  if (
    entitlements.limits.externalChannelsPerWorkspace <= 0
  ) {
    return {
      ok: false,
      reason: "ineligible_plan",
      message:
        "This workspace's current subscription plan does not include Telegram notifications. Upgrade your plan in Morrow → Billing to link Telegram.",
    };
  }

  const workspaceRow = await db
    .prepare(
      `
        SELECT name
        FROM workspaces
        WHERE id = ?
        LIMIT 1
      `,
    )
    .bind(row.workspace_id)
    .first<{ name: string }>();
  const workspaceName =
    workspaceRow?.name?.trim() || "Morrow Workspace";

  const existingChannelsResult = await db
    .prepare(
      `
        SELECT
          id,
          channel,
          name,
          config_json
        FROM external_notification_channels
        WHERE workspace_id = ?
      `,
    )
    .bind(row.workspace_id)
    .all<{
      id: string;
      channel: string;
      name: string;
      config_json: string;
    }>();

  const existingChannels =
    existingChannelsResult.results ?? [];

  // Check if this exact Telegram chatId is already linked in this workspace
  const existingSameChat = existingChannels.find((ch) => {
    if (ch.channel !== "telegram") {
      return false;
    }
    try {
      const parsed = JSON.parse(ch.config_json) as {
        chatId?: unknown;
      };
      return String(parsed?.chatId ?? "").trim() === chatId;
    } catch {
      return false;
    }
  });

  const configJson = JSON.stringify({
    chatId,
    ...(username ? { username } : {}),
  });

  let channelId: string;
  let finalChannelName =
    row.channel_name.trim() || "Telegram";

  if (existingSameChat) {
    channelId = existingSameChat.id;
    finalChannelName = existingSameChat.name;

    await db
      .prepare(
        `
          UPDATE external_notification_channels
          SET
            status = 'active',
            config_json = ?,
            send_changes = ?,
            send_digests = ?,
            min_significance = ?,
            categories_json = ?,
            competitor_ids_json = ?,
            digest_periods_json = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND workspace_id = ?
        `,
      )
      .bind(
        configJson,
        row.send_changes,
        row.send_digests,
        row.min_significance,
        row.categories_json,
        row.competitor_ids_json,
        row.digest_periods_json,
        channelId,
        row.workspace_id,
      )
      .run();
  } else {
    if (
      existingChannels.length >=
      entitlements.limits.externalChannelsPerWorkspace
    ) {
      return {
        ok: false,
        reason: "capacity_exceeded",
        message: `This workspace has reached its ${entitlements.planName} plan limit of ${entitlements.limits.externalChannelsPerWorkspace} external notification channel${entitlements.limits.externalChannelsPerWorkspace === 1 ? "" : "s"}.`,
      };
    }

    const existingTelegramNames = new Set(
      existingChannels
        .filter((ch) => ch.channel === "telegram")
        .map((ch) => ch.name.toLowerCase()),
    );

    if (
      existingTelegramNames.has(
        finalChannelName.toLowerCase(),
      )
    ) {
      const suffix = username ? `@${username}` : chatId;
      finalChannelName = `${finalChannelName} (${suffix})`;
    }

    channelId = randomUUID();
    await db
      .prepare(
        `
          INSERT INTO external_notification_channels (
            id,
            workspace_id,
            channel,
            name,
            status,
            config_json,
            send_changes,
            send_digests,
            min_significance,
            categories_json,
            competitor_ids_json,
            digest_periods_json,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            'telegram',
            ?,
            'active',
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `,
      )
      .bind(
        channelId,
        row.workspace_id,
        finalChannelName,
        configJson,
        row.send_changes,
        row.send_digests,
        row.min_significance,
        row.categories_json,
        row.competitor_ids_json,
        row.digest_periods_json,
      )
      .run();
  }

  await db
    .prepare(
      `
        UPDATE telegram_link_codes
        SET
          consumed_at = ?,
          linked_chat_id = ?
        WHERE code = ?
      `,
    )
    .bind(now.toISOString(), chatId, normalizedCode)
    .run();

  return {
    ok: true,
    channelId,
    workspaceId: row.workspace_id,
    workspaceName,
    channelName: finalChannelName,
    chatId,
    username,
  };
}

function extractStartTokenFromMessageText(
  text?: string | null,
): string | null {
  if (!text || typeof text !== "string") {
    return null;
  }

  const match = text
    .trim()
    .match(/^\/start(?:@[a-zA-Z0-9_]+)?(?:\s+([a-zA-Z0-9_-]{1,64}))?$/i);
  if (!match) {
    return null;
  }

  return match[1]?.trim() || null;
}

function extractCandidateLinkCodeFromMessageText(
  text?: string | null,
): string | null {
  if (!text || typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  // Support "/start MRW-XXXX" or "/link MRW-XXXX"
  const commandMatch = trimmed.match(
    /^\/(?:start|link)(?:@[a-zA-Z0-9_]+)?\s+([^\s]+)$/i,
  );
  if (commandMatch?.[1]) {
    return normalizeTelegramLinkCode(commandMatch[1]);
  }

  // Ignore bare slash commands like "/start" or "/help"
  if (trimmed.startsWith("/")) {
    return null;
  }

  return normalizeTelegramLinkCode(trimmed);
}

export async function recordTelegramUpdateHandshake(
  db: D1DatabaseLike,
  update: TelegramUpdate,
): Promise<{
  recorded: boolean;
  chatId: string | null;
  username: string | null;
  startToken: string | null;
  candidateLinkCode: string | null;
  isStartOrIdCommand: boolean;
}> {
  const message = update.message ?? update.channel_post;
  const chat =
    message?.chat ?? update.my_chat_member?.chat;
  const from =
    message?.from ?? update.my_chat_member?.from;

  if (
    !chat ||
    (typeof chat.id !== "number" &&
      typeof chat.id !== "string")
  ) {
    return {
      recorded: false,
      chatId: null,
      username: null,
      startToken: null,
      candidateLinkCode: null,
      isStartOrIdCommand: false,
    };
  }

  const chatId = String(chat.id).trim();
  if (!chatId) {
    return {
      recorded: false,
      chatId: null,
      username: null,
      startToken: null,
      candidateLinkCode: null,
      isStartOrIdCommand: false,
    };
  }

  const username = normalizeTelegramUsername(
    chat.username || from?.username || null,
  );
  const fullName = [
    chat.first_name || from?.first_name,
    chat.last_name || from?.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const chatTitle =
    (typeof chat.title === "string" && chat.title.trim()) ||
    fullName ||
    null;

  const startToken = extractStartTokenFromMessageText(
    message?.text,
  );
  const candidateLinkCode =
    extractCandidateLinkCodeFromMessageText(message?.text);
  const textTrimmed = (message?.text ?? "").trim();
  const isStartOrIdCommand =
    /^\/(start|id)(?:@[a-zA-Z0-9_]+)?(?:\s|$)/i.test(
      textTrimmed,
    );

  await ensureTelegramHandshakesTable(db);

  await db
    .prepare(
      `
        INSERT INTO telegram_bot_handshakes (
          chat_id,
          username,
          chat_title,
          start_token,
          updated_at
        )
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(chat_id) DO UPDATE SET
          username = COALESCE(excluded.username, telegram_bot_handshakes.username),
          chat_title = COALESCE(excluded.chat_title, telegram_bot_handshakes.chat_title),
          start_token = COALESCE(excluded.start_token, telegram_bot_handshakes.start_token),
          updated_at = CURRENT_TIMESTAMP
      `,
    )
    .bind(chatId, username, chatTitle, startToken)
    .run();

  return {
    recorded: true,
    chatId,
    username,
    startToken,
    candidateLinkCode,
    isStartOrIdCommand,
  };
}

export async function syncTelegramBotUpdates(
  db: D1DatabaseLike,
  botToken: string,
  fetcher: FetchLike = fetch,
): Promise<void> {
  const token = botToken.trim();
  if (!token || /[\s/?#\\]/.test(token)) {
    return;
  }

  try {
    const response = await fetcher(
      `https://api.telegram.org/bot${token}/getUpdates?limit=100`,
      {
        method: "GET",
      },
    );

    if (!response.ok) {
      // If a webhook is active on Telegram, getUpdates returns 409 Conflict;
      // in that case the webhook endpoint already records handshakes into D1.
      return;
    }

    const payload = (await response.json()) as {
      ok?: boolean;
      result?: TelegramUpdate[];
    };

    if (!payload?.ok || !Array.isArray(payload.result)) {
      return;
    }

    for (const update of payload.result) {
      if (update && typeof update === "object") {
        await recordTelegramUpdateHandshake(db, update);
      }
    }
  } catch {
    // Best-effort sync; do not fail channel setup if getUpdates is unreachable.
  }
}

async function lookupTelegramHandshake(
  db: D1DatabaseLike,
  criteria: {
    startToken?: string | null;
    username?: string | null;
  },
): Promise<TelegramBotHandshakeRow | null> {
  await ensureTelegramHandshakesTable(db);

  const startToken = criteria.startToken?.trim() || "";
  if (startToken) {
    const byToken = await db
      .prepare(
        `
          SELECT
            chat_id,
            username,
            chat_title,
            start_token,
            updated_at
          FROM telegram_bot_handshakes
          WHERE start_token = ?
          ORDER BY updated_at DESC
          LIMIT 1
        `,
      )
      .bind(startToken)
      .first<TelegramBotHandshakeRow>();

    if (byToken?.chat_id) {
      return byToken;
    }
  }

  const username = normalizeTelegramUsername(
    criteria.username,
  );
  if (username) {
    const byUsername = await db
      .prepare(
        `
          SELECT
            chat_id,
            username,
            chat_title,
            start_token,
            updated_at
          FROM telegram_bot_handshakes
          WHERE LOWER(username) = ?
          ORDER BY updated_at DESC
          LIMIT 1
        `,
      )
      .bind(username)
      .first<TelegramBotHandshakeRow>();

    if (byUsername?.chat_id) {
      return byUsername;
    }
  }

  return null;
}

export async function resolveTelegramChatDestination(
  db: D1DatabaseLike,
  options: {
    rawChatIdOrUsername?: string | null;
    connectToken?: string | null;
    botToken?: string | null;
    fetcher?: FetchLike;
  },
): Promise<ResolvedTelegramChat> {
  const fetcher = options.fetcher ?? fetch;
  const rawInput = (options.rawChatIdOrUsername ?? "").trim();
  const connectToken = (options.connectToken ?? "").trim();
  const botToken = (options.botToken ?? "").trim();

  // 1. Direct numeric Chat ID (e.g., "123456789" or "-1001234567890")
  if (rawInput && isNumericTelegramChatId(rawInput)) {
    return {
      chatId: rawInput,
      username: null,
    };
  }

  const normalizedUsername =
    normalizeTelegramUsername(rawInput);

  // 2. Check D1 handshakes by connectToken or @username
  if (connectToken || normalizedUsername) {
    let handshake = await lookupTelegramHandshake(db, {
      startToken: connectToken,
      username: normalizedUsername,
    });

    if (!handshake && botToken) {
      await syncTelegramBotUpdates(db, botToken, fetcher);
      handshake = await lookupTelegramHandshake(db, {
        startToken: connectToken,
        username: normalizedUsername,
      });
    }

    if (handshake?.chat_id) {
      return {
        chatId: handshake.chat_id,
        username:
          handshake.username ?? normalizedUsername ?? null,
      };
    }
  }

  // 3. If the user entered a @username or @channel that wasn't in D1 handshakes yet
  if (normalizedUsername) {
    if (botToken && !/[\s/?#\\]/.test(botToken)) {
      try {
        const response = await fetcher(
          `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(`@${normalizedUsername}`)}`,
          {
            method: "GET",
          },
        );
        if (response.ok) {
          const data = (await response.json()) as {
            ok?: boolean;
            result?: {
              id?: number | string;
              username?: string;
            };
          };
          if (
            data?.ok &&
            (typeof data.result?.id === "number" ||
              typeof data.result?.id === "string")
          ) {
            return {
              chatId: String(data.result.id),
              username:
                normalizeTelegramUsername(
                  data.result.username,
                ) ?? normalizedUsername,
            };
          }
        }
      } catch {
        // Fall through to helpful error below
      }

      throw new Error(
        `Could not find a Telegram chat for @${normalizedUsername}. Please open the Morrow Telegram bot and tap Start first (or paste your numeric Chat ID).`,
      );
    }

    // When no botToken is present (e.g., offline config validation), preserve @username
    return {
      chatId: `@${normalizedUsername}`,
      username: normalizedUsername,
    };
  }

  if (rawInput) {
    return {
      chatId: rawInput,
      username: null,
    };
  }

  throw new Error(
    "Open the Morrow Telegram bot and tap Start first, or enter your Telegram @username or Chat ID.",
  );
}

export async function sendTelegramBotPlainMessage(
  options: {
    botToken: string;
    chatId: string;
    text: string;
    fetcher?: FetchLike;
  },
): Promise<boolean> {
  const token = options.botToken.trim();
  const chatId = options.chatId.trim();
  if (!token || !chatId || /[\s/?#\\]/.test(token)) {
    return false;
  }

  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: options.text,
          disable_web_page_preview: true,
        }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export function createTelegramLinkValidationHandler(
  env: TelegramBotEnv,
) {
  return async function POST(
    request: Request,
  ): Promise<Response> {
    const configuredSecret = (
      env.MORROW_TELEGRAM_WEBHOOK_SECRET ?? ""
    ).trim();

    if (configuredSecret) {
      const providedSecret = (
        request.headers.get(
          "x-telegram-bot-api-secret-token",
        ) ??
        request.headers
          .get("authorization")
          ?.replace(/^Bearer\s+/i, "") ??
        ""
      ).trim();

      if (providedSecret !== configuredSecret) {
        return Response.json(
          { error: "Unauthorized Telegram link validation request." },
          { status: 401 },
        );
      }
    }

    let body: {
      code?: unknown;
      chatId?: unknown;
      username?: unknown;
    };
    try {
      body = (await request.json()) as {
        code?: unknown;
        chatId?: unknown;
        username?: unknown;
      };
    } catch {
      return Response.json(
        { error: "Invalid JSON payload." },
        { status: 400 },
      );
    }

    const code =
      typeof body.code === "string" ? body.code : "";
    const chatId =
      typeof body.chatId === "string" ||
      typeof body.chatId === "number"
        ? String(body.chatId)
        : "";
    const username =
      typeof body.username === "string"
        ? body.username
        : null;

    const validation = await validateTelegramLinkCode(
      env.DB,
      {
        code,
        chatId,
        username,
      },
    );

    if (!validation.ok) {
      const status =
        validation.reason === "expired_code"
          ? 410
          : validation.reason === "ineligible_plan" ||
              validation.reason === "capacity_exceeded"
            ? 403
            : 400;
      return Response.json(validation, { status });
    }

    return Response.json(validation, { status: 200 });
  };
}

export function createTelegramWebhookHandler(
  env: TelegramBotEnv,
  fetcher: FetchLike = fetch,
) {
  return async function POST(
    request: Request,
  ): Promise<Response> {
    const configuredSecret = (
      env.MORROW_TELEGRAM_WEBHOOK_SECRET ?? ""
    ).trim();

    if (configuredSecret) {
      const providedSecret = (
        request.headers.get(
          "x-telegram-bot-api-secret-token",
        ) ?? ""
      ).trim();

      if (providedSecret !== configuredSecret) {
        return Response.json(
          { error: "Unauthorized Telegram webhook request." },
          { status: 401 },
        );
      }
    }

    let update: TelegramUpdate;
    try {
      update = (await request.json()) as TelegramUpdate;
    } catch {
      return Response.json(
        { error: "Invalid Telegram webhook JSON payload." },
        { status: 400 },
      );
    }

    const result = await recordTelegramUpdateHandshake(
      env.DB,
      update,
    );

    const botToken = (
      env.MORROW_TELEGRAM_BOT_TOKEN ?? ""
    ).trim();

    if (!result.recorded || !result.chatId) {
      return Response.json({ ok: true });
    }

    // 1. If the user sent a candidate link ID (either directly or as `/start MRW-XXXX`),
    // validate the 10-minute temporary unique ID and link their Telegram chat to their workspace.
    if (result.candidateLinkCode) {
      const validation = await validateTelegramLinkCode(
        env.DB,
        {
          code: result.candidateLinkCode,
          chatId: result.chatId,
          username: result.username,
        },
      );

      if (botToken) {
        if (validation.ok) {
          const lines = [
            `Telegram linked to Morrow (${validation.workspaceName})!`,
            "",
            `Channel: ${validation.channelName}`,
            `Telegram ID: ${validation.chatId}${validation.username ? ` (@${validation.username})` : ""}`,
            "",
            "Your Telegram ID now appears in your Morrow delivery channels list. You can manage routing rules or revoke access anytime in Morrow → Notifications.",
          ];
          await sendTelegramBotPlainMessage({
            botToken,
            chatId: result.chatId,
            text: lines.join("\n"),
            fetcher,
          });
        } else {
          await sendTelegramBotPlainMessage({
            botToken,
            chatId: result.chatId,
            text: validation.message,
            fetcher,
          });
        }
      }

      return Response.json({
        ok: true,
        linked: validation.ok,
        ...(validation.ok
          ? {
              channelId: validation.channelId,
              workspaceId: validation.workspaceId,
            }
          : { reason: validation.reason }),
      });
    }

    // 2. When the user starts the bot (`/start`), prompt them for their 10-minute temporary unique ID.
    if (result.isStartOrIdCommand && botToken) {
      const lines = [
        "Welcome to Morrow!",
        "",
        "Please send your temporary unique ID (valid for 10 minutes) from Morrow → Notifications to link your Telegram account.",
      ];

      await sendTelegramBotPlainMessage({
        botToken,
        chatId: result.chatId,
        text: lines.join("\n"),
        fetcher,
      });
    }

    return Response.json({ ok: true });
  };
}

