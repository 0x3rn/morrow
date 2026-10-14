import type { ChangeNotificationContext } from "./change-email.ts";
import type {
  DigestPeriod,
  GeneratedDigest,
} from "./digest-generator.ts";
import {
  DIGEST_CATEGORIES,
  DIGEST_SIGNIFICANCES,
  type DigestCategory,
  type DigestCompetitorGroup,
  type DigestSignificance,
} from "./digest-query.ts";

export const EXTERNAL_DELIVERY_CHANNELS = [
  "slack",
  "telegram",
  "webhook",
] as const;

export type ExternalDeliveryChannel =
  (typeof EXTERNAL_DELIVERY_CHANNELS)[number];

export interface MorrowChangeDeliveryEvent {
  version: 1;
  type: "change.detected";
  deliveryId: string;
  occurredAt: string;
  workspaceId: string;

  change: {
    id: string;
    category: DigestCategory;
    significance: DigestSignificance;
    summary: string;
    whyItMatters: string | null;
    detectedAt: string;
    changeUrl: string;
    competitorUrl: string;

    monitoredPage: {
      id: string;
      url: string;
      label: string | null;
    };

    competitor: {
      id: string;
      name: string;
      domain: string;
    };
  };
}

export interface MorrowDigestDeliveryEvent {
  version: 1;
  type: "digest.generated";
  deliveryId: string;
  occurredAt: string;
  workspaceId: string;

  digest: {
    id: string;
    period: DigestPeriod;
    windowStart: string;
    windowEnd: string;
    generatedAt: string;
    dashboardUrl: string;
    changesUrl: string;

    totals: {
      changes: number;
      major: number;
      moderate: number;
      minor: number;
    };

    categoryCounts: Record<DigestCategory, number>;
    competitors: DigestCompetitorGroup[];
  };
}

export type MorrowDeliveryEvent =
  | MorrowChangeDeliveryEvent
  | MorrowDigestDeliveryEvent;

export interface BuildDeliveryEventOptions {
  deliveryId?: string;
  occurredAt?: string;
}

export interface SlackTextObject {
  type: "plain_text" | "mrkdwn";
  text: string;
  emoji?: boolean;
}

export type SlackBlock =
  | {
      type: "header";
      text: {
        type: "plain_text";
        text: string;
        emoji?: boolean;
      };
    }
  | {
      type: "section";
      text: SlackTextObject;
    }
  | {
      type: "context";
      elements: SlackTextObject[];
    };

export interface SlackWebhookPayload {
  text: string;
  blocks: SlackBlock[];
}

export interface SlackDeliveryRequest {
  webhookUrl: string;
  event: MorrowDeliveryEvent;
}

export interface SlackDeliveryResult {
  channel: "slack";
  providerMessageId: string | null;
}

export interface TelegramDeliveryRequest {
  botToken: string;
  chatId: string;
  event: MorrowDeliveryEvent;
  apiBaseUrl?: string;
}

export interface TelegramDeliveryResult {
  channel: "telegram";
  providerMessageId: string;
}

export interface WebhookDeliveryRequest {
  url: string;
  secret: string;
  event: MorrowDeliveryEvent;
  timestamp?: string;
}

export interface WebhookDeliveryResult {
  channel: "webhook";
  providerMessageId: string | null;
  signature: string;
  timestamp: string;
}

export type ExternalChannelDestination =
  | {
      channel: "slack";
      webhookUrl: string;
    }
  | {
      channel: "telegram";
      botToken: string;
      chatId: string;
      apiBaseUrl?: string;
    }
  | {
      channel: "webhook";
      url: string;
      secret: string;
      timestamp?: string;
    };

export type ExternalDeliveryResult =
  | SlackDeliveryResult
  | TelegramDeliveryResult
  | WebhookDeliveryResult;

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const MAX_PROVIDER_ERROR_CHARS = 500;
const MAX_SLACK_HEADER_CHARS = 150;
const MAX_SLACK_TEXT_CHARS = 2900;
const MAX_TELEGRAM_TEXT_CHARS = 4000;

function trimProviderDetail(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Unknown provider error";
  }
  return normalized.slice(0, MAX_PROVIDER_ERROR_CHARS);
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
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

function assertValidTimestamp(
  value: string,
  label: string,
): string {
  const trimmed = assertNonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(trimmed))) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return trimmed;
}

