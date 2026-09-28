export const DIGEST_CATEGORIES = [
  "pricing",
  "product",
  "feature",
  "positioning",
  "promotion",
  "policy",
  "navigation",
  "content",
  "other",
] as const;

export const DIGEST_SIGNIFICANCES = [
  "major",
  "moderate",
  "minor",
] as const;

export type DigestCategory =
  (typeof DIGEST_CATEGORIES)[number];

export type DigestSignificance =
  (typeof DIGEST_SIGNIFICANCES)[number];

export interface DigestChangeRow {
  id: string;
  category: string;
  significance: string;
  summary: string | null;
  why_it_matters: string | null;
  detected_at: string;

  monitored_page_id: string;
  monitored_page_url: string;
  monitored_page_label: string | null;

  competitor_id: string;
  competitor_name: string;
  competitor_domain: string;

  workspace_id: string;
}

export interface DigestChange {
  id: string;
  category: DigestCategory;
  significance: DigestSignificance;
  summary: string | null;
  whyItMatters: string | null;
  detectedAt: string;

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
}

export interface DigestCompetitorGroup {
  competitor: {
    id: string;
    name: string;
    domain: string;
  };

  changeCount: number;
  majorChangeCount: number;
  moderateChangeCount: number;
  minorChangeCount: number;

  categories: Partial<
    Record<DigestCategory, number>
  >;

  changes: DigestChange[];
}

export interface DigestIntelligence {
  workspaceId: string;
  windowStart: string;
  windowEnd: string;

  changeCount: number;
  majorChangeCount: number;
  moderateChangeCount: number;
  minorChangeCount: number;

  categoryCounts: Record<DigestCategory, number>;

  competitors: DigestCompetitorGroup[];
  changes: DigestChange[];
}

interface D1ResultLike<T> {
  results?: T[];
}

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T>(): Promise<D1ResultLike<T>>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

const SIGNIFICANCE_WEIGHT: Record<
  DigestSignificance,
  number
> = {
  major: 3,
  moderate: 2,
  minor: 1,
};

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

function normalizeNullableText(
  value: string | null,
): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0
    ? normalized
    : null;
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

function compareChanges(
  left: DigestChange,
  right: DigestChange,
): number {
  const significanceDifference =
    SIGNIFICANCE_WEIGHT[right.significance] -
    SIGNIFICANCE_WEIGHT[left.significance];

  if (significanceDifference !== 0) {
    return significanceDifference;
  }

  const detectedAtDifference =
    Date.parse(right.detectedAt) -
    Date.parse(left.detectedAt);

  if (detectedAtDifference !== 0) {
    return detectedAtDifference;
  }

  return right.id.localeCompare(left.id);
}

function createCategoryCounts(): Record<
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

