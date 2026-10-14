import { randomUUID } from "node:crypto";

import {
  parseExternalChannelConfig,
  type D1DatabaseLike,
} from "../worker/external-notifications.ts";
import {
  EXTERNAL_NOTIFICATION_CHANNELS,
  maskExternalChannelConfigSummary,
  normalizeSignificanceLevel,
  parseAllowedCategoriesJson,
  parseAllowedCompetitorIdsJson,
  parseAllowedDigestPeriodsJson,
  serializeAllowedCategories,
  serializeAllowedCompetitorIds,
  serializeAllowedDigestPeriods,
  type ExternalNotificationChannelType,
  type NotificationChangeCategory,
  type NotificationDigestPeriod,
  type NotificationSignificanceLevel,
} from "../worker/notification-routing.ts";

export interface WorkspaceIdentity {
  id: string;
  name: string;
}

export interface WorkspaceCompetitorOption {
  id: string;
  name: string;
  domain: string;
  status: string;
}

export interface UserEmailNotificationPreferencesView {
  emailEnabled: boolean;
  digestEmailEnabled: boolean;
  minSignificance: NotificationSignificanceLevel;
  categories: NotificationChangeCategory[];
  competitorIds: string[];
  digestPeriods: NotificationDigestPeriod[];
  updatedAt: string | null;
}

