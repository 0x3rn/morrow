import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  BILLING_INTERVALS,
  BILLING_PLAN_CATALOG,
  BILLING_PLAN_IDS,
  BILLING_SUBSCRIPTION_STATUSES,
  PAID_BILLING_PLAN_IDS,
  evaluatePlanTransition,
  formatFrequencyIntervalLabel,
  getAllowedFrequenciesForMinInterval,
  getBillingPlanDefinition,
  getDefaultFrequencyForPlan,
  getRetentionCutoffIso,
  isBillingInterval,
  isBillingPlanId,
  isBillingSubscriptionStatus,
  isFrequencyAllowedForPlan,
  normalizeBillingInterval,
  normalizeBillingPlanId,
  normalizeBillingSubscriptionStatus,
  resolveWorkspaceEntitlements,
} from "../lib/billing-plans.ts";
import {
  createWorkspaceExternalChannel,
  saveUserEmailNotificationPreferences,
} from "../lib/notification-settings.ts";
import {
  acceptWorkspaceInvitation,
  createTeamWorkspace,
  inviteOrAddWorkspaceMember,
  updateWorkspaceMemberRole,
} from "../lib/team-workspaces.ts";
import {
  acquireWorkspaceBillingLock,
  assertWorkspaceCompetitorCapacity,
  assertWorkspaceDigestScheduleAllowed,
  assertWorkspaceExternalChannelCapacity,
  assertWorkspaceMonitoredPageCapacity,
  assertWorkspaceMonitoringFrequencyAllowed,
  assertWorkspaceSectionLevelMonitoringAllowed,
  assertWorkspaceTeamSeatCapacity,
  changeWorkspaceSubscriptionPlan,
  enforceCompetitorCapacityAfterInsert,
  enforceExternalChannelCapacityAfterInsert,
  enforceMonitoredPageCapacityAfterInsert,
  enforceTeamSeatCapacityAfterInsert,
  enforceUserWorkspaceCreationCapacityAfterInsert,
  getWorkspaceBillingSnapshot,
  getWorkspaceEntitlements,
  getWorkspaceRetentionWindow,
  getWorkspaceSubscription,
  releaseWorkspaceBillingLock,
  setWorkspaceSubscriptionCancellation,
  updateWorkspaceBillingInterval,
} from "../lib/workspace-billing.ts";
import {
  computePolarSignature,
  createPolarWebhookHandler,
  initiateOrUpdateWorkspaceSubscription,
  isPlaceholderEnvValue,
  processPolarWebhook,
  resolvePlanFromProductId,
  resolvePolarConfig,
  updateWorkspaceSubscriptionCancellationWithPolar,
  verifyPolarWebhookSignature,
} from "../lib/polar.ts";
import {
  BILLING_PROVIDER_CONNECTION_USER_FACING_MESSAGE,
  BILLING_UNAVAILABLE_USER_FACING_MESSAGE,
  DEFAULT_USER_FACING_ERROR_MESSAGE,
  isTechnicalOrRedactedErrorMessage,
  toUserFacingErrorMessage,
} from "../lib/user-facing-error.ts";
import { canManageWorkspaceBilling } from "../lib/workspace-roles.ts";

