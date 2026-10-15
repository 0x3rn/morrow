import {
  DIGEST_CATEGORIES,
  type DigestCategory,
  type DigestChange,
  type DigestCompetitorGroup,
  type DigestSignificance,
} from "./digest-query.ts";
import {
  DIGEST_PERIODS,
  type DigestContentV1,
  type DigestPeriod,
} from "./digest-generator.ts";

export const NOTIFICATION_CHANGE_CATEGORIES = [
  ...DIGEST_CATEGORIES,
  "section_removed",
] as const;

export const NOTIFICATION_SIGNIFICANCE_LEVELS = [
  "minor",
  "moderate",
  "major",
] as const;

export const NOTIFICATION_DIGEST_PERIODS = DIGEST_PERIODS;

export const EXTERNAL_NOTIFICATION_CHANNELS = [
  "slack",
  "telegram",
  "webhook",
] as const;

export type NotificationChangeCategory =
  (typeof NOTIFICATION_CHANGE_CATEGORIES)[number];

export type NotificationSignificanceLevel =
  (typeof NOTIFICATION_SIGNIFICANCE_LEVELS)[number];

export type NotificationDigestPeriod = DigestPeriod;

export type ExternalNotificationChannelType =
  (typeof EXTERNAL_NOTIFICATION_CHANNELS)[number];

const SIGNIFICANCE_RANK: Record<
  NotificationSignificanceLevel,
  number
> = {
  minor: 1,
  moderate: 2,
  major: 3,
};

const CATEGORY_SET = new Set<string>(
  NOTIFICATION_CHANGE_CATEGORIES,
);

const PERIOD_SET = new Set<string>(
  NOTIFICATION_DIGEST_PERIODS,
);

export interface ChangeRoutingCandidate {
  category: string;
  significance: string;
  competitorId: string;
  hasMissingMonitoredSection?: boolean;
}

export function hasMissingMonitoredSectionInDiffJson(
  diffJson: string | null | undefined,
): boolean {
  if (!diffJson || typeof diffJson !== "string") {
    return false;
  }

  try {
    const parsed = JSON.parse(diffJson) as {
      missingIncludeSelectors?: unknown;
    };
    return (
      Array.isArray(parsed?.missingIncludeSelectors) &&
      parsed.missingIncludeSelectors.length > 0
    );
  } catch {
    return false;
  }
}

export interface ChangeRoutingPolicyInput {
  enabled: boolean | number;
  sendChanges?: boolean | number;
  minSignificance?: string | null;
  majorOnly?: boolean | number | null;
  categoriesJson?: string | null;
  competitorIdsJson?: string | null;
}

export interface DigestRoutingPolicyInput {
  enabled: boolean | number;
  sendDigests?: boolean | number;
  minSignificance?: string | null;
  majorOnly?: boolean | number | null;
  categoriesJson?: string | null;
  competitorIdsJson?: string | null;
  digestPeriodsJson?: string | null;
}

export interface MaskedExternalChannelConfig {
  summary: string;
  webhookUrl: string;
  chatId: string;
  messageThreadId: string;
  customHeadersJson: string;
  hasSecret: boolean;
}

function isTruthyFlag(
  value: boolean | number | null | undefined,
  defaultValue = true,
): boolean {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return Number(value) === 1;
}

export function isNotificationChangeCategory(
  value: unknown,
): value is NotificationChangeCategory {
  return (
    typeof value === "string" &&
    CATEGORY_SET.has(value)
  );
}

export function isNotificationSignificanceLevel(
  value: unknown,
): value is NotificationSignificanceLevel {
  return (
    value === "minor" ||
    value === "moderate" ||
    value === "major"
  );
}

export function isNotificationDigestPeriod(
  value: unknown,
): value is NotificationDigestPeriod {
  return (
    typeof value === "string" &&
    PERIOD_SET.has(value)
  );
}

export function normalizeSignificanceLevel(
  minSignificance?: unknown,
  majorOnlyOrFallback?: unknown,
): NotificationSignificanceLevel {
  const isMajorOnly =
    majorOnlyOrFallback === true ||
    Number(majorOnlyOrFallback) === 1;

  if (isMajorOnly) {
    return "major";
  }

  const normalizedMin =
    typeof minSignificance === "string"
      ? minSignificance.trim().toLowerCase()
      : minSignificance;

  if (isNotificationSignificanceLevel(normalizedMin)) {
    return normalizedMin;
  }

  const normalizedFallback =
    typeof majorOnlyOrFallback === "string"
      ? majorOnlyOrFallback.trim().toLowerCase()
      : majorOnlyOrFallback;

  if (isNotificationSignificanceLevel(normalizedFallback)) {
    return normalizedFallback;
  }

  return "minor";
}

