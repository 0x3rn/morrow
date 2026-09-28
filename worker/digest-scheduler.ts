import {
  DigestGenerationInProgressError,
  generateDigest,
  type DigestPeriod,
  type GeneratedDigest,
} from "./digest-generator";

export interface DigestReportingWindow {
  period: DigestPeriod;
  windowStart: string;
  windowEnd: string;
}

export interface DigestSchedulerResult {
  scheduledAt: string;
  dueWindows: DigestReportingWindow[];
  workspaceCount: number;
  generatedCount: number;
  reusedCount: number;
  inProgressCount: number;
  failedCount: number;
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

interface WorkspaceRow {
  id: string;
}

type GenerateDigest = (
  db: D1DatabaseLike,
  workspaceId: string,
  period: DigestPeriod,
  windowStart: string,
  windowEnd: string,
) => Promise<GeneratedDigest>;

interface DigestSchedulerLogger {
  info(
    message: string,
    context: Record<string, unknown>,
  ): void;

  error(
    message: string,
    context: Record<string, unknown>,
  ): void;
}

export interface DigestSchedulerDependencies {
  generate?: GenerateDigest;
  logger?: DigestSchedulerLogger;
}

const defaultLogger: DigestSchedulerLogger = {
  info(message, context) {
    console.log(message, context);
  },

  error(message, context) {
    console.error(message, context);
  },
};

function parseScheduledAt(
  scheduledAt: string | number | Date,
): Date {
  const parsed = new Date(scheduledAt);

  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(
      "Digest scheduler timestamp must be valid.",
    );
  }

  return parsed;
}

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
    ),
  );
}

function addUtcDays(
  value: Date,
  days: number,
): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function getDueDigestWindows(
  scheduledAt: string | number | Date,
): DigestReportingWindow[] {
  const scheduled = parseScheduledAt(scheduledAt);

  if (
    scheduled.getUTCHours() !== 0 ||
    scheduled.getUTCMinutes() !== 0 ||
    scheduled.getUTCSeconds() !== 0 ||
    scheduled.getUTCMilliseconds() !== 0
  ) {
    return [];
  }

  const windowEnd = startOfUtcDay(scheduled);
  const dueWindows: DigestReportingWindow[] = [
    {
      period: "daily",
      windowStart: addUtcDays(
        windowEnd,
        -1,
      ).toISOString(),
      windowEnd: windowEnd.toISOString(),
    },
  ];

  if (windowEnd.getUTCDay() === 1) {
    dueWindows.push({
      period: "weekly",
      windowStart: addUtcDays(
        windowEnd,
        -7,
      ).toISOString(),
      windowEnd: windowEnd.toISOString(),
    });
  }

  if (windowEnd.getUTCDate() === 1) {
    dueWindows.push({
      period: "monthly",
      windowStart: new Date(
        Date.UTC(
          windowEnd.getUTCFullYear(),
          windowEnd.getUTCMonth() - 1,
          1,
        ),
      ).toISOString(),
      windowEnd: windowEnd.toISOString(),
    });
  }

  return dueWindows;
}

export async function discoverDigestWorkspaceIds(
  db: D1DatabaseLike,
): Promise<string[]> {
  const result = await db
    .prepare(
      `
        SELECT id
        FROM workspaces
        ORDER BY id ASC
      `,
    )
    .all<WorkspaceRow>();

  const workspaceIds = (
    result.results ?? []
  ).map((row) => row.id);

  if (
    workspaceIds.some(
      (workspaceId) =>
        typeof workspaceId !== "string" ||
        workspaceId.length === 0,
    )
  ) {
    throw new Error(
      "Digest workspace discovery returned an invalid workspace ID.",
    );
  }

  return workspaceIds;
}

export async function runDigestScheduler(
  db: D1DatabaseLike,
  scheduledAt: string | number | Date,
  dependencies: DigestSchedulerDependencies = {},
): Promise<DigestSchedulerResult> {
  const scheduled = parseScheduledAt(scheduledAt);
  const canonicalScheduledAt =
    scheduled.toISOString();
  const dueWindows =
    getDueDigestWindows(scheduled);

  const result: DigestSchedulerResult = {
    scheduledAt: canonicalScheduledAt,
    dueWindows,
    workspaceCount: 0,
    generatedCount: 0,
    reusedCount: 0,
    inProgressCount: 0,
    failedCount: 0,
  };

  if (dueWindows.length === 0) {
    return result;
  }

  const workspaceIds =
    await discoverDigestWorkspaceIds(db);

  result.workspaceCount = workspaceIds.length;

  const generate =
    dependencies.generate ?? generateDigest;
  const logger =
    dependencies.logger ?? defaultLogger;

  for (const workspaceId of workspaceIds) {
    for (const window of dueWindows) {
      const context = {
        workspaceId,
        period: window.period,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
      };

      try {
        const digest = await generate(
          db,
          workspaceId,
          window.period,
          window.windowStart,
          window.windowEnd,
        );

        if (digest.reused) {
          result.reusedCount += 1;
        } else {
          result.generatedCount += 1;
        }

        logger.info(
          "Morrow digest scheduler completed a digest job",
          {
            ...context,
            digestId: digest.id,
            reused: digest.reused,
          },
        );
      } catch (error) {
        if (
          error instanceof
          DigestGenerationInProgressError
        ) {
          result.inProgressCount += 1;

          logger.info(
            "Morrow digest scheduler skipped an in-progress digest job",
            {
              ...context,
              digestId: error.digestId,
            },
          );

          continue;
        }

        result.failedCount += 1;

        logger.error(
          "Morrow digest scheduler failed a digest job",
          {
            ...context,
            error:
              error instanceof Error
                ? error.message
                : String(error),
          },
        );
      }
    }
  }

  return result;
}