function createD1Fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");

  const migrationFiles = readdirSync(
    new URL("../migrations/", import.meta.url),
  )
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    sqlite.exec(
      readFileSync(
        new URL(`../migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  }

  t.after(() => {
    sqlite.close();
  });

  function createPreparedStatement(sql, boundValues = []) {
    return {
      sql,
      boundValues,
      bind(...values) {
        return createPreparedStatement(sql, values);
      },
      async first() {
        const row = sqlite
          .prepare(sql)
          .get(...boundValues);
        return row ? { ...row } : null;
      },
      async all() {
        const rows = sqlite
          .prepare(sql)
          .all(...boundValues)
          .map((row) => ({ ...row }));
        return { results: rows };
      },
      async run() {
        const result = sqlite
          .prepare(sql)
          .run(...boundValues);
        return {
          success: true,
          meta: {
            changes: Number(result.changes ?? 0),
          },
        };
      },
    };
  }

  const db = {
    prepare(sql) {
      return createPreparedStatement(sql);
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };

  sqlite
    .prepare(
      `
        INSERT INTO users (id, email, name, email_verified)
        VALUES
          ('usr_owner', 'owner@acme.test', 'Alice Owner', 1),
          ('usr_admin', 'admin@acme.test', 'Bob Admin', 1),
          ('usr_member', 'member@acme.test', 'Charlie Member', 1),
          ('usr_viewer', 'viewer@acme.test', 'Dana Viewer', 1)
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO workspaces (id, name, created_by)
        VALUES ('ws_acme', 'Acme Intelligence', 'usr_owner')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES
          ('ws_acme', 'usr_owner', 'owner'),
          ('ws_acme', 'usr_admin', 'admin'),
          ('ws_acme', 'usr_member', 'member'),
          ('ws_acme', 'usr_viewer', 'viewer')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        UPDATE users
        SET active_workspace_id = 'ws_acme'
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO workspace_subscriptions (
          workspace_id,
          plan_id,
          status,
          billing_interval,
          cancel_at_period_end,
          updated_by
        )
        VALUES (
          'ws_acme',
          'starter',
          'active',
          'monthly',
          0,
          'usr_owner'
        )
      `,
    )
    .run();

  return { sqlite, db };
}

test("THE-28.1: billing-plans defines canonical 5-tier plan catalog (Free, Personal, Starter, Growth, Scale), frequency rules, retention windows, and plan transitions", () => {
  assert.deepEqual(BILLING_PLAN_IDS, [
    "free",
    "personal",
    "starter",
    "growth",
    "scale",
  ]);
  assert.deepEqual(PAID_BILLING_PLAN_IDS, [
    "personal",
    "starter",
    "growth",
    "scale",
  ]);
  assert.deepEqual(BILLING_SUBSCRIPTION_STATUSES, [
    "trialing",
    "active",
    "past_due",
    "canceled",
  ]);
  assert.deepEqual(BILLING_INTERVALS, [
    "monthly",
    "annual",
  ]);

  assert.equal(isBillingPlanId("free"), true);
  assert.equal(isBillingPlanId("personal"), true);
  assert.equal(isBillingPlanId("growth"), true);
  assert.equal(isBillingPlanId("enterprise"), false);
  assert.equal(
    normalizeBillingPlanId(" SCALE "),
    "scale",
  );
  assert.equal(
    normalizeBillingPlanId("unknown"),
    "free",
  );

  assert.equal(
    isBillingSubscriptionStatus("past_due"),
    true,
  );
  assert.equal(
    normalizeBillingSubscriptionStatus(" CANCELED "),
    "canceled",
  );

  assert.equal(isBillingInterval("annual"), true);
  assert.equal(
    normalizeBillingInterval(" ANNUAL "),
    "annual",
  );

  assert.equal(canManageWorkspaceBilling("owner"), true);
  assert.equal(canManageWorkspaceBilling("admin"), false);
  assert.equal(canManageWorkspaceBilling("member"), false);
  assert.equal(canManageWorkspaceBilling("viewer"), false);

  const freeEntitlements = resolveWorkspaceEntitlements({
    planId: "free",
    subscriptionStatus: "active",
    billingInterval: "monthly",
  });
  assert.equal(
    freeEntitlements.limits.workspacesPerAccount,
    1,
  );
  assert.equal(
    freeEntitlements.limits.teamMembersPerWorkspace,
    1,
  );
  assert.equal(
    freeEntitlements.limits.competitorsPerWorkspace,
    1,
  );
  assert.equal(
    freeEntitlements.limits.monitoredPagesPerWorkspace,
    3,
  );
  assert.equal(
    freeEntitlements.limits.monitoredPagesPerCompetitor,
    3,
  );
  assert.equal(
    freeEntitlements.limits.minFrequencyMinutes,
    1440,
  );
  assert.equal(
    freeEntitlements.limits.historyRetentionDays,
    7,
  );
  assert.equal(
    freeEntitlements.limits.externalChannelsPerWorkspace,
    0,
  );
  assert.equal(
    freeEntitlements.features.sectionLevelMonitoring,
    false,
  );
  assert.equal(
    freeEntitlements.features.scheduledDigests,
    false,
  );
  assert.deepEqual(
    freeEntitlements.features.allowedDigestPeriods,
    [],
  );
  assert.deepEqual(
    freeEntitlements.allowedFrequencies,
    [1440, 10080],
  );
  assert.equal(
    getDefaultFrequencyForPlan(freeEntitlements),
    1440,
  );

  const personalEntitlements =
    resolveWorkspaceEntitlements({
      planId: "personal",
      subscriptionStatus: "active",
      billingInterval: "monthly",
    });
  assert.equal(
    personalEntitlements.effectiveMonthlyPriceUsd,
    5,
  );
  assert.equal(
    personalEntitlements.limits.workspacesPerAccount,
    1,
  );
  assert.equal(
    personalEntitlements.limits.teamMembersPerWorkspace,
    3,
  );
  assert.equal(
    personalEntitlements.limits.competitorsPerWorkspace,
    3,
  );
  assert.equal(
    personalEntitlements.limits.monitoredPagesPerWorkspace,
    10,
  );
  assert.equal(
    personalEntitlements.limits
      .monitoredPagesPerCompetitor,
    4,
  );
  assert.equal(
    personalEntitlements.limits.minFrequencyMinutes,
    720,
  );
  assert.equal(
    personalEntitlements.limits.historyRetentionDays,
    14,
  );
  assert.equal(
    personalEntitlements.limits
      .externalChannelsPerWorkspace,
    1,
  );
  assert.equal(
    personalEntitlements.features.sectionLevelMonitoring,
    false,
  );
  assert.equal(
    personalEntitlements.features.scheduledDigests,
    true,
  );
  assert.deepEqual(
    personalEntitlements.features.allowedDigestPeriods,
    ["weekly"],
  );
  assert.deepEqual(
    personalEntitlements.allowedFrequencies,
    [720, 1440, 10080],
  );
  assert.equal(
    getDefaultFrequencyForPlan(personalEntitlements),
    720,
  );

  const starterEntitlements =
    resolveWorkspaceEntitlements({
      planId: "starter",
      subscriptionStatus: "active",
      billingInterval: "monthly",
    });
  assert.equal(
    starterEntitlements.limits.workspacesPerAccount,
    5,
  );
  assert.equal(
    starterEntitlements.limits.teamMembersPerWorkspace,
    5,
  );
  assert.equal(
    starterEntitlements.limits.competitorsPerWorkspace,
    10,
  );
  assert.equal(
    starterEntitlements.limits.monitoredPagesPerWorkspace,
    50,
  );
  assert.equal(
    starterEntitlements.limits.minFrequencyMinutes,
    360,
  );
  assert.equal(
    starterEntitlements.limits.historyRetentionDays,
    30,
  );
  assert.equal(
    starterEntitlements.features.hourlyMonitoring,
    false,
  );
  assert.equal(
    starterEntitlements.features.sectionLevelMonitoring,
    true,
  );
  assert.deepEqual(
    starterEntitlements.features.allowedDigestPeriods,
    ["daily", "weekly", "monthly"],
  );
  assert.deepEqual(
    starterEntitlements.allowedFrequencies,
    [360, 720, 1440, 10080],
  );
  assert.equal(
    isFrequencyAllowedForPlan(60, starterEntitlements),
    false,
  );
  assert.equal(
    isFrequencyAllowedForPlan(360, starterEntitlements),
    true,
  );

  const growthAnnual = resolveWorkspaceEntitlements({
    planId: "growth",
    subscriptionStatus: "active",
    billingInterval: "annual",
  });
  assert.equal(growthAnnual.effectivePlanId, "growth");
  assert.equal(
    growthAnnual.effectiveMonthlyPriceUsd,
    BILLING_PLAN_CATALOG.growth.annualMonthlyPriceUsd,
  );
  assert.equal(
    growthAnnual.limits.workspacesPerAccount,
    25,
  );
  assert.equal(
    growthAnnual.limits.teamMembersPerWorkspace,
    15,
  );
  assert.equal(
    growthAnnual.features.hourlyMonitoring,
    true,
  );
  assert.equal(
    isFrequencyAllowedForPlan(60, growthAnnual),
    true,
  );
  assert.equal(
    getDefaultFrequencyForPlan(growthAnnual),
    360,
  );

  // Canceled subscriptions fall back to Free limits while retaining configuredPlanId
  const canceledScale = resolveWorkspaceEntitlements({
    planId: "scale",
    subscriptionStatus: "canceled",
    billingInterval: "monthly",
  });
  assert.equal(canceledScale.configuredPlanId, "scale");
  assert.equal(canceledScale.effectivePlanId, "free");
  assert.equal(
    canceledScale.limits.minFrequencyMinutes,
    1440,
  );

  assert.equal(
    formatFrequencyIntervalLabel(60),
    "Every hour",
  );
  assert.equal(
    formatFrequencyIntervalLabel(360),
    "Every 6 hours",
  );
  assert.deepEqual(
    getAllowedFrequenciesForMinInterval(60),
    [60, 360, 720, 1440, 10080],
  );

  const reference = new Date("2026-10-14T00:00:00.000Z");
  assert.equal(
    getRetentionCutoffIso(30, reference),
    "2026-09-14T00:00:00.000Z",
  );

  const blockedDowngrade = evaluatePlanTransition({
    currentPlanId: "starter",
    targetPlanId: "personal",
    usage: {
      ownedWorkspaces: 2,
      competitors: 5,
      monitoredPages: 12,
      maxPagesOnSingleCompetitor: 6,
      teamSeats: 4,
      externalChannels: 2,
      pagesWithCssSelectors: 3,
    },
    fasterThanTargetMinFrequencyPages: 4,
    pagesWithCssSelectors: 3,
  });
  assert.equal(blockedDowngrade.direction, "downgrade");
  assert.equal(blockedDowngrade.allowed, false);
  assert.equal(
    blockedDowngrade.blockingReasons.length,
    6,
  );
  assert.equal(
    blockedDowngrade.pagesRequiringFrequencyAdjustment,
    4,
  );
  assert.equal(
    blockedDowngrade.pagesRequiringSelectorClear,
    3,
  );
});

test("THE-28.2 & THE-28.3: enforces Starter plan limits across competitors, monitored pages, check frequencies, team seats, and external channels", async (t) => {
  const { db, sqlite } = createD1Fixture(t);

  const initialSub = await getWorkspaceSubscription(
    db,
    "ws_acme",
  );
  assert.equal(initialSub.planId, "starter");
  assert.equal(initialSub.status, "active");

  // 1. Hourly check frequency (60 min) is rejected on Starter plan
  await assert.rejects(
    () =>
      assertWorkspaceMonitoringFrequencyAllowed(db, {
        workspaceId: "ws_acme",
        frequencyMinutes: 60,
      }),
    /Starter plan supports checks as frequent as every 6 hours/,
  );

  // 6-hour check frequency (360 min) is allowed on Starter plan
  await assertWorkspaceMonitoringFrequencyAllowed(db, {
    workspaceId: "ws_acme",
    frequencyMinutes: 360,
  });

  // 2. Seed 10 competitors (Starter limit) and verify the 11th is blocked
  for (let i = 1; i <= 10; i++) {
    sqlite
      .prepare(
        `
          INSERT INTO competitors (id, workspace_id, name, domain, status)
          VALUES (?, 'ws_acme', ?, ?, 'active')
        `,
      )
      .run(
        `comp_${i}`,
        `Competitor ${i}`,
        `comp${i}.test`,
      );
  }

  await assert.rejects(
    () =>
      assertWorkspaceCompetitorCapacity(db, "ws_acme"),
    /reached the Starter plan limit of 10 competitors/,
  );

  // 3. Seed 10 monitored pages on comp_1 (Starter per-competitor limit) and verify 11th is blocked
  for (let i = 1; i <= 10; i++) {
    sqlite
      .prepare(
        `
          INSERT INTO monitored_pages (id, competitor_id, url, label, frequency_minutes)
          VALUES (?, 'comp_1', ?, ?, 360)
        `,
      )
      .run(
        `mp_1_${i}`,
        `https://comp1.test/page-${i}`,
        `Page ${i}`,
      );
  }

  await assert.rejects(
    () =>
      assertWorkspaceMonitoredPageCapacity(db, {
        workspaceId: "ws_acme",
        competitorId: "comp_1",
      }),
    /reached the Starter plan limit of 10 monitored pages per competitor/,
  );

  // 4. External channels: Starter allows up to 3 channels
  for (let i = 1; i <= 3; i++) {
    await createWorkspaceExternalChannel(db, {
      userId: "usr_owner",
      name: `Slack Channel ${i}`,
      channel: "slack",
      slackWebhookUrl: `https://hooks.slack.com/services/T1/B1/S${i}`,
      sendChanges: true,
      sendDigests: false,
      minSignificance: "major",
      categories: [],
      competitorIds: [],
      digestPeriods: ["weekly"],
    });
  }

  await assert.rejects(
    () =>
      createWorkspaceExternalChannel(db, {
        userId: "usr_owner",
        name: "Slack Channel 4",
        channel: "slack",
        slackWebhookUrl:
          "https://hooks.slack.com/services/T1/B1/S4",
        sendChanges: true,
        sendDigests: false,
        minSignificance: "major",
        categories: [],
        competitorIds: [],
        digestPeriods: ["weekly"],
      }),
    /reached the Starter plan limit of 3 external notification channels/,
  );

  // 5. Team seats: ws_acme has 4 active members; Starter allows 5 seats total
  await inviteOrAddWorkspaceMember(db, {
    actorUserId: "usr_owner",
    workspaceId: "ws_acme",
    email: "seat5@acme.test",
    role: "member",
  });

  // Re-inviting an already-pending email does not consume a 6th seat
  await inviteOrAddWorkspaceMember(db, {
    actorUserId: "usr_owner",
    workspaceId: "ws_acme",
    email: "seat5@acme.test",
    role: "viewer",
  });

  // Inviting a 6th distinct seat is blocked on Starter
  await assert.rejects(
    () =>
      inviteOrAddWorkspaceMember(db, {
        actorUserId: "usr_owner",
        workspaceId: "ws_acme",
        email: "seat6@acme.test",
        role: "viewer",
      }),
    /reached the Starter plan limit of 5 team seats/,
  );
});