function getAppOrigin(appUrl: string): string {
  const trimmed = assertNonEmptyString(
    appUrl,
    "MORROW_APP_URL",
  );
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("MORROW_APP_URL must be a valid URL.");
  }

  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:"
  ) {
    throw new Error(
      "MORROW_APP_URL must use HTTP or HTTPS.",
    );
  }

  return parsed.origin;
}

export function assertHttpsUrl(
  rawUrl: string,
  label: string,
): string {
  const trimmed = assertNonEmptyString(rawUrl, label);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      `${label} must not embed credentials in the URL.`,
    );
  }

  return parsed.toString();
}

function isDigestCategory(
  value: string,
): value is DigestCategory {
  return (DIGEST_CATEGORIES as readonly string[]).includes(
    value,
  );
}

function isDigestSignificance(
  value: string,
): value is DigestSignificance {
  return (
    DIGEST_SIGNIFICANCES as readonly string[]
  ).includes(value);
}

function escapeSlackMrkdwn(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncateText(
  value: string,
  maxChars: number,
): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function isExternalDeliveryChannel(
  value: unknown,
): value is ExternalDeliveryChannel {
  return (
    typeof value === "string" &&
    (
      EXTERNAL_DELIVERY_CHANNELS as readonly string[]
    ).includes(value)
  );
}

export function buildChangeDeliveryEvent(
  context: ChangeNotificationContext,
  appUrl: string,
  options: BuildDeliveryEventOptions = {},
): MorrowChangeDeliveryEvent {
  const origin = getAppOrigin(appUrl);
  const changeId = assertNonEmptyString(
    context.change_id,
    "Change ID",
  );
  const workspaceId = assertNonEmptyString(
    context.workspace_id,
    "Workspace ID",
  );
  const competitorId = assertNonEmptyString(
    context.competitor_id,
    "Competitor ID",
  );
  const competitorName = assertNonEmptyString(
    context.competitor_name,
    "Competitor name",
  );
  const competitorDomain = assertNonEmptyString(
    context.competitor_domain,
    "Competitor domain",
  );
  const monitoredPageId = assertNonEmptyString(
    context.monitored_page_id,
    "Monitored page ID",
  );
  const monitoredPageUrl = assertNonEmptyString(
    context.monitored_page_url,
    "Monitored page URL",
  );

  if (!isDigestCategory(context.category)) {
    throw new Error(
      `Unsupported change category for external delivery: ${context.category}`,
    );
  }

  if (!isDigestSignificance(context.significance)) {
    throw new Error(
      `Unsupported change significance for external delivery: ${context.significance}`,
    );
  }

  const detectedAt = assertValidTimestamp(
    context.detected_at,
    "Change detected_at",
  );
  const deliveryId = options.deliveryId
    ? assertNonEmptyString(options.deliveryId, "Delivery ID")
    : `delivery_${crypto.randomUUID()}`;
  const occurredAt = options.occurredAt
    ? assertValidTimestamp(
        options.occurredAt,
        "Delivery occurredAt",
      )
    : new Date().toISOString();

  const summary =
    context.summary?.trim() ||
    `A meaningful ${context.category} change was detected.`;
  const whyItMatters =
    context.why_it_matters?.trim() || null;
  const monitoredPageLabel =
    context.monitored_page_label?.trim() || null;

  const changeUrl = new URL(
    `/dashboard/changes/${encodeURIComponent(changeId)}`,
    origin,
  ).toString();
  const competitorUrl = new URL(
    `/dashboard/competitors/${encodeURIComponent(competitorId)}`,
    origin,
  ).toString();

  return {
    version: 1,
    type: "change.detected",
    deliveryId,
    occurredAt,
    workspaceId,
    change: {
      id: changeId,
      category: context.category,
      significance: context.significance,
      summary,
      whyItMatters,
      detectedAt,
      changeUrl,
      competitorUrl,
      monitoredPage: {
        id: monitoredPageId,
        url: monitoredPageUrl,
        label: monitoredPageLabel,
      },
      competitor: {
        id: competitorId,
        name: competitorName,
        domain: competitorDomain,
      },
    },
  };
}

export function buildDigestDeliveryEvent(
  digest: GeneratedDigest,
  appUrl: string,
  options: BuildDeliveryEventOptions = {},
): MorrowDigestDeliveryEvent {
  const origin = getAppOrigin(appUrl);
  const digestId = assertNonEmptyString(
    digest.id,
    "Digest ID",
  );
  const workspaceId = assertNonEmptyString(
    digest.workspaceId,
    "Workspace ID",
  );

  if (digest.status !== "generated") {
    throw new Error(
      `Digest ${digestId} must be in generated state before external delivery.`,
    );
  }

  const windowStart = assertValidTimestamp(
    digest.windowStart,
    "Digest windowStart",
  );
  const windowEnd = assertValidTimestamp(
    digest.windowEnd,
    "Digest windowEnd",
  );
  const generatedAt = assertValidTimestamp(
    digest.generatedAt,
    "Digest generatedAt",
  );

  if (Date.parse(windowEnd) <= Date.parse(windowStart)) {
    throw new Error(
      "Digest reporting window must end after it starts.",
    );
  }

  const deliveryId = options.deliveryId
    ? assertNonEmptyString(options.deliveryId, "Delivery ID")
    : `delivery_${crypto.randomUUID()}`;
  const occurredAt = options.occurredAt
    ? assertValidTimestamp(
        options.occurredAt,
        "Delivery occurredAt",
      )
    : new Date().toISOString();

  const dashboardUrl = new URL(
    "/dashboard",
    origin,
  ).toString();
  const changesUrl = new URL(
    "/dashboard/changes",
    origin,
  ).toString();

  return {
    version: 1,
    type: "digest.generated",
    deliveryId,
    occurredAt,
    workspaceId,
    digest: {
      id: digestId,
      period: digest.period,
      windowStart,
      windowEnd,
      generatedAt,
      dashboardUrl,
      changesUrl,
      totals: {
        changes: digest.content.totals.changes,
        major: digest.content.totals.major,
        moderate: digest.content.totals.moderate,
        minor: digest.content.totals.minor,
      },
      categoryCounts: {
        ...digest.content.categoryCounts,
      },
      competitors: digest.content.competitors,
    },
  };
}

export function buildSlackPayload(
  event: MorrowDeliveryEvent,
): SlackWebhookPayload {
  if (event.type === "change.detected") {
    const { change } = event;
    const significanceLabel = capitalize(
      change.significance,
    );
    const categoryLabel = capitalize(change.category);
    const headerText = truncateText(
      `${significanceLabel}: ${change.competitor.name} ${change.category} change`,
      MAX_SLACK_HEADER_CHARS,
    );
    const fallbackText = `${headerText} — ${change.summary}`;

    const sectionLines = [
      `*${escapeSlackMrkdwn(change.competitor.name)}* (${escapeSlackMrkdwn(change.competitor.domain)})`,
      `*Category:* ${escapeSlackMrkdwn(categoryLabel)} • *Significance:* ${escapeSlackMrkdwn(significanceLabel)}`,
      "",
      escapeSlackMrkdwn(change.summary),
    ];

    if (change.whyItMatters) {
      sectionLines.push(
        "",
        `*Why it matters:* ${escapeSlackMrkdwn(change.whyItMatters)}`,
      );
    }

    const blocks: SlackBlock[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: headerText,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncateText(
            sectionLines.join("\n"),
            MAX_SLACK_TEXT_CHARS,
          ),
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: truncateText(
              `Monitored page: ${escapeSlackMrkdwn(change.monitoredPage.url)} | <${change.changeUrl}|View change> • <${change.competitorUrl}|Open competitor>`,
              MAX_SLACK_TEXT_CHARS,
            ),
          },
        ],
      },
    ];

    return {
      text: truncateText(
        fallbackText,
        MAX_SLACK_TEXT_CHARS,
      ),
      blocks,
    };
  }

  const { digest } = event;
  const periodLabel = capitalize(digest.period);
  const headerText = truncateText(
    `Morrow ${periodLabel} Digest (${digest.totals.changes} ${digest.totals.changes === 1 ? "change" : "changes"})`,
    MAX_SLACK_HEADER_CHARS,
  );
  const fallbackText = `${headerText} — ${digest.totals.major} major, ${digest.totals.moderate} moderate, ${digest.totals.minor} minor`;

  const topCompetitors = digest.competitors
    .slice(0, 5)
    .map(
      (group) =>
        `• *${escapeSlackMrkdwn(group.competitor.name)}*: ${group.changeCount} (${group.majorChangeCount} major, ${group.moderateChangeCount} moderate, ${group.minorChangeCount} minor)`,
    );

  const summaryLines = [
    `*Window:* ${escapeSlackMrkdwn(digest.windowStart)} → ${escapeSlackMrkdwn(digest.windowEnd)}`,
    `*Totals:* ${digest.totals.changes} total (${digest.totals.major} major, ${digest.totals.moderate} moderate, ${digest.totals.minor} minor)`,
  ];

  if (topCompetitors.length > 0) {
    summaryLines.push(
      "",
      "*Active competitors:*",
      ...topCompetitors,
    );
  } else {
    summaryLines.push(
      "",
      "No meaningful competitor changes were recorded in this reporting window.",
    );
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: headerText,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncateText(
          summaryLines.join("\n"),
          MAX_SLACK_TEXT_CHARS,
        ),
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: truncateText(
            `<${digest.changesUrl}|View change history> • <${digest.dashboardUrl}|Open dashboard>`,
            MAX_SLACK_TEXT_CHARS,
          ),
        },
      ],
    },
  ];

  return {
    text: truncateText(fallbackText, MAX_SLACK_TEXT_CHARS),
    blocks,
  };
}

