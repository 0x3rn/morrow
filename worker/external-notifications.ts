import type { ChangeNotificationContext } from "./change-email.ts";
import {
  DIGEST_PERIODS,
  parseDigestContent,
  type DigestPeriod,
  type GeneratedDigest,
} from "./digest-generator.ts";
import {
  assertHttpsUrl,
  buildChangeDeliveryEvent,
  buildDigestDeliveryEvent,
  deliverExternalEvent,
  isExternalDeliveryChannel,
  type ExternalChannelDestination,
  type ExternalDeliveryChannel,
  type FetchLike,
} from "./external-delivery.ts";
import {
  matchesChangeRoutingPolicy,
  scopeDigestContentToRoutingPolicy,
} from "./notification-routing.ts";

interface D1ResultLike<T> {
  results?: T[];
}

interface D1RunResultLike {
  success?: boolean;
  meta?: {
    changes?: number;
  };
}

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T>(): Promise<D1ResultLike<T>>;
  first<T>(): Promise<T | null>;
  run(): Promise<D1RunResultLike>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export interface ExternalNotificationEnv {
  DB: D1DatabaseLike;
  MORROW_APP_URL?: string;
}

export interface ExternalChannelRow {
  id: string;
  workspace_id: string;
  channel: string;
  name: string;
  status: string;
  config_json: string;
  send_changes?: number;
  send_digests?: number;
  min_significance?: string;
  categories_json?: string;
  competitor_ids_json?: string;
  digest_periods_json?: string;
}

interface ExistingExternalDelivery {
  id: string;
  status: string;
  attempt_count: number;
  claim_token: string | null;
}

interface ExternalDeliveryClaim {
  claimed: boolean;
  deliveryId: string | null;
  claimToken: string | null;
  reason: "claimed" | "already_sent" | "in_flight";
}

interface PersistedDigestRow {
  id: string;
  workspace_id: string;
  period: string;
  window_start: string;
  window_end: string;
  status: string;
  change_count: number;
  major_change_count: number;
  moderate_change_count: number;
  minor_change_count: number;
  content_json: string | null;
  generated_at: string | null;
}

export interface ChangeExternalDeliveryRunResult {
  changeId: string;
  changeFound: boolean;
  configured: boolean;
  channelsFound: number;
  sent: number;
  alreadySent: number;
  inFlight: number;
  failed: number;
}

export interface DigestExternalDeliveryRunResult {
  digestId: string;
  digestFound: boolean;
  configured: boolean;
  channelsFound: number;
  sent: number;
  alreadySent: number;
  inFlight: number;
  failed: number;
}

type DeliverySourceTarget =
  | {
      sourceType: "change";
      changeId: string;
    }
  | {
      sourceType: "digest";
      digestId: string;
    };

function getAffectedRows(result: D1RunResultLike): number {
  return Number(result.meta?.changes ?? 0);
}