test("THE-28.3 & THE-28.4: upgrades, downgrades, frequency normalization, billing intervals, cancellation, and RBAC enforcement", async (t) => {
  const { db, sqlite } = createD1Fixture(t);

  sqlite
    .prepare(
      `
        INSERT INTO competitors (id, workspace_id, name, domain, status)
        VALUES ('comp_stripe', 'ws_acme', 'Stripe', 'stripe.com', 'active')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO monitored_pages (id, competitor_id, url, label, frequency_minutes)
        VALUES
          ('mp_pricing', 'comp_stripe', 'https://stripe.com/pricing', 'Pricing', 360),
          ('mp_docs', 'comp_stripe', 'https://stripe.com/docs', 'Docs', 720)
      `,
    )
    .run();

  // Non-owners (Admin, Member, Viewer) cannot change subscription plans or billing intervals
  for (const userId of [
    "usr_admin",
    "usr_member",
    "usr_viewer",
  ]) {
    await assert.rejects(
      () =>
        changeWorkspaceSubscriptionPlan(db, {
          actorUserId: userId,
          workspaceId: "ws_acme",
          planId: "growth",
        }),
      /Only workspace Owners can manage billing and subscription plans/,
    );
  }

  // Owner upgrades workspace to Growth plan on annual billing
  const upgradeResult =
    await changeWorkspaceSubscriptionPlan(db, {
      actorUserId: "usr_owner",
      workspaceId: "ws_acme",
      planId: "growth",
      billingInterval: "annual",
    });

  assert.equal(upgradeResult.direction, "upgrade");
  assert.equal(
    upgradeResult.subscription.planId,
    "growth",
  );
  assert.equal(
    upgradeResult.subscription.billingInterval,
    "annual",
  );
  assert.equal(
    upgradeResult.entitlements.features.hourlyMonitoring,
    true,
  );
  assert.equal(
    upgradeResult.entitlements.limits
      .historyRetentionDays,
    90,
  );

  // Hourly frequency (60 min) is now allowed on Growth
  await assertWorkspaceMonitoringFrequencyAllowed(db, {
    workspaceId: "ws_acme",
    frequencyMinutes: 60,
  });

  sqlite
    .prepare(
      `
        UPDATE monitored_pages
        SET frequency_minutes = 60
        WHERE id = 'mp_pricing'
      `,
    )
    .run();

  // If workspace has 11 competitors, downgrading to Starter (10 limit) is blocked
  for (let i = 1; i <= 10; i++) {
    sqlite
      .prepare(
        `
          INSERT INTO competitors (id, workspace_id, name, domain, status)
          VALUES (?, 'ws_acme', ?, ?, 'active')
        `,
      )
      .run(
        `comp_extra_${i}`,
        `Extra ${i}`,
        `extra${i}.test`,
      );
  }

  await assert.rejects(
    () =>
      changeWorkspaceSubscriptionPlan(db, {
        actorUserId: "usr_owner",
        workspaceId: "ws_acme",
        planId: "starter",
      }),
    /currently tracks 11 competitors, which exceeds the Starter plan limit of 10/,
  );

  // Remove 2 extra competitors so total is 9 (within Starter's 10 limit)
  sqlite
    .prepare(
      `
        DELETE FROM competitors
        WHERE id IN ('comp_extra_9', 'comp_extra_10')
      `,
    )
    .run();

  // Downgrading from Growth to Starter succeeds and automatically normalizes mp_pricing from 60m to 360m
  const downgradeResult =
    await changeWorkspaceSubscriptionPlan(db, {
      actorUserId: "usr_owner",
      workspaceId: "ws_acme",
      planId: "starter",
    });

  assert.equal(downgradeResult.direction, "downgrade");
  assert.equal(
    downgradeResult.subscription.planId,
    "starter",
  );
  assert.equal(
    downgradeResult.adjustedPageFrequencies,
    1,
  );

  const pricingPageRow = sqlite
    .prepare(
      `
        SELECT frequency_minutes
        FROM monitored_pages
        WHERE id = 'mp_pricing'
      `,
    )
    .get();
  assert.equal(pricingPageRow.frequency_minutes, 360);

  // Switch billing cycle to monthly and verify currentPeriodStart and currentPeriodEnd are preserved
  const intervalSub =
    await updateWorkspaceBillingInterval(db, {
      actorUserId: "usr_owner",
      workspaceId: "ws_acme",
      billingInterval: "monthly",
    });
  assert.equal(intervalSub.billingInterval, "monthly");
  assert.equal(
    intervalSub.currentPeriodStart,
    downgradeResult.subscription.currentPeriodStart,
  );
  assert.equal(
    intervalSub.currentPeriodEnd,
    downgradeResult.subscription.currentPeriodEnd,
  );

  // Schedule cancellation at period end and then reactivate
  const scheduledCancel =
    await setWorkspaceSubscriptionCancellation(db, {
      actorUserId: "usr_owner",
      workspaceId: "ws_acme",
      cancelAtPeriodEnd: true,
    });
  assert.equal(
    scheduledCancel.subscription.cancelAtPeriodEnd,
    true,
  );
  assert.equal(
    scheduledCancel.subscription.status,
    "active",
  );

  const reactivated =
    await setWorkspaceSubscriptionCancellation(db, {
      actorUserId: "usr_owner",
      workspaceId: "ws_acme",
      cancelAtPeriodEnd: false,
    });
  assert.equal(
    reactivated.subscription.cancelAtPeriodEnd,
    false,
  );

  // Verify billing snapshot and audit log events
  const snapshot = await getWorkspaceBillingSnapshot(
    db,
    "usr_owner",
  );
  assert.equal(snapshot.subscription.planId, "starter");
  assert.equal(snapshot.planOptions.length, 5);
  assert.ok(snapshot.recentEvents.length >= 4);
  assert.equal(
    snapshot.recentEvents[0].eventType,
    "subscription_reactivated",
  );
});

test("THE-28.3: retention window and metered history counts reflect plan historyRetentionDays", async (t) => {
  const { db, sqlite } = createD1Fixture(t);

  sqlite
    .prepare(
      `
        INSERT INTO competitors (id, workspace_id, name, domain, status)
        VALUES ('comp_1', 'ws_acme', 'Linear', 'linear.app', 'active')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO monitored_pages (id, competitor_id, url, label, frequency_minutes)
        VALUES ('mp_1', 'comp_1', 'https://linear.app/pricing', 'Pricing', 360)
      `,
    )
    .run();

  const now = new Date();
  const tenDaysAgo = new Date(
    now.getTime() - 10 * 86400_000,
  ).toISOString();
  const sixtyDaysAgo = new Date(
    now.getTime() - 60 * 86400_000,
  ).toISOString();

  sqlite
    .prepare(
      `
        INSERT INTO snapshots (id, monitored_page_id, http_status, captured_at)
        VALUES
          ('snap_recent', 'mp_1', 200, ?),
          ('snap_60d', 'mp_1', 200, ?)
      `,
    )
    .run(tenDaysAgo, sixtyDaysAgo);

  sqlite
    .prepare(
      `
        INSERT INTO changes (
          id,
          monitored_page_id,
          current_snapshot_id,
          category,
          significance,
          summary,
          detected_at
        )
        VALUES
          ('chg_recent', 'mp_1', 'snap_recent', 'pricing', 'major', 'Recent change', ?),
          ('chg_60d', 'mp_1', 'snap_60d', 'pricing', 'moderate', '60-day old change', ?)
      `,
    )
    .run(tenDaysAgo, sixtyDaysAgo);

  // On Starter (30-day retention), the 60-day-old change & snapshot are outside the retention window
  const starterSnapshot =
    await getWorkspaceBillingSnapshot(db, "usr_owner");
  assert.equal(
    starterSnapshot.entitlements.limits
      .historyRetentionDays,
    30,
  );
  assert.equal(
    starterSnapshot.usage.outsideRetentionChanges,
    1,
  );
  assert.equal(
    starterSnapshot.usage.outsideRetentionSnapshots,
    1,
  );

  // Upgrading to Growth (90-day retention) brings the 60-day-old change & snapshot inside the retention window
  await changeWorkspaceSubscriptionPlan(db, {
    actorUserId: "usr_owner",
    workspaceId: "ws_acme",
    planId: "growth",
  });

  const growthSnapshot =
    await getWorkspaceBillingSnapshot(db, "usr_owner");
  assert.equal(
    growthSnapshot.entitlements.limits
      .historyRetentionDays,
    90,
  );
  assert.equal(
    growthSnapshot.usage.outsideRetentionChanges,
    0,
  );
  assert.equal(
    growthSnapshot.usage.outsideRetentionSnapshots,
    0,
  );

  const retentionWindow =
    await getWorkspaceRetentionWindow(db, "ws_acme", now);
  assert.equal(retentionWindow.retentionDays, 90);

  // Creating a new team workspace under an Owner on Growth inherits the Owner's Growth plan
  const newWs = await createTeamWorkspace(db, {
    userId: "usr_owner",
    name: "Second Workspace",
  });
  const newWsEntitlements =
    await getWorkspaceEntitlements(db, newWs.id);
  assert.equal(
    newWsEntitlements.effectivePlanId,
    "growth",
  );
  assert.equal(
    getBillingPlanDefinition(
      newWsEntitlements.effectivePlanId,
    ).name,
    "Growth",
  );

  // Changing plan on the second workspace updates all workspaces owned by usr_owner
  await changeWorkspaceSubscriptionPlan(db, {
    actorUserId: "usr_owner",
    workspaceId: newWs.id,
    planId: "scale",
    billingInterval: "annual",
  });
  const acmeAfterSiblingUpgrade =
    await getWorkspaceEntitlements(db, "ws_acme");
  assert.equal(
    acmeAfterSiblingUpgrade.effectivePlanId,
    "scale",
  );
  assert.equal(
    acmeAfterSiblingUpgrade.billingInterval,
    "annual",
  );

  // Creating a workspace for a user with no existing paid subscription provisions Free
  sqlite
    .prepare(
      `INSERT INTO users (id, email, name, email_verified) VALUES (?, ?, ?, 1)`,
    )
    .run("usr_fresh", "fresh@acme.com", "Fresh Owner");
  const freshWs = await createTeamWorkspace(db, {
    userId: "usr_fresh",
    name: "Fresh Workspace",
  });
  const freshWsEntitlements =
    await getWorkspaceEntitlements(db, freshWs.id);
  assert.equal(
    freshWsEntitlements.effectivePlanId,
    "free",
  );
  // Free plan allows 1 seat (the owner) and 0 external channels
  await assert.rejects(
    () =>
      assertWorkspaceTeamSeatCapacity(db, {
        workspaceId: freshWs.id,
      }),
    /reached the Free plan limit of 1 team seat/,
  );
  await assert.rejects(
    () =>
      assertWorkspaceExternalChannelCapacity(
        db,
        freshWs.id,
      ),
    /External notification channels are not included on the Free plan/,
  );
});

const POLAR_TEST_ORG_ID = "org_44001_test";
const POLAR_TEST_PRODUCTS = {
  personalMonthly: "prod_personal_monthly",
  personalAnnual: "prod_personal_annual",
  starterMonthly: "prod_starter_monthly",
  starterAnnual: "prod_starter_annual",
  growthMonthly: "prod_growth_monthly",
  growthAnnual: "prod_growth_annual",
  scaleMonthly: "prod_scale_monthly",
  scaleAnnual: "prod_scale_annual",
};

function createPolarTestEnv(db, overrides = {}) {
  return {
    DB: db,
    MORROW_APP_URL: "https://morrow.example.com",
    POLAR_ACCESS_TOKEN: "unit-test-billing-access-token",
    POLAR_ORGANIZATION_ID: POLAR_TEST_ORG_ID,
    POLAR_WEBHOOK_SECRET: "unit-test-billing-webhook-secret",
    POLAR_PERSONAL_MONTHLY_PRODUCT_ID:
      POLAR_TEST_PRODUCTS.personalMonthly,
    POLAR_PERSONAL_ANNUAL_PRODUCT_ID:
      POLAR_TEST_PRODUCTS.personalAnnual,
    POLAR_STARTER_MONTHLY_PRODUCT_ID:
      POLAR_TEST_PRODUCTS.starterMonthly,
    POLAR_STARTER_ANNUAL_PRODUCT_ID:
      POLAR_TEST_PRODUCTS.starterAnnual,
    POLAR_GROWTH_MONTHLY_PRODUCT_ID:
      POLAR_TEST_PRODUCTS.growthMonthly,
    POLAR_GROWTH_ANNUAL_PRODUCT_ID:
      POLAR_TEST_PRODUCTS.growthAnnual,
    POLAR_SCALE_MONTHLY_PRODUCT_ID:
      POLAR_TEST_PRODUCTS.scaleMonthly,
    POLAR_SCALE_ANNUAL_PRODUCT_ID:
      POLAR_TEST_PRODUCTS.scaleAnnual,
    ...overrides,
  };
}

