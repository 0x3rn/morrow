export const BILLING_PLAN_IDS = [
  "free",
  "personal",
  "starter",
  "growth",
  "scale",
] as const;

export type BillingPlanId =
  (typeof BILLING_PLAN_IDS)[number];

export const PAID_BILLING_PLAN_IDS = [
  "personal",
  "starter",
  "growth",
  "scale",
] as const;

export type PaidBillingPlanId =
  (typeof PAID_BILLING_PLAN_IDS)[number];

export const DEFAULT_BILLING_PLAN_ID: BillingPlanId =
  "free";

export const BILLING_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
] as const;

export type BillingSubscriptionStatus =
  (typeof BILLING_SUBSCRIPTION_STATUSES)[number];

export const DEFAULT_BILLING_SUBSCRIPTION_STATUS: BillingSubscriptionStatus =
  "active";

export const BILLING_INTERVALS = [
  "monthly",
  "annual",
] as const;

export type BillingInterval =
  (typeof BILLING_INTERVALS)[number];

export const DEFAULT_BILLING_INTERVAL: BillingInterval =
  "monthly";

export const MONITORING_FREQUENCY_OPTIONS = [
  60,
  360,
  720,
  1440,
  10080,
] as const;

export type MonitoringFrequencyMinutes =
  (typeof MONITORING_FREQUENCY_OPTIONS)[number];

export type BillingDigestPeriod =
  | "daily"
  | "weekly"
  | "monthly";

export interface BillingPlanLimits {
  workspacesPerAccount: number;
  competitorsPerWorkspace: number;
  monitoredPagesPerWorkspace: number;
  monitoredPagesPerCompetitor: number;
  minFrequencyMinutes: MonitoringFrequencyMinutes;
  historyRetentionDays: number;
  teamMembersPerWorkspace: number;
  externalChannelsPerWorkspace: number;
}

export interface BillingPlanFeatures {
  hourlyMonitoring: boolean;
  visualComparison: boolean;
  sectionLevelMonitoring: boolean;
  scheduledDigests: boolean;
  allowedDigestPeriods: readonly BillingDigestPeriod[];
  priorityQueue: boolean;
}

export interface BillingPlanDefinition {
  id: BillingPlanId;
  name: string;
  tagline: string;
  tierRank: number;
  monthlyPriceUsd: number;
  annualMonthlyPriceUsd: number;
  limits: BillingPlanLimits;
  features: BillingPlanFeatures;
  highlights: readonly string[];
}

export const BILLING_PLAN_CATALOG: Record<
  BillingPlanId,
  BillingPlanDefinition
