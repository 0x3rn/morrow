import { randomUUID } from "node:crypto";

import {
  BILLING_PLAN_CATALOG,
  BILLING_PLAN_IDS,
  DEFAULT_BILLING_INTERVAL,
  DEFAULT_BILLING_PLAN_ID,
  DEFAULT_BILLING_SUBSCRIPTION_STATUS,
  evaluatePlanTransition,
  formatFrequencyIntervalLabel,
  getBillingPlanDefinition,
  getRetentionCutoffIso,
  isBillingInterval,
  isBillingPlanId,
  isFrequencyAllowedForPlan,
  normalizeBillingInterval,
  normalizeBillingPlanId,
  normalizeBillingSubscriptionStatus,
  parseBillingTimestampMs,
  resolveWorkspaceEntitlements,
  type BillingInterval,
  type BillingPlanDefinition,
  type BillingPlanId,
  type BillingSubscriptionStatus,
  type PlanTransitionEvaluation,
  type WorkspaceEntitlements,
  type WorkspaceMeteredUsage,
} from "./billing-plans.ts";
import type { D1DatabaseLike } from "../worker/external-notifications.ts";
import {
  getWorkspaceMembershipById,
  requireActiveWorkspaceMembership,
  type ActiveWorkspaceMembership,
} from "./team-workspaces.ts";
import { canManageWorkspaceBilling } from "./workspace-roles.ts";

type D1PreparedStatementLike = ReturnType<
  D1DatabaseLike["prepare"]
>;

interface WorkspaceSubscriptionRow {
  workspace_id: string;
  plan_id: string;
  status: string;
  billing_interval: string;
  cancel_at_period_end: number;
  current_period_start: string;
  current_period_end: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  provider_variant_id?: string | null;
  provider_order_id?: string | null;
  provider_status?: string | null;
  provider_customer_portal_url?: string | null;
  provider_update_payment_url?: string | null;
  provider_updated_at?: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface UsageMetricsRow {
  owned_workspaces_count: number;
  competitors_count: number;
  monitored_pages_count: number;
  max_pages_per_competitor: number;
  active_members_count: number;
  pending_invitations_count: number;
  external_channels_count: number;
  pages_with_selectors_count: number;
  outside_retention_changes_count: number;
  outside_retention_snapshots_count: number;
}

interface BillingEventRow {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  event_type: string;
  previous_plan_id: string | null;
  new_plan_id: string;
  billing_interval: string;
  details_json: string;
  created_at: string;
}

export type WorkspaceBillingEventType =
  | "subscription_initialized"
  | "checkout_initiated"
  | "plan_upgraded"
  | "plan_downgraded"
  | "billing_interval_changed"
  | "cancellation_scheduled"
  | "subscription_reactivated"
  | "subscription_canceled"
  | "payment_succeeded"
  | "payment_failed";

export interface WorkspaceSubscriptionView {
  workspaceId: string;
  planId: BillingPlanId;
  status: BillingSubscriptionStatus;
  billingInterval: BillingInterval;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  providerVariantId: string | null;
  providerOrderId: string | null;
  providerStatus: string | null;
  providerCustomerPortalUrl: string | null;
  providerUpdatePaymentUrl: string | null;
  providerUpdatedAt: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDetailedUsage
  extends WorkspaceMeteredUsage {
  ownedWorkspaces: number;
  activeMembers: number;
  pendingInvitations: number;
  pagesWithCssSelectors: number;
  retentionCutoffIso: string;
  outsideRetentionChanges: number;
  outsideRetentionSnapshots: number;
}

export interface WorkspacePlanOptionView {
  plan: BillingPlanDefinition;
  isCurrentPlan: boolean;
  transition: PlanTransitionEvaluation;
}

export interface WorkspaceBillingEventView {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  actorLabel: string;
  eventType: WorkspaceBillingEventType;
  previousPlanId: BillingPlanId | null;
  newPlanId: BillingPlanId;
  billingInterval: BillingInterval;
  adjustedPageFrequencies: number;
  adjustedSelectorPages: number;
  createdAt: string;
}

export interface WorkspaceBillingSnapshot {
  activeWorkspace: ActiveWorkspaceMembership;
  subscription: WorkspaceSubscriptionView;
  entitlements: WorkspaceEntitlements;
  usage: WorkspaceDetailedUsage;
  planOptions: WorkspacePlanOptionView[];
  recentEvents: WorkspaceBillingEventView[];
}

async function executeBatch(
  db: D1DatabaseLike,
  statements: D1PreparedStatementLike[],
): Promise<void> {
  if (statements.length === 0) {
    return;
  }

  if (typeof db.batch === "function") {
    await db.batch(statements);
    return;
  }

  for (const statement of statements) {
    await statement.run();
  }
}

function isMissingTableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /no such table|no such column/i.test(error.message)
  );
}

function isMissingColumnOnlyError(
  error: unknown,
): boolean {
  return (
    error instanceof Error &&
    /no such column/i.test(error.message)
  );
}