/** Builds a Polar Subscription object as returned by the API and embedded in webhooks. */
function polarSubscription(overrides = {}) {
  const productId =
    overrides.product_id ?? POLAR_TEST_PRODUCTS.starterMonthly;
  return {
    id: "sub_88001_test",
    created_at: "2026-10-01T00:00:00.000Z",
    modified_at: "2026-10-14T12:00:00.000Z",
    status: "active",
    cancel_at_period_end: false,
    customer_id: "cus_501_test",
    product_id: productId,
    current_period_end: "2026-11-14T00:00:00.000Z",
    ends_at: null,
    ended_at: null,
    trial_end: null,
    metadata: {},
    product: {
      id: productId,
      organization_id: POLAR_TEST_ORG_ID,
    },
    ...overrides,
  };
}

function polarEventBody(type, subscription) {
  return JSON.stringify({
    type,
    timestamp: new Date().toISOString(),
    data: subscription,
  });
}

function polarWebhookParts(env, rawBody, id = "msg_test_1") {
  const webhookTimestamp = String(
    Math.floor(Date.now() / 1000),
  );
  return {
    rawBody,
    webhookId: id,
    webhookTimestamp,
    signatureHeader: computePolarSignature(
      rawBody,
      env.POLAR_WEBHOOK_SECRET,
      id,
      webhookTimestamp,
    ),
  };
}

function polarWebhookRequest(env, rawBody, id = "msg_test_1") {
  const parts = polarWebhookParts(env, rawBody, id);
  return new Request(
    "https://morrow.example.com/api/webhooks/polar",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "webhook-id": parts.webhookId,
        "webhook-timestamp": parts.webhookTimestamp,
        "webhook-signature": parts.signatureHeader,
      },
      body: rawBody,
    },
  );
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

test("THE-28.5: Polar config validation, placeholder rejection, duplicate product guard, and Standard Webhooks HMAC-SHA256 signature verification", () => {
  assert.equal(
    isPlaceholderEnvValue("your_polar_access_token"),
    true,
  );
  assert.equal(
    isPlaceholderEnvValue("replace_with_webhook_secret"),
    true,
  );
  assert.equal(
    isPlaceholderEnvValue("<paste_key_here>"),
    true,
  );
  assert.equal(
    isPlaceholderEnvValue("unit-test-billing-access-token"),
    false,
  );

  // Placeholder values in .env.local must never be accepted as live secrets
  const placeholderConfig = resolvePolarConfig({
    POLAR_ACCESS_TOKEN: "your_polar_access_token",
    POLAR_ORGANIZATION_ID: "your_polar_organization_id",
    POLAR_WEBHOOK_SECRET: "your_polar_webhook_secret",
    POLAR_PERSONAL_MONTHLY_PRODUCT_ID:
      "your_personal_monthly_product_id",
    POLAR_GROWTH_MONTHLY_PRODUCT_ID:
      "your_growth_monthly_product_id",
  });
  assert.equal(placeholderConfig.isConfigured, false);
  assert.equal(placeholderConfig.accessToken, null);
  assert.equal(placeholderConfig.organizationId, null);
  assert.equal(placeholderConfig.webhookSecret, null);

  // Duplicate product IDs across plans must throw to prevent product confusion
  assert.throws(
    () =>
      resolvePolarConfig({
        POLAR_ACCESS_TOKEN: "unit-test-billing-access-token",
        POLAR_ORGANIZATION_ID: POLAR_TEST_ORG_ID,
        POLAR_WEBHOOK_SECRET: "unit-test-billing-webhook-secret",
        POLAR_GROWTH_MONTHLY_PRODUCT_ID: "prod_shared_id_1",
        POLAR_SCALE_MONTHLY_PRODUCT_ID: "prod_shared_id_1",
      }),
    /Duplicate Polar product ID \(prod_shared_id_1\)/,
  );

  // Malformed organization or product IDs must throw
  assert.throws(
    () =>
      resolvePolarConfig({
        POLAR_ORGANIZATION_ID: "not a valid id!",
      }),
    /POLAR_ORGANIZATION_ID must be a valid Polar ID/,
  );

  // Unknown server names must throw; sandbox switches the API base URL
  assert.throws(
    () => resolvePolarConfig({ POLAR_SERVER: "staging" }),
    /POLAR_SERVER must be either/,
  );
  assert.equal(
    resolvePolarConfig({ POLAR_SERVER: "sandbox" })
      .apiBaseUrl,
    "https://sandbox-api.polar.sh/v1",
  );
  assert.equal(
    resolvePolarConfig({}).apiBaseUrl,
    "https://api.polar.sh/v1",
  );

  const validConfig = resolvePolarConfig(
    createPolarTestEnv(null),
  );
  assert.equal(validConfig.isConfigured, true);
  assert.deepEqual(
    resolvePlanFromProductId(
      validConfig,
      POLAR_TEST_PRODUCTS.personalMonthly,
    ),
    {
      planId: "personal",
      billingInterval: "monthly",
    },
  );
  assert.deepEqual(
    resolvePlanFromProductId(
      validConfig,
      POLAR_TEST_PRODUCTS.growthAnnual,
    ),
    {
      planId: "growth",
      billingInterval: "annual",
    },
  );
  assert.equal(
    resolvePlanFromProductId(validConfig, "prod_unknown"),
    null,
  );

  // Standard Webhooks signature verification
  const rawBody = polarEventBody(
    "subscription.created",
    polarSubscription({ id: "sub_7001_test" }),
  );
  const secret = "unit-test-billing-webhook-secret";
  const webhookId = "msg_sig_test";
  const webhookTimestamp = String(
    Math.floor(Date.now() / 1000),
  );
  const validSig = computePolarSignature(
    rawBody,
    secret,
    webhookId,
    webhookTimestamp,
  );
  const base = {
    rawBody,
    webhookId,
    webhookTimestamp,
    signatureHeader: validSig,
    webhookSecret: secret,
  };

  assert.equal(verifyPolarWebhookSignature(base), true);

  // Multiple space-delimited signatures: any valid one is accepted
  assert.equal(
    verifyPolarWebhookSignature({
      ...base,
      signatureHeader: `v1,AAAA ${validSig}`,
    }),
    true,
  );

  // Tampered payload fails verification
  assert.equal(
    verifyPolarWebhookSignature({
      ...base,
      rawBody: rawBody.replace("sub_7001_test", "sub_7002_test"),
    }),
    false,
  );

  // A different webhook-id or timestamp invalidates the signature
  assert.equal(
    verifyPolarWebhookSignature({
      ...base,
      webhookId: "msg_other",
    }),
    false,
  );

  // Stale (replayed) timestamps are rejected even with a valid signature
  const oldTimestamp = String(
    Math.floor(Date.now() / 1000) - 3600,
  );
  assert.equal(
    verifyPolarWebhookSignature({
      ...base,
      webhookTimestamp: oldTimestamp,
      signatureHeader: computePolarSignature(
        rawBody,
        secret,
        webhookId,
        oldTimestamp,
      ),
    }),
    false,
  );

  // Wrong secret, placeholder secret, or malformed signature fails verification
  assert.equal(
    verifyPolarWebhookSignature({
      ...base,
      webhookSecret: "unit-test-wrong-webhook-secret",
    }),
    false,
  );
  assert.equal(
    verifyPolarWebhookSignature({
      ...base,
      signatureHeader: computePolarSignature(
        rawBody,
        "your_polar_webhook_secret",
        webhookId,
        webhookTimestamp,
      ),
      webhookSecret: "your_polar_webhook_secret",
    }),
    false,
  );
  assert.equal(
    verifyPolarWebhookSignature({
      ...base,
      signatureHeader: "not-a-signature",
    }),
    false,
  );
  assert.equal(
    verifyPolarWebhookSignature({
      ...base,
      signatureHeader: null,
    }),
    false,
  );
});