export interface WorkspaceExternalChannelView {
  id: string;
  workspaceId: string;
  name: string;
  channel: ExternalNotificationChannelType;
  status: "active" | "paused";
  configSummary: string;
  telegramChatId: string;
  webhookUrl: string;
  sendChanges: boolean;
  sendDigests: boolean;
  minSignificance: NotificationSignificanceLevel;
  categories: NotificationChangeCategory[];
  competitorIds: string[];
  digestPeriods: NotificationDigestPeriod[];
  sentCount: number;
  failedCount: number;
  lastDeliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceNotificationDeliveryMetrics {
  emailChangeSentCount: number;
  emailDigestSentCount: number;
  externalSentCount: number;
  externalFailedCount: number;
}

export interface WorkspaceNotificationSettingsSnapshot {
  workspace: WorkspaceIdentity;
  competitors: WorkspaceCompetitorOption[];
  emailPreferences: UserEmailNotificationPreferencesView;
  externalChannels: WorkspaceExternalChannelView[];
  deliveryMetrics: WorkspaceNotificationDeliveryMetrics;
}

export interface SaveUserEmailNotificationPreferencesInput {
  userId: string;
  emailEnabled: boolean;
  digestEmailEnabled: boolean;
  minSignificance: string;
  categories: readonly string[];
  competitorIds: readonly string[];
  digestPeriods: readonly string[];
}

export interface UpsertWorkspaceExternalChannelInput {
  userId: string;
  channelId?: string;
  name: string;
  channel: string;
  slackWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  sendChanges: boolean;
  sendDigests: boolean;
  minSignificance: string;
  categories: readonly string[];
  competitorIds: readonly string[];
  digestPeriods: readonly string[];
}

interface NotificationPreferencesRow {
  email_enabled: number;
  major_only: number;
  min_significance?: string | null;
  categories_json?: string | null;
  competitor_ids_json?: string | null;
  digest_email_enabled?: number | null;
  digest_periods_json?: string | null;
  updated_at?: string | null;
}

interface ExternalChannelRecordRow {
  id: string;
  workspace_id: string;
  channel: string;
  name: string;
  status: string;
  config_json: string;
  send_changes: number;
  send_digests: number;
  min_significance: string;
  categories_json: string;
  competitor_ids_json: string;
  digest_periods_json: string;
  created_at: string;
  updated_at: string;
  sent_count: number;
  failed_count: number;
  last_delivered_at: string | null;
}

interface DeliveryMetricsRow {
  email_change_sent_count: number;
  email_digest_sent_count: number;
  external_sent_count: number;
  external_failed_count: number;
}

function isExternalChannelType(
  value: string,
): value is ExternalNotificationChannelType {
  return (
    EXTERNAL_NOTIFICATION_CHANNELS as readonly string[]
  ).includes(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error);
  return /unique constraint/i.test(message);
}

function extractSafeEditableFields(
  channel: ExternalNotificationChannelType,
  configJson: string,
): {
  telegramChatId: string;
  webhookUrl: string;
} {
  try {
    const parsed = JSON.parse(configJson) as Record<
      string,
      unknown
    >;

    if (
      channel === "telegram" &&
      typeof parsed?.chatId === "string"
    ) {
      return {
        telegramChatId: parsed.chatId.trim(),
        webhookUrl: "",
      };
    }

    if (
      channel === "webhook" &&
      typeof parsed?.url === "string"
    ) {
      return {
        telegramChatId: "",
        webhookUrl: parsed.url.trim(),
      };
    }
  } catch {
    // Fall back to empty strings if stored JSON cannot be parsed.
  }

  return {
    telegramChatId: "",
    webhookUrl: "",
  };
}

export async function getUserPrimaryWorkspace(
  db: D1DatabaseLike,
  userId: string,
): Promise<WorkspaceIdentity | null> {
  return db
    .prepare(
      `
        SELECT
          workspaces.id,
          workspaces.name

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
      `,
    )
    .bind(userId)
    .first<WorkspaceIdentity>();
}

async function getWorkspaceCompetitors(
  db: D1DatabaseLike,
  workspaceId: string,
): Promise<WorkspaceCompetitorOption[]> {
  const result = await db
    .prepare(
      `
        SELECT
          id,
          name,
          domain,
          status

        FROM competitors

        WHERE workspace_id = ?

        ORDER BY
          name COLLATE NOCASE ASC,
          datetime(created_at) ASC
      `,
    )
    .bind(workspaceId)
    .all<WorkspaceCompetitorOption>();

  return result.results ?? [];
}

function filterValidWorkspaceCompetitorIds(
  requestedIds: readonly string[],
  competitors: readonly WorkspaceCompetitorOption[],
): string[] {
  const validSet = new Set(
    competitors.map((competitor) => competitor.id),
  );

  const filtered: string[] = [];
  for (const rawId of requestedIds) {
    const trimmed =
      typeof rawId === "string" ? rawId.trim() : "";
    if (
      trimmed &&
      validSet.has(trimmed) &&
      !filtered.includes(trimmed)
    ) {
      filtered.push(trimmed);
    }
  }

  return filtered;
}

export async function getWorkspaceNotificationSettings(
  db: D1DatabaseLike,
  userId: string,
): Promise<WorkspaceNotificationSettingsSnapshot> {
  const workspace = await getUserPrimaryWorkspace(
    db,
    userId,
  );

  if (!workspace) {
    throw new Error(
      "No workspace found for this account.",
    );
  }

  const [
    competitors,
    preferencesRow,
    channelsResult,
    metricsRow,
  ] = await Promise.all([
    getWorkspaceCompetitors(db, workspace.id),

    db
      .prepare(
        `
          SELECT
            email_enabled,
            major_only,
            min_significance,
            categories_json,
            competitor_ids_json,
            digest_email_enabled,
            digest_periods_json,
            updated_at

          FROM notification_preferences

          WHERE user_id = ?

          LIMIT 1
        `,
      )
      .bind(userId)
      .first<NotificationPreferencesRow>(),

    db
      .prepare(
        `
          SELECT
            external_notification_channels.id,
            external_notification_channels.workspace_id,
            external_notification_channels.channel,
            external_notification_channels.name,
            external_notification_channels.status,
            external_notification_channels.config_json,
            external_notification_channels.send_changes,
            external_notification_channels.send_digests,
            external_notification_channels.min_significance,
            external_notification_channels.categories_json,
            external_notification_channels.competitor_ids_json,
            external_notification_channels.digest_periods_json,
            external_notification_channels.created_at,
            external_notification_channels.updated_at,

            (
              SELECT
                COUNT(*)
              FROM external_notification_deliveries
              WHERE external_notification_deliveries.channel_id =
                    external_notification_channels.id
                AND external_notification_deliveries.status = 'sent'
            ) AS sent_count,

            (
              SELECT
                COUNT(*)
              FROM external_notification_deliveries
              WHERE external_notification_deliveries.channel_id =
                    external_notification_channels.id
                AND external_notification_deliveries.status = 'failed'
            ) AS failed_count,

            (
              SELECT
                MAX(external_notification_deliveries.sent_at)
              FROM external_notification_deliveries
              WHERE external_notification_deliveries.channel_id =
                    external_notification_channels.id
                AND external_notification_deliveries.status = 'sent'
            ) AS last_delivered_at

          FROM external_notification_channels

          WHERE external_notification_channels.workspace_id = ?

          ORDER BY
            datetime(
              external_notification_channels.created_at
            ) ASC,
            external_notification_channels.name COLLATE NOCASE ASC
        `,
      )
      .bind(workspace.id)
      .all<ExternalChannelRecordRow>(),

    db
      .prepare(
        `
          SELECT
            (
              SELECT
                COUNT(*)
              FROM notification_deliveries
              INNER JOIN changes
                ON changes.id = notification_deliveries.change_id
              INNER JOIN monitored_pages
                ON monitored_pages.id = changes.monitored_page_id
              INNER JOIN competitors
                ON competitors.id = monitored_pages.competitor_id
              WHERE competitors.workspace_id = ?
                AND notification_deliveries.user_id = ?
                AND notification_deliveries.status = 'sent'
            ) AS email_change_sent_count,

            (
              SELECT
                COUNT(*)
              FROM digest_email_deliveries
              INNER JOIN digests
                ON digests.id = digest_email_deliveries.digest_id
              WHERE digests.workspace_id = ?
                AND digest_email_deliveries.user_id = ?
                AND digest_email_deliveries.status = 'sent'
            ) AS email_digest_sent_count,

            (
              SELECT
                COUNT(*)
              FROM external_notification_deliveries
              INNER JOIN external_notification_channels
                ON external_notification_channels.id =
                   external_notification_deliveries.channel_id
              WHERE external_notification_channels.workspace_id = ?
                AND external_notification_deliveries.status = 'sent'
            ) AS external_sent_count,

            (
              SELECT
                COUNT(*)
              FROM external_notification_deliveries
              INNER JOIN external_notification_channels
                ON external_notification_channels.id =
                   external_notification_deliveries.channel_id
              WHERE external_notification_channels.workspace_id = ?
                AND external_notification_deliveries.status = 'failed'
            ) AS external_failed_count
        `,
      )
      .bind(
        workspace.id,
        userId,
        workspace.id,
        userId,
        workspace.id,
        workspace.id,
      )
      .first<DeliveryMetricsRow>(),
  ]);

  const parsedEmailDigestPeriods = preferencesRow
    ? parseAllowedDigestPeriodsJson(
        preferencesRow.digest_periods_json,
      )
    : [];

  const emailPreferences: UserEmailNotificationPreferencesView =
    preferencesRow
      ? {
          emailEnabled:
            preferencesRow.email_enabled === 1,
          digestEmailEnabled:
            preferencesRow.digest_email_enabled === 1,
          minSignificance: normalizeSignificanceLevel(
            preferencesRow.min_significance,
            preferencesRow.major_only,
          ),
          categories: parseAllowedCategoriesJson(
            preferencesRow.categories_json,
          ),
          competitorIds: filterValidWorkspaceCompetitorIds(
            parseAllowedCompetitorIdsJson(
              preferencesRow.competitor_ids_json,
            ),
            competitors,
          ),
          digestPeriods:
            parsedEmailDigestPeriods.length > 0
              ? parsedEmailDigestPeriods
              : ["weekly"],
          updatedAt: preferencesRow.updated_at ?? null,
        }
      : {
          emailEnabled: true,
          digestEmailEnabled: false,
          minSignificance: "minor",
          categories: [],
          competitorIds: [],
          digestPeriods: ["weekly"],
          updatedAt: null,
        };

  const externalChannels: WorkspaceExternalChannelView[] = (
    channelsResult.results ?? []
  )
    .filter((row) => isExternalChannelType(row.channel))
    .map((row) => {
      const channelType =
        row.channel as ExternalNotificationChannelType;
      const editableFields = extractSafeEditableFields(
        channelType,
        row.config_json,
      );
      const parsedChannelPeriods =
        parseAllowedDigestPeriodsJson(
          row.digest_periods_json,
        );

      return {
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name,
        channel: channelType,
        status:
          row.status === "paused" ? "paused" : "active",
        configSummary: maskExternalChannelConfigSummary(
          channelType,
          row.config_json,
        ).summary,
        telegramChatId: editableFields.telegramChatId,
        webhookUrl: editableFields.webhookUrl,
        sendChanges: row.send_changes === 1,
        sendDigests: row.send_digests === 1,
        minSignificance: normalizeSignificanceLevel(
          row.min_significance,
          "minor",
        ),
        categories: parseAllowedCategoriesJson(
          row.categories_json,
        ),
        competitorIds: filterValidWorkspaceCompetitorIds(
          parseAllowedCompetitorIdsJson(
            row.competitor_ids_json,
          ),
          competitors,
        ),
        digestPeriods:
          parsedChannelPeriods.length > 0
            ? parsedChannelPeriods
            : ["daily", "weekly", "monthly"],
        sentCount: Number(row.sent_count ?? 0),
        failedCount: Number(row.failed_count ?? 0),
        lastDeliveredAt: row.last_delivered_at ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

  return {
    workspace,
    competitors,
    emailPreferences,
    externalChannels,
    deliveryMetrics: {
      emailChangeSentCount: Number(
        metricsRow?.email_change_sent_count ?? 0,
      ),
      emailDigestSentCount: Number(
        metricsRow?.email_digest_sent_count ?? 0,
      ),
      externalSentCount: Number(
        metricsRow?.external_sent_count ?? 0,
      ),
      externalFailedCount: Number(
        metricsRow?.external_failed_count ?? 0,
      ),
    },
  };
}

export async function saveUserEmailNotificationPreferences(
  db: D1DatabaseLike,
  input: SaveUserEmailNotificationPreferencesInput,
): Promise<UserEmailNotificationPreferencesView> {
  const workspace = await getUserPrimaryWorkspace(
    db,
    input.userId,
  );

  if (!workspace) {
    throw new Error(
      "No workspace found for this account.",
    );
  }

  const competitors = await getWorkspaceCompetitors(
    db,
    workspace.id,
  );

  const minSignificance = normalizeSignificanceLevel(
    input.minSignificance,
    "minor",
  );
  const majorOnly = minSignificance === "major" ? 1 : 0;

  const categoriesJson = serializeAllowedCategories(
    input.categories,
  );
  const validCompetitorIds =
    filterValidWorkspaceCompetitorIds(
      input.competitorIds,
      competitors,
    );
  const competitorIdsJson = serializeAllowedCompetitorIds(
    validCompetitorIds,
  );

  const normalizedDigestPeriods =
    parseAllowedDigestPeriodsJson(
      JSON.stringify(input.digestPeriods),
    );

  if (
    input.digestEmailEnabled &&
    normalizedDigestPeriods.length === 0
  ) {
    throw new Error(
      "Choose at least one digest schedule when scheduled digest emails are enabled.",
    );
  }

  const digestPeriodsJson = serializeAllowedDigestPeriods(
    normalizedDigestPeriods,
    ["weekly"],
  );

  await db
    .prepare(
      `
        INSERT INTO notification_preferences (
          id,
          user_id,
          email_enabled,
          major_only,
          min_significance,
          categories_json,
          competitor_ids_json,
          digest_email_enabled,
          digest_periods_json,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          ?,
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
        ON CONFLICT(user_id) DO UPDATE SET
          email_enabled = excluded.email_enabled,
          major_only = excluded.major_only,
          min_significance = excluded.min_significance,
          categories_json = excluded.categories_json,
          competitor_ids_json = excluded.competitor_ids_json,
          digest_email_enabled = excluded.digest_email_enabled,
          digest_periods_json = excluded.digest_periods_json,
          updated_at = CURRENT_TIMESTAMP
      `,
    )
    .bind(
      randomUUID(),
      input.userId,
      input.emailEnabled ? 1 : 0,
      majorOnly,
      minSignificance,
      categoriesJson,
      competitorIdsJson,
      input.digestEmailEnabled ? 1 : 0,
      digestPeriodsJson,
    )
    .run();

  return {
    emailEnabled: input.emailEnabled,
    digestEmailEnabled: input.digestEmailEnabled,
    minSignificance,
    categories: parseAllowedCategoriesJson(categoriesJson),
    competitorIds: validCompetitorIds,
    digestPeriods: parseAllowedDigestPeriodsJson(
      digestPeriodsJson,
    ),
    updatedAt: new Date().toISOString(),
  };
}

function buildValidatedExternalConfigJson(
  channel: ExternalNotificationChannelType,
  input: UpsertWorkspaceExternalChannelInput,
  existingConfigJson?: string,
): string {
  let existingParsed: Record<string, unknown> = {};
  if (existingConfigJson) {
    try {
      const parsed = JSON.parse(existingConfigJson);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        existingParsed = parsed as Record<string, unknown>;
      }
    } catch {
      existingParsed = {};
    }
  }

  let candidateConfig: Record<string, unknown>;

  switch (channel) {
    case "slack": {
      const providedWebhookUrl = (
        input.slackWebhookUrl ?? ""
      ).trim();
      const webhookUrl =
        providedWebhookUrl ||
        (typeof existingParsed.webhookUrl === "string"
          ? existingParsed.webhookUrl.trim()
          : "");

      if (!webhookUrl) {
        throw new Error(
          "Slack incoming webhook URL is required.",
        );
      }

      candidateConfig = {
        webhookUrl,
      };
      break;
    }

    case "telegram": {
      const providedBotToken = (
        input.telegramBotToken ?? ""
      ).trim();
      const botToken =
        providedBotToken ||
        (typeof existingParsed.botToken === "string"
          ? existingParsed.botToken.trim()
          : "");

      const providedChatId = (
        input.telegramChatId ?? ""
      ).trim();
      const chatId =
        providedChatId ||
        (typeof existingParsed.chatId === "string"
          ? existingParsed.chatId.trim()
          : "");

      if (!botToken) {
        throw new Error(
          "Telegram bot token is required.",
        );
      }

      if (!chatId) {
        throw new Error(
          "Telegram chat ID is required.",
        );
      }

      candidateConfig = {
        botToken,
        chatId,
        ...(typeof existingParsed.apiBaseUrl === "string" &&
        existingParsed.apiBaseUrl.trim().length > 0
          ? {
              apiBaseUrl:
                existingParsed.apiBaseUrl.trim(),
            }
          : {}),
      };
      break;
    }

    case "webhook": {
      const providedUrl = (input.webhookUrl ?? "").trim();
      const url =
        providedUrl ||
        (typeof existingParsed.url === "string"
          ? existingParsed.url.trim()
          : "");

      const providedSecret = (
        input.webhookSecret ?? ""
      ).trim();
      const secret =
        providedSecret ||
        (typeof existingParsed.secret === "string"
          ? existingParsed.secret.trim()
          : "");

      if (!url) {
        throw new Error(
          "Webhook destination HTTPS URL is required.",
        );
      }

      if (!secret) {
        throw new Error(
          "Webhook signing secret is required.",
        );
      }

      candidateConfig = {
        url,
        secret,
      };
      break;
    }
  }

  const serialized = JSON.stringify(candidateConfig);

  // Validate against the Worker's canonical parser (HTTPS enforcement, token syntax, etc.).
  parseExternalChannelConfig(channel, serialized);

  return serialized;
}

export async function createWorkspaceExternalChannel(
  db: D1DatabaseLike,
  input: UpsertWorkspaceExternalChannelInput,
): Promise<{ id: string }> {
  const workspace = await getUserPrimaryWorkspace(
    db,
    input.userId,
  );

  if (!workspace) {
    throw new Error(
      "No workspace found for this account.",
    );
  }

  const name = input.name.trim();
  if (!name) {
    throw new Error("Channel name is required.");
  }

  const normalizedChannel = input.channel
    .trim()
    .toLowerCase();
  if (!isExternalChannelType(normalizedChannel)) {
    throw new Error(
      "Choose a valid channel type (Slack, Telegram, or Webhook).",
    );
  }

  if (!input.sendChanges && !input.sendDigests) {
    throw new Error(
      "Enable at least one delivery trigger (instant change alerts or scheduled digests) for this channel.",
    );
  }

  const normalizedDigestPeriods =
    parseAllowedDigestPeriodsJson(
      JSON.stringify(input.digestPeriods),
    );

  if (
    input.sendDigests &&
    normalizedDigestPeriods.length === 0
  ) {
    throw new Error(
      "Choose at least one digest schedule when scheduled digests are enabled for this channel.",
    );
  }

  const competitors = await getWorkspaceCompetitors(
    db,
    workspace.id,
  );

  const configJson = buildValidatedExternalConfigJson(
    normalizedChannel,
    input,
  );

  const minSignificance = normalizeSignificanceLevel(
    input.minSignificance,
    "minor",
  );
  const categoriesJson = serializeAllowedCategories(
    input.categories,
  );
  const validCompetitorIds =
    filterValidWorkspaceCompetitorIds(
      input.competitorIds,
      competitors,
    );
  const competitorIdsJson = serializeAllowedCompetitorIds(
    validCompetitorIds,
  );
  const digestPeriodsJson = serializeAllowedDigestPeriods(
    normalizedDigestPeriods,
    ["daily", "weekly", "monthly"],
  );

  const channelId = randomUUID();

  try {
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
            ?,
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
        workspace.id,
        normalizedChannel,
        name,
        configJson,
        input.sendChanges ? 1 : 0,
        input.sendDigests ? 1 : 0,
        minSignificance,
        categoriesJson,
        competitorIdsJson,
        digestPeriodsJson,
      )
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error(
        "A delivery channel with this name already exists for that integration type.",
      );
    }
    throw error;
  }

  return { id: channelId };
}

export async function updateWorkspaceExternalChannel(
  db: D1DatabaseLike,
  input: UpsertWorkspaceExternalChannelInput,
): Promise<void> {
  const channelId = (input.channelId ?? "").trim();
  const name = input.name.trim();

  if (!channelId || !name) {
    throw new Error(
      "Channel ID and name are required.",
    );
  }

  const existing = await db
    .prepare(
      `
        SELECT
          external_notification_channels.id,
          external_notification_channels.workspace_id,
          external_notification_channels.channel,
          external_notification_channels.config_json

        FROM external_notification_channels

        INNER JOIN workspace_members
          ON workspace_members.workspace_id =
             external_notification_channels.workspace_id

        WHERE external_notification_channels.id = ?
          AND workspace_members.user_id = ?

        LIMIT 1
      `,
    )
    .bind(channelId, input.userId)
    .first<{
      id: string;
      workspace_id: string;
      channel: string;
      config_json: string;
    }>();

  if (!existing) {
    throw new Error(
      "Notification channel not found or access denied.",
    );
  }

  if (!isExternalChannelType(existing.channel)) {
    throw new Error(
      `Unsupported external notification channel: ${existing.channel}`,
    );
  }

  if (!input.sendChanges && !input.sendDigests) {
    throw new Error(
      "Enable at least one delivery trigger (instant change alerts or scheduled digests) for this channel.",
    );
  }

  const normalizedDigestPeriods =
    parseAllowedDigestPeriodsJson(
      JSON.stringify(input.digestPeriods),
    );

  if (
    input.sendDigests &&
    normalizedDigestPeriods.length === 0
  ) {
    throw new Error(
      "Choose at least one digest schedule when scheduled digests are enabled for this channel.",
    );
  }

  const competitors = await getWorkspaceCompetitors(
    db,
    existing.workspace_id,
  );

  const configJson = buildValidatedExternalConfigJson(
    existing.channel,
    input,
    existing.config_json,
  );

  const minSignificance = normalizeSignificanceLevel(
    input.minSignificance,
    "minor",
  );
  const categoriesJson = serializeAllowedCategories(
    input.categories,
  );
  const validCompetitorIds =
    filterValidWorkspaceCompetitorIds(
      input.competitorIds,
      competitors,
    );
  const competitorIdsJson = serializeAllowedCompetitorIds(
    validCompetitorIds,
  );
  const digestPeriodsJson = serializeAllowedDigestPeriods(
    normalizedDigestPeriods,
    ["daily", "weekly", "monthly"],
  );

  let result;
  try {
    result = await db
      .prepare(
        `
          UPDATE external_notification_channels

          SET
            name = ?,
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
        name,
        configJson,
        input.sendChanges ? 1 : 0,
        input.sendDigests ? 1 : 0,
        minSignificance,
        categoriesJson,
        competitorIdsJson,
        digestPeriodsJson,
        channelId,
        existing.workspace_id,
      )
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error(
        "Another channel of this type already uses that name.",
      );
    }
    throw error;
  }

  if ((result.meta?.changes ?? 0) === 0) {
    throw new Error(
      "Notification channel not found or access denied.",
    );
  }
}

export async function toggleWorkspaceExternalChannelStatus(
  db: D1DatabaseLike,
  input: {
    userId: string;
    channelId: string;
    currentStatus: string;
  },
): Promise<"active" | "paused"> {
  const channelId = input.channelId.trim();
  if (!channelId) {
    throw new Error("Channel ID is required.");
  }

  const nextStatus =
    input.currentStatus.trim() === "active"
      ? "paused"
      : "active";

  const result = await db
    .prepare(
      `
        UPDATE external_notification_channels

        SET
          status = ?,
          updated_at = CURRENT_TIMESTAMP

        WHERE id = ?
          AND workspace_id IN (
            SELECT
              workspace_id
            FROM workspace_members
            WHERE user_id = ?
          )
      `,
    )
    .bind(nextStatus, channelId, input.userId)
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    throw new Error(
      "Notification channel not found or access denied.",
    );
  }

  return nextStatus;
}

export async function removeWorkspaceExternalChannel(
  db: D1DatabaseLike,
  input: {
    userId: string;
    channelId: string;
  },
): Promise<void> {
  const channelId = input.channelId.trim();
  if (!channelId) {
    throw new Error("Channel ID is required.");
  }

  const result = await db
    .prepare(
      `
        DELETE FROM external_notification_channels

        WHERE id = ?
          AND workspace_id IN (
            SELECT
              workspace_id
            FROM workspace_members
            WHERE user_id = ?
          )
      `,
    )
    .bind(channelId, input.userId)
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    throw new Error(
      "Notification channel not found or access denied.",
    );
  }
}