export function parseAllowedCategoriesJson(
  raw: string | null | undefined,
): NotificationChangeCategory[] {
  if (!raw || typeof raw !== "string") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const selected = new Set<NotificationChangeCategory>();
  for (const item of parsed) {
    const normalized =
      typeof item === "string"
        ? item.trim().toLowerCase()
        : "";
    if (isNotificationChangeCategory(normalized)) {
      selected.add(normalized);
    }
  }

  // If every category is selected, normalize to [] ("all categories").
  if (
    selected.size ===
    NOTIFICATION_CHANGE_CATEGORIES.length
  ) {
    return [];
  }

  return NOTIFICATION_CHANGE_CATEGORIES.filter((cat) =>
    selected.has(cat),
  );
}

export function parseAllowedCompetitorIdsJson(
  raw: string | null | undefined,
): string[] {
  if (!raw || typeof raw !== "string") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of parsed) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

export function parseAllowedDigestPeriodsJson(
  raw: string | null | undefined,
): NotificationDigestPeriod[] {
  if (!raw || typeof raw !== "string") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const selected = new Set<NotificationDigestPeriod>();
  for (const item of parsed) {
    const normalized =
      typeof item === "string"
        ? item.trim().toLowerCase()
        : "";
    if (isNotificationDigestPeriod(normalized)) {
      selected.add(normalized);
    }
  }

  return NOTIFICATION_DIGEST_PERIODS.filter((period) =>
    selected.has(period),
  );
}

export function serializeAllowedCategories(
  categories: readonly string[],
): string {
  const selected = new Set<NotificationChangeCategory>();

  for (const item of categories) {
    const normalized = item.trim().toLowerCase();
    if (isNotificationChangeCategory(normalized)) {
      selected.add(normalized);
    }
  }

  if (
    selected.size === 0 ||
    selected.size ===
      NOTIFICATION_CHANGE_CATEGORIES.length
  ) {
    return "[]";
  }

  return JSON.stringify(
    NOTIFICATION_CHANGE_CATEGORIES.filter((cat) =>
      selected.has(cat),
    ),
  );
}

export function serializeAllowedCompetitorIds(
  competitorIds: readonly string[],
  validWorkspaceCompetitorIds?: ReadonlySet<string>,
): string {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawId of competitorIds) {
    const id = rawId.trim();
    if (!id || seen.has(id)) {
      continue;
    }

    if (
      validWorkspaceCompetitorIds &&
      !validWorkspaceCompetitorIds.has(id)
    ) {
      continue;
    }

    seen.add(id);
    normalized.push(id);
  }

  if (
    validWorkspaceCompetitorIds &&
    validWorkspaceCompetitorIds.size > 0 &&
    normalized.length ===
      validWorkspaceCompetitorIds.size
  ) {
    return "[]";
  }

  return JSON.stringify(normalized);
}

export function serializeAllowedDigestPeriods(
  periods: readonly string[],
  fallbackPeriods: readonly NotificationDigestPeriod[] = [
    "weekly",
  ],
): string {
  const selected = new Set<NotificationDigestPeriod>();

  for (const item of periods) {
    const normalized = item.trim().toLowerCase();
    if (isNotificationDigestPeriod(normalized)) {
      selected.add(normalized);
    }
  }

  if (selected.size === 0) {
    return JSON.stringify([...fallbackPeriods]);
  }

  return JSON.stringify(
    NOTIFICATION_DIGEST_PERIODS.filter((period) =>
      selected.has(period),
    ),
  );
}

export function matchesSignificanceThreshold(
  changeSignificance: string,
  minSignificance?: unknown,
  majorOnly?: unknown,
): boolean {
  const effectiveMin = normalizeSignificanceLevel(
    minSignificance,
    majorOnly,
  );
  const candidateRank = isNotificationSignificanceLevel(
    changeSignificance,
  )
    ? SIGNIFICANCE_RANK[changeSignificance]
    : SIGNIFICANCE_RANK.minor;

  return (
    candidateRank >= SIGNIFICANCE_RANK[effectiveMin]
  );
}

export function matchesChangeRoutingPolicy(
  change: ChangeRoutingCandidate,
  policy: ChangeRoutingPolicyInput,
): boolean {
  if (!isTruthyFlag(policy.enabled, true)) {
    return false;
  }

  if (!isTruthyFlag(policy.sendChanges, true)) {
    return false;
  }

  if (
    !matchesSignificanceThreshold(
      change.significance,
      policy.minSignificance,
      policy.majorOnly,
    )
  ) {
    return false;
  }

  const allowedCategories = parseAllowedCategoriesJson(
    policy.categoriesJson,
  );
  if (allowedCategories.length > 0) {
    const matchesCategory = allowedCategories.includes(
      change.category as NotificationChangeCategory,
    );
    const matchesSectionRemoved =
      Boolean(change.hasMissingMonitoredSection) &&
      allowedCategories.includes("section_removed");

    if (!matchesCategory && !matchesSectionRemoved) {
      return false;
    }
  }

  const allowedCompetitorIds =
    parseAllowedCompetitorIdsJson(
      policy.competitorIdsJson,
    );
  if (
    allowedCompetitorIds.length > 0 &&
    !allowedCompetitorIds.includes(change.competitorId)
  ) {
    return false;
  }

  return true;
}