export function buildDigestIntelligence(
  workspaceId: string,
  windowStart: string,
  windowEnd: string,
  rows: DigestChangeRow[],
): DigestIntelligence {
  assertReportingWindow(windowStart, windowEnd);

  const categoryCounts = createCategoryCounts();
  const changes: DigestChange[] = [];

  let majorChangeCount = 0;
  let moderateChangeCount = 0;
  let minorChangeCount = 0;

  for (const row of rows) {
    if (row.workspace_id !== workspaceId) {
      throw new Error(
        `Digest query returned a change outside workspace ${workspaceId}.`,
      );
    }

    if (!isDigestCategory(row.category)) {
      throw new Error(
        `Unsupported digest category: ${row.category}`,
      );
    }

    if (!isDigestSignificance(row.significance)) {
      throw new Error(
        `Unsupported digest significance: ${row.significance}`,
      );
    }

    categoryCounts[row.category] += 1;

    if (row.significance === "major") {
      majorChangeCount += 1;
    } else if (row.significance === "moderate") {
      moderateChangeCount += 1;
    } else {
      minorChangeCount += 1;
    }

    changes.push({
      id: row.id,
      category: row.category,
      significance: row.significance,
      summary: normalizeNullableText(row.summary),
      whyItMatters: normalizeNullableText(
        row.why_it_matters,
      ),
      detectedAt: row.detected_at,

      monitoredPage: {
        id: row.monitored_page_id,
        url: row.monitored_page_url,
        label: normalizeNullableText(
          row.monitored_page_label,
        ),
      },

      competitor: {
        id: row.competitor_id,
        name: row.competitor_name,
        domain: row.competitor_domain,
      },
    });
  }

  changes.sort(compareChanges);

  const competitorGroups =
    new Map<string, DigestCompetitorGroup>();

  for (const change of changes) {
    let group = competitorGroups.get(
      change.competitor.id,
    );

    if (!group) {
      group = {
        competitor: {
          ...change.competitor,
        },
        changeCount: 0,
        majorChangeCount: 0,
        moderateChangeCount: 0,
        minorChangeCount: 0,
        categories: {},
        changes: [],
      };

      competitorGroups.set(
        change.competitor.id,
        group,
      );
    }

    group.changeCount += 1;

    if (change.significance === "major") {
      group.majorChangeCount += 1;
    } else if (
      change.significance === "moderate"
    ) {
      group.moderateChangeCount += 1;
    } else {
      group.minorChangeCount += 1;
    }

    group.categories[change.category] =
      (group.categories[change.category] ?? 0) + 1;

    group.changes.push(change);
  }

  const competitors = [
    ...competitorGroups.values(),
  ].sort((left, right) => {
    if (
      right.majorChangeCount !==
      left.majorChangeCount
    ) {
      return (
        right.majorChangeCount -
        left.majorChangeCount
      );
    }

    if (
      right.moderateChangeCount !==
      left.moderateChangeCount
    ) {
      return (
        right.moderateChangeCount -
        left.moderateChangeCount
      );
    }

    if (
      right.changeCount !== left.changeCount
    ) {
      return right.changeCount - left.changeCount;
    }

    const nameDifference =
      left.competitor.name.localeCompare(
        right.competitor.name,
      );

    if (nameDifference !== 0) {
      return nameDifference;
    }

    return left.competitor.id.localeCompare(
      right.competitor.id,
    );
  });

  return {
    workspaceId,
    windowStart,
    windowEnd,

    changeCount: changes.length,
    majorChangeCount,
    moderateChangeCount,
    minorChangeCount,

    categoryCounts,

    competitors,
    changes,
  };
}

export async function queryDigestIntelligence(
  db: D1DatabaseLike,
  workspaceId: string,
  windowStart: string,
  windowEnd: string,
): Promise<DigestIntelligence> {
  assertReportingWindow(windowStart, windowEnd);

  const result = await db
    .prepare(
      `
        SELECT
          changes.id,
          changes.category,
          changes.significance,
          changes.summary,
          changes.why_it_matters,
          changes.detected_at,

          monitored_pages.id
            AS monitored_page_id,
          monitored_pages.url
            AS monitored_page_url,
          monitored_pages.label
            AS monitored_page_label,

          competitors.id
            AS competitor_id,
          competitors.name
            AS competitor_name,
          competitors.domain
            AS competitor_domain,
          competitors.workspace_id
            AS workspace_id

        FROM changes

        INNER JOIN monitored_pages
          ON monitored_pages.id =
            changes.monitored_page_id

        INNER JOIN competitors
          ON competitors.id =
            monitored_pages.competitor_id

        WHERE competitors.workspace_id = ?
          AND datetime(changes.detected_at) >=
            datetime(?)
          AND datetime(changes.detected_at) <
            datetime(?)

        ORDER BY
          datetime(changes.detected_at) DESC,
          changes.id DESC
      `,
    )
    .bind(
      workspaceId,
      windowStart,
      windowEnd,
    )
    .all<DigestChangeRow>();

  return buildDigestIntelligence(
    workspaceId,
    windowStart,
    windowEnd,
    result.results ?? [],
  );
}
