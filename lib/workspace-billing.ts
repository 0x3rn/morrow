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
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface UsageMetricsRow {
  competitors_count: number;
  monitored_pages_count: number;
  max_pages_per_competitor: number;
  active_members_count: number;
  pending_invitations_count: number;
  external_channels_count: number;
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
  | "plan_upgraded"
  | "plan_downgraded"
  | "billing_interval_changed"
  | "cancellation_scheduled"
  | "subscription_reactivated"
  | "subscription_canceled";

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
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDetailedUsage
  extends WorkspaceMeteredUsage {
  activeMembers: number;
  pendingInvitations: number;
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
    /no such table/i.test(error.message)
  );
}

function createDefaultSubscriptionView(
  workspaceId: string,
): WorkspaceSubscriptionView {
  const now = new Date();
  const periodEnd = new Date(
    now.getTime() + 30 * 24 * 60 * 60 * 1000,
  );
  return {
    workspaceId,
    planId: DEFAULT_BILLING_PLAN_ID,
    status: DEFAULT_BILLING_SUBSCRIPTION_STATUS,
    billingInterval: DEFAULT_BILLING_INTERVAL,
    cancelAtPeriodEnd: false,
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    providerCustomerId: null,
    providerSubscriptionId: null,
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
  } catch (error) {
    if (!isMissingTableError(error)) {
      throw error;
    }
  }

  return createDefaultSubscriptionView(workspaceId);
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
    BILLING_PLAN_CATALOG.starter.limits
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

function parseAdjustedPageFrequencies(
  detailsJson: string,
): number {
  try {
    const parsed = JSON.parse(detailsJson);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { adjustedPageFrequencies?: unknown })
        .adjustedPageFrequencies === "number"
    ) {
      return Number(
        (parsed as { adjustedPageFrequencies: number })
          .adjustedPageFrequencies,
      );
    }
  } catch {
    // Ignore malformed JSON in historical rows
  }
  return 0;
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
  });

  const usage = await getWorkspaceMeteredUsage(
    db,
    activeWorkspace.id,
    {
      retentionDays:
        entitlements.limits.historyRetentionDays,
    },
  );

  const fasterThanStarterCount =
    await countPagesFasterThanInterval(
      db,
      activeWorkspace.id,
      BILLING_PLAN_CATALOG.starter.limits
        .minFrequencyMinutes,
    );

  const planOptions: WorkspacePlanOptionView[] =
    BILLING_PLAN_IDS.map((planId) => {
      const plan = getBillingPlanDefinition(planId);
      const fasterPages =
        plan.limits.minFrequencyMinutes > 60
          ? fasterThanStarterCount
          : 0;

      const transition = evaluatePlanTransition({
        currentPlanId: entitlements.effectivePlanId,
        targetPlanId: planId,
        usage,
        fasterThanTargetMinFrequencyPages: fasterPages,
      });

      return {
        plan,
        isCurrentPlan:
          entitlements.effectivePlanId === planId &&
          subscription.status !== "canceled",
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
      (row) => ({
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
          parseAdjustedPageFrequencies(
            row.details_json,
          ),
        createdAt: row.created_at,
      }),
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
      "Choose a valid subscription plan (Starter, Growth, or Scale).",
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
    currentSubscription.status === "active" &&
    !currentSubscription.cancelAtPeriodEnd
  ) {
    return {
      subscription: currentSubscription,
      entitlements: currentEffectiveEntitlements,
      direction: "same",
      adjustedPageFrequencies: 0,
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
        : currentSubscription.status === "canceled" ||
            currentSubscription.cancelAtPeriodEnd
          ? "subscription_reactivated"
          : "billing_interval_changed";

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
    });

  return {
    subscription: updatedSubscription,
    entitlements: updatedEntitlements,
    direction: evaluation.direction,
    adjustedPageFrequencies:
      evaluation.pagesRequiringFrequencyAdjustment,
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
    const starterMinFreq =
      BILLING_PLAN_CATALOG.starter.limits
        .minFrequencyMinutes;
    const fasterPagesCount =
      await countPagesFasterThanInterval(
        db,
        workspaceId,
        starterMinFreq,
      );

    const statements: D1PreparedStatementLike[] = [
      db
        .prepare(
          `
            UPDATE workspace_subscriptions
            SET
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
            starterMinFreq,
            workspaceId,
            starterMinFreq,
          ),
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
              'starter',
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
    });

    return {
      subscription: updatedSubscription,
      entitlements,
      adjustedPageFrequencies: fasterPagesCount,
    };
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
  });

  return {
    subscription: updatedSubscription,
    entitlements,
    adjustedPageFrequencies: 0,
  };
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
      `This workspace has reached the ${entitlements.planName} plan limit of ${limit} competitors. Upgrade your workspace plan in Billing to monitor more competitors.`,
    );
  }

  return entitlements;
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
      `This workspace has reached the ${entitlements.planName} plan limit of ${limit} team seats (including pending invitations). Upgrade your workspace plan in Billing to add more teammates.`,
    );
  }

  return entitlements;
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
      `This workspace has reached the ${entitlements.planName} plan limit of ${limit} external notification channels. Upgrade your workspace plan in Billing to add more channels.`,
    );
  }

  return entitlements;
}