export function buildTelegramMessage(
  event: MorrowDeliveryEvent,
): string {
  if (event.type === "change.detected") {
    const { change } = event;
    const significanceLabel = capitalize(
      change.significance,
    );
    const categoryLabel = capitalize(change.category);

    const lines = [
      `Morrow competitor alert (${significanceLabel})`,
      `${change.competitor.name} (${change.competitor.domain})`,
      `Category: ${categoryLabel} • Significance: ${significanceLabel}`,
      "",
      change.summary,
    ];

    if (change.whyItMatters) {
      lines.push(
        "",
        `Why it matters: ${change.whyItMatters}`,
      );
    }

    lines.push(
      "",
      `Monitored page: ${change.monitoredPage.url}`,
      `View change: ${change.changeUrl}`,
      `Open competitor: ${change.competitorUrl}`,
    );

    return truncateText(
      lines.join("\n"),
      MAX_TELEGRAM_TEXT_CHARS,
    );
  }

  const { digest } = event;
  const periodLabel = capitalize(digest.period);
  const lines = [
    `Morrow ${periodLabel} Digest`,
    `Window: ${digest.windowStart} → ${digest.windowEnd}`,
    `Totals: ${digest.totals.changes} changes (${digest.totals.major} major, ${digest.totals.moderate} moderate, ${digest.totals.minor} minor)`,
  ];

  if (digest.competitors.length > 0) {
    lines.push("", "Active competitors:");
    for (const group of digest.competitors.slice(0, 5)) {
      lines.push(
        `- ${group.competitor.name}: ${group.changeCount} (${group.majorChangeCount} major, ${group.moderateChangeCount} moderate, ${group.minorChangeCount} minor)`,
      );
    }
  } else {
    lines.push(
      "",
      "No meaningful competitor changes were recorded in this reporting window.",
    );
  }

  lines.push(
    "",
    `Change history: ${digest.changesUrl}`,
    `Dashboard: ${digest.dashboardUrl}`,
  );

  return truncateText(
    lines.join("\n"),
    MAX_TELEGRAM_TEXT_CHARS,
  );
}