> = {
  free: {
    id: "free",
    name: "Free",
    tagline:
      "Baseline competitor monitoring for non-subscribing users exploring Morrow.",
    tierRank: 1,
    monthlyPriceUsd: 0,
    annualMonthlyPriceUsd: 0,
    limits: {
      workspacesPerAccount: 1,
      competitorsPerWorkspace: 1,
      monitoredPagesPerWorkspace: 3,
      monitoredPagesPerCompetitor: 3,
      minFrequencyMinutes: 1440,
      historyRetentionDays: 7,
      teamMembersPerWorkspace: 1,
      externalChannelsPerWorkspace: 0,
    },
    features: {
      hourlyMonitoring: false,
      visualComparison: true,
      sectionLevelMonitoring: false,
      scheduledDigests: false,
      allowedDigestPeriods: [],
      priorityQueue: false,
    },
    highlights: [
      "1 workspace and 1 seat (owner only)",
      "1 competitor and up to 3 monitored pages",
      "Checks every 24 hours with 7-day retention",
      "Visual screenshot diffs and instant email alerts",
    ],
  },
  personal: {
    id: "personal",
    name: "Personal",
    tagline:
      "Focused competitor tracking for solo founders, indie hackers, and small projects.",
    tierRank: 2,
    monthlyPriceUsd: 5,
    annualMonthlyPriceUsd: 4,
    limits: {
      workspacesPerAccount: 1,
      competitorsPerWorkspace: 3,
      monitoredPagesPerWorkspace: 10,
      monitoredPagesPerCompetitor: 4,
      minFrequencyMinutes: 720,
      historyRetentionDays: 14,
      teamMembersPerWorkspace: 3,
      externalChannelsPerWorkspace: 1,
    },
    features: {
      hourlyMonitoring: false,
      visualComparison: true,
      sectionLevelMonitoring: false,
      scheduledDigests: true,
      allowedDigestPeriods: ["weekly"],
      priorityQueue: false,
    },
    highlights: [
      "1 workspace and up to 3 team seats (owner + 2 invited)",
      "Up to 3 competitors and 10 monitored pages (max 4/competitor)",
      "Checks as frequent as every 12 hours with 14-day retention",
      "1 external notification channel and weekly scheduled digests",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter",
    tagline:
      "Essential competitor intelligence for early-stage startups and small product teams.",
    tierRank: 3,
    monthlyPriceUsd: 19,
    annualMonthlyPriceUsd: 15,
    limits: {
      workspacesPerAccount: 5,
      competitorsPerWorkspace: 10,
      monitoredPagesPerWorkspace: 50,
      monitoredPagesPerCompetitor: 10,
      minFrequencyMinutes: 360,
      historyRetentionDays: 30,
      teamMembersPerWorkspace: 5,
      externalChannelsPerWorkspace: 3,
    },
    features: {
      hourlyMonitoring: false,
      visualComparison: true,
      sectionLevelMonitoring: true,
      scheduledDigests: true,
      allowedDigestPeriods: ["daily", "weekly", "monthly"],
      priorityQueue: false,
    },
    highlights: [
      "Up to 5 workspaces and 5 team seats per workspace",
      "Up to 10 competitors and 50 monitored pages (max 10/competitor)",
      "Checks every 6 hours, CSS section selectors, and 30-day retention",
      "Up to 3 external channels plus daily & weekly digests",
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    tagline:
      "High-frequency monitoring and deeper historical retention for scaling GTM and PMM teams.",
    tierRank: 4,
    monthlyPriceUsd: 49,
    annualMonthlyPriceUsd: 39,
    limits: {
      workspacesPerAccount: 25,
      competitorsPerWorkspace: 25,
      monitoredPagesPerWorkspace: 150,
      monitoredPagesPerCompetitor: 25,
      minFrequencyMinutes: 60,
      historyRetentionDays: 90,
      teamMembersPerWorkspace: 15,
      externalChannelsPerWorkspace: 10,
    },
    features: {
      hourlyMonitoring: true,
      visualComparison: true,
      sectionLevelMonitoring: true,
      scheduledDigests: true,
      allowedDigestPeriods: ["daily", "weekly", "monthly"],
      priorityQueue: false,
    },
    highlights: [
      "Up to 25 workspaces and 15 team seats per workspace",
      "Up to 25 competitors and 150 monitored pages (max 25/competitor)",
      "Hourly monitoring unlocked (60-minute interval) and 90-day retention",
      "Up to 10 external notification channels",
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    tagline:
      "Full-market coverage, 1-year intelligence archive, and priority capture capacity for multi-product orgs.",
    tierRank: 5,
    monthlyPriceUsd: 99,
    annualMonthlyPriceUsd: 79,
    limits: {
      workspacesPerAccount: 50,
      competitorsPerWorkspace: 100,
      monitoredPagesPerWorkspace: 500,
      monitoredPagesPerCompetitor: 50,
      minFrequencyMinutes: 60,
      historyRetentionDays: 365,
      teamMembersPerWorkspace: 50,
      externalChannelsPerWorkspace: 25,
    },
    features: {
      hourlyMonitoring: true,
      visualComparison: true,
      sectionLevelMonitoring: true,
      scheduledDigests: true,
      allowedDigestPeriods: ["daily", "weekly", "monthly"],
      priorityQueue: true,
    },
    highlights: [
      "Up to 50 workspaces and 50 team seats per workspace",
      "Up to 100 competitors and 500 monitored pages (max 50/competitor)",
      "Hourly monitoring with priority queue and 365-day retention archive",
      "Up to 25 external notification channels",
    ],
  },
};

export interface WorkspaceEntitlements {
  configuredPlanId: BillingPlanId;
  effectivePlanId: BillingPlanId;
  planName: string;
  tagline: string;
  tierRank: number;
  subscriptionStatus: BillingSubscriptionStatus;
  billingInterval: BillingInterval;
  cancelAtPeriodEnd: boolean;
  monthlyPriceUsd: number;
  effectiveMonthlyPriceUsd: number;
  annualTotalPriceUsd: number;
  limits: BillingPlanLimits;
  features: BillingPlanFeatures;
  allowedFrequencies: MonitoringFrequencyMinutes[];
}

export interface WorkspaceMeteredUsage {
  ownedWorkspaces?: number;
  competitors: number;
  monitoredPages: number;
  maxPagesOnSingleCompetitor: number;
  teamSeats: number;
  externalChannels: number;
  fasterThanTargetMinFrequencyPages?: number;
  pagesWithCssSelectors?: number;
}

export interface PlanTransitionEvaluation {
  direction: "upgrade" | "downgrade" | "same";
  allowed: boolean;
  blockingReasons: string[];
  pagesRequiringFrequencyAdjustment: number;
  pagesRequiringSelectorClear?: number;
}

export function isBillingPlanId(
  value: unknown,
): value is BillingPlanId {
  return (
    typeof value === "string" &&
    (BILLING_PLAN_IDS as readonly string[]).includes(
      value,
    )
  );
}

export function isPaidBillingPlanId(
  value: unknown,
): value is PaidBillingPlanId {
  return (
    typeof value === "string" &&
    (
      PAID_BILLING_PLAN_IDS as readonly string[]
    ).includes(value)
  );
}

export function normalizeBillingPlanId(
  value: unknown,
  fallback: BillingPlanId = DEFAULT_BILLING_PLAN_ID,
): BillingPlanId {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return isBillingPlanId(normalized)
    ? normalized
    : fallback;
}

export function isBillingSubscriptionStatus(
  value: unknown,
): value is BillingSubscriptionStatus {
  return (
    typeof value === "string" &&
    (
      BILLING_SUBSCRIPTION_STATUSES as readonly string[]
    ).includes(value)
  );
}

export function normalizeBillingSubscriptionStatus(
  value: unknown,
  fallback: BillingSubscriptionStatus = DEFAULT_BILLING_SUBSCRIPTION_STATUS,
): BillingSubscriptionStatus {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return isBillingSubscriptionStatus(normalized)
    ? normalized
    : fallback;
}

export function isBillingInterval(
  value: unknown,
): value is BillingInterval {
  return (
    typeof value === "string" &&
    (BILLING_INTERVALS as readonly string[]).includes(
      value,
    )
  );
}

export function normalizeBillingInterval(
  value: unknown,
  fallback: BillingInterval = DEFAULT_BILLING_INTERVAL,
): BillingInterval {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return isBillingInterval(normalized)
    ? normalized
    : fallback;
}

export function getBillingPlanDefinition(
  planId: unknown,
): BillingPlanDefinition {
  const normalized = normalizeBillingPlanId(planId);
  return BILLING_PLAN_CATALOG[normalized];
}

export function getAllowedFrequenciesForMinInterval(
  minFrequencyMinutes: number,
): MonitoringFrequencyMinutes[] {
  return MONITORING_FREQUENCY_OPTIONS.filter(
    (interval) => interval >= minFrequencyMinutes,
  );
}

export function parseBillingTimestampMs(
  value: unknown,
): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized =
    trimmed.endsWith("Z") ||
    /[+-]\d{2}:\d{2}$/.test(trimmed)
      ? trimmed
      : `${trimmed.replace(" ", "T")}Z`;

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

export function resolveWorkspaceEntitlements(input?: {
  planId?: unknown;
  subscriptionStatus?: unknown;
  billingInterval?: unknown;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string | null;
  referenceDate?: Date;
}): WorkspaceEntitlements {
  const configuredPlanId = normalizeBillingPlanId(
    input?.planId,
  );
  const rawSubscriptionStatus =
    normalizeBillingSubscriptionStatus(
      input?.subscriptionStatus,
    );
  const billingInterval = normalizeBillingInterval(
    input?.billingInterval,
  );
  const rawCancelAtPeriodEnd = Boolean(
    input?.cancelAtPeriodEnd,
  );

  const periodEndMs = parseBillingTimestampMs(
    input?.currentPeriodEnd,
  );
  const referenceMs = (
    input?.referenceDate ?? new Date()
  ).getTime();

  // If a subscription was scheduled to cancel at period end (or is trialing/past_due) and the period end has passed,
  // treat it as expired/canceled immediately even if the external webhook is delayed.
  const isPeriodExpired =
    periodEndMs !== null &&
    periodEndMs <= referenceMs &&
    (rawCancelAtPeriodEnd ||
      rawSubscriptionStatus === "trialing" ||
      rawSubscriptionStatus === "past_due");

  const subscriptionStatus: BillingSubscriptionStatus =
    isPeriodExpired
      ? "canceled"
      : rawSubscriptionStatus;
  const cancelAtPeriodEnd = isPeriodExpired
    ? false
    : rawCancelAtPeriodEnd;

  // Canceled subscriptions fall back to Free entitlements while retaining workspace data.
  const effectivePlanId: BillingPlanId =
    subscriptionStatus === "canceled"
      ? "free"
      : configuredPlanId;

  const plan =
    BILLING_PLAN_CATALOG[effectivePlanId];
  const effectiveMonthlyPriceUsd =
    billingInterval === "annual"
      ? plan.annualMonthlyPriceUsd
      : plan.monthlyPriceUsd;

  return {
    configuredPlanId,
    effectivePlanId,
    planName: plan.name,
    tagline: plan.tagline,
    tierRank: plan.tierRank,
    subscriptionStatus,
    billingInterval,
    cancelAtPeriodEnd,
    monthlyPriceUsd: plan.monthlyPriceUsd,
    effectiveMonthlyPriceUsd,
    annualTotalPriceUsd:
      plan.annualMonthlyPriceUsd * 12,
    limits: { ...plan.limits },
    features: {
      ...plan.features,
      allowedDigestPeriods: [
        ...plan.features.allowedDigestPeriods,
      ],
    },
    allowedFrequencies:
      getAllowedFrequenciesForMinInterval(
        plan.limits.minFrequencyMinutes,
      ),
  };
}

export function isFrequencyAllowedForPlan(
  frequencyMinutes: number,
  planOrEntitlements:
    | BillingPlanId
    | WorkspaceEntitlements
    | BillingPlanDefinition,
): boolean {
  if (
    !Number.isSafeInteger(frequencyMinutes) ||
    !(
      MONITORING_FREQUENCY_OPTIONS as readonly number[]
    ).includes(frequencyMinutes)
  ) {
    return false;
  }

  const minFrequencyMinutes =
    typeof planOrEntitlements === "string"
      ? getBillingPlanDefinition(planOrEntitlements)
          .limits.minFrequencyMinutes
      : planOrEntitlements.limits
          .minFrequencyMinutes;

  return frequencyMinutes >= minFrequencyMinutes;
}

export function getDefaultFrequencyForPlan(
  planOrEntitlements:
    | BillingPlanId
    | WorkspaceEntitlements
    | BillingPlanDefinition,
): MonitoringFrequencyMinutes {
  const minFrequencyMinutes =
    typeof planOrEntitlements === "string"
      ? getBillingPlanDefinition(planOrEntitlements)
          .limits.minFrequencyMinutes
      : planOrEntitlements.limits
          .minFrequencyMinutes;

  return (
    MONITORING_FREQUENCY_OPTIONS.find(
      (interval) =>
        interval >= Math.max(360, minFrequencyMinutes),
    ) ?? 1440
  );
}

export function formatFrequencyIntervalLabel(
  frequencyMinutes: number,
): string {
  switch (frequencyMinutes) {
    case 60:
      return "Every hour";
    case 360:
      return "Every 6 hours";
    case 720:
      return "Every 12 hours";
    case 1440:
      return "Every 24 hours";
    case 10080:
      return "Every 7 days";
    default:
      return `Every ${frequencyMinutes} minutes`;
  }
}

export function getRetentionCutoffIso(
  historyRetentionDays: number,
  referenceDate: Date = new Date(),
): string {
  const safeDays = Math.max(
    1,
    Math.trunc(historyRetentionDays),
  );
  const cutoffMs =
    referenceDate.getTime() -
    safeDays * 24 * 60 * 60 * 1000;
  return new Date(cutoffMs).toISOString();
}

export function evaluatePlanTransition(input: {
  currentPlanId: BillingPlanId;
  targetPlanId: BillingPlanId;
  usage: WorkspaceMeteredUsage;
  fasterThanTargetMinFrequencyPages?: number;
  pagesWithCssSelectors?: number;
}): PlanTransitionEvaluation {
  const currentPlan = getBillingPlanDefinition(
    input.currentPlanId,
  );
  const targetPlan = getBillingPlanDefinition(
    input.targetPlanId,
  );

  const direction:
    | "upgrade"
    | "downgrade"
    | "same" =
    targetPlan.tierRank > currentPlan.tierRank
      ? "upgrade"
      : targetPlan.tierRank < currentPlan.tierRank
        ? "downgrade"
        : "same";

  const blockingReasons: string[] = [];
  const { limits } = targetPlan;
  const { usage } = input;

  if (
    typeof usage.ownedWorkspaces === "number" &&
    usage.ownedWorkspaces >
      limits.workspacesPerAccount
  ) {
    blockingReasons.push(
      `Your account currently owns ${usage.ownedWorkspaces} workspaces, which exceeds the ${targetPlan.name} plan limit of ${limits.workspacesPerAccount}.`,
    );
  }

  if (
    usage.competitors >
    limits.competitorsPerWorkspace
  ) {
    blockingReasons.push(
      `This workspace currently tracks ${usage.competitors} competitors, which exceeds the ${targetPlan.name} plan limit of ${limits.competitorsPerWorkspace}.`,
    );
  }

  if (
    usage.monitoredPages >
    limits.monitoredPagesPerWorkspace
  ) {
    blockingReasons.push(
      `This workspace currently monitors ${usage.monitoredPages} pages, which exceeds the ${targetPlan.name} plan limit of ${limits.monitoredPagesPerWorkspace}.`,
    );
  }

  if (
    usage.maxPagesOnSingleCompetitor >
    limits.monitoredPagesPerCompetitor
  ) {
    blockingReasons.push(
      `At least one competitor has ${usage.maxPagesOnSingleCompetitor} monitored pages, which exceeds the ${targetPlan.name} plan limit of ${limits.monitoredPagesPerCompetitor} pages per competitor.`,
    );
  }

  if (
    usage.teamSeats >
    limits.teamMembersPerWorkspace
  ) {
    blockingReasons.push(
      `This workspace currently uses ${usage.teamSeats} team seats (members and pending invitations), which exceeds the ${targetPlan.name} plan limit of ${limits.teamMembersPerWorkspace}.`,
    );
  }

  if (
    usage.externalChannels >
    limits.externalChannelsPerWorkspace
  ) {
    blockingReasons.push(
      `This workspace currently has ${usage.externalChannels} external notification channels, which exceeds the ${targetPlan.name} plan limit of ${limits.externalChannelsPerWorkspace}.`,
    );
  }

  const pagesRequiringFrequencyAdjustment =
    Math.max(
      0,
      input.fasterThanTargetMinFrequencyPages ??
        usage.fasterThanTargetMinFrequencyPages ??
        0,
    );

  const rawPagesWithSelectors = Math.max(
    0,
    input.pagesWithCssSelectors ??
      usage.pagesWithCssSelectors ??
      0,
  );
  const pagesRequiringSelectorClear =
    !targetPlan.features.sectionLevelMonitoring
      ? rawPagesWithSelectors
      : 0;

  return {
    direction,
    allowed: blockingReasons.length === 0,
    blockingReasons,
    pagesRequiringFrequencyAdjustment,
    pagesRequiringSelectorClear,
  };
}

export function getAnnualSavingsPercent(
  plan: Pick<
    BillingPlanDefinition,
    "monthlyPriceUsd" | "annualMonthlyPriceUsd"
  >,
): number {
  if (
    plan.monthlyPriceUsd <= 0 ||
    plan.annualMonthlyPriceUsd >= plan.monthlyPriceUsd
  ) {
    return 0;
  }

  return Math.round(
    ((plan.monthlyPriceUsd - plan.annualMonthlyPriceUsd) /
      plan.monthlyPriceUsd) *
      100,
  );
}