function trimError(value: unknown): string {
  const message =
    value instanceof Error ? value.message : String(value);
  const normalized =
    message.replace(/\s+/g, " ").trim() ||
    "External notification delivery failed.";
  return normalized.slice(0, 2000);
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function assertNonEmptyString(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function isDigestPeriod(
  value: string,
): value is DigestPeriod {
  return (DIGEST_PERIODS as readonly string[]).includes(
    value,
  );
}

export function parseExternalChannelConfig(
  channel: string,
  configJson: string,
): ExternalChannelDestination {
  if (!isExternalDeliveryChannel(channel)) {
    throw new Error(
      `Unsupported external notification channel: ${channel}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    throw new Error(
      `External channel (${channel}) config_json is not valid JSON.`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      `External channel (${channel}) config_json must be a JSON object.`,
    );
  }

  switch (channel) {
    case "slack": {
      const webhookUrl = assertHttpsUrl(
        assertNonEmptyString(
          parsed.webhookUrl,
          "Slack webhookUrl",
        ),
        "Slack webhookUrl",
      );
      return {
        channel: "slack",
        webhookUrl,
      };
    }

    case "telegram": {
      const botToken = assertNonEmptyString(
        parsed.botToken,
        "Telegram botToken",
      );
      if (/[\s/?#\\]/.test(botToken)) {
        throw new Error(
          "Telegram botToken contains invalid URL characters.",
        );
      }
      const chatId = assertNonEmptyString(
        parsed.chatId,
        "Telegram chatId",
      );
      const apiBaseUrl =
        typeof parsed.apiBaseUrl === "string" &&
        parsed.apiBaseUrl.trim().length > 0
          ? assertHttpsUrl(
              parsed.apiBaseUrl,
              "Telegram apiBaseUrl",
            )
          : undefined;

      return {
        channel: "telegram",
        botToken,
        chatId,
        ...(apiBaseUrl ? { apiBaseUrl } : {}),
      };
    }

    case "webhook": {
      const url = assertHttpsUrl(
        assertNonEmptyString(
          parsed.url,
          "Webhook destination url",
        ),
        "Webhook destination url",
      );
      const secret = assertNonEmptyString(
        parsed.secret,
        "Webhook signing secret",
      );
      return {
        channel: "webhook",
        url,
        secret,
      };
    }
  }
}

async function getChangeContext(
  db: D1DatabaseLike,
  changeId: string,
): Promise<ChangeNotificationContext | null> {
  return db
    .prepare(
      `
        SELECT
          changes.id AS change_id,
          changes.category,
          changes.significance,
          changes.summary,
          changes.why_it_matters,
          changes.detected_at,
          monitored_pages.id AS monitored_page_id,
          monitored_pages.url AS monitored_page_url,
          monitored_pages.label AS monitored_page_label,
          competitors.id AS competitor_id,
          competitors.name AS competitor_name,
          competitors.domain AS competitor_domain,
          competitors.workspace_id
        FROM changes
        INNER JOIN monitored_pages
          ON monitored_pages.id = changes.monitored_page_id
        INNER JOIN competitors
          ON competitors.id = monitored_pages.competitor_id
        WHERE changes.id = ?
        LIMIT 1
      `,
    )
    .bind(changeId)
    .first<ChangeNotificationContext>();
}

async function getGeneratedDigestById(
  db: D1DatabaseLike,
  digestId: string,
): Promise<GeneratedDigest | null> {
  const row = await db
    .prepare(
      `
        SELECT
          id,
          workspace_id,
          period,
          window_start,
          window_end,
          status,
          change_count,
          major_change_count,
          moderate_change_count,
          minor_change_count,
          content_json,
          generated_at
        FROM digests
        WHERE id = ?
        LIMIT 1
      `,
    )
    .bind(digestId)
    .first<PersistedDigestRow>();

  if (
    !row ||
    row.status !== "generated" ||
    row.content_json === null ||
    row.generated_at === null
  ) {
    return null;
  }

  if (!isDigestPeriod(row.period)) {
    throw new Error(
      `Persisted digest ${row.id} has unsupported period ${row.period}.`,
    );
  }

  const content = parseDigestContent(row.content_json);
  if (
    content.workspaceId !== row.workspace_id ||
    content.period !== row.period ||
    content.windowStart !== row.window_start ||
    content.windowEnd !== row.window_end ||
    content.generatedAt !== row.generated_at ||
    content.totals.changes !== row.change_count ||
    content.totals.major !== row.major_change_count ||
    content.totals.moderate !== row.moderate_change_count ||
    content.totals.minor !== row.minor_change_count
  ) {
    throw new Error(
      `Persisted digest ${row.id} content does not match its database metadata.`,
    );
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    period: row.period,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    status: "generated",
    generatedAt: row.generated_at,
    content,
    reused: true,
  };
}

async function getActiveWorkspaceChannels(
  db: D1DatabaseLike,
  workspaceId: string,
): Promise<ExternalChannelRow[]> {
  const { results } = await db
    .prepare(
      `
        SELECT
          id,
          workspace_id,
          channel,
          name,
          status,
          config_json,
          COALESCE(send_changes, 1) AS send_changes,
          COALESCE(send_digests, 1) AS send_digests,
          COALESCE(min_significance, 'minor') AS min_significance,
          COALESCE(categories_json, '[]') AS categories_json,
          COALESCE(competitor_ids_json, '[]') AS competitor_ids_json,
          COALESCE(digest_periods_json, '["daily","weekly","monthly"]') AS digest_periods_json
        FROM external_notification_channels
        WHERE workspace_id = ?
          AND status = 'active'
        ORDER BY id ASC
      `,
    )
    .bind(workspaceId)
    .all<ExternalChannelRow>();

  return results ?? [];
}

async function findExistingExternalDelivery(
  db: D1DatabaseLike,
  channelId: string,
  target: DeliverySourceTarget,
): Promise<ExistingExternalDelivery | null> {
  if (target.sourceType === "change") {
    return db
      .prepare(
        `
          SELECT
            id,
            status,
            attempt_count,
            claim_token
          FROM external_notification_deliveries
          WHERE channel_id = ?
            AND source_type = 'change'
            AND change_id = ?
          LIMIT 1
        `,
      )
      .bind(channelId, target.changeId)
      .first<ExistingExternalDelivery>();
  }

  return db
    .prepare(
      `
        SELECT
          id,
          status,
          attempt_count,
          claim_token
        FROM external_notification_deliveries
        WHERE channel_id = ?
          AND source_type = 'digest'
          AND digest_id = ?
        LIMIT 1
      `,
    )
    .bind(channelId, target.digestId)
    .first<ExistingExternalDelivery>();
}

async function claimExternalDelivery(
  db: D1DatabaseLike,
  workspaceId: string,
  channelId: string,
  channel: ExternalDeliveryChannel,
  target: DeliverySourceTarget,
): Promise<ExternalDeliveryClaim> {
  const deliveryId = crypto.randomUUID();
  const claimToken = crypto.randomUUID();

  const insertResult = await db
    .prepare(
      `
        INSERT OR IGNORE INTO external_notification_deliveries (
          id,
          workspace_id,
          channel_id,
          channel,
          source_type,
          change_id,
          digest_id,
          status,
          attempt_count,
          claim_token,
          claimed_at,
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
          'sending',
          1,
          ?,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `,
    )
    .bind(
      deliveryId,
      workspaceId,
      channelId,
      channel,
      target.sourceType,
      target.sourceType === "change"
        ? target.changeId
        : null,
      target.sourceType === "digest"
        ? target.digestId
        : null,
      claimToken,
    )
    .run();

  if (getAffectedRows(insertResult) > 0) {
    return {
      claimed: true,
      deliveryId,
      claimToken,
      reason: "claimed",
    };
  }

  const retryResult =
    target.sourceType === "change"
      ? await db
          .prepare(
            `
              UPDATE external_notification_deliveries
              SET
                status = 'sending',
                attempt_count = attempt_count + 1,
                claim_token = ?,
                claimed_at = CURRENT_TIMESTAMP,
                last_error = NULL,
                sent_at = NULL,
                updated_at = CURRENT_TIMESTAMP
              WHERE channel_id = ?
                AND source_type = 'change'
                AND change_id = ?
                AND status <> 'sent'
                AND (
                  status = 'failed'
                  OR (
                    status = 'sending'
                    AND datetime(claimed_at) <= datetime('now', '-15 minutes')
                  )
                )
            `,
          )
          .bind(claimToken, channelId, target.changeId)
          .run()
      : await db
          .prepare(
            `
              UPDATE external_notification_deliveries
              SET
                status = 'sending',
                attempt_count = attempt_count + 1,
                claim_token = ?,
                claimed_at = CURRENT_TIMESTAMP,
                last_error = NULL,
                sent_at = NULL,
                updated_at = CURRENT_TIMESTAMP
              WHERE channel_id = ?
                AND source_type = 'digest'
                AND digest_id = ?
                AND status <> 'sent'
                AND (
                  status = 'failed'
                  OR (
                    status = 'sending'
                    AND datetime(claimed_at) <= datetime('now', '-15 minutes')
                  )
                )
            `,
          )
          .bind(claimToken, channelId, target.digestId)
          .run();

  if (getAffectedRows(retryResult) > 0) {
    const row = await findExistingExternalDelivery(
      db,
      channelId,
      target,
    );

    if (!row || row.claim_token !== claimToken) {
      throw new Error(
        "External notification delivery was claimed for retry but could not be reloaded.",
      );
    }

    return {
      claimed: true,
      deliveryId: row.id,
      claimToken,
      reason: "claimed",
    };
  }

  const existing = await findExistingExternalDelivery(
    db,
    channelId,
    target,
  );

  if (existing?.status === "sent") {
    return {
      claimed: false,
      deliveryId: existing.id,
      claimToken: null,
      reason: "already_sent",
    };
  }

  return {
    claimed: false,
    deliveryId: existing?.id ?? null,
    claimToken: null,
    reason: "in_flight",
  };
}

async function markExternalDeliverySent(
  db: D1DatabaseLike,
  deliveryId: string,
  claimToken: string,
  providerMessageId: string | null,
): Promise<void> {
  await db
    .prepare(
      `
        UPDATE external_notification_deliveries
        SET
          status = 'sent',
          provider_message_id = ?,
          sent_at = CURRENT_TIMESTAMP,
          last_error = NULL,
          claim_token = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND claim_token = ?
      `,
    )
    .bind(providerMessageId, deliveryId, claimToken)
    .run();
}

async function markExternalDeliveryFailed(
  db: D1DatabaseLike,
  deliveryId: string,
  claimToken: string,
  error: unknown,
): Promise<void> {
  await db
    .prepare(
      `
        UPDATE external_notification_deliveries
        SET
          status = 'failed',
          last_error = ?,
          sent_at = NULL,
          claim_token = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND claim_token = ?
      `,
    )
    .bind(trimError(error), deliveryId, claimToken)
    .run();
}

export async function notifyChangeByExternalChannels(
  env: ExternalNotificationEnv,
  changeId: string,
  fetcher: FetchLike = fetch,
): Promise<ChangeExternalDeliveryRunResult> {
  const result: ChangeExternalDeliveryRunResult = {
    changeId,
    changeFound: false,
    configured: false,
    channelsFound: 0,
    sent: 0,
    alreadySent: 0,
    inFlight: 0,
    failed: 0,
  };

  const context = await getChangeContext(env.DB, changeId);
  if (!context) {
    return result;
  }

  result.changeFound = true;

  const activeChannels = await getActiveWorkspaceChannels(
    env.DB,
    context.workspace_id,
  );
  const channels = activeChannels.filter((channelRow) =>
    matchesChangeRoutingPolicy(
      {
        category: context.category,
        significance: context.significance,
        competitorId: context.competitor_id,
      },
      {
        enabled: channelRow.status === "active",
        sendChanges: channelRow.send_changes ?? 1,
        minSignificance: channelRow.min_significance,
        categoriesJson: channelRow.categories_json,
        competitorIdsJson: channelRow.competitor_ids_json,
      },
    ),
  );
  result.channelsFound = channels.length;

  if (!env.MORROW_APP_URL) {
    console.log(
      "Morrow external change notification skipped because MORROW_APP_URL is not configured.",
      {
        changeId,
        channelsFound: channels.length,
      },
    );
    return result;
  }

  result.configured = true;

  for (const channelRow of channels) {
    let claim: ExternalDeliveryClaim | null = null;

    try {
      if (!isExternalDeliveryChannel(channelRow.channel)) {
        throw new Error(
          `Unsupported external channel type: ${channelRow.channel}`,
        );
      }

      claim = await claimExternalDelivery(
        env.DB,
        context.workspace_id,
        channelRow.id,
        channelRow.channel,
        {
          sourceType: "change",
          changeId: context.change_id,
        },
      );

      if (!claim.claimed) {
        if (claim.reason === "already_sent") {
          result.alreadySent += 1;
        } else {
          result.inFlight += 1;
        }
        continue;
      }

      if (!claim.deliveryId || !claim.claimToken) {
        throw new Error(
          "External change delivery claim is missing its delivery ID or claim token.",
        );
      }

      const destination = parseExternalChannelConfig(
        channelRow.channel,
        channelRow.config_json,
      );
      const event = buildChangeDeliveryEvent(
        context,
        env.MORROW_APP_URL,
        {
          deliveryId: claim.deliveryId,
        },
      );

      const providerResult = await deliverExternalEvent(
        destination,
        event,
        fetcher,
      );

      await markExternalDeliverySent(
        env.DB,
        claim.deliveryId,
        claim.claimToken,
        providerResult.providerMessageId,
      );

      result.sent += 1;
    } catch (error) {
      result.failed += 1;

      if (
        claim?.claimed &&
        claim.deliveryId &&
        claim.claimToken
      ) {
        try {
          await markExternalDeliveryFailed(
            env.DB,
            claim.deliveryId,
            claim.claimToken,
            error,
          );
        } catch (markError) {
          console.error(
            "Morrow could not record external change delivery failure.",
            {
              changeId,
              channelId: channelRow.id,
              deliveryId: claim.deliveryId,
              error: trimError(markError),
            },
          );
        }
      }

      console.error(
        "Morrow external change delivery failed.",
        {
          changeId,
          channelId: channelRow.id,
          channel: channelRow.channel,
          error: trimError(error),
        },
      );
    }
  }

  return result;
}

export async function notifyDigestByExternalChannels(
  env: ExternalNotificationEnv,
  digestId: string,
  fetcher: FetchLike = fetch,
): Promise<DigestExternalDeliveryRunResult> {
  const result: DigestExternalDeliveryRunResult = {
    digestId,
    digestFound: false,
    configured: false,
    channelsFound: 0,
    sent: 0,
    alreadySent: 0,
    inFlight: 0,
    failed: 0,
  };

  const digest = await getGeneratedDigestById(
    env.DB,
    digestId,
  );
  if (!digest) {
    return result;
  }

  result.digestFound = true;

  const activeChannels = await getActiveWorkspaceChannels(
    env.DB,
    digest.workspaceId,
  );
  const eligibleChannels = activeChannels
    .map((channelRow) => {
      const scopedContent =
        scopeDigestContentToRoutingPolicy(digest.content, {
          enabled: channelRow.status === "active",
          sendDigests: channelRow.send_digests ?? 1,
          minSignificance: channelRow.min_significance,
          categoriesJson: channelRow.categories_json,
          competitorIdsJson: channelRow.competitor_ids_json,
          digestPeriodsJson: channelRow.digest_periods_json,
        });

      return scopedContent
        ? {
            channelRow,
            scopedDigest: {
              ...digest,
              content: scopedContent,
            },
          }
        : null;
    })
    .filter(
      (
        entry,
      ): entry is NonNullable<typeof entry> =>
        entry !== null,
    );

  result.channelsFound = eligibleChannels.length;

  if (!env.MORROW_APP_URL) {
    console.log(
      "Morrow external digest notification skipped because MORROW_APP_URL is not configured.",
      {
        digestId,
        channelsFound: eligibleChannels.length,
      },
    );
    return result;
  }

  result.configured = true;

  for (const {
    channelRow,
    scopedDigest,
  } of eligibleChannels) {
    let claim: ExternalDeliveryClaim | null = null;

    try {
      if (!isExternalDeliveryChannel(channelRow.channel)) {
        throw new Error(
          `Unsupported external channel type: ${channelRow.channel}`,
        );
      }

      claim = await claimExternalDelivery(
        env.DB,
        digest.workspaceId,
        channelRow.id,
        channelRow.channel,
        {
          sourceType: "digest",
          digestId: digest.id,
        },
      );

      if (!claim.claimed) {
        if (claim.reason === "already_sent") {
          result.alreadySent += 1;
        } else {
          result.inFlight += 1;
        }
        continue;
      }

      if (!claim.deliveryId || !claim.claimToken) {
        throw new Error(
          "External digest delivery claim is missing its delivery ID or claim token.",
        );
      }

      const destination = parseExternalChannelConfig(
        channelRow.channel,
        channelRow.config_json,
      );
      const event = buildDigestDeliveryEvent(
        scopedDigest,
        env.MORROW_APP_URL,
        {
          deliveryId: claim.deliveryId,
        },
      );

      const providerResult = await deliverExternalEvent(
        destination,
        event,
        fetcher,
      );

      await markExternalDeliverySent(
        env.DB,
        claim.deliveryId,
        claim.claimToken,
        providerResult.providerMessageId,
      );

      result.sent += 1;
    } catch (error) {
      result.failed += 1;

      if (
        claim?.claimed &&
        claim.deliveryId &&
        claim.claimToken
      ) {
        try {
          await markExternalDeliveryFailed(
            env.DB,
            claim.deliveryId,
            claim.claimToken,
            error,
          );
        } catch (markError) {
          console.error(
            "Morrow could not record external digest delivery failure.",
            {
              digestId,
              channelId: channelRow.id,
              deliveryId: claim.deliveryId,
              error: trimError(markError),
            },
          );
        }
      }

      console.error(
        "Morrow external digest delivery failed.",
        {
          digestId,
          channelId: channelRow.id,
          channel: channelRow.channel,
          error: trimError(error),
        },
      );
    }
  }

  return result;
}