test("THE-28.5: prevents payment bypass on checkout initiation, reuses pending checkouts on double-click, and blocks open-redirect URLs", async (t) => {
  const { db, sqlite } = createD1Fixture(t);
  const env = createPolarTestEnv(db);

  let checkoutApiCalls = 0;
  const mockFetcher = async (url, init) => {
    checkoutApiCalls += 1;
    assert.equal(url, "https://api.polar.sh/v1/checkouts/");
    assert.equal(init.method, "POST");
    assert.equal(
      init.headers.Authorization,
      "Bearer unit-test-billing-access-token",
    );
    const body = JSON.parse(init.body);
    assert.deepEqual(body.products, [
      POLAR_TEST_PRODUCTS.growthAnnual,
    ]);
    assert.equal(
      body.success_url,
      "https://morrow.example.com/dashboard/billing?checkout=completed",
    );
    assert.equal(body.customer_email, "owner@acme.test");
    assert.equal(body.metadata.workspace_id, "ws_acme");
    assert.equal(body.metadata.target_plan_id, "growth");

    return jsonResponse(
      {
        id: "chk_live_101",
        url: "https://buy.polar.sh/polar_cl_chk_live_101",
      },
      201,
    );
  };

  // Non-owners cannot initiate Polar checkout
  await assert.rejects(
    () =>
      initiateOrUpdateWorkspaceSubscription(
        env,
        {
          actorUserId: "usr_admin",
          workspaceId: "ws_acme",
          planId: "growth",
          billingInterval: "annual",
        },
        mockFetcher,
      ),
    /Only workspace Owners can manage billing/,
  );

  // Owner initiates upgrade to Growth (annual)
  const firstCheckout =
    await initiateOrUpdateWorkspaceSubscription(
      env,
      {
        actorUserId: "usr_owner",
        actorEmail: "owner@acme.test",
        actorName: "Alice Owner",
        workspaceId: "ws_acme",
        planId: "growth",
        billingInterval: "annual",
      },
      mockFetcher,
    );

  assert.equal(firstCheckout.mode, "checkout_redirect");
  assert.equal(
    firstCheckout.checkoutUrl,
    "https://buy.polar.sh/polar_cl_chk_live_101",
  );
  assert.equal(checkoutApiCalls, 1);

  // CRITICAL SECURITY CHECK: Initiating checkout MUST NOT upgrade the workspace in D1 before payment!
  const subBeforeWebhook = await getWorkspaceSubscription(
    db,
    "ws_acme",
  );
  assert.equal(subBeforeWebhook.planId, "starter");
  const entitlementsBeforeWebhook =
    await getWorkspaceEntitlements(db, "ws_acme");
  assert.equal(
    entitlementsBeforeWebhook.effectivePlanId,
    "starter",
  );
  assert.equal(
    entitlementsBeforeWebhook.features.hourlyMonitoring,
    false,
  );

  // Rapid double-click / retry within 10 minutes reuses the existing pending checkout session
  // instead of creating duplicate checkouts on Polar
  const secondCheckout =
    await initiateOrUpdateWorkspaceSubscription(
      env,
      {
        actorUserId: "usr_owner",
        actorEmail: "owner@acme.test",
        actorName: "Alice Owner",
        workspaceId: "ws_acme",
        planId: "growth",
        billingInterval: "annual",
      },
      mockFetcher,
    );
  assert.equal(secondCheckout.mode, "checkout_redirect");
  assert.equal(
    secondCheckout.checkoutSessionId,
    firstCheckout.checkoutSessionId,
  );
  assert.equal(checkoutApiCalls, 1);

  // Rejects open-redirect / non-polar.sh checkout URLs
  sqlite
    .prepare(
      `DELETE FROM workspace_checkout_sessions WHERE workspace_id = 'ws_acme'`,
    )
    .run();

  await assert.rejects(
    () =>
      initiateOrUpdateWorkspaceSubscription(
        env,
        {
          actorUserId: "usr_owner",
          workspaceId: "ws_acme",
          planId: "scale",
          billingInterval: "monthly",
        },
        async () =>
          jsonResponse(
            {
              id: "chk_evil",
              url: "https://evil-phishing.example.com/checkout",
            },
            201,
          ),
      ),
    /must point to an official polar\.sh domain/,
  );

  // A look-alike host that merely ends with "polar.sh" is rejected too
  await assert.rejects(
    () =>
      initiateOrUpdateWorkspaceSubscription(
        env,
        {
          actorUserId: "usr_owner",
          workspaceId: "ws_acme",
          planId: "scale",
          billingInterval: "monthly",
        },
        async () =>
          jsonResponse(
            {
              id: "chk_evil_2",
              url: "https://evilpolar.sh/checkout",
            },
            201,
          ),
      ),
    /must point to an official polar\.sh domain/,
  );
});

test("THE-28.5: webhook security, plan-spoofing defense, idempotency under replay, cross-workspace hijack prevention, and out-of-order race condition protection", async (t) => {
  const { db, sqlite } = createD1Fixture(t);
  const env = createPolarTestEnv(db);
  const webhookHandler = createPolarWebhookHandler(env);

  // Create a workspace owned by a different user (usr_admin) to test cross-account workspace hijack protection
  await createTeamWorkspace(db, {
    userId: "usr_admin",
    name: "Second Org",
  });
  const secondWsRow = sqlite
    .prepare(
      `SELECT id FROM workspaces WHERE id != 'ws_acme' LIMIT 1`,
    )
    .get();
  const secondWorkspaceId = secondWsRow.id;

  // 1. Forged signature -> 401 Unauthorized
  const forgedRes = await webhookHandler(
    new Request(
      "https://morrow.example.com/api/webhooks/polar",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "webhook-id": "msg_forged",
          "webhook-timestamp": String(
            Math.floor(Date.now() / 1000),
          ),
          "webhook-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        },
        body: polarEventBody(
          "subscription.created",
          polarSubscription({ id: "sub_9001_test" }),
        ),
      },
    ),
  );
  assert.equal(forgedRes.status, 401);

  // 1b. Missing signature headers -> 401 Unauthorized
  const unsignedRes = await webhookHandler(
    new Request(
      "https://morrow.example.com/api/webhooks/polar",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: polarEventBody(
          "subscription.created",
          polarSubscription({ id: "sub_9002_test" }),
        ),
      },
    ),
  );
  assert.equal(unsignedRes.status, 401);

  // 2. Product vs metadata plan-spoofing attack:
  // Attacker pays for Starter Monthly but sets metadata.target_plan_id = "scale".
  // Server MUST provision Starter Monthly based on product_id and ignore metadata.target_plan_id!
  const spoofPayload = polarEventBody(
    "subscription.created",
    polarSubscription({
      id: "sub_88001_test",
      product_id: POLAR_TEST_PRODUCTS.starterMonthly,
      metadata: {
        workspace_id: "ws_acme",
        actor_user_id: "usr_owner",
        target_plan_id: "scale",
        billing_interval: "annual",
      },
    }),
  );

  const spoofRes = await webhookHandler(
    polarWebhookRequest(env, spoofPayload, "msg_spoof"),
  );
  assert.equal(spoofRes.status, 200);

  const subAfterSpoofAttempt = await getWorkspaceSubscription(
    db,
    "ws_acme",
  );
  assert.equal(subAfterSpoofAttempt.planId, "starter");
  assert.equal(
    subAfterSpoofAttempt.billingInterval,
    "monthly",
  );
  assert.equal(
    subAfterSpoofAttempt.providerSubscriptionId,
    "sub_88001_test",
  );

  // 2b. Subscriptions from a different Polar organization are rejected
  const foreignOrgPayload = polarEventBody(
    "subscription.updated",
    polarSubscription({
      id: "sub_88001_test",
      product: {
        id: POLAR_TEST_PRODUCTS.scaleAnnual,
        organization_id: "org_someone_else",
      },
      product_id: POLAR_TEST_PRODUCTS.scaleAnnual,
      metadata: { workspace_id: "ws_acme" },
    }),
  );
  const foreignOrgRes = await webhookHandler(
    polarWebhookRequest(env, foreignOrgPayload, "msg_foreign"),
  );
  assert.equal(foreignOrgRes.status, 400);

  // 2c. Unpaid (incomplete) subscriptions and unrelated events are ignored
  const incompleteResult = await processPolarWebhook(
    env,
    polarWebhookParts(
      env,
      polarEventBody(
        "subscription.created",
        polarSubscription({
          id: "sub_88002_test",
          status: "incomplete",
          metadata: { workspace_id: "ws_acme" },
        }),
      ),
      "msg_incomplete",
    ),
  );
  assert.equal(incompleteResult.outcome, "ignored_event");
  const ignoredEventResult = await processPolarWebhook(
    env,
    polarWebhookParts(
      env,
      JSON.stringify({ type: "order.paid", data: {} }),
      "msg_order",
    ),
  );
  assert.equal(ignoredEventResult.outcome, "ignored_event");

  // 3. Replay / duplicate delivery protection:
  // Sending the exact same signed webhook again returns outcome: "duplicate" without adding duplicate billing events.
  const eventsBeforeReplay = sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM workspace_billing_events WHERE workspace_id = 'ws_acme'`,
    )
    .get().count;

  const replayResult = await processPolarWebhook(
    env,
    polarWebhookParts(env, spoofPayload, "msg_spoof"),
  );
  assert.equal(replayResult.outcome, "duplicate");

  const eventsAfterReplay = sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM workspace_billing_events WHERE workspace_id = 'ws_acme'`,
    )
    .get().count;
  assert.equal(eventsAfterReplay, eventsBeforeReplay);

  // 4. Cross-workspace subscription hijacking attempt:
  // Trying to bind subscription "sub_88001_test" (already bound to ws_acme) to secondWorkspaceId is rejected with 409!
  const hijackPayload = polarEventBody(
    "subscription.updated",
    polarSubscription({
      id: "sub_88001_test",
      product_id: POLAR_TEST_PRODUCTS.scaleAnnual,
      modified_at: "2026-10-14T12:05:00.000Z",
      metadata: { workspace_id: secondWorkspaceId },
    }),
  );

  const hijackRes = await webhookHandler(
    polarWebhookRequest(env, hijackPayload, "msg_hijack"),
  );
  assert.equal(hijackRes.status, 409);

  // Verify secondWorkspaceId was NOT upgraded (remains on default Free tier)
  const secondWsSub = await getWorkspaceSubscription(
    db,
    secondWorkspaceId,
  );
  assert.equal(secondWsSub.planId, "free");
  assert.equal(secondWsSub.providerSubscriptionId, null);

  // 5. Out-of-order webhook race condition:
  // Newer webhook (Scale Annual, modified_at 12:20:00Z) arrives BEFORE older webhook (Growth Monthly, modified_at 12:10:00Z).
  const newerScalePayload = polarEventBody(
    "subscription.updated",
    polarSubscription({
      id: "sub_88001_test",
      product_id: POLAR_TEST_PRODUCTS.scaleAnnual,
      current_period_end: "2027-10-14T00:00:00.000Z",
      modified_at: "2026-10-14T12:20:00.000Z",
      metadata: { workspace_id: "ws_acme" },
    }),
  );

  const olderGrowthPayload = polarEventBody(
    "subscription.updated",
    polarSubscription({
      id: "sub_88001_test",
      product_id: POLAR_TEST_PRODUCTS.growthMonthly, // stale!
      modified_at: "2026-10-14T12:10:00.000Z",
      metadata: { workspace_id: "ws_acme" },
    }),
  );

  const newerResult = await processPolarWebhook(
    env,
    polarWebhookParts(env, newerScalePayload, "msg_newer"),
  );
  assert.equal(newerResult.outcome, "processed");
  assert.equal(newerResult.planId, "scale");

  // Now the delayed older webhook arrives — it MUST be ignored as stale and NOT overwrite Scale!
  const staleResult = await processPolarWebhook(
    env,
    polarWebhookParts(env, olderGrowthPayload, "msg_older"),
  );
  assert.equal(staleResult.outcome, "ignored_stale");

  const subAfterStaleWebhook = await getWorkspaceSubscription(
    db,
    "ws_acme",
  );
  assert.equal(subAfterStaleWebhook.planId, "scale");
  assert.equal(
    subAfterStaleWebhook.billingInterval,
    "annual",
  );
});