function createEmptyCategoryCounts(): Record<
  DigestCategory,
  number
> {
  return {
    pricing: 0,
    product: 0,
    feature: 0,
    positioning: 0,
    promotion: 0,
    policy: 0,
    navigation: 0,
    content: 0,
    other: 0,
  };
}

function buildCompetitorGroupsFromChanges(
  changes: DigestChange[],
): DigestCompetitorGroup[] {
  const byCompetitor = new Map<
    string,
    DigestCompetitorGroup
  >();

  for (const change of changes) {
    let group = byCompetitor.get(change.competitor.id);
    if (!group) {
      group = {
        competitor: {
          id: change.competitor.id,
          name: change.competitor.name,
          domain: change.competitor.domain,
        },
        changeCount: 0,
        majorChangeCount: 0,
        moderateChangeCount: 0,
        minorChangeCount: 0,
        categories: {},
        changes: [],
      };
      byCompetitor.set(change.competitor.id, group);
    }

    group.changeCount += 1;
    if (change.significance === "major") {
      group.majorChangeCount += 1;
    } else if (change.significance === "moderate") {
      group.moderateChangeCount += 1;
    } else {
      group.minorChangeCount += 1;
    }

    group.categories[change.category] =
      (group.categories[change.category] ?? 0) + 1;
    group.changes.push(change);
  }

  return Array.from(byCompetitor.values()).sort(
    (left, right) => {
      if (
        right.majorChangeCount !==
        left.majorChangeCount
      ) {
        return (
          right.majorChangeCount -
          left.majorChangeCount
        );
      }

      if (right.changeCount !== left.changeCount) {
        return right.changeCount - left.changeCount;
      }

      const nameCompare =
        left.competitor.name.localeCompare(
          right.competitor.name,
        );
      if (nameCompare !== 0) {
        return nameCompare;
      }

      return left.competitor.id.localeCompare(
        right.competitor.id,
      );
    },
  );
}

export function scopeDigestContentToRoutingPolicy(
  content: DigestContentV1,
  policy: DigestRoutingPolicyInput,
): DigestContentV1 | null {
  if (!isTruthyFlag(policy.enabled, true)) {
    return null;
  }

  if (!isTruthyFlag(policy.sendDigests, true)) {
    return null;
  }

  if (content.totals.changes <= 0) {
    return null;
  }

  const allowedPeriods = parseAllowedDigestPeriodsJson(
    policy.digestPeriodsJson,
  );
  if (
    allowedPeriods.length > 0 &&
    !allowedPeriods.includes(content.period)
  ) {
    return null;
  }

  const minSignificance = normalizeSignificanceLevel(
    policy.minSignificance,
    policy.majorOnly,
  );
  const allowedCategories = parseAllowedCategoriesJson(
    policy.categoriesJson,
  );
  const allowedCompetitorIds =
    parseAllowedCompetitorIdsJson(
      policy.competitorIdsJson,
    );

  const hasNarrowingFilter =
    minSignificance !== "minor" ||
    allowedCategories.length > 0 ||
    allowedCompetitorIds.length > 0;

  if (!hasNarrowingFilter) {
    return content;
  }

  const sourceChanges: DigestChange[] =
    Array.isArray(content.changes) &&
    content.changes.length > 0
      ? content.changes
      : Array.isArray(content.competitors)
        ? content.competitors.flatMap((group) =>
            Array.isArray(group.changes)
              ? group.changes
              : [],
          )
        : [];

  if (sourceChanges.length === 0) {
    // Fallback for synthetic digest objects without individual change rows
    if (
      minSignificance === "major" &&
      content.totals.major <= 0
    ) {
      return null;
    }

    if (
      minSignificance === "moderate" &&
      content.totals.major + content.totals.moderate <=
        0
    ) {
      return null;
    }

    if (allowedCategories.length > 0) {
      const hasMatchingCategory =
        allowedCategories.some(
          (cat) =>
            cat !== "section_removed" &&
            (content.categoryCounts?.[
              cat as DigestCategory
            ] ?? 0) > 0,
        );
      if (!hasMatchingCategory) {
        return null;
      }
    }

    if (allowedCompetitorIds.length > 0) {
      const hasMatchingCompetitor =
        Array.isArray(content.competitors) &&
        content.competitors.some((group) =>
          allowedCompetitorIds.includes(
            group.competitor.id,
          ),
        );
      if (!hasMatchingCompetitor) {
        return null;
      }
    }

    return content;
  }

  const filteredChanges = sourceChanges.filter((change) =>
    matchesChangeRoutingPolicy(
      {
        category: change.category,
        significance: change.significance,
        competitorId: change.competitor.id,
      },
      {
        enabled: true,
        sendChanges: true,
        minSignificance,
        categoriesJson: policy.categoriesJson,
        competitorIdsJson: policy.competitorIdsJson,
      },
    ),
  );

  if (filteredChanges.length === 0) {
    return null;
  }

  const categoryCounts = createEmptyCategoryCounts();
  let major = 0;
  let moderate = 0;
  let minor = 0;

  for (const change of filteredChanges) {
    const significance: DigestSignificance =
      change.significance;
    if (significance === "major") {
      major += 1;
    } else if (significance === "moderate") {
      moderate += 1;
    } else {
      minor += 1;
    }

    categoryCounts[change.category] =
      (categoryCounts[change.category] ?? 0) + 1;
  }

  return {
    ...content,
    totals: {
      changes: filteredChanges.length,
      major,
      moderate,
      minor,
    },
    categoryCounts,
    competitors: buildCompetitorGroupsFromChanges(
      filteredChanges,
    ),
    changes: filteredChanges,
  };
}

