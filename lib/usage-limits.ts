import {
  BILLING_PLAN_CATALOG,
  type BillingPlanLimits,
} from "./billing-plans.ts";

export const MORROW_MVP_USAGE_LIMITS = {
  competitorsPerWorkspace:
    BILLING_PLAN_CATALOG.starter.limits
      .competitorsPerWorkspace,
  monitoredPagesPerWorkspace:
    BILLING_PLAN_CATALOG.starter.limits
      .monitoredPagesPerWorkspace,
  monitoredPagesPerCompetitor:
    BILLING_PLAN_CATALOG.starter.limits
      .monitoredPagesPerCompetitor,
} as const;

export type MorrowUsageLimits = Pick<
  BillingPlanLimits,
  | "competitorsPerWorkspace"
  | "monitoredPagesPerWorkspace"
  | "monitoredPagesPerCompetitor"
>;