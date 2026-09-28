import {
  DIGEST_CATEGORIES,
  queryDigestIntelligence,
  type DigestCategory,
  type DigestChange,
  type DigestCompetitorGroup,
  type DigestIntelligence,
} from "./digest-query";

export const DIGEST_PERIODS = [
  "daily",
  "weekly",
  "monthly",
] as const;

export type DigestPeriod =
  (typeof DIGEST_PERIODS)[number];

export interface DigestContentV1 {
  version: 1;

  workspaceId: string;
  period: DigestPeriod;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;

  totals: {
    changes: number;
    major: number;
    moderate: number;
    minor: number;
  };

  categoryCounts: Record<DigestCategory, number>;

  competitors: DigestCompetitorGroup[];

  changes: DigestChange[];
}

export interface GeneratedDigest {
  id: string;
  workspaceId: string;
  period: DigestPeriod;
  windowStart: string;
  windowEnd: string;
  status: "generated";
  generatedAt: string;
  content: DigestContentV1;
  reused: boolean;
}

interface DigestRow {
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
  failure_reason: string | null;
}

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

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

const MAX_FAILURE_REASON_CHARS = 1000;

export class DigestGenerationInProgressError
  extends Error {
  readonly digestId: string;

  constructor(digestId: string) {
    super(
      `Digest generation already in progress for ${digestId}.`,
    );
    this.name = "DigestGenerationInProgressError";
    this.digestId = digestId;
  }
}

type DigestGenerationReservation =
  | {
      kind: "acquired";
      row: DigestRow;
    }
  | {
      kind: "generated";
      digest: GeneratedDigest;
    }
  | {
      kind: "in_progress";
      digestId: string;
    };

function getAffectedRows(
  result: D1RunResultLike,
): number {
  return Number(result.meta?.changes ?? 0);
}

function isDigestPeriod(
  value: string,
): value is DigestPeriod {
  return (DIGEST_PERIODS as readonly string[]).includes(
    value,
  );
}

function assertDigestPeriod(
  period: string,
): asserts period is DigestPeriod {
  if (!isDigestPeriod(period)) {
    throw new Error(
      `Unsupported digest period: ${period}`,
    );
  }
}

function assertReportingWindow(
  windowStart: string,
  windowEnd: string,
): void {
  const start = Date.parse(windowStart);
  const end = Date.parse(windowEnd);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  ) {
    throw new Error(
      "Digest reporting window must have a valid start before its end.",
    );
  }
}

function createDigestId(): string {
  return `digest_${crypto.randomUUID()}`;
}