function createDefaultSubscriptionView(
  workspaceId: string,
  planId: BillingPlanId = DEFAULT_BILLING_PLAN_ID,
): WorkspaceSubscriptionView {
  const now = new Date();
  const periodEnd = new Date(
    now.getTime() + 30 * 24 * 60 * 60 * 1000,
  );
  return {
    workspaceId,
    planId,
    status: DEFAULT_BILLING_SUBSCRIPTION_STATUS,
    billingInterval: DEFAULT_BILLING_INTERVAL,
    cancelAtPeriodEnd: false,
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    providerCustomerId: null,
    providerSubscriptionId: null,
    providerVariantId: null,
    providerOrderId: null,
    providerStatus: null,
    providerCustomerPortalUrl: null,
    providerUpdatePaymentUrl: null,
    providerUpdatedAt: null,
    updatedBy: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function toWorkspaceSubscriptionView(
  row: WorkspaceSubscriptionRow,
): WorkspaceSubscriptionView {
  return {
    workspaceId: row.workspace_id,
    planId: normalizeBillingPlanId(row.plan_id),
    status: normalizeBillingSubscriptionStatus(
      row.status,
    ),
    billingInterval: normalizeBillingInterval(
      row.billing_interval,
    ),
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    providerCustomerId: row.provider_customer_id ?? null,
    providerSubscriptionId:
      row.provider_subscription_id ?? null,
    providerVariantId: row.provider_variant_id ?? null,
    providerOrderId: row.provider_order_id ?? null,
    providerStatus: row.provider_status ?? null,
    providerCustomerPortalUrl:
      row.provider_customer_portal_url ?? null,
    providerUpdatePaymentUrl:
      row.provider_update_payment_url ?? null,
    providerUpdatedAt: row.provider_updated_at ?? null,
    updatedBy: row.updated_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getWorkspaceSubscription(
  db: D1DatabaseLike,
  workspaceId: string,
): Promise<WorkspaceSubscriptionView> {
  try {
    const row = await db
      .prepare(
        `
          SELECT
            workspace_id,
            plan_id,
            status,
            billing_interval,
            cancel_at_period_end,
            current_period_start,
            current_period_end,
            provider_customer_id,
            provider_subscription_id,
            provider_variant_id,
            provider_order_id,
            provider_status,
            provider_customer_portal_url,
            provider_update_payment_url,
            provider_updated_at,
            updated_by,
            created_at,
            updated_at
          FROM workspace_subscriptions
          WHERE workspace_id = ?
          LIMIT 1
        `,
      )
      .bind(workspaceId)
      .first<WorkspaceSubscriptionRow>();

    if (row) {
      return toWorkspaceSubscriptionView(row);
    }

    return createDefaultSubscriptionView(
      workspaceId,
      DEFAULT_BILLING_PLAN_ID,
    );
  } catch (error) {
    if (isMissingColumnOnlyError(error)) {
      const legacyRow = await db
        .prepare(
          `
            SELECT
              workspace_id,
              plan_id,
              status,
              billing_interval,
              cancel_at_period_end,
              current_period_start,
              current_period_end,
              provider_customer_id,
              provider_subscription_id,
              updated_by,
              created_at,
              updated_at
            FROM workspace_subscriptions
            WHERE workspace_id = ?
            LIMIT 1
          `,
        )
        .bind(workspaceId)
        .first<WorkspaceSubscriptionRow>();

      if (legacyRow) {
        return toWorkspaceSubscriptionView(legacyRow);
      }

      return createDefaultSubscriptionView(
        workspaceId,
        DEFAULT_BILLING_PLAN_ID,
      );
    }

    if (!isMissingTableError(error)) {
      throw error;
    }

    // Only when the workspace_subscriptions table itself does not exist (pre-0013 test schemas)
    // do we fall back to Starter so legacy pre-billing migration tests can run unblocked.
    return createDefaultSubscriptionView(
      workspaceId,
      "starter",
    );
  }
}

export async function ensureWorkspaceSubscription(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    actorUserId?: string | null;
    planId?: BillingPlanId;
    billingInterval?: BillingInterval;
  },
): Promise<WorkspaceSubscriptionView> {
  const planId = normalizeBillingPlanId(input.planId);
  const billingInterval = normalizeBillingInterval(
    input.billingInterval,
  );
  const periodWindowModifier =
    billingInterval === "annual"
      ? "+365 days"
      : "+30 days";

  try {
    await db
      .prepare(
        `
          INSERT OR IGNORE INTO workspace_subscriptions (
            workspace_id,
            plan_id,
            status,
            billing_interval,
            cancel_at_period_end,
            current_period_start,
            current_period_end,
            updated_by,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            'active',
            ?,
            0,
            CURRENT_TIMESTAMP,
            datetime('now', ?),
            ?,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `,
      )
      .bind(
        input.workspaceId,
        planId,
        billingInterval,
        periodWindowModifier,
        input.actorUserId ?? null,
      )
      .run();
  } catch (error) {
    if (!isMissingTableError(error)) {
      throw error;
    }
  }

  return getWorkspaceSubscription(db, input.workspaceId);
}

export async function getWorkspaceEntitlements(
  db: D1DatabaseLike,
  workspaceId: string,
): Promise<WorkspaceEntitlements> {
  const subscription = await getWorkspaceSubscription(
    db,
    workspaceId,
  );

  return resolveWorkspaceEntitlements({
    planId: subscription.planId,
    subscriptionStatus: subscription.status,
    billingInterval: subscription.billingInterval,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd,
  });
}

export async function getWorkspaceRetentionWindow(
  db: D1DatabaseLike,
  workspaceId: string,
  referenceDate: Date = new Date(),
): Promise<{
  entitlements: WorkspaceEntitlements;
  retentionDays: number;
  cutoffIso: string;
}> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    workspaceId,
  );
  const retentionDays =
    entitlements.limits.historyRetentionDays;
  const cutoffIso = getRetentionCutoffIso(
    retentionDays,
    referenceDate,
  );

  return {
    entitlements,
    retentionDays,
    cutoffIso,
  };
}

export async function getWorkspaceMeteredUsage(
  db: D1DatabaseLike,
  workspaceId: string,
  options?: {
    retentionDays?: number;
    referenceDate?: Date;
  },
): Promise<WorkspaceDetailedUsage> {
  const retentionDays =
    options?.retentionDays ??
    BILLING_PLAN_CATALOG[DEFAULT_BILLING_PLAN_ID].limits
      .historyRetentionDays;
  const retentionCutoffIso = getRetentionCutoffIso(
    retentionDays,
    options?.referenceDate,
  );

  let pendingInvitationsAvailable = true;
  let row: UsageMetricsRow | null = null;

  try {
    row = await db
      .prepare(
        `
          SELECT
            (
              SELECT COALESCE(MAX(owner_ws_count), 1)
              FROM (
                SELECT COUNT(DISTINCT wm_all.workspace_id) AS owner_ws_count
                FROM workspace_members AS wm_owners
                INNER JOIN workspace_members AS wm_all
                  ON wm_all.user_id = wm_owners.user_id
                 AND wm_all.role = 'owner'
                WHERE wm_owners.workspace_id = ?
                  AND wm_owners.role = 'owner'
                GROUP BY wm_owners.user_id
              )
            ) AS owned_workspaces_count,

            (
              SELECT COUNT(*)
              FROM competitors
              WHERE competitors.workspace_id = ?
            ) AS competitors_count,

            (
              SELECT COUNT(*)
              FROM monitored_pages
              INNER JOIN competitors
                ON competitors.id = monitored_pages.competitor_id
              WHERE competitors.workspace_id = ?
            ) AS monitored_pages_count,

            (
              SELECT COALESCE(MAX(page_count), 0)
              FROM (
                SELECT COUNT(*) AS page_count
                FROM monitored_pages
                INNER JOIN competitors
                  ON competitors.id = monitored_pages.competitor_id
                WHERE competitors.workspace_id = ?
                GROUP BY competitors.id
              )
            ) AS max_pages_per_competitor,

            (
              SELECT COUNT(*)
              FROM workspace_members
              WHERE workspace_members.workspace_id = ?
            ) AS active_members_count,

            (
              SELECT COUNT(*)
              FROM workspace_invitations
              WHERE workspace_invitations.workspace_id = ?
                AND workspace_invitations.status = 'pending'
            ) AS pending_invitations_count,

            (
              SELECT COUNT(*)
              FROM external_notification_channels
              WHERE external_notification_channels.workspace_id = ?
            ) AS external_channels_count,

            (
              SELECT COUNT(*)
              FROM monitored_pages
              INNER JOIN competitors
                ON competitors.id = monitored_pages.competitor_id
              WHERE competitors.workspace_id = ?
                AND (
                  (
                    monitored_pages.include_selectors_json IS NOT NULL
                    AND TRIM(monitored_pages.include_selectors_json) != ''
                    AND TRIM(monitored_pages.include_selectors_json) != '[]'
                  )
                  OR (
                    monitored_pages.ignore_selectors_json IS NOT NULL
                    AND TRIM(monitored_pages.ignore_selectors_json) != ''
                    AND TRIM(monitored_pages.ignore_selectors_json) != '[]'
                  )
                )
            ) AS pages_with_selectors_count,

            (
              SELECT COUNT(*)
              FROM changes
              INNER JOIN monitored_pages
                ON monitored_pages.id = changes.monitored_page_id
              INNER JOIN competitors
                ON competitors.id = monitored_pages.competitor_id
              WHERE competitors.workspace_id = ?
                AND datetime(changes.detected_at) < datetime(?)
            ) AS outside_retention_changes_count,

            (
              SELECT COUNT(*)
              FROM snapshots
              INNER JOIN monitored_pages
                ON monitored_pages.id = snapshots.monitored_page_id
              INNER JOIN competitors
                ON competitors.id = monitored_pages.competitor_id
              WHERE competitors.workspace_id = ?
                AND datetime(snapshots.captured_at) < datetime(?)
            ) AS outside_retention_snapshots_count
        `,
      )
      .bind(
        workspaceId,
        workspaceId,
        workspaceId,
        workspaceId,
        workspaceId,
        workspaceId,
        workspaceId,
        workspaceId,
        workspaceId,
        retentionCutoffIso,
        workspaceId,
        retentionCutoffIso,
      )
      .first<UsageMetricsRow>();
  } catch (error) {
    if (!isMissingTableError(error)) {
      throw error;
    }
    pendingInvitationsAvailable = false;
  }

  if (!pendingInvitationsAvailable) {
    const fallbackRow = await db
      .prepare(
        `
          SELECT
            (
              SELECT COUNT(*)
              FROM competitors
              WHERE competitors.workspace_id = ?
            ) AS competitors_count,

            (
              SELECT COUNT(*)
              FROM monitored_pages
              INNER JOIN competitors
                ON competitors.id = monitored_pages.competitor_id
              WHERE competitors.workspace_id = ?
            ) AS monitored_pages_count,

            (
              SELECT COALESCE(MAX(page_count), 0)
              FROM (
                SELECT COUNT(*) AS page_count
                FROM monitored_pages
                INNER JOIN competitors
                  ON competitors.id = monitored_pages.competitor_id
                WHERE competitors.workspace_id = ?
                GROUP BY competitors.id
              )
            ) AS max_pages_per_competitor,

            (
              SELECT COUNT(*)
              FROM workspace_members
              WHERE workspace_members.workspace_id = ?
            ) AS active_members_count
        `,
      )
      .bind(
        workspaceId,
        workspaceId,
        workspaceId,
        workspaceId,
      )
      .first<{
        competitors_count: number;
        monitored_pages_count: number;
        max_pages_per_competitor: number;
        active_members_count: number;
      }>();

    const activeMembers = Number(
      fallbackRow?.active_members_count ?? 0,
    );

    return {
      ownedWorkspaces: 1,
      competitors: Number(
        fallbackRow?.competitors_count ?? 0,
      ),
      monitoredPages: Number(
        fallbackRow?.monitored_pages_count ?? 0,
      ),
      maxPagesOnSingleCompetitor: Number(
        fallbackRow?.max_pages_per_competitor ?? 0,
      ),
      activeMembers,
      pendingInvitations: 0,
      teamSeats: activeMembers,
      externalChannels: 0,
      pagesWithCssSelectors: 0,
      retentionCutoffIso,
      outsideRetentionChanges: 0,
      outsideRetentionSnapshots: 0,
    };
  }

  const activeMembers = Number(
    row?.active_members_count ?? 0,
  );
  const pendingInvitations = Number(
    row?.pending_invitations_count ?? 0,
  );

  return {
    ownedWorkspaces: Math.max(
      1,
      Number(row?.owned_workspaces_count ?? 1),
    ),
    competitors: Number(row?.competitors_count ?? 0),
    monitoredPages: Number(
      row?.monitored_pages_count ?? 0,
    ),
    maxPagesOnSingleCompetitor: Number(
      row?.max_pages_per_competitor ?? 0,
    ),
    activeMembers,
    pendingInvitations,
    teamSeats: activeMembers + pendingInvitations,
    externalChannels: Number(
      row?.external_channels_count ?? 0,
    ),
    pagesWithCssSelectors: Number(
      row?.pages_with_selectors_count ?? 0,
    ),
    retentionCutoffIso,
    outsideRetentionChanges: Number(
      row?.outside_retention_changes_count ?? 0,
    ),
    outsideRetentionSnapshots: Number(
      row?.outside_retention_snapshots_count ?? 0,
    ),
  };
}

async function countPagesFasterThanInterval(
  db: D1DatabaseLike,
  workspaceId: string,
  minFrequencyMinutes: number,
): Promise<number> {
  const row = await db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM monitored_pages
        INNER JOIN competitors
          ON competitors.id = monitored_pages.competitor_id
        WHERE competitors.workspace_id = ?
          AND monitored_pages.frequency_minutes < ?
      `,
    )
    .bind(workspaceId, minFrequencyMinutes)
    .first<{ count: number }>();

  return Number(row?.count ?? 0);
}

function parseEventAdjustments(detailsJson: string): {
  adjustedPageFrequencies: number;
  adjustedSelectorPages: number;
} {
  try {
    const parsed = JSON.parse(detailsJson);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      return {
        adjustedPageFrequencies:
          typeof record.adjustedPageFrequencies === "number"
            ? Number(record.adjustedPageFrequencies)
            : 0,
        adjustedSelectorPages:
          typeof record.adjustedSelectorPages === "number"
            ? Number(record.adjustedSelectorPages)
            : 0,
      };
    }
  } catch {
    // Ignore malformed JSON in historical rows
  }
  return {
    adjustedPageFrequencies: 0,
    adjustedSelectorPages: 0,
  };
}

export async function getWorkspaceBillingSnapshot(
  db: D1DatabaseLike,
  userId: string,
): Promise<WorkspaceBillingSnapshot> {
  const activeWorkspace =
    await requireActiveWorkspaceMembership(db, userId);

  const subscription = await ensureWorkspaceSubscription(
    db,
    {
      workspaceId: activeWorkspace.id,
      actorUserId: userId,
    },
  );

  const entitlements = resolveWorkspaceEntitlements({
    planId: subscription.planId,
    subscriptionStatus: subscription.status,
    billingInterval: subscription.billingInterval,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd,
  });

  const usage = await getWorkspaceMeteredUsage(
    db,
    activeWorkspace.id,
    {
      retentionDays:
        entitlements.limits.historyRetentionDays,
    },
  );

  const fasterCountsByPlan = await Promise.all(
    BILLING_PLAN_IDS.map(async (planId) => {
      const plan = getBillingPlanDefinition(planId);
      const count =
        plan.limits.minFrequencyMinutes > 60
          ? await countPagesFasterThanInterval(
              db,
              activeWorkspace.id,
              plan.limits.minFrequencyMinutes,
            )
          : 0;
      return [planId, count] as const;
    }),
  );
  const fasterCountMap = new Map<BillingPlanId, number>(
    fasterCountsByPlan,
  );

  const planOptions: WorkspacePlanOptionView[] =
    BILLING_PLAN_IDS.map((planId) => {
      const plan = getBillingPlanDefinition(planId);
      const fasterPages =
        fasterCountMap.get(planId) ?? 0;

      const transition = evaluatePlanTransition({
        currentPlanId: entitlements.effectivePlanId,
        targetPlanId: planId,
        usage,
        fasterThanTargetMinFrequencyPages: fasterPages,
        pagesWithCssSelectors:
          usage.pagesWithCssSelectors,
      });

      return {
        plan,
        isCurrentPlan:
          entitlements.effectivePlanId === planId &&
          (planId === "free" ||
            entitlements.subscriptionStatus !== "canceled"),
        transition,
      };
    });

  let recentEvents: WorkspaceBillingEventView[] = [];
  try {
    const eventsResult = await db
      .prepare(
        `
          SELECT
            workspace_billing_events.id,
            workspace_billing_events.workspace_id,
            workspace_billing_events.actor_user_id,
            users.name AS actor_name,
            users.email AS actor_email,
            workspace_billing_events.event_type,
            workspace_billing_events.previous_plan_id,
            workspace_billing_events.new_plan_id,
            workspace_billing_events.billing_interval,
            workspace_billing_events.details_json,
            workspace_billing_events.created_at
          FROM workspace_billing_events
          LEFT JOIN users
            ON users.id = workspace_billing_events.actor_user_id
          WHERE workspace_billing_events.workspace_id = ?
          ORDER BY
            datetime(workspace_billing_events.created_at) DESC,
            workspace_billing_events.rowid DESC
          LIMIT 15
        `,
      )
      .bind(activeWorkspace.id)
      .all<BillingEventRow>();

    recentEvents = (eventsResult.results ?? []).map(
      (row) => {
        const adjustments = parseEventAdjustments(
          row.details_json,
        );
        return {
          id: row.id,
          workspaceId: row.workspace_id,
          actorUserId: row.actor_user_id ?? null,
          actorLabel:
            row.actor_name?.trim() ||
            row.actor_email?.trim() ||
            "Workspace Owner",
          eventType:
            row.event_type as WorkspaceBillingEventType,
          previousPlanId: row.previous_plan_id
            ? normalizeBillingPlanId(row.previous_plan_id)
            : null,
          newPlanId: normalizeBillingPlanId(
            row.new_plan_id,
          ),
          billingInterval: normalizeBillingInterval(
            row.billing_interval,
          ),
          adjustedPageFrequencies:
            adjustments.adjustedPageFrequencies,
          adjustedSelectorPages:
            adjustments.adjustedSelectorPages,
          createdAt: row.created_at,
        };
      },
    );
  } catch (error) {
    if (!isMissingTableError(error)) {
      throw error;
    }
  }

  return {
    activeWorkspace,
    subscription,
    entitlements,
    usage,
    planOptions,
    recentEvents,
  };
}

export async function changeWorkspaceSubscriptionPlan(
  db: D1DatabaseLike,
  input: {
    actorUserId: string;
    workspaceId: string;
    planId: string;
    billingInterval?: string;
  },
): Promise<{
  subscription: WorkspaceSubscriptionView;
  entitlements: WorkspaceEntitlements;
  direction: "upgrade" | "downgrade" | "same";
  adjustedPageFrequencies: number;
  adjustedSelectorPages: number;
}> {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    throw new Error("Workspace ID is required.");
  }

  const normalizedPlanCandidate = input.planId
    .trim()
    .toLowerCase();
  if (!isBillingPlanId(normalizedPlanCandidate)) {
    throw new Error(
      "Choose a valid subscription plan (Free, Personal, Starter, Growth, or Scale).",
    );
  }
  const targetPlanId: BillingPlanId =
    normalizedPlanCandidate;

  const actor = await getWorkspaceMembershipById(
    db,
    input.actorUserId,
    workspaceId,
  );

  if (!actor) {
    throw new Error(
      "Workspace not found or access denied.",
    );
  }

  if (!canManageWorkspaceBilling(actor.role)) {
    throw new Error(
      "Only workspace Owners can manage billing and subscription plans.",
    );
  }

  const currentSubscription =
    await ensureWorkspaceSubscription(db, {
      workspaceId,
      actorUserId: input.actorUserId,
    });

  const currentEffectiveEntitlements =
    resolveWorkspaceEntitlements({
      planId: currentSubscription.planId,
      subscriptionStatus: currentSubscription.status,
      billingInterval:
        currentSubscription.billingInterval,
      cancelAtPeriodEnd:
        currentSubscription.cancelAtPeriodEnd,
      currentPeriodEnd:
        currentSubscription.currentPeriodEnd,
    });

  const nextBillingInterval: BillingInterval =
    input.billingInterval !== undefined
      ? (() => {
          const candidate = input.billingInterval
            .trim()
            .toLowerCase();
          if (!isBillingInterval(candidate)) {
            throw new Error(
              "Choose a valid billing cycle (monthly or annual).",
            );
          }
          return candidate;
        })()
      : currentSubscription.billingInterval;

  const targetPlan =
    getBillingPlanDefinition(targetPlanId);

  const usage = await getWorkspaceMeteredUsage(
    db,
    workspaceId,
    {
      retentionDays:
        targetPlan.limits.historyRetentionDays,
    },
  );

  const fasterPagesCount =
    await countPagesFasterThanInterval(
      db,
      workspaceId,
      targetPlan.limits.minFrequencyMinutes,
    );

  const evaluation = evaluatePlanTransition({
    currentPlanId:
      currentEffectiveEntitlements.effectivePlanId,
    targetPlanId,
    usage,
    fasterThanTargetMinFrequencyPages: fasterPagesCount,
    pagesWithCssSelectors:
      usage.pagesWithCssSelectors,
  });

  if (!evaluation.allowed) {
    throw new Error(
      evaluation.blockingReasons.join(" "),
    );
  }

  if (
    currentSubscription.planId === targetPlanId &&
    currentSubscription.billingInterval ===
      nextBillingInterval &&
    currentEffectiveEntitlements.subscriptionStatus ===
      "active" &&
    !currentEffectiveEntitlements.cancelAtPeriodEnd
  ) {
    return {
      subscription: currentSubscription,
      entitlements: currentEffectiveEntitlements,
      direction: "same",
      adjustedPageFrequencies: 0,
      adjustedSelectorPages: 0,
    };
  }

  const periodModifier =
    nextBillingInterval === "annual"
      ? "+365 days"
      : "+30 days";

  const eventType: WorkspaceBillingEventType =
    evaluation.direction === "upgrade"
      ? "plan_upgraded"
      : evaluation.direction === "downgrade"
        ? "plan_downgraded"
        : currentEffectiveEntitlements.subscriptionStatus ===
              "canceled" ||
            currentSubscription.cancelAtPeriodEnd
          ? "subscription_reactivated"
          : "billing_interval_changed";

  const adjustedSelectorPages =
    evaluation.pagesRequiringSelectorClear ?? 0;

  const statements: D1PreparedStatementLike[] = [
    db
      .prepare(
        `
          INSERT INTO workspace_subscriptions (
            workspace_id,
            plan_id,
            status,
            billing_interval,
            cancel_at_period_end,
            current_period_start,
            current_period_end,
            updated_by,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            'active',
            ?,
            0,
            CURRENT_TIMESTAMP,
            datetime('now', ?),
            ?,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
          ON CONFLICT(workspace_id) DO UPDATE SET
            plan_id = excluded.plan_id,
            status = 'active',
            billing_interval = excluded.billing_interval,
            cancel_at_period_end = 0,
            current_period_start = CURRENT_TIMESTAMP,
            current_period_end = datetime('now', ?),
            updated_by = excluded.updated_by,
            updated_at = CURRENT_TIMESTAMP
        `,
      )
      .bind(
        workspaceId,
        targetPlanId,
        nextBillingInterval,
        periodModifier,
        input.actorUserId,
        periodModifier,
      ),
  ];

  if (evaluation.pagesRequiringFrequencyAdjustment > 0) {
    statements.push(
      db
        .prepare(
          `
            UPDATE monitored_pages
            SET
              frequency_minutes = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE competitor_id IN (
              SELECT id
              FROM competitors
              WHERE workspace_id = ?
            )
              AND frequency_minutes < ?
          `,
        )
        .bind(
          targetPlan.limits.minFrequencyMinutes,
          workspaceId,
          targetPlan.limits.minFrequencyMinutes,
        ),
    );
  }

  if (adjustedSelectorPages > 0) {
    statements.push(
      db
        .prepare(
          `
            UPDATE monitored_pages
            SET
              include_selectors_json = '[]',
              ignore_selectors_json = '[]',
              updated_at = CURRENT_TIMESTAMP
            WHERE competitor_id IN (
              SELECT id
              FROM competitors
              WHERE workspace_id = ?
            )
              AND (
                (
                  include_selectors_json IS NOT NULL
                  AND TRIM(include_selectors_json) != ''
                  AND TRIM(include_selectors_json) != '[]'
                )
                OR (
                  ignore_selectors_json IS NOT NULL
                  AND TRIM(ignore_selectors_json) != ''
                  AND TRIM(ignore_selectors_json) != '[]'
                )
              )
          `,
        )
        .bind(workspaceId),
    );
  }

  statements.push(
    db
      .prepare(
        `
          INSERT INTO workspace_billing_events (
            id,
            workspace_id,
            actor_user_id,
            event_type,
            previous_plan_id,
            new_plan_id,
            billing_interval,
            details_json,
            created_at
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
            CURRENT_TIMESTAMP
          )
        `,
      )
      .bind(
        randomUUID(),
        workspaceId,
        input.actorUserId,
        eventType,
        currentSubscription.planId,
        targetPlanId,
        nextBillingInterval,
        JSON.stringify({
          adjustedPageFrequencies:
            evaluation.pagesRequiringFrequencyAdjustment,
          adjustedSelectorPages,
          minFrequencyMinutes:
            targetPlan.limits.minFrequencyMinutes,
          historyRetentionDays:
            targetPlan.limits.historyRetentionDays,
        }),
      ),
  );

  await executeBatch(db, statements);

  const updatedSubscription =
    await getWorkspaceSubscription(db, workspaceId);
  const updatedEntitlements =
    resolveWorkspaceEntitlements({
      planId: updatedSubscription.planId,
      subscriptionStatus: updatedSubscription.status,
      billingInterval:
        updatedSubscription.billingInterval,
      cancelAtPeriodEnd:
        updatedSubscription.cancelAtPeriodEnd,
      currentPeriodEnd:
        updatedSubscription.currentPeriodEnd,
    });

  return {
    subscription: updatedSubscription,
    entitlements: updatedEntitlements,
    direction: evaluation.direction,
    adjustedPageFrequencies:
      evaluation.pagesRequiringFrequencyAdjustment,
    adjustedSelectorPages,
  };
}

export async function updateWorkspaceBillingInterval(
  db: D1DatabaseLike,
  input: {
    actorUserId: string;
    workspaceId: string;
    billingInterval: string;
  },
): Promise<WorkspaceSubscriptionView> {
  const workspaceId = input.workspaceId.trim();
  const candidate = input.billingInterval
    .trim()
    .toLowerCase();

  if (!isBillingInterval(candidate)) {
    throw new Error(
      "Choose a valid billing cycle (monthly or annual).",
    );
  }

  const currentSubscription =
    await ensureWorkspaceSubscription(db, {
      workspaceId,
      actorUserId: input.actorUserId,
    });

  const result = await changeWorkspaceSubscriptionPlan(
    db,
    {
      actorUserId: input.actorUserId,
      workspaceId,
      planId: currentSubscription.planId,
      billingInterval: candidate,
    },
  );

  return result.subscription;
}

export async function setWorkspaceSubscriptionCancellation(
  db: D1DatabaseLike,
  input: {
    actorUserId: string;
    workspaceId: string;
    cancelAtPeriodEnd: boolean;
    immediate?: boolean;
  },
): Promise<{
  subscription: WorkspaceSubscriptionView;
  entitlements: WorkspaceEntitlements;
  adjustedPageFrequencies: number;
  adjustedSelectorPages: number;
}> {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    throw new Error("Workspace ID is required.");
  }

  const actor = await getWorkspaceMembershipById(
    db,
    input.actorUserId,
    workspaceId,
  );

  if (!actor) {
    throw new Error(
      "Workspace not found or access denied.",
    );
  }

  if (!canManageWorkspaceBilling(actor.role)) {
    throw new Error(
      "Only workspace Owners can manage billing and subscription plans.",
    );
  }

  const currentSubscription =
    await ensureWorkspaceSubscription(db, {
      workspaceId,
      actorUserId: input.actorUserId,
    });

  if (input.immediate) {
    const freeMinFreq =
      BILLING_PLAN_CATALOG.free.limits
        .minFrequencyMinutes;
    const [fasterPagesCount, usage] =
      await Promise.all([
        countPagesFasterThanInterval(
          db,
          workspaceId,
          freeMinFreq,
        ),
        getWorkspaceMeteredUsage(db, workspaceId),
      ]);
    const adjustedSelectorPages =
      usage.pagesWithCssSelectors;

    const statements: D1PreparedStatementLike[] = [
      db
        .prepare(
          `
            UPDATE workspace_subscriptions
            SET
              plan_id = 'free',
              status = 'canceled',
              cancel_at_period_end = 0,
              updated_by = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE workspace_id = ?
          `,
        )
        .bind(input.actorUserId, workspaceId),
    ];

    if (fasterPagesCount > 0) {
      statements.push(
        db
          .prepare(
            `
              UPDATE monitored_pages
              SET
                frequency_minutes = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE competitor_id IN (
                SELECT id
                FROM competitors
                WHERE workspace_id = ?
              )
                AND frequency_minutes < ?
            `,
          )
          .bind(
            freeMinFreq,
            workspaceId,
            freeMinFreq,
          ),
      );
    }

    if (adjustedSelectorPages > 0) {
      statements.push(
        db
          .prepare(
            `
              UPDATE monitored_pages
              SET
                include_selectors_json = '[]',
                ignore_selectors_json = '[]',
                updated_at = CURRENT_TIMESTAMP
              WHERE competitor_id IN (
                SELECT id
                FROM competitors
                WHERE workspace_id = ?
              )
                AND (
                  (
                    include_selectors_json IS NOT NULL
                    AND TRIM(include_selectors_json) != ''
                    AND TRIM(include_selectors_json) != '[]'
                  )
                  OR (
                    ignore_selectors_json IS NOT NULL
                    AND TRIM(ignore_selectors_json) != ''
                    AND TRIM(ignore_selectors_json) != '[]'
                  )
                )
            `,
          )
          .bind(workspaceId),
      );
    }

    statements.push(
      db
        .prepare(
          `
            INSERT INTO workspace_billing_events (
              id,
              workspace_id,
              actor_user_id,
              event_type,
              previous_plan_id,
              new_plan_id,
              billing_interval,
              details_json,
              created_at
            )
            VALUES (
              ?,
              ?,
              ?,
              'subscription_canceled',
              ?,
              'free',
              ?,
              ?,
              CURRENT_TIMESTAMP
            )
          `,
        )
        .bind(
          randomUUID(),
          workspaceId,
          input.actorUserId,
          currentSubscription.planId,
          currentSubscription.billingInterval,
          JSON.stringify({
            adjustedPageFrequencies: fasterPagesCount,
            adjustedSelectorPages,
          }),
        ),
    );

    await executeBatch(db, statements);

    const updatedSubscription =
      await getWorkspaceSubscription(db, workspaceId);
    const entitlements = resolveWorkspaceEntitlements({
      planId: updatedSubscription.planId,
      subscriptionStatus: updatedSubscription.status,
      billingInterval:
        updatedSubscription.billingInterval,
      cancelAtPeriodEnd:
        updatedSubscription.cancelAtPeriodEnd,
      currentPeriodEnd:
        updatedSubscription.currentPeriodEnd,
    });

    return {
      subscription: updatedSubscription,
      entitlements,
      adjustedPageFrequencies: fasterPagesCount,
      adjustedSelectorPages,
    };
  }

  const currentPeriodEndMs = parseBillingTimestampMs(
    currentSubscription.currentPeriodEnd,
  );
  const isPeriodExpired =
    currentPeriodEndMs !== null &&
    currentPeriodEndMs <= Date.now();

  if (
    !input.cancelAtPeriodEnd &&
    (currentSubscription.status === "canceled" ||
      isPeriodExpired) &&
    currentSubscription.planId !== "free"
  ) {
    throw new Error(
      "This subscription has already expired or been canceled. Complete a new checkout to activate a paid plan.",
    );
  }

  const nextCancelAtPeriodEnd = input.cancelAtPeriodEnd
    ? 1
    : 0;
  const eventType: WorkspaceBillingEventType =
    input.cancelAtPeriodEnd
      ? "cancellation_scheduled"
      : "subscription_reactivated";

  await executeBatch(db, [
    db
      .prepare(
        `
          UPDATE workspace_subscriptions
          SET
            status = 'active',
            cancel_at_period_end = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE workspace_id = ?
        `,
      )
      .bind(
        nextCancelAtPeriodEnd,
        input.actorUserId,
        workspaceId,
      ),

    db
      .prepare(
        `
          INSERT INTO workspace_billing_events (
            id,
            workspace_id,
            actor_user_id,
            event_type,
            previous_plan_id,
            new_plan_id,
            billing_interval,
            details_json,
            created_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            '{}',
            CURRENT_TIMESTAMP
          )
        `,
      )
      .bind(
        randomUUID(),
        workspaceId,
        input.actorUserId,
        eventType,
        currentSubscription.planId,
        currentSubscription.planId,
        currentSubscription.billingInterval,
      ),
  ]);

  const updatedSubscription =
    await getWorkspaceSubscription(db, workspaceId);
  const entitlements = resolveWorkspaceEntitlements({
    planId: updatedSubscription.planId,
    subscriptionStatus: updatedSubscription.status,
    billingInterval: updatedSubscription.billingInterval,
    cancelAtPeriodEnd:
      updatedSubscription.cancelAtPeriodEnd,
    currentPeriodEnd:
      updatedSubscription.currentPeriodEnd,
  });

  return {
    subscription: updatedSubscription,
    entitlements,
    adjustedPageFrequencies: 0,
    adjustedSelectorPages: 0,
  };
}

export async function acquireWorkspaceBillingLock(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    lockId?: string;
    leaseDurationMs?: number;
    now?: Date;
  },
): Promise<string> {
  const workspaceId = input.workspaceId.trim();
  const lockId = input.lockId ?? randomUUID();
  const now = input.now ?? new Date();
  const leaseDurationMs = Math.max(
    1000,
    input.leaseDurationMs ?? 30_000,
  );
  const nowIso = now.toISOString();
  const expiresIso = new Date(
    now.getTime() + leaseDurationMs,
  ).toISOString();

  await ensureWorkspaceSubscription(db, {
    workspaceId,
  });

  const result = await db
    .prepare(
      `
        UPDATE workspace_subscriptions
        SET
          mutation_lock_id = ?,
          mutation_locked_until = ?
        WHERE workspace_id = ?
          AND (
            mutation_lock_id IS NULL
            OR mutation_locked_until IS NULL
            OR datetime(mutation_locked_until) <= datetime(?)
          )
      `,
    )
    .bind(lockId, expiresIso, workspaceId, nowIso)
    .run();

  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new Error(
      "Another billing operation is already in progress for this workspace. Please wait a moment and try again.",
    );
  }

  return lockId;
}

export async function releaseWorkspaceBillingLock(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    lockId: string;
  },
): Promise<void> {
  try {
    await db
      .prepare(
        `
          UPDATE workspace_subscriptions
          SET
            mutation_lock_id = NULL,
            mutation_locked_until = NULL
          WHERE workspace_id = ?
            AND mutation_lock_id = ?
        `,
      )
      .bind(input.workspaceId.trim(), input.lockId)
      .run();
  } catch (error) {
    if (!isMissingTableError(error)) {
      throw error;
    }
  }
}

export async function withWorkspaceBillingLock<T>(
  db: D1DatabaseLike,
  workspaceId: string,
  operation: () => Promise<T>,
  options?: {
    leaseDurationMs?: number;
    now?: Date;
  },
): Promise<T> {
  const lockId = await acquireWorkspaceBillingLock(db, {
    workspaceId,
    leaseDurationMs: options?.leaseDurationMs,
    now: options?.now,
  });

  try {
    return await operation();
  } finally {
    await releaseWorkspaceBillingLock(db, {
      workspaceId,
      lockId,
    });
  }
}

export async function countUserOwnedWorkspaces(
  db: D1DatabaseLike,
  userId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `
        SELECT COUNT(DISTINCT workspaces.id) AS count
        FROM workspaces
        LEFT JOIN workspace_members
          ON workspace_members.workspace_id = workspaces.id
         AND workspace_members.user_id = ?
        WHERE workspaces.created_by = ?
           OR workspace_members.role = 'owner'
      `,
    )
    .bind(userId, userId)
    .first<{ count: number }>();

  return Number(row?.count ?? 0);
}

export async function getUserWorkspaceCreationEntitlements(
  db: D1DatabaseLike,
  userId: string,
): Promise<WorkspaceEntitlements> {
  const ownedRowsResult = await db
    .prepare(
      `
        SELECT DISTINCT workspaces.id AS workspace_id
        FROM workspaces
        LEFT JOIN workspace_members
          ON workspace_members.workspace_id = workspaces.id
         AND workspace_members.user_id = ?
        WHERE workspaces.created_by = ?
           OR workspace_members.role = 'owner'
        ORDER BY datetime(workspaces.created_at) ASC, workspaces.id ASC
      `,
    )
    .bind(userId, userId)
    .all<{ workspace_id: string }>();

  const ownedWorkspaceIds = (
    ownedRowsResult.results ?? []
  ).map((row) => row.workspace_id);

  if (ownedWorkspaceIds.length === 0) {
    return resolveWorkspaceEntitlements({
      planId: DEFAULT_BILLING_PLAN_ID,
    });
  }

  const entitlementsList = await Promise.all(
    ownedWorkspaceIds.map((wsId) =>
      getWorkspaceEntitlements(db, wsId),
    ),
  );

  let highest = entitlementsList[0]!;
  for (const current of entitlementsList) {
    if (
      current.limits.workspacesPerAccount >
        highest.limits.workspacesPerAccount ||
      (current.limits.workspacesPerAccount ===
        highest.limits.workspacesPerAccount &&
        current.tierRank > highest.tierRank)
    ) {
      highest = current;
    }
  }

  return highest;
}

export async function assertUserWorkspaceCreationCapacity(
  db: D1DatabaseLike,
  userId: string,
): Promise<WorkspaceEntitlements> {
  const [ownedCount, entitlements] = await Promise.all([
    countUserOwnedWorkspaces(db, userId),
    getUserWorkspaceCreationEntitlements(db, userId),
  ]);

  if (ownedCount === 0) {
    return entitlements;
  }

  const limit =
    entitlements.limits.workspacesPerAccount;
  if (ownedCount >= limit) {
    throw new Error(
      `Your account has reached the ${entitlements.planName} plan limit of ${limit} ${limit === 1 ? "workspace" : "workspaces"}. Upgrade your workspace plan in Billing to create additional workspaces.`,
    );
  }

  return entitlements;
}

export async function enforceUserWorkspaceCreationCapacityAfterInsert(
  db: D1DatabaseLike,
  input: {
    userId: string;
    newWorkspaceId: string;
    previousActiveWorkspaceId?: string | null;
  },
): Promise<void> {
  const [ownedCount, entitlements] = await Promise.all([
    countUserOwnedWorkspaces(db, input.userId),
    getUserWorkspaceCreationEntitlements(
      db,
      input.userId,
    ),
  ]);

  const limit =
    entitlements.limits.workspacesPerAccount;

  if (ownedCount > 1 && ownedCount > limit) {
    const cleanupStatements: D1PreparedStatementLike[] =
      [
        db
          .prepare(
            `
              DELETE FROM workspaces
              WHERE id = ?
            `,
          )
          .bind(input.newWorkspaceId),
      ];

    if (input.previousActiveWorkspaceId) {
      cleanupStatements.push(
        db
          .prepare(
            `
              UPDATE users
              SET
                active_workspace_id = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `,
          )
          .bind(
            input.previousActiveWorkspaceId,
            input.userId,
          ),
      );
    }

    await executeBatch(db, cleanupStatements);

    throw new Error(
      `Your account has reached the ${entitlements.planName} plan limit of ${limit} ${limit === 1 ? "workspace" : "workspaces"}. Upgrade your workspace plan in Billing to create additional workspaces.`,
    );
  }
}

export async function assertWorkspaceCompetitorCapacity(
  db: D1DatabaseLike,
  workspaceId: string,
): Promise<WorkspaceEntitlements> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    workspaceId,
  );
  const row = await db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM competitors
        WHERE workspace_id = ?
      `,
    )
    .bind(workspaceId)
    .first<{ count: number }>();

  const currentCount = Number(row?.count ?? 0);
  const limit =
    entitlements.limits.competitorsPerWorkspace;

  if (currentCount >= limit) {
    throw new Error(
      `This workspace has reached the ${entitlements.planName} plan limit of ${limit} ${limit === 1 ? "competitor" : "competitors"}. Upgrade your workspace plan in Billing to monitor more competitors.`,
    );
  }

  return entitlements;
}

export async function enforceCompetitorCapacityAfterInsert(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    competitorId: string;
  },
): Promise<void> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    input.workspaceId,
  );
  const limit =
    entitlements.limits.competitorsPerWorkspace;

  const row = await db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM competitors
        WHERE workspace_id = ?
      `,
    )
    .bind(input.workspaceId)
    .first<{ count: number }>();

  if (Number(row?.count ?? 0) > limit) {
    await db
      .prepare(
        `
          DELETE FROM competitors
          WHERE id = ?
            AND workspace_id = ?
        `,
      )
      .bind(input.competitorId, input.workspaceId)
      .run();

    throw new Error(
      `This workspace has reached the ${entitlements.planName} plan limit of ${limit} ${limit === 1 ? "competitor" : "competitors"}. Upgrade your workspace plan in Billing to monitor more competitors.`,
    );
  }
}

export async function assertWorkspaceMonitoredPageCapacity(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    competitorId: string;
  },
): Promise<WorkspaceEntitlements> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    input.workspaceId,
  );

  const [workspacePageCount, competitorPageCount] =
    await Promise.all([
      db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM monitored_pages
            INNER JOIN competitors
              ON competitors.id = monitored_pages.competitor_id
            WHERE competitors.workspace_id = ?
          `,
        )
        .bind(input.workspaceId)
        .first<{ count: number }>(),

      db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM monitored_pages
            WHERE competitor_id = ?
          `,
        )
        .bind(input.competitorId)
        .first<{ count: number }>(),
    ]);

  const workspaceLimit =
    entitlements.limits.monitoredPagesPerWorkspace;
  const competitorLimit =
    entitlements.limits.monitoredPagesPerCompetitor;

  if (
    Number(workspacePageCount?.count ?? 0) >=
    workspaceLimit
  ) {
    throw new Error(
      `This workspace has reached the ${entitlements.planName} plan limit of ${workspaceLimit} monitored pages. Upgrade your workspace plan in Billing to monitor more pages.`,
    );
  }

  if (
    Number(competitorPageCount?.count ?? 0) >=
    competitorLimit
  ) {
    throw new Error(
      `This competitor has reached the ${entitlements.planName} plan limit of ${competitorLimit} monitored pages per competitor. Upgrade your workspace plan in Billing to add more pages per competitor.`,
    );
  }

  return entitlements;
}

export async function enforceMonitoredPageCapacityAfterInsert(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    competitorId: string;
    pageId: string;
  },
): Promise<void> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    input.workspaceId,
  );

  const [workspacePageCount, competitorPageCount] =
    await Promise.all([
      db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM monitored_pages
            INNER JOIN competitors
              ON competitors.id = monitored_pages.competitor_id
            WHERE competitors.workspace_id = ?
          `,
        )
        .bind(input.workspaceId)
        .first<{ count: number }>(),

      db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM monitored_pages
            WHERE competitor_id = ?
          `,
        )
        .bind(input.competitorId)
        .first<{ count: number }>(),
    ]);

  const workspaceLimit =
    entitlements.limits.monitoredPagesPerWorkspace;
  const competitorLimit =
    entitlements.limits.monitoredPagesPerCompetitor;

  if (
    Number(workspacePageCount?.count ?? 0) >
      workspaceLimit ||
    Number(competitorPageCount?.count ?? 0) >
      competitorLimit
  ) {
    await db
      .prepare(
        `
          DELETE FROM monitored_pages
          WHERE id = ?
            AND competitor_id = ?
        `,
      )
      .bind(input.pageId, input.competitorId)
      .run();

    if (
      Number(workspacePageCount?.count ?? 0) >
      workspaceLimit
    ) {
      throw new Error(
        `This workspace has reached the ${entitlements.planName} plan limit of ${workspaceLimit} monitored pages. Upgrade your workspace plan in Billing to monitor more pages.`,
      );
    }

    throw new Error(
      `This competitor has reached the ${entitlements.planName} plan limit of ${competitorLimit} monitored pages per competitor. Upgrade your workspace plan in Billing to add more pages per competitor.`,
    );
  }
}

export async function assertWorkspaceMonitoringFrequencyAllowed(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    frequencyMinutes: number;
  },
): Promise<WorkspaceEntitlements> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    input.workspaceId,
  );

  if (
    !isFrequencyAllowedForPlan(
      input.frequencyMinutes,
      entitlements,
    )
  ) {
    const requestedLabel = formatFrequencyIntervalLabel(
      input.frequencyMinutes,
    ).toLowerCase();
    const minimumLabel = formatFrequencyIntervalLabel(
      entitlements.limits.minFrequencyMinutes,
    ).toLowerCase();

    throw new Error(
      `Check frequency (${requestedLabel}) requires a higher plan. The ${entitlements.planName} plan supports checks as frequent as ${minimumLabel}. Upgrade in Billing to unlock faster monitoring.`,
    );
  }

  return entitlements;
}

export async function assertWorkspaceSectionLevelMonitoringAllowed(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    includeSelectors: readonly string[];
    ignoreSelectors: readonly string[];
  },
): Promise<WorkspaceEntitlements> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    input.workspaceId,
  );

  const hasNonEmptySelectors =
    input.includeSelectors.length > 0 ||
    input.ignoreSelectors.length > 0;

  if (
    hasNonEmptySelectors &&
    !entitlements.features.sectionLevelMonitoring
  ) {
    throw new Error(
      `Section-level CSS selector monitoring is not available on the ${entitlements.planName} plan. Upgrade to Starter or higher in Billing to target or ignore specific page sections.`,
    );
  }

  return entitlements;
}

export async function assertWorkspaceDigestScheduleAllowed(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    enabled: boolean;
    digestPeriods: readonly string[];
  },
): Promise<WorkspaceEntitlements> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    input.workspaceId,
  );

  if (!input.enabled) {
    return entitlements;
  }

  if (!entitlements.features.scheduledDigests) {
    throw new Error(
      `Scheduled digests are not included on the ${entitlements.planName} plan. Upgrade to Personal or higher in Billing to enable scheduled digests.`,
    );
  }

  const allowedPeriods = new Set<string>(
    entitlements.features.allowedDigestPeriods,
  );
  const disallowed = input.digestPeriods.filter(
    (period) => !allowedPeriods.has(period),
  );

  if (disallowed.length > 0) {
    throw new Error(
      `The ${entitlements.planName} plan supports ${entitlements.features.allowedDigestPeriods.join(", ")} scheduled digests only (${disallowed.join(", ")} requires Starter or higher). Upgrade your workspace plan in Billing to unlock additional digest schedules.`,
    );
  }

  return entitlements;
}

export async function assertWorkspaceTeamSeatCapacity(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    candidateEmail?: string;
  },
): Promise<WorkspaceEntitlements> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    input.workspaceId,
  );
  const limit =
    entitlements.limits.teamMembersPerWorkspace;

  const normalizedEmail = (input.candidateEmail ?? "")
    .trim()
    .toLowerCase();

  let alreadyPendingForEmail = false;
  if (normalizedEmail) {
    try {
      const existingInvite = await db
        .prepare(
          `
            SELECT id
            FROM workspace_invitations
            WHERE workspace_id = ?
              AND LOWER(email) = ?
              AND status = 'pending'
            LIMIT 1
          `,
        )
        .bind(input.workspaceId, normalizedEmail)
        .first<{ id: string }>();

      alreadyPendingForEmail = Boolean(
        existingInvite?.id,
      );
    } catch (error) {
      if (!isMissingTableError(error)) {
        throw error;
      }
    }
  }

  if (alreadyPendingForEmail) {
    return entitlements;
  }

  const usage = await getWorkspaceMeteredUsage(
    db,
    input.workspaceId,
    {
      retentionDays:
        entitlements.limits.historyRetentionDays,
    },
  );

  if (usage.teamSeats >= limit) {
    throw new Error(
      `This workspace has reached the ${entitlements.planName} plan limit of ${limit} ${limit === 1 ? "team seat" : "team seats"} (including the owner and pending invitations). Upgrade your workspace plan in Billing to add more teammates.`,
    );
  }

  return entitlements;
}

export async function assertWorkspaceInvitationAcceptanceCapacity(
  db: D1DatabaseLike,
  workspaceId: string,
): Promise<WorkspaceEntitlements> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    workspaceId,
  );
  const limit =
    entitlements.limits.teamMembersPerWorkspace;
  const usage = await getWorkspaceMeteredUsage(
    db,
    workspaceId,
    {
      retentionDays:
        entitlements.limits.historyRetentionDays,
    },
  );

  if (usage.activeMembers >= limit) {
    throw new Error(
      `This workspace has reached the ${entitlements.planName} plan limit of ${limit} ${limit === 1 ? "team seat" : "team seats"}. Ask the workspace Owner to upgrade the plan in Billing before accepting this invitation.`,
    );
  }

  return entitlements;
}

export async function enforceWorkspaceInvitationAcceptanceAfterInsert(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    invitationId: string;
    memberUserId: string;
  },
): Promise<void> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    input.workspaceId,
  );
  const limit =
    entitlements.limits.teamMembersPerWorkspace;
  const usage = await getWorkspaceMeteredUsage(
    db,
    input.workspaceId,
    {
      retentionDays:
        entitlements.limits.historyRetentionDays,
    },
  );

  if (usage.activeMembers > limit) {
    await executeBatch(db, [
      db
        .prepare(
          `
            DELETE FROM workspace_members
            WHERE workspace_id = ?
              AND user_id = ?
              AND role != 'owner'
          `,
        )
        .bind(input.workspaceId, input.memberUserId),
      db
        .prepare(
          `
            UPDATE workspace_invitations
            SET
              status = 'pending',
              responded_at = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND workspace_id = ?
          `,
        )
        .bind(input.invitationId, input.workspaceId),
    ]);

    throw new Error(
      `This workspace has reached the ${entitlements.planName} plan limit of ${limit} ${limit === 1 ? "team seat" : "team seats"}. Ask the workspace Owner to upgrade the plan in Billing before accepting this invitation.`,
    );
  }
}

export async function enforceTeamSeatCapacityAfterInsert(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    invitationId?: string;
    memberUserId?: string;
  },
): Promise<void> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    input.workspaceId,
  );
  const limit =
    entitlements.limits.teamMembersPerWorkspace;

  const usage = await getWorkspaceMeteredUsage(
    db,
    input.workspaceId,
    {
      retentionDays:
        entitlements.limits.historyRetentionDays,
    },
  );

  if (usage.teamSeats > limit) {
    if (input.invitationId) {
      await db
        .prepare(
          `
            DELETE FROM workspace_invitations
            WHERE id = ?
              AND workspace_id = ?
          `,
        )
        .bind(input.invitationId, input.workspaceId)
        .run();
    } else if (input.memberUserId) {
      await db
        .prepare(
          `
            DELETE FROM workspace_members
            WHERE workspace_id = ?
              AND user_id = ?
              AND role != 'owner'
          `,
        )
        .bind(input.workspaceId, input.memberUserId)
        .run();
    }

    throw new Error(
      `This workspace has reached the ${entitlements.planName} plan limit of ${limit} ${limit === 1 ? "team seat" : "team seats"} (including the owner and pending invitations). Upgrade your workspace plan in Billing to add more teammates.`,
    );
  }
}

export async function assertWorkspaceExternalChannelCapacity(
  db: D1DatabaseLike,
  workspaceId: string,
): Promise<WorkspaceEntitlements> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    workspaceId,
  );
  const limit =
    entitlements.limits.externalChannelsPerWorkspace;

  if (limit <= 0) {
    throw new Error(
      `External notification channels are not included on the ${entitlements.planName} plan. Upgrade to Personal or higher in Billing to connect Slack, Telegram, or Webhook channels.`,
    );
  }

  const row = await db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM external_notification_channels
        WHERE workspace_id = ?
      `,
    )
    .bind(workspaceId)
    .first<{ count: number }>();

  const currentCount = Number(row?.count ?? 0);
  if (currentCount >= limit) {
    throw new Error(
      `This workspace has reached the ${entitlements.planName} plan limit of ${limit} external notification ${limit === 1 ? "channel" : "channels"}. Upgrade your workspace plan in Billing to add more channels.`,
    );
  }

  return entitlements;
}

export async function enforceExternalChannelCapacityAfterInsert(
  db: D1DatabaseLike,
  input: {
    workspaceId: string;
    channelId: string;
  },
): Promise<void> {
  const entitlements = await getWorkspaceEntitlements(
    db,
    input.workspaceId,
  );
  const limit =
    entitlements.limits.externalChannelsPerWorkspace;

  const row = await db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM external_notification_channels
        WHERE workspace_id = ?
      `,
    )
    .bind(input.workspaceId)
    .first<{ count: number }>();

  if (Number(row?.count ?? 0) > limit) {
    await db
      .prepare(
        `
          DELETE FROM external_notification_channels
          WHERE id = ?
            AND workspace_id = ?
        `,
      )
      .bind(input.channelId, input.workspaceId)
      .run();

    if (limit <= 0) {
      throw new Error(
        `External notification channels are not included on the ${entitlements.planName} plan. Upgrade to Personal or higher in Billing to connect Slack, Telegram, or Webhook channels.`,
      );
    }

    throw new Error(
      `This workspace has reached the ${entitlements.planName} plan limit of ${limit} external notification ${limit === 1 ? "channel" : "channels"}. Upgrade your workspace plan in Billing to add more channels.`,
    );
  }
}