test("THE-28.5: active Polar subscription upgrades, failed-payment upgrade block, cancellation grace period, and post-expiry fallback to Free", async (t) => {
  const { db, sqlite } = createD1Fixture(t);
  const polarEnv = createPolarTestEnv(db, {
    POLAR_CUSTOMER_PORTAL_URL:
      "https://polar.sh/morrow/portal",
  });

  // Seed ws_acme with an active Growth Monthly subscription on Polar
  sqlite
    .prepare(
      `
        UPDATE workspace_subscriptions
        SET
          plan_id = 'growth',
          status = 'active',
          billing_interval = 'monthly',
          provider_subscription_id = 'sub_99001_test',
          provider_variant_id = '${POLAR_TEST_PRODUCTS.growthMonthly}',
          provider_status = 'active',
          current_period_end = '2026-11-14T00:00:00.000Z'
        WHERE workspace_id = 'ws_acme'
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO competitors (id, workspace_id, name, domain, status)
        VALUES ('comp_1', 'ws_acme', 'Acme Rival', 'rival.test', 'active')
      `,
    )
    .run();
  sqlite
    .prepare(
      `
        INSERT INTO monitored_pages (id, competitor_id, url, label, frequency_minutes, include_selectors_json, ignore_selectors_json)
        VALUES ('mp_fast', 'comp_1', 'https://rival.test/pricing', 'Pricing', 60, '[".pricing-tier"]', '[".cookie-banner"]')
      `,
    )
    .run();

  // 1. If Polar reports the subscription is past_due when attempting an upgrade,
  // the upgrade is blocked so unpaid accounts cannot upgrade to Scale!
  await assert.rejects(
    () =>
      initiateOrUpdateWorkspaceSubscription(
        polarEnv,
        {
          actorUserId: "usr_owner",
          workspaceId: "ws_acme",
          planId: "scale",
          billingInterval: "monthly",
        },
        async () =>
          jsonResponse(
            polarSubscription({
              id: "sub_99001_test",
              product_id: POLAR_TEST_PRODUCTS.growthMonthly,
              status: "past_due",
            }),
          ),
      ),
    /past-due payment/,
  );

  // 2. Valid in-place upgrade from Growth Monthly to Scale Annual
  // verifies GET + PATCH with proration_behavior: "invoice"
  const requests = [];
  const upgradeResult =
    await initiateOrUpdateWorkspaceSubscription(
      polarEnv,
      {
        actorUserId: "usr_owner",
        workspaceId: "ws_acme",
        planId: "scale",
        billingInterval: "annual",
      },
      async (url, init) => {
        requests.push({
          url,
          method: init?.method,
          body: init?.body ? JSON.parse(init.body) : null,
        });
        if (init?.method === "GET") {
          return jsonResponse(
            polarSubscription({
              id: "sub_99001_test",
              product_id: POLAR_TEST_PRODUCTS.growthMonthly,
            }),
          );
        }

        return jsonResponse(
          polarSubscription({
            id: "sub_99001_test",
            customer_id: "cus_777_test",
            product_id: POLAR_TEST_PRODUCTS.scaleAnnual,
            current_period_end: "2027-10-14T00:00:00.000Z",
            modified_at: "2026-10-14T15:00:00.000Z",
          }),
        );
      },
    );

  const patchRequest = requests.find(
    (request) => request.method === "PATCH",
  );
  assert.equal(
    patchRequest.url,
    "https://api.polar.sh/v1/subscriptions/sub_99001_test",
  );
  assert.equal(upgradeResult.mode, "updated_in_place");
  assert.equal(
    patchRequest.body.product_id,
    POLAR_TEST_PRODUCTS.scaleAnnual,
  );
  assert.equal(patchRequest.body.proration_behavior, "invoice");
  assert.equal(upgradeResult.subscription.planId, "scale");
  assert.equal(
    upgradeResult.subscription.billingInterval,
    "annual",
  );
  assert.equal(
    upgradeResult.subscription.providerCustomerPortalUrl,
    "https://polar.sh/morrow/portal",
  );

  // 2b. A PATCH response that does not confirm the requested product is rejected
  await assert.rejects(
    () =>
      initiateOrUpdateWorkspaceSubscription(
        polarEnv,
        {
          actorUserId: "usr_owner",
          workspaceId: "ws_acme",
          planId: "growth",
          billingInterval: "annual",
        },
        async () =>
          jsonResponse(
            polarSubscription({
              id: "sub_99001_test",
              product_id: POLAR_TEST_PRODUCTS.scaleAnnual,
              current_period_end: "2027-10-14T00:00:00.000Z",
            }),
          ),
      ),
    /did not confirm/,
  );

  // 3. Schedule cancellation at period end via Polar API
  const cancelRequests = [];
  const cancelResult =
    await updateWorkspaceSubscriptionCancellationWithPolar(
      polarEnv,
      {
        actorUserId: "usr_owner",
        workspaceId: "ws_acme",
        cancelAtPeriodEnd: true,
      },
      async (url, init) => {
        cancelRequests.push({
          method: init?.method,
          body: init?.body ? JSON.parse(init.body) : null,
        });
        return jsonResponse(
          polarSubscription({
            id: "sub_99001_test",
            product_id: POLAR_TEST_PRODUCTS.scaleAnnual,
            cancel_at_period_end: init?.method === "PATCH",
            current_period_end: "2027-10-14T00:00:00.000Z",
            ends_at:
              init?.method === "PATCH"
                ? "2027-10-14T00:00:00.000Z"
                : null,
            modified_at: "2026-10-14T15:05:00.000Z",
          }),
        );
      },
    );

  assert.deepEqual(
    cancelRequests.find((request) => request.method === "PATCH")
      .body,
    { cancel_at_period_end: true },
  );
  assert.equal(
    cancelResult.subscription.cancelAtPeriodEnd,
    true,
  );
  assert.equal(cancelResult.subscription.status, "active");
  assert.equal(
    cancelResult.entitlements.effectivePlanId,
    "scale",
  );

  // 4. Grace-period expiry loophole check:
  // If current_period_end is in the past, entitlements immediately fall back to Free even before webhook arrives,
  // and attempting to reactivate an expired subscription without a new checkout is blocked!
  sqlite
    .prepare(
      `
        UPDATE workspace_subscriptions
        SET current_period_end = '2020-01-01T00:00:00.000Z'
        WHERE workspace_id = 'ws_acme'
      `,
    )
    .run();

  const expiredEntitlements = await getWorkspaceEntitlements(
    db,
    "ws_acme",
  );
  assert.equal(
    expiredEntitlements.subscriptionStatus,
    "canceled",
  );
  assert.equal(expiredEntitlements.effectivePlanId, "free");

  await assert.rejects(
    () =>
      setWorkspaceSubscriptionCancellation(db, {
        actorUserId: "usr_owner",
        workspaceId: "ws_acme",
        cancelAtPeriodEnd: false,
      }),
    /already expired or been canceled/,
  );

  await assert.rejects(
    () =>
      updateWorkspaceSubscriptionCancellationWithPolar(
        polarEnv,
        {
          actorUserId: "usr_owner",
          workspaceId: "ws_acme",
          cancelAtPeriodEnd: false,
        },
      ),
    /already expired/,
  );

  // 5. When subscription.revoked webhook arrives, plan_id resets to 'free', hourly pages normalize to 1440m, and custom CSS selectors are cleared
  const revokedWebhookPayload = polarEventBody(
    "subscription.revoked",
    polarSubscription({
      id: "sub_99001_test",
      product_id: POLAR_TEST_PRODUCTS.scaleAnnual,
      status: "canceled",
      cancel_at_period_end: false,
      ends_at: "2026-10-14T16:00:00.000Z",
      ended_at: "2026-10-14T16:00:00.000Z",
      modified_at: "2026-10-14T16:00:00.000Z",
      metadata: { workspace_id: "ws_acme" },
    }),
  );

  const revokedResult = await processPolarWebhook(
    polarEnv,
    polarWebhookParts(polarEnv, revokedWebhookPayload, "msg_revoked"),
  );
  assert.equal(revokedResult.outcome, "processed");
  assert.equal(revokedResult.planId, "free");
  assert.equal(revokedResult.status, "canceled");

  const pageAfterExpiry = sqlite
    .prepare(
      `SELECT frequency_minutes, include_selectors_json, ignore_selectors_json FROM monitored_pages WHERE id = 'mp_fast'`,
    )
    .get();
  assert.equal(pageAfterExpiry.frequency_minutes, 1440);
  assert.equal(pageAfterExpiry.include_selectors_json, "[]");
  assert.equal(pageAfterExpiry.ignore_selectors_json, "[]");
});

