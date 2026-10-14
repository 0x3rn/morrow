export const BILLING_PLAN_IDS = [
  "starter",
  "growth",
  "scale",
] as const;

export type BillingPlanId =
  (typeof BILLING_PLAN_IDS)[number];

export const DEFAULT_BILLING_PLAN_ID: BillingPlanId =
  "starter";

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

export interface BillingPlanLimits {
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
  starter: {
    id: "starter",
    name: "Starter",
    tagline:
      "Essential competitor intelligence for solo founders and lean product teams.",
    tierRank: 1,
    monthlyPriceUsd: 19,
    annualMonthlyPriceUsd: 15,
    limits: {
      competitorsPerWorkspace: 10,
      monitoredPagesPerWorkspace: 50,
      monitoredPagesPerCompetitor: 10,
      minFrequencyMinutes: 360,
      historyRetentionDays: 30,
      teamMembersPerWorkspace: 6,
      externalChannelsPerWorkspace: 3,
    },
    features: {
      hourlyMonitoring: false,
      visualComparison: true,
      sectionLevelMonitoring: true,
      scheduledDigests: true,
      priorityQueue: false,
    },
    highlights: [
      "Up to 10 competitors and 50 monitored pages",
      "Checks as frequent as every 6 hours",
      "30-day change and snapshot retention window",
      "Up to 6 workspace team seats and 3 external channels",
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    tagline:
      "High-frequency monitoring and deeper historical retention for scaling GTM and PMM teams.",
    tierRank: 2,
    monthlyPriceUsd: 49,
    annualMonthlyPriceUsd: 39,
    limits: {
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
      priorityQueue: false,
    },
    highlights: [
      "Up to 25 competitors and 150 monitored pages",
      "Hourly monitoring unlocked (60-minute interval)",
      "90-day change and snapshot retention window",
      "Up to 15 workspace team seats and 10 external channels",
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    tagline:
      "Full-market coverage, 1-year intelligence archive, and priority capture capacity for multi-product orgs.",
    tierRank: 3,
    monthlyPriceUsd: 99,
    annualMonthlyPriceUsd: 79,
    limits: {
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
      priorityQueue: true,
    },
    highlights: [
      "Up to 100 competitors and 500 monitored pages",
      "Hourly monitoring with priority queue scheduling",
      "365-day change and snapshot retention archive",
      "Up to 50 workspace team seats and 25 external channels",
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
  competitors: number;
  monitoredPages: number;
  maxPagesOnSingleCompetitor: number;
  teamSeats: number;
  externalChannels: number;
  fasterThanTargetMinFrequencyPages?: number;
}

export interface PlanTransitionEvaluation {
  direction: "upgrade" | "downgrade" | "same";
  allowed: boolean;
  blockingReasons: string[];
  pagesRequiringFrequencyAdjustment: number;
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

export function resolveWorkspaceEntitlements(input?: {
  planId?: unknown;
  subscriptionStatus?: unknown;
  billingInterval?: unknown;
  cancelAtPeriodEnd?: boolean;
}): WorkspaceEntitlements {
  const configuredPlanId = normalizeBillingPlanId(
    input?.planId,
  );
  const subscriptionStatus =
    normalizeBillingSubscriptionStatus(
      input?.subscriptionStatus,
    );
  const billingInterval = normalizeBillingInterval(
    input?.billingInterval,
  );
  const cancelAtPeriodEnd = Boolean(
    input?.cancelAtPeriodEnd,
  );

  // Canceled subscriptions fall back to Starter entitlements while retaining workspace data.
  const effectivePlanId: BillingPlanId =
    subscriptionStatus === "canceled"
      ? "starter"
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
    features: { ...plan.features },
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
    ) ?? 360
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

  return {
    direction,
    allowed: blockingReasons.length === 0,
    blockingReasons,
    pagesRequiringFrequencyAdjustment,
  };
}