export function matchesDigestRoutingPolicy(
  content: DigestContentV1,
  policy: DigestRoutingPolicyInput,
): boolean {
  return (
    scopeDigestContentToRoutingPolicy(
      content,
      policy,
    ) !== null
  );
}

function maskUrlPath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname
      .split("/")
      .filter(Boolean);
    if (segments.length === 0) {
      return parsed.origin;
    }

    const maskedTail =
      segments.length > 1
        ? `/${segments[0]}/•••`
        : "/•••";
    return `${parsed.origin}${maskedTail}`;
  } catch {
    return "Configured endpoint";
  }
}

export function maskExternalChannelConfigSummary(
  channel: string,
  configJson: string,
): MaskedExternalChannelConfig {
  const empty: MaskedExternalChannelConfig = {
    summary: "Invalid configuration",
    webhookUrl: "",
    chatId: "",
    messageThreadId: "",
    customHeadersJson: "",
    hasSecret: false,
  };

  let parsed: Record<string, unknown>;
  try {
    const raw = JSON.parse(configJson);
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      return empty;
    }
    parsed = raw as Record<string, unknown>;
  } catch {
    return empty;
  }

  if (channel === "slack") {
    const webhookUrl =
      typeof parsed.webhookUrl === "string"
        ? parsed.webhookUrl.trim()
        : "";
    return {
      ...empty,
      summary: webhookUrl
        ? `Slack incoming webhook (${maskUrlPath(webhookUrl)})`
        : "Slack webhook",
      hasSecret: Boolean(webhookUrl),
    };
  }

  if (channel === "telegram") {
    const chatId =
      typeof parsed.chatId === "string" ||
      typeof parsed.chatId === "number"
        ? String(parsed.chatId).trim()
        : "";
    const threadId =
      typeof parsed.messageThreadId === "number" &&
      Number.isInteger(parsed.messageThreadId) &&
      parsed.messageThreadId > 0
        ? String(parsed.messageThreadId)
        : "";
    const hasToken =
      typeof parsed.botToken === "string" &&
      parsed.botToken.trim().length > 0;

    return {
      ...empty,
      summary: chatId
        ? `Telegram chat ${chatId}${threadId ? ` (topic #${threadId})` : ""}`
        : "Telegram bot",
      chatId,
      messageThreadId: threadId,
      hasSecret: hasToken,
    };
  }

  if (channel === "webhook") {
    const rawUrl =
      typeof parsed.url === "string" && parsed.url.trim()
        ? parsed.url
        : typeof parsed.webhookUrl === "string"
          ? parsed.webhookUrl
          : "";
    const webhookUrl = rawUrl.trim();
    const rawSecret =
      typeof parsed.secret === "string" &&
      parsed.secret.trim()
        ? parsed.secret
        : typeof parsed.signingSecret === "string"
          ? parsed.signingSecret
          : "";
    const hasSecret = rawSecret.trim().length > 0;
    const headersObj =
      parsed.headers &&
      typeof parsed.headers === "object" &&
      !Array.isArray(parsed.headers)
        ? parsed.headers
        : null;
    const customHeadersJson =
      headersObj && Object.keys(headersObj).length > 0
        ? JSON.stringify(headersObj)
        : "";

    return {
      ...empty,
      summary: webhookUrl
        ? `Signed webhook (${webhookUrl})`
        : "Signed webhook",
      webhookUrl,
      customHeadersJson,
      hasSecret,
    };
  }

  return empty;
}