test("THE-28.5: atomic billing mutation lock and post-insert TOCTOU race condition guards", async (t) => {
  const { db, sqlite } = createD1Fixture(t);

  // 1. Concurrent billing lock prevents overlapping billing mutations on the same workspace
  const lockId = await acquireWorkspaceBillingLock(db, {
    workspaceId: "ws_acme",
    leaseDurationMs: 30_000,
  });

  await assert.rejects(
    () =>
      acquireWorkspaceBillingLock(db, {
        workspaceId: "ws_acme",
        leaseDurationMs: 30_000,
      }),
    /Another billing operation is already in progress/,
  );

  await releaseWorkspaceBillingLock(db, {
    workspaceId: "ws_acme",
    lockId,
  });

  const secondLockId = await acquireWorkspaceBillingLock(
    db,
    {
      workspaceId: "ws_acme",
      leaseDurationMs: 30_000,
    },
  );
  await releaseWorkspaceBillingLock(db, {
    workspaceId: "ws_acme",
    lockId: secondLockId,
  });

  // 2. Post-insert TOCTOU competitor guard:
  // If 11 competitors are inserted concurrently on Starter (limit 10), the 11th is automatically rolled back
  for (let i = 1; i <= 11; i++) {
    sqlite
      .prepare(
        `
          INSERT INTO competitors (id, workspace_id, name, domain, status)
          VALUES (?, 'ws_acme', ?, ?, 'active')
        `,
      )
      .run(`comp_race_${i}`, `Race ${i}`, `race${i}.test`);
  }

  await assert.rejects(
    () =>
      enforceCompetitorCapacityAfterInsert(db, {
        workspaceId: "ws_acme",
        competitorId: "comp_race_11",
      }),
    /reached the Starter plan limit of 10 competitors/,
  );

  const remainingCompetitors = sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM competitors WHERE workspace_id = 'ws_acme'`,
    )
    .get().count;
  assert.equal(remainingCompetitors, 10);

  // 3. Post-insert TOCTOU monitored page guard (rolls back 11th page on a single competitor on Starter)
  for (let i = 1; i <= 11; i++) {
    sqlite
      .prepare(
        `
          INSERT INTO monitored_pages (id, competitor_id, url, label, frequency_minutes)
          VALUES (?, 'comp_race_1', ?, ?, 360)
        `,
      )
      .run(
        `mp_race_${i}`,
        `https://race1.test/p${i}`,
        `P${i}`,
      );
  }

  await assert.rejects(
    () =>
      enforceMonitoredPageCapacityAfterInsert(db, {
        workspaceId: "ws_acme",
        competitorId: "comp_race_1",
        pageId: "mp_race_11",
      }),
    /reached the Starter plan limit of 10 monitored pages per competitor/,
  );

  const remainingPages = sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM monitored_pages WHERE competitor_id = 'comp_race_1'`,
    )
    .get().count;
  assert.equal(remainingPages, 10);

  // 4. Post-insert TOCTOU team seat guard (rolls back 6th seat on Starter)
  for (let i = 1; i <= 2; i++) {
    sqlite
      .prepare(
        `
          INSERT INTO workspace_invitations (id, workspace_id, email, role, invited_by, status)
          VALUES (?, 'ws_acme', ?, 'member', 'usr_owner', 'pending')
        `,
      )
      .run(`inv_race_${i}`, `race${i}@acme.test`);
  }

  await assert.rejects(
    () =>
      enforceTeamSeatCapacityAfterInsert(db, {
        workspaceId: "ws_acme",
        invitationId: "inv_race_2",
      }),
    /reached the Starter plan limit of 5 team seats/,
  );

  const remainingInvites = sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM workspace_invitations WHERE workspace_id = 'ws_acme' AND status = 'pending'`,
    )
    .get().count;
  assert.equal(remainingInvites, 1); // 4 members + 1 invite = 5 seats

  // 5. Post-insert TOCTOU external channel guard (rolls back 4th channel on Starter)
  for (let i = 1; i <= 4; i++) {
    sqlite
      .prepare(
        `
          INSERT INTO external_notification_channels (
            id, workspace_id, channel, name, status, config_json
          )
          VALUES (?, 'ws_acme', 'slack', ?, 'active', '{"webhookUrl":"https://hooks.slack.com/services/T/B/S"}')
        `,
      )
      .run(`ch_race_${i}`, `Race Slack ${i}`);
  }

  await assert.rejects(
    () =>
      enforceExternalChannelCapacityAfterInsert(db, {
        workspaceId: "ws_acme",
        channelId: "ch_race_4",
      }),
    /reached the Starter plan limit of 3 external notification channels/,
  );

  const remainingChannels = sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM external_notification_channels WHERE workspace_id = 'ws_acme'`,
    )
    .get().count;
  assert.equal(remainingChannels, 3);
});

test("THE-28.6: enforces Free & Personal tier limits, workspace creation caps, CSS selector gating & downgrade clearing, digest period gating, and pending invite acceptance guards", async (t) => {
  const { db, sqlite } = createD1Fixture(t);

  // Reduce ws_acme to 1 owner so we can test Personal and Free transitions cleanly
  sqlite
    .prepare(
      `DELETE FROM workspace_members WHERE workspace_id = 'ws_acme' AND user_id != 'usr_owner'`,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO competitors (id, workspace_id, name, domain, status)
        VALUES ('comp_solo', 'ws_acme', 'Solo Rival', 'solorival.test', 'active')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO monitored_pages (id, competitor_id, url, label, frequency_minutes, include_selectors_json, ignore_selectors_json)
        VALUES ('mp_solo', 'comp_solo', 'https://solorival.test/pricing', 'Pricing', 360, '[".price-card"]', '[".cookie-banner"]')
      `,
    )
    .run();

  // 1. On Starter, section-level CSS selector monitoring and daily/weekly/monthly digests are allowed
  await assertWorkspaceSectionLevelMonitoringAllowed(db, {
    workspaceId: "ws_acme",
    includeSelectors: [".price-card"],
    ignoreSelectors: [],
  });
  await assertWorkspaceDigestScheduleAllowed(db, {
    workspaceId: "ws_acme",
    enabled: true,
    digestPeriods: ["daily", "weekly", "monthly"],
  });

  // 2. Downgrading from Starter to Personal ($5/mo):
  // - Automatically normalizes 360m page to 720m (12h)
  // - Automatically clears custom CSS selector rules (since Personal does not include sectionLevelMonitoring)
  const personalDowngrade =
    await changeWorkspaceSubscriptionPlan(db, {
      actorUserId: "usr_owner",
      workspaceId: "ws_acme",
      planId: "personal",
    });
  assert.equal(personalDowngrade.direction, "downgrade");
  assert.equal(
    personalDowngrade.subscription.planId,
    "personal",
  );
  assert.equal(
    personalDowngrade.adjustedPageFrequencies,
    1,
  );
  assert.equal(personalDowngrade.adjustedSelectorPages, 1);

  const pageOnPersonal = sqlite
    .prepare(
      `SELECT frequency_minutes, include_selectors_json, ignore_selectors_json FROM monitored_pages WHERE id = 'mp_solo'`,
    )
    .get();
  assert.equal(pageOnPersonal.frequency_minutes, 720);
  assert.equal(pageOnPersonal.include_selectors_json, "[]");
  assert.equal(pageOnPersonal.ignore_selectors_json, "[]");

  // 3. On Personal, section-level CSS selector monitoring is blocked
  await assert.rejects(
    () =>
      assertWorkspaceSectionLevelMonitoringAllowed(db, {
        workspaceId: "ws_acme",
        includeSelectors: [".price-card"],
        ignoreSelectors: [],
      }),
    /Section-level CSS selector monitoring is not available on the Personal plan/,
  );

  // 4. On Personal, weekly digests are allowed, but daily and monthly digests are rejected!
  await saveUserEmailNotificationPreferences(db, {
    userId: "usr_owner",
    emailEnabled: true,
    digestEmailEnabled: true,
    minSignificance: "moderate",
    categories: [],
    competitorIds: [],
    digestPeriods: ["weekly"],
  });

  await assert.rejects(
    () =>
      saveUserEmailNotificationPreferences(db, {
        userId: "usr_owner",
        emailEnabled: true,
        digestEmailEnabled: true,
        minSignificance: "moderate",
        categories: [],
        competitorIds: [],
        digestPeriods: ["daily"],
      }),
    /The Personal plan supports weekly scheduled digests only/,
  );

  // 5. On Personal, workspace creation cap is 1 workspace per account — creating a 2nd workspace is blocked!
  await assert.rejects(
    () =>
      createTeamWorkspace(db, {
        userId: "usr_owner",
        name: "Blocked Second Workspace",
      }),
    /Your account has reached the Personal plan limit of 1 workspace/,
  );

  // Post-insert TOCTOU workspace creation guard rolls back a concurrently inserted 2nd workspace on Personal
  sqlite
    .prepare(
      `INSERT INTO workspaces (id, name, created_by) VALUES ('ws_race_2', 'Race WS', 'usr_owner')`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws_race_2', 'usr_owner', 'owner')`,
    )
    .run();

  await assert.rejects(
    () =>
      enforceUserWorkspaceCreationCapacityAfterInsert(db, {
        userId: "usr_owner",
        newWorkspaceId: "ws_race_2",
      }),
    /Your account has reached the Personal plan limit of 1 workspace/,
  );
  assert.equal(
    sqlite
      .prepare(
        `SELECT COUNT(*) AS count FROM workspaces WHERE id = 'ws_race_2'`,
      )
      .get().count,
    0,
  );

  // 6. On Personal, up to 3 seats total (owner + 2 invited) are allowed.
  // Invite newinvitee@acme.test while on Personal, then downgrade to Free BEFORE they accept the invite.
  const inviteOnPersonal = await inviteOrAddWorkspaceMember(
    db,
    {
      actorUserId: "usr_owner",
      workspaceId: "ws_acme",
      email: "newinvitee@acme.test",
      role: "member",
    },
  );
  assert.equal(
    inviteOnPersonal.outcome,
    "invitation_sent",
  );
  const pendingInviteRow = sqlite
    .prepare(
      `SELECT id FROM workspace_invitations WHERE workspace_id = 'ws_acme' AND email = 'newinvitee@acme.test'`,
    )
    .get();
  assert.ok(pendingInviteRow?.id);

  // Downgrading to Free while a pending invite exists is blocked because total seats (1 owner + 1 pending = 2) > Free limit (1)
  await assert.rejects(
    () =>
      changeWorkspaceSubscriptionPlan(db, {
        actorUserId: "usr_owner",
        workspaceId: "ws_acme",
        planId: "free",
      }),
    /currently uses 2 team seats \(members and pending invitations\), which exceeds the Free plan limit of 1/,
  );

  // Simulate subscription expiration while the invitation is still pending
  sqlite
    .prepare(
      `
        UPDATE workspace_subscriptions
        SET status = 'canceled', plan_id = 'free'
        WHERE workspace_id = 'ws_acme'
      `,
    )
    .run();

  // Create the invited user account and attempt to accept the pending invitation — MUST be blocked because workspace is now on Free (1 seat max)!
  sqlite
    .prepare(
      `INSERT INTO users (id, email, name, email_verified) VALUES ('usr_invitee', 'newinvitee@acme.test', 'New Invitee', 1)`,
    )
    .run();

  await assert.rejects(
    () =>
      acceptWorkspaceInvitation(db, {
        userId: "usr_invitee",
        invitationId: pendingInviteRow.id,
      }),
    /reached the Free plan limit of 1 team seat/,
  );

  // 7. On Free plan, scheduled digests (even weekly) are completely disabled
  await assert.rejects(
    () =>
      saveUserEmailNotificationPreferences(db, {
        userId: "usr_owner",
        emailEnabled: true,
        digestEmailEnabled: true,
        minSignificance: "moderate",
        categories: [],
        competitorIds: [],
        digestPeriods: ["weekly"],
      }),
    /Scheduled digests are not included on the Free plan/,
  );

  // 8. Role promotion loophole check: promoting a member to 'owner' in a second workspace is blocked if they already own 1 workspace on Free/Personal
  sqlite
    .prepare(
      `
        INSERT INTO workspaces (id, name, created_by)
        VALUES ('ws_other', 'Other Workspace', 'usr_admin')
      `,
    )
    .run();
  sqlite
    .prepare(
      `
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES
          ('ws_other', 'usr_admin', 'owner'),
          ('ws_other', 'usr_owner', 'admin')
      `,
    )
    .run();
  sqlite
    .prepare(
      `
        INSERT INTO workspace_subscriptions (workspace_id, plan_id, status, billing_interval)
        VALUES ('ws_other', 'personal', 'active', 'monthly')
      `,
    )
    .run();

  await assert.rejects(
    () =>
      updateWorkspaceMemberRole(db, {
        actorUserId: "usr_admin",
        workspaceId: "ws_other",
        targetUserId: "usr_owner",
        nextRole: "owner",
      }),
    /Your account has reached the Free plan limit of 1 workspace/,
  );
});