function normalizeFailureReason(
  error: unknown,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : String(error);

  const normalized =
    raw.replace(/\s+/g, " ").trim() ||
    "Digest generation failed.";

  return normalized.slice(
    0,
    MAX_FAILURE_REASON_CHARS,
  );
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

function isNonNegativeInteger(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function isString(
  value: unknown,
): value is string {
  return typeof value === "string";
}

function isNullableString(
  value: unknown,
): value is string | null {
  return value === null || isString(value);
}

function isDigestCategory(
  value: unknown,
): value is DigestCategory {
  return (
    typeof value === "string" &&
    (
      DIGEST_CATEGORIES as readonly string[]
    ).includes(value)
  );
}

function isDigestChange(
  value: unknown,
): value is DigestChange {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !isString(value.id) ||
    !isDigestCategory(value.category) ||
    !(
      value.significance === "major" ||
      value.significance === "moderate" ||
      value.significance === "minor"
    ) ||
    !isNullableString(value.summary) ||
    !isNullableString(value.whyItMatters) ||
    !isString(value.detectedAt) ||
    !isRecord(value.monitoredPage) ||
    !isString(value.monitoredPage.id) ||
    !isString(value.monitoredPage.url) ||
    !isNullableString(value.monitoredPage.label) ||
    !isRecord(value.competitor) ||
    !isString(value.competitor.id) ||
    !isString(value.competitor.name) ||
    !isString(value.competitor.domain)
  ) {
    return false;
  }

  return true;
}

function isDigestCompetitorGroup(
  value: unknown,
): value is DigestCompetitorGroup {
  if (
    !isRecord(value) ||
    !isRecord(value.competitor) ||
    !isString(value.competitor.id) ||
    !isString(value.competitor.name) ||
    !isString(value.competitor.domain) ||
    !isNonNegativeInteger(value.changeCount) ||
    !isNonNegativeInteger(value.majorChangeCount) ||
    !isNonNegativeInteger(
      value.moderateChangeCount,
    ) ||
    !isNonNegativeInteger(value.minorChangeCount) ||
    !isRecord(value.categories) ||
    !Array.isArray(value.changes) ||
    !value.changes.every(isDigestChange)
  ) {
    return false;
  }

  for (
    const [category, count] of
    Object.entries(value.categories)
  ) {
    if (
      !isDigestCategory(category) ||
      !isNonNegativeInteger(count)
    ) {
      return false;
    }
  }

  return true;
}

function isCategoryCounts(
  value: unknown,
): value is Record<DigestCategory, number> {
  if (!isRecord(value)) {
    return false;
  }

  return DIGEST_CATEGORIES.every(
    (category) =>
      isNonNegativeInteger(value[category]),
  );
}

export function buildDigestContent(
  period: DigestPeriod,
  intelligence: DigestIntelligence,
  generatedAt: string,
): DigestContentV1 {
  assertDigestPeriod(period);

  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error(
      "Digest generatedAt must be a valid timestamp.",
    );
  }

  assertReportingWindow(
    intelligence.windowStart,
    intelligence.windowEnd,
  );

  return {
    version: 1,

    workspaceId:
      intelligence.workspaceId,

    period,

    windowStart:
      intelligence.windowStart,

    windowEnd:
      intelligence.windowEnd,

    generatedAt,

    totals: {
      changes:
        intelligence.changeCount,

      major:
        intelligence.majorChangeCount,

      moderate:
        intelligence.moderateChangeCount,

      minor:
        intelligence.minorChangeCount,
    },

    categoryCounts: {
      ...intelligence.categoryCounts,
    },

    competitors:
      intelligence.competitors,

    changes:
      intelligence.changes,
  };
}

export function parseDigestContent(
  value: string,
): DigestContentV1 {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "Persisted digest content is not valid JSON.",
    );
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    !isString(parsed.workspaceId) ||
    !isDigestPeriod(
      typeof parsed.period === "string"
        ? parsed.period
        : "",
    ) ||
    !isString(parsed.windowStart) ||
    !isString(parsed.windowEnd) ||
    !isString(parsed.generatedAt) ||
    !isRecord(parsed.totals) ||
    !isNonNegativeInteger(
      parsed.totals.changes,
    ) ||
    !isNonNegativeInteger(
      parsed.totals.major,
    ) ||
    !isNonNegativeInteger(
      parsed.totals.moderate,
    ) ||
    !isNonNegativeInteger(
      parsed.totals.minor,
    ) ||
    !isCategoryCounts(
      parsed.categoryCounts,
    ) ||
    !Array.isArray(parsed.competitors) ||
    !parsed.competitors.every(
      isDigestCompetitorGroup,
    ) ||
    !Array.isArray(parsed.changes) ||
    !parsed.changes.every(
      isDigestChange,
    )
  ) {
    throw new Error(
      "Persisted digest content does not match digest content version 1.",
    );
  }

  assertReportingWindow(
    parsed.windowStart,
    parsed.windowEnd,
  );

  if (
    !Number.isFinite(
      Date.parse(parsed.generatedAt),
    )
  ) {
    throw new Error(
      "Persisted digest generatedAt is invalid.",
    );
  }

  return parsed as unknown as DigestContentV1;
}

