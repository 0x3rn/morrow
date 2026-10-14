import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  BILLING_INTERVALS,
  BILLING_PLAN_CATALOG,
  BILLING_PLAN_IDS,
  BILLING_SUBSCRIPTION_STATUSES,
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
import { createWorkspaceExternalChannel } from "../lib/notification-settings.ts";
import {
  createTeamWorkspace,
  inviteOrAddWorkspaceMember,
} from "../lib/team-workspaces.ts";
import {
  assertWorkspaceCompetitorCapacity,
  assertWorkspaceExternalChannelCapacity,
  assertWorkspaceMonitoredPageCapacity,
  assertWorkspaceMonitoringFrequencyAllowed,
  assertWorkspaceTeamSeatCapacity,
  changeWorkspaceSubscriptionPlan,
  getWorkspaceBillingSnapshot,
  getWorkspaceEntitlements,
  getWorkspaceRetentionWindow,
  getWorkspaceSubscription,
  setWorkspaceSubscriptionCancellation,
  updateWorkspaceBillingInterval,
} from "../lib/workspace-billing.ts";
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

test("THE-28.1: billing-plans defines canonical plan catalog, frequency rules, retention windows, and plan transitions", () => {
  assert.deepEqual(BILLING_PLAN_IDS, [
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

  assert.equal(isBillingPlanId("growth"), true);
  assert.equal(isBillingPlanId("enterprise"), false);
  assert.equal(
    normalizeBillingPlanId(" SCALE "),
    "scale",
  );
  assert.equal(
    normalizeBillingPlanId("unknown"),
    "starter",
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

  const starterEntitlements =
    resolveWorkspaceEntitlements({
      planId: "starter",
      subscriptionStatus: "active",
      billingInterval: "monthly",
    });
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

  // Canceled subscriptions fall back to Starter limits while retaining configuredPlanId
  const canceledScale = resolveWorkspaceEntitlements({
    planId: "scale",
    subscriptionStatus: "canceled",
    billingInterval: "monthly",
  });
  assert.equal(canceledScale.configuredPlanId, "scale");
  assert.equal(canceledScale.effectivePlanId, "starter");
  assert.equal(
    canceledScale.limits.minFrequencyMinutes,
    360,
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
    currentPlanId: "growth",
    targetPlanId: "starter",
    usage: {
      competitors: 12,
      monitoredPages: 55,
      maxPagesOnSingleCompetitor: 11,
      teamSeats: 7,
      externalChannels: 4,
    },
    fasterThanTargetMinFrequencyPages: 3,
  });
  assert.equal(blockedDowngrade.direction, "downgrade");
  assert.equal(blockedDowngrade.allowed, false);
  assert.equal(
    blockedDowngrade.blockingReasons.length,
    5,
  );
  assert.equal(
    blockedDowngrade.pagesRequiringFrequencyAdjustment,
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

  // 5. Team seats: ws_acme has 4 active members; Starter allows 6 seats total
  await inviteOrAddWorkspaceMember(db, {
    actorUserId: "usr_owner",
    workspaceId: "ws_acme",
    email: "seat5@acme.test",
    role: "member",
  });
  await inviteOrAddWorkspaceMember(db, {
    actorUserId: "usr_owner",
    workspaceId: "ws_acme",
    email: "seat6@acme.test",
    role: "viewer",
  });

  // Re-inviting an already-pending email does not consume a 7th seat
  await inviteOrAddWorkspaceMember(db, {
    actorUserId: "usr_owner",
    workspaceId: "ws_acme",
    email: "seat6@acme.test",
    role: "member",
  });

  // Inviting a 7th distinct seat is blocked on Starter
  await assert.rejects(
    () =>
      inviteOrAddWorkspaceMember(db, {
        actorUserId: "usr_owner",
        workspaceId: "ws_acme",
        email: "seat7@acme.test",
        role: "viewer",
      }),
    /reached the Starter plan limit of 6 team seats/,
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

  // Switch billing cycle to monthly
  const intervalSub =
    await updateWorkspaceBillingInterval(db, {
      actorUserId: "usr_owner",
      workspaceId: "ws_acme",
      billingInterval: "monthly",
    });
  assert.equal(intervalSub.billingInterval, "monthly");

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
  assert.equal(snapshot.planOptions.length, 3);
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

  // Creating a new team workspace automatically provisions its Starter subscription
  const newWs = await createTeamWorkspace(db, {
    userId: "usr_owner",
    name: "Second Workspace",
  });
  const newWsEntitlements =
    await getWorkspaceEntitlements(db, newWs.id);
  assert.equal(
    newWsEntitlements.effectivePlanId,
    "starter",
  );
  assert.equal(
    getBillingPlanDefinition(
      newWsEntitlements.effectivePlanId,
    ).name,
    "Starter",
  );
  assert.equal(
    await assertWorkspaceTeamSeatCapacity(db, {
      workspaceId: newWs.id,
    }).then((ent) => ent.effectivePlanId),
    "starter",
  );
  assert.equal(
    await assertWorkspaceExternalChannelCapacity(
      db,
      newWs.id,
    ).then((ent) => ent.effectivePlanId),
    "starter",
  );
});