export async function sendSlackNotification(
  request: SlackDeliveryRequest,
  fetcher: FetchLike = fetch,
): Promise<SlackDeliveryResult> {
  const webhookUrl = assertHttpsUrl(
    request.webhookUrl,
    "Slack webhook URL",
  );
  const payload = buildSlackPayload(request.event);

  const response = await fetcher(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawBody = await response.text();

  if (!response.ok) {
    const detail = trimProviderDetail(
      rawBody || response.statusText,
    );
    throw new Error(
      `Slack webhook delivery failed (${response.status}): ${detail}`,
    );
  }

  const headerMessageId =
    response.headers
      .get("x-slack-req-id")
      ?.trim() || null;

  return {
    channel: "slack",
    providerMessageId: headerMessageId,
  };
}

export async function sendTelegramNotification(
  request: TelegramDeliveryRequest,
  fetcher: FetchLike = fetch,
): Promise<TelegramDeliveryResult> {
  const botToken = assertNonEmptyString(
    request.botToken,
    "Telegram bot token",
  );

  if (/[\s/?#\\]/.test(botToken)) {
    throw new Error(
      "Telegram bot token contains invalid URL characters.",
    );
  }

  const chatId = assertNonEmptyString(
    request.chatId,
    "Telegram chat ID",
  );
  const baseUrl = request.apiBaseUrl
    ? assertHttpsUrl(
        request.apiBaseUrl,
        "Telegram API base URL",
      ).replace(/\/+$/, "")
    : "https://api.telegram.org";

  const endpoint = `${baseUrl}/bot${botToken}/sendMessage`;
  const text = buildTelegramMessage(request.event);

  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const rawBody = await response.text();
  let parsed: {
    ok?: boolean;
    description?: string;
    result?: {
      message_id?: number | string;
    };
  } | null = null;

  if (rawBody) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok || parsed?.ok !== true) {
    const detail = trimProviderDetail(
      parsed?.description ||
        rawBody ||
        response.statusText,
    );
    throw new Error(
      `Telegram delivery failed (${response.status}): ${detail}`,
    );
  }

  const rawMessageId = parsed?.result?.message_id;
  if (
    (typeof rawMessageId !== "number" &&
      typeof rawMessageId !== "string") ||
    String(rawMessageId).trim().length === 0
  ) {
    throw new Error(
      "Telegram delivery succeeded but returned no message_id.",
    );
  }

  return {
    channel: "telegram",
    providerMessageId: String(rawMessageId).trim(),
  };
}

export async function signWebhookPayload(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const normalizedSecret = assertNonEmptyString(
    secret,
    "Webhook secret",
  );
  const normalizedTimestamp = assertNonEmptyString(
    timestamp,
    "Webhook timestamp",
  );

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizedSecret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signingInput = encoder.encode(
    `${normalizedTimestamp}.${rawBody}`,
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    signingInput,
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `sha256=${hex}`;
}

export async function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signatureHeader: string,
): Promise<boolean> {
  const expected = await signWebhookPayload(
    secret,
    timestamp,
    rawBody,
  );
  if (signatureHeader.length !== expected.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |=
      expected.charCodeAt(i) ^
      signatureHeader.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function sendWebhookNotification(
  request: WebhookDeliveryRequest,
  fetcher: FetchLike = fetch,
): Promise<WebhookDeliveryResult> {
  const url = assertHttpsUrl(
    request.url,
    "Webhook destination URL",
  );
  const secret = assertNonEmptyString(
    request.secret,
    "Webhook secret",
  );
  const deliveryId = assertNonEmptyString(
    request.event.deliveryId,
    "Webhook deliveryId",
  );
  const timestamp = request.timestamp
    ? assertNonEmptyString(
        request.timestamp,
        "Webhook timestamp",
      )
    : String(Math.floor(Date.now() / 1000));

  const rawBody = JSON.stringify(request.event);
  const signature = await signWebhookPayload(
    secret,
    timestamp,
    rawBody,
  );

  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Morrow-Event": request.event.type,
      "X-Morrow-Delivery": deliveryId,
      "X-Morrow-Timestamp": timestamp,
      "X-Morrow-Signature": signature,
    },
    body: rawBody,
  });

  const responseBody = await response.text();
  if (!response.ok) {
    let errorDetail = responseBody || response.statusText;
    if (responseBody) {
      try {
        const parsed = JSON.parse(responseBody) as {
          error?: unknown;
          message?: unknown;
        };
        if (typeof parsed.message === "string") {
          errorDetail = parsed.message;
        } else if (typeof parsed.error === "string") {
          errorDetail = parsed.error;
        }
      } catch {
        // Keep raw responseBody fallback
      }
    }

    throw new Error(
      `Webhook delivery failed (${response.status}): ${trimProviderDetail(errorDetail)}`,
    );
  }

  let providerMessageId =
    response.headers.get("x-request-id")?.trim() || null;

  if (!providerMessageId && responseBody) {
    try {
      const parsed = JSON.parse(responseBody) as {
        id?: unknown;
      };
      if (
        (typeof parsed.id === "string" ||
          typeof parsed.id === "number") &&
        String(parsed.id).trim().length > 0
      ) {
        providerMessageId = String(parsed.id).trim();
      }
    } catch {
      // Optional JSON response body is not required for 2xx webhook acks
    }
  }

  return {
    channel: "webhook",
    providerMessageId,
    signature,
    timestamp,
  };
}

export async function deliverExternalEvent(
  destination: ExternalChannelDestination,
  event: MorrowDeliveryEvent,
  fetcher: FetchLike = fetch,
): Promise<ExternalDeliveryResult> {
  switch (destination.channel) {
    case "slack":
      return sendSlackNotification(
        {
          webhookUrl: destination.webhookUrl,
          event,
        },
        fetcher,
      );

    case "telegram":
      return sendTelegramNotification(
        {
          botToken: destination.botToken,
          chatId: destination.chatId,
          apiBaseUrl: destination.apiBaseUrl,
          event,
        },
        fetcher,
      );

    case "webhook":
      return sendWebhookNotification(
        {
          url: destination.url,
          secret: destination.secret,
          timestamp: destination.timestamp,
          event,
        },
        fetcher,
      );
  }
}