function assertContentMatchesRow(
  row: DigestRow,
  content: DigestContentV1,
): void {
  if (
    content.workspaceId !== row.workspace_id ||
    content.period !== row.period ||
    content.windowStart !== row.window_start ||
    content.windowEnd !== row.window_end ||
    content.generatedAt !== row.generated_at ||
    content.totals.changes !== row.change_count ||
    content.totals.major !==
      row.major_change_count ||
    content.totals.moderate !==
      row.moderate_change_count ||
    content.totals.minor !==
      row.minor_change_count
  ) {
    throw new Error(
      `Persisted digest ${row.id} content does not match its database metadata.`,
    );
  }
}

async function findDigest(
  db: D1DatabaseLike,
  workspaceId: string,
  period: DigestPeriod,
  windowStart: string,
  windowEnd: string,
): Promise<DigestRow | null> {
  return db
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
          generated_at,
          failure_reason
        FROM digests
        WHERE workspace_id = ?
          AND period = ?
          AND window_start = ?
          AND window_end = ?
        LIMIT 1
      `,
    )
    .bind(
      workspaceId,
      period,
      windowStart,
      windowEnd,
    )
    .first<DigestRow>();
}

function reuseGeneratedDigest(
  row: DigestRow,
): GeneratedDigest {
  if (
    row.status !== "generated" ||
    row.content_json === null ||
    row.generated_at === null
  ) {
    throw new Error(
      `Digest ${row.id} is not a completed generated digest.`,
    );
  }

  if (!isDigestPeriod(row.period)) {
    throw new Error(
      `Persisted digest ${row.id} has unsupported period ${row.period}.`,
    );
  }

  const content =
    parseDigestContent(
      row.content_json,
    );

  assertContentMatchesRow(
    row,
    content,
  );

  return {
    id: row.id,
    workspaceId:
      row.workspace_id,
    period:
      row.period,
    windowStart:
      row.window_start,
    windowEnd:
      row.window_end,
    status: "generated",
    generatedAt:
      row.generated_at,
    content,
    reused: true,
  };
}

function classifyExistingDigest(
  row: DigestRow,
): DigestGenerationReservation {
  if (row.status === "generated") {
    return {
      kind: "generated",
      digest: reuseGeneratedDigest(row),
    };
  }

  if (row.status === "pending") {
    return {
      kind: "in_progress",
      digestId: row.id,
    };
  }

  throw new Error(
    `Digest ${row.id} has unsupported status ${row.status}.`,
  );
}

async function acquireDigestGeneration(
  db: D1DatabaseLike,
  workspaceId: string,
  period: DigestPeriod,
  windowStart: string,
  windowEnd: string,
): Promise<DigestGenerationReservation> {
  const id = createDigestId();

  const insertResult = await db
    .prepare(
      `
        INSERT INTO digests (
          id,
          workspace_id,
          period,
          window_start,
          window_end,
          status
        )
        VALUES (?, ?, ?, ?, ?, 'pending')
        ON CONFLICT (
          workspace_id,
          period,
          window_start,
          window_end
        )
        DO NOTHING
      `,
    )
    .bind(
      id,
      workspaceId,
      period,
      windowStart,
      windowEnd,
    )
    .run();

  if (getAffectedRows(insertResult) === 1) {
    const inserted =
      await findDigest(
        db,
        workspaceId,
        period,
        windowStart,
        windowEnd,
      );

    if (
      !inserted ||
      inserted.id !== id ||
      inserted.status !== "pending"
    ) {
      throw new Error(
        "Digest reservation was inserted but could not be acquired.",
      );
    }

    return {
      kind: "acquired",
      row: inserted,
    };
  }

  const existing =
    await findDigest(
      db,
      workspaceId,
      period,
      windowStart,
      windowEnd,
    );

  if (!existing) {
    throw new Error(
      "Digest reservation conflict did not produce a persisted row.",
    );
  }

  if (existing.status !== "failed") {
    return classifyExistingDigest(existing);
  }

  const retryResult = await db
    .prepare(
      `
        UPDATE digests
        SET
          status = 'pending',
          change_count = 0,
          major_change_count = 0,
          moderate_change_count = 0,
          minor_change_count = 0,
          content_json = NULL,
          generated_at = NULL,
          failure_reason = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'failed'
      `,
    )
    .bind(existing.id)
    .run();

  if (getAffectedRows(retryResult) === 1) {
    const acquired =
      await findDigest(
        db,
        workspaceId,
        period,
        windowStart,
        windowEnd,
      );

    if (
      !acquired ||
      acquired.id !== existing.id ||
      acquired.status !== "pending"
    ) {
      throw new Error(
        `Digest ${existing.id} retry was claimed but could not be acquired.`,
      );
    }

    return {
      kind: "acquired",
      row: acquired,
    };
  }

  const current =
    await findDigest(
      db,
      workspaceId,
      period,
      windowStart,
      windowEnd,
    );

  if (!current) {
    throw new Error(
      `Digest ${existing.id} disappeared while acquiring retry ownership.`,
    );
  }

  return classifyExistingDigest(current);
}

async function persistGeneratedDigest(
  db: D1DatabaseLike,
  digestId: string,
  intelligence: DigestIntelligence,
  content: DigestContentV1,
): Promise<void> {
  await db
    .prepare(
      `
        UPDATE digests
        SET
          status = 'generated',
          change_count = ?,
          major_change_count = ?,
          moderate_change_count = ?,
          minor_change_count = ?,
          content_json = ?,
          generated_at = ?,
          failure_reason = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'pending'
      `,
    )
    .bind(
      intelligence.changeCount,
      intelligence.majorChangeCount,
      intelligence.moderateChangeCount,
      intelligence.minorChangeCount,
      JSON.stringify(content),
      content.generatedAt,
      digestId,
    )
    .run();
}

async function persistFailedDigest(
  db: D1DatabaseLike,
  digestId: string,
  error: unknown,
): Promise<void> {
  await db
    .prepare(
      `
        UPDATE digests
        SET
          status = 'failed',
          change_count = 0,
          major_change_count = 0,
          moderate_change_count = 0,
          minor_change_count = 0,
          content_json = NULL,
          generated_at = NULL,
          failure_reason = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'pending'
      `,
    )
    .bind(
      normalizeFailureReason(error),
      digestId,
    )
    .run();
}

export async function generateDigest(
  db: D1DatabaseLike,
  workspaceId: string,
  period: DigestPeriod,
  windowStart: string,
  windowEnd: string,
  now: () => Date = () => new Date(),
): Promise<GeneratedDigest> {
  assertDigestPeriod(period);
  assertReportingWindow(
    windowStart,
    windowEnd,
  );

  const reservation =
    await acquireDigestGeneration(
      db,
      workspaceId,
      period,
      windowStart,
      windowEnd,
    );

  if (reservation.kind === "generated") {
    return reservation.digest;
  }

  if (reservation.kind === "in_progress") {
    throw new DigestGenerationInProgressError(
      reservation.digestId,
    );
  }

  const row = reservation.row;

  try {
    const intelligence =
      await queryDigestIntelligence(
        db,
        workspaceId,
        windowStart,
        windowEnd,
      );

    const generatedAt =
      now().toISOString();

    const content =
      buildDigestContent(
        period,
        intelligence,
        generatedAt,
      );

    await persistGeneratedDigest(
      db,
      row.id,
      intelligence,
      content,
    );

    const persisted =
      await findDigest(
        db,
        workspaceId,
        period,
        windowStart,
        windowEnd,
      );

    if (
      !persisted ||
      persisted.status !== "generated"
    ) {
      throw new Error(
        `Digest ${row.id} was not persisted as generated.`,
      );
    }

    const result =
      reuseGeneratedDigest(
        persisted,
      );

    return {
      ...result,
      reused: false,
    };
  } catch (error) {
    await persistFailedDigest(
      db,
      row.id,
      error,
    );

    throw error;
  }
}