test("THE-28.7: user-facing error sanitizer masks RSC render/digest errors, .env.local billing config errors, and SQL/runtime details while preserving clean validation copy", () => {
  const rscProductionError = new Error(
    "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error.",
  );
  assert.equal(
    isTechnicalOrRedactedErrorMessage(
      rscProductionError.message,
    ),
    true,
  );
  assert.equal(
    toUserFacingErrorMessage(rscProductionError),
    DEFAULT_USER_FACING_ERROR_MESSAGE,
  );

  // Error object with a React digest property must also be masked even if message differs
  const digestError = Object.assign(
    new Error("Internal server error"),
    { digest: "1948274912" },
  );
  assert.equal(
    toUserFacingErrorMessage(digestError),
    DEFAULT_USER_FACING_ERROR_MESSAGE,
  );

  // Unconfigured Polar / .env.local errors map to a polite customer-facing message
  assert.equal(
    toUserFacingErrorMessage(
      new Error(
        "Polar payment integration is not configured yet. Replace the placeholder POLAR_* values in .env.local to enable live checkouts and plan changes.",
      ),
    ),
    BILLING_UNAVAILABLE_USER_FACING_MESSAGE,
  );
  assert.equal(
    toUserFacingErrorMessage(
      new Error(
        "Polar product ID is not configured for the Personal (monthly) plan. Set POLAR_PERSONAL_MONTHLY_PRODUCT_ID in .env.local.",
      ),
    ),
    BILLING_UNAVAILABLE_USER_FACING_MESSAGE,
  );

  // Upstream provider / HTTP failures map to a clean provider connection error
  assert.equal(
    toUserFacingErrorMessage(
      new Error(
        "Polar checkout creation failed: HTTP 502",
      ),
    ),
    BILLING_PROVIDER_CONNECTION_USER_FACING_MESSAGE,
  );

  // SQLite / D1 / JS runtime / network errors are masked
  for (const technicalMessage of [
    "D1_ERROR: no such table: workspace_subscriptions",
    "SQLITE_CONSTRAINT: UNIQUE constraint failed: competitors.workspace_id, competitors.domain",
    "TypeError: Cannot read properties of undefined (reading 'id')",
    "Failed to fetch",
  ]) {
    assert.equal(
      toUserFacingErrorMessage(new Error(technicalMessage)),
      DEFAULT_USER_FACING_ERROR_MESSAGE,
    );
  }

  // Unauthorized maps to session expired prompt
  assert.equal(
    toUserFacingErrorMessage(new Error("Unauthorized")),
    "Your session has expired. Please sign in again.",
  );

  // Legitimate user-facing validation and plan-limit messages are preserved cleanly
  const quotaMessage =
    "This workspace has reached the Personal plan limit of 3 competitors. Upgrade your workspace plan in Billing to monitor more competitors.";
  assert.equal(
    toUserFacingErrorMessage(new Error(quotaMessage)),
    quotaMessage,
  );

  assert.equal(
    toUserFacingErrorMessage(
      new Error("Slack webhookUrl must use HTTPS."),
    ),
    "Slack webhook URL must use HTTPS.",
  );
});

test("THE-28.8 & THE-28.9: owner_email auto-populates and direct D1 edits to annual billing_interval align current_period_end to 1 year after current_period_start", async (t) => {
  const { db, sqlite } = createD1Fixture(t);

  // Verify owner_email was populated automatically on insert
  const initialRow = sqlite
    .prepare(
      "SELECT owner_email, billing_interval, current_period_start, current_period_end FROM workspace_subscriptions WHERE workspace_id = 'ws_acme'",
    )
    .get();
  assert.equal(initialRow.owner_email, "owner@acme.test");

  // Simulate a workspace created on 2026-09-04 with a 30-day default period end, then edited in D1 to Scale + annual
  sqlite
    .prepare(
      `
        UPDATE workspace_subscriptions
        SET
          plan_id = 'scale',
          current_period_start = '2026-09-04 08:25:24',
          current_period_end = '2026-10-04 08:25:24'
        WHERE workspace_id = 'ws_acme'
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        UPDATE workspace_subscriptions
        SET billing_interval = 'annual'
        WHERE workspace_id = 'ws_acme'
      `,
    )
    .run();

  const updatedRow = sqlite
    .prepare(
      "SELECT billing_interval, current_period_start, current_period_end FROM workspace_subscriptions WHERE workspace_id = 'ws_acme'",
    )
    .get();
  assert.equal(updatedRow.billing_interval, "annual");
  assert.equal(
    updatedRow.current_period_start,
    "2026-09-04 08:25:24",
  );
  assert.equal(
    updatedRow.current_period_end,
    "2027-09-04 08:25:24",
  );

  const subscription = await getWorkspaceSubscription(
    db,
    "ws_acme",
  );
  assert.equal(subscription.billingInterval, "annual");
  assert.equal(
    subscription.currentPeriodStart,
    "2026-09-04 08:25:24",
  );
  assert.equal(
    subscription.currentPeriodEnd,
    "2027-09-04 08:25:24",
  );

  // Switching back to monthly in D1 aligns current_period_end to 30 days after current_period_start
  sqlite
    .prepare(
      `
        UPDATE workspace_subscriptions
        SET billing_interval = 'monthly'
        WHERE workspace_id = 'ws_acme'
      `,
    )
    .run();

  const monthlyRow = sqlite
    .prepare(
      "SELECT billing_interval, current_period_end FROM workspace_subscriptions WHERE workspace_id = 'ws_acme'",
    )
    .get();
  assert.equal(monthlyRow.billing_interval, "monthly");
  assert.equal(
    monthlyRow.current_period_end,
    "2026-10-04 08:25:24",
  );

  // Updating the owner's email in users syncs owner_email in workspace_subscriptions
  sqlite
    .prepare(
      "UPDATE users SET email = 'new-owner@acme.test' WHERE id = 'usr_owner'",
    )
    .run();
  const syncedRow = sqlite
    .prepare(
      "SELECT owner_email FROM workspace_subscriptions WHERE workspace_id = 'ws_acme'",
    )
    .get();
  assert.equal(
    syncedRow.owner_email,
    "new-owner@acme.test",
  );
});

test("Account-owned subscriptions: sibling workspaces share the Owner's plan, sync on direct D1 edits, and enforce per-workspace limits on downgrade", async (t) => {
  const { db, sqlite } = createD1Fixture(t);

  // usr_owner starts on Starter (allows up to 2 workspaces, 5 competitors per workspace)
  const secondWs = await createTeamWorkspace(db, {
    userId: "usr_owner",
    name: "Acme Europe",
  });

  // Newly created workspace inherits usr_owner's Starter plan automatically
  const secondSub = await getWorkspaceSubscription(
    db,
    secondWs.id,
  );
  assert.equal(secondSub.planId, "starter");

  // Direct D1 edit on ws_acme to 'growth' + 'annual' automatically syncs to secondWs via trigger
  sqlite
    .prepare(
      `
        UPDATE workspace_subscriptions
        SET plan_id = 'growth', billing_interval = 'annual'
        WHERE workspace_id = 'ws_acme'
      `,
    )
    .run();

  const secondSubAfterD1Edit =
    await getWorkspaceSubscription(db, secondWs.id);
  assert.equal(secondSubAfterD1Edit.planId, "growth");
  assert.equal(
    secondSubAfterD1Edit.billingInterval,
    "annual",
  );

  // Add 4 competitors in secondWs (allowed on Growth/Starter, exceeds Personal's 3-competitor limit)
  for (let i = 1; i <= 4; i++) {
    sqlite
      .prepare(
        `
          INSERT INTO competitors (id, workspace_id, name, domain, status)
          VALUES (?, ?, ?, ?, 'active')
        `,
      )
      .run(
        `comp_eu_${i}`,
        secondWs.id,
        `EU Comp ${i}`,
        `eu${i}.example.com`,
      );
  }

  // Attempting to downgrade to Personal from ws_acme (even though ws_acme has 0 competitors)
  // is blocked because usr_owner owns 2 workspaces (Personal allows 1) AND secondWs has 4 competitors (Personal allows 3)
  const ws1Snapshot = await getWorkspaceBillingSnapshot(
    db,
    "usr_owner",
    new Date(),
    "ws_acme",
  );
  const personalOption = ws1Snapshot.planOptions.find(
    (p) => p.plan.id === "personal",
  );
  const starterOption = ws1Snapshot.planOptions.find(
    (p) => p.plan.id === "starter",
  );

  assert.equal(personalOption.transition.allowed, false);
  assert.ok(
    personalOption.transition.blockingReasons.some((r) =>
      r.includes("workspaces"),
    ),
  );
  assert.ok(
    personalOption.transition.blockingReasons.some((r) =>
      r.includes("competitors"),
    ),
  );

  // Downgrading from Growth to Starter is allowed (2 workspaces <= 2, 4 competitors <= 5)
  assert.equal(starterOption.transition.allowed, true);
});

