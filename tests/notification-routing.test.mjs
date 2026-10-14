import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createWorkspaceExternalChannel,
  getWorkspaceNotificationSettings,
  removeWorkspaceExternalChannel,
  saveUserEmailNotificationPreferences,
  toggleWorkspaceExternalChannelStatus,
  updateWorkspaceExternalChannel,
} from "../lib/notification-settings.ts";
import {
  notifyChangeByEmail,
  notifyDigestByEmail,
} from "../worker/change-email.ts";
import { generateDigest } from "../worker/digest-generator.ts";
import {
  notifyChangeByExternalChannels,
  notifyDigestByExternalChannels,
} from "../worker/external-notifications.ts";
import {
  EXTERNAL_NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANGE_CATEGORIES,
  NOTIFICATION_DIGEST_PERIODS,
  NOTIFICATION_SIGNIFICANCE_LEVELS,
  maskExternalChannelConfigSummary,
  matchesChangeRoutingPolicy,
  matchesDigestRoutingPolicy,
  matchesSignificanceThreshold,
  normalizeSignificanceLevel,
  parseAllowedCategoriesJson,
  parseAllowedCompetitorIdsJson,
  parseAllowedDigestPeriodsJson,
  scopeDigestContentToRoutingPolicy,
  serializeAllowedCategories,
  serializeAllowedCompetitorIds,
  serializeAllowedDigestPeriods,
} from "../worker/notification-routing.ts";

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

  t.after(() => sqlite.close());

  const db = {
    prepare(sql) {
      let boundValues = [];
      return {
        bind(...args) {
          boundValues = args;
          return this;
        },
        async all() {
          const results = sqlite
            .prepare(sql)
            .all(...boundValues);
          const meta = sqlite
            .prepare("SELECT changes() AS changes")
            .get();
          return {
            results,
            meta,
            success: true,
          };
        },
        async first() {
          return (
            sqlite.prepare(sql).get(...boundValues) ?? null
          );
        },
        async run() {
          const info = sqlite
            .prepare(sql)
            .run(...boundValues);
          return {
            results: [],
            meta: {
              changes: Number(info.changes ?? 0),
            },
            success: true,
          };
        },
      };
    },
  };

  sqlite
    .prepare(
      `
        INSERT INTO users (id, email, name)
        VALUES
          ('usr_alice', 'alice@acme.test', 'Alice'),
          ('usr_bob', 'bob@acme.test', 'Bob'),
          ('usr_outsider', 'outsider@other.test', 'Outsider')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO workspaces (id, name, created_by)
        VALUES
          ('ws_acme', 'Acme Workspace', 'usr_alice'),
          ('ws_other', 'Other Workspace', 'usr_outsider')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
        VALUES
          ('ws_acme', 'usr_alice', 'owner', '2026-10-01T00:00:00Z'),
          ('ws_acme', 'usr_bob', 'admin', '2026-10-01T00:05:00Z'),
          ('ws_other', 'usr_outsider', 'owner', '2026-10-01T00:00:00Z')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO competitors (id, workspace_id, name, domain, status)
        VALUES
          ('comp_stripe', 'ws_acme', 'Stripe', 'stripe.com', 'active'),
          ('comp_adyen', 'ws_acme', 'Adyen', 'adyen.com', 'active'),
          ('comp_other', 'ws_other', 'OtherCorp', 'other.test', 'active')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO monitored_pages (id, competitor_id, url, label, frequency_minutes, status)
        VALUES
          ('pg_stripe_pricing', 'comp_stripe', 'https://stripe.com/pricing', 'Pricing', 60, 'active'),
          ('pg_adyen_docs', 'comp_adyen', 'https://adyen.com/docs', 'Docs', 60, 'active')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO snapshots (id, monitored_page_id, content_hash, http_status, captured_at)
        VALUES
          ('snap_s1', 'pg_stripe_pricing', 'h1', 200, '2026-10-13T10:00:00Z'),
          ('snap_s2', 'pg_stripe_pricing', 'h2', 200, '2026-10-13T12:00:00Z'),
          ('snap_a1', 'pg_adyen_docs', 'h3', 200, '2026-10-13T11:00:00Z'),
          ('snap_a2', 'pg_adyen_docs', 'h4', 200, '2026-10-13T13:00:00Z')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO changes (
          id,
          monitored_page_id,
          previous_snapshot_id,
          current_snapshot_id,
          category,
          significance,
          summary,
          why_it_matters,
          diff_json,
          detected_at
        )
        VALUES
          (
            'chg_stripe_pricing_major',
            'pg_stripe_pricing',
            'snap_s1',
            'snap_s2',
            'pricing',
            'major',
            'Stripe raised enterprise platform fee to $2,500/mo',
            'Enterprise floor price increased by 25%.',
            '{"addedLines":["Enterprise: $2,500/month"],"removedLines":["Enterprise: $2,000/month"]}',
            '2026-10-13T12:00:00Z'
          ),
          (
            'chg_adyen_content_minor',
            'pg_adyen_docs',
            'snap_a1',
            'snap_a2',
            'content',
            'minor',
            'Adyen updated developer quickstart wording',
            'Minor wording adjustment in documentation intro.',
            '{"addedLines":["Quickstart v2"],"removedLines":["Quickstart v1"]}',
            '2026-10-13T13:00:00Z'
          )
      `,
    )
    .run();

  return { sqlite, db };
}

test("THE-26.1: normalization, JSON parsing, and serialization helpers enforce canonical routing values", () => {
  assert.deepEqual(NOTIFICATION_CHANGE_CATEGORIES, [
    "pricing",
    "product",
    "feature",
    "positioning",
    "promotion",
    "policy",
    "navigation",
    "content",
    "other",
  ]);
  assert.deepEqual(NOTIFICATION_SIGNIFICANCE_LEVELS, [
    "minor",
    "moderate",
    "major",
  ]);
  assert.deepEqual(NOTIFICATION_DIGEST_PERIODS, [
    "daily",
    "weekly",
    "monthly",
  ]);
  assert.deepEqual(EXTERNAL_NOTIFICATION_CHANNELS, [
    "slack",
    "telegram",
    "webhook",
  ]);

  assert.equal(
    normalizeSignificanceLevel("MAJOR"),
    "major",
  );
  assert.equal(
    normalizeSignificanceLevel("Moderate"),
    "moderate",
  );
  assert.equal(
    normalizeSignificanceLevel("unknown", "moderate"),
    "moderate",
  );

  assert.deepEqual(
    parseAllowedCategoriesJson(
      '["Pricing", "policy", "invalid", "pricing"]',
    ),
    ["pricing", "policy"],
  );
  assert.deepEqual(
    parseAllowedCategoriesJson("not-json"),
    [],
  );

  assert.equal(
    serializeAllowedCategories([
      "pricing",
      "positioning",
      "pricing",
    ]),
    '["pricing","positioning"]',
  );
  // Selecting all 9 categories normalizes to "[]" (all categories allowed)
  assert.equal(
    serializeAllowedCategories(
      NOTIFICATION_CHANGE_CATEGORIES,
    ),
    "[]",
  );

  assert.deepEqual(
    parseAllowedCompetitorIdsJson(
      '["comp_1", "comp_2", "comp_1", ""]',
    ),
    ["comp_1", "comp_2"],
  );
  assert.equal(
    serializeAllowedCompetitorIds(["comp_1", "comp_2"]),
    '["comp_1","comp_2"]',
  );

  assert.deepEqual(
    parseAllowedDigestPeriodsJson('["weekly"]'),
    ["weekly"],
  );
  assert.deepEqual(
    parseAllowedDigestPeriodsJson("[]"),
    [],
  );
  assert.equal(
    serializeAllowedDigestPeriods(["daily"]),
    '["daily"]',
  );
});

test("THE-26.1: matchesChangeRoutingPolicy evaluates enabled state, significance threshold, category, and competitor filters", () => {
  assert.equal(
    matchesSignificanceThreshold("minor", "minor"),
    true,
  );
  assert.equal(
    matchesSignificanceThreshold("minor", "moderate"),
    false,
  );
  assert.equal(
    matchesSignificanceThreshold("moderate", "moderate"),
    true,
  );
  assert.equal(
    matchesSignificanceThreshold("major", "moderate"),
    true,
  );
  assert.equal(
    matchesSignificanceThreshold("moderate", "major"),
    false,
  );

  const sampleChange = {
    category: "pricing",
    significance: "moderate",
    competitorId: "comp_stripe",
  };

  assert.equal(
    matchesChangeRoutingPolicy(sampleChange, {
      enabled: true,
    }),
    true,
  );

  assert.equal(
    matchesChangeRoutingPolicy(sampleChange, {
      enabled: false,
    }),
    false,
  );

  assert.equal(
    matchesChangeRoutingPolicy(sampleChange, {
      enabled: true,
      minSignificance: "major",
    }),
    false,
  );

  assert.equal(
    matchesChangeRoutingPolicy(sampleChange, {
      enabled: true,
      majorOnly: true,
    }),
    false,
  );

  assert.equal(
    matchesChangeRoutingPolicy(sampleChange, {
      enabled: true,
      minSignificance: "moderate",
      categoriesJson: '["pricing","feature"]',
      competitorIdsJson: '["comp_stripe"]',
    }),
    true,
  );

  assert.equal(
    matchesChangeRoutingPolicy(sampleChange, {
      enabled: true,
      minSignificance: "moderate",
      categoriesJson: '["positioning"]',
    }),
    false,
  );

  assert.equal(
    matchesChangeRoutingPolicy(sampleChange, {
      enabled: true,
      minSignificance: "moderate",
      competitorIdsJson: '["comp_adyen"]',
    }),
    false,
  );
});

test("THE-26.1: scopeDigestContentToRoutingPolicy filters digest entries and recomputes totals", async (t) => {
  const { db } = createD1Fixture(t);

  const generated = await generateDigest(
    db,
    "ws_acme",
    "daily",
    "2026-10-13T00:00:00.000Z",
    "2026-10-14T00:00:00.000Z",
  );

  const sampleDigestContent = generated.content;
  assert.equal(sampleDigestContent.totals.changes, 2);

  const scoped = scopeDigestContentToRoutingPolicy(
    sampleDigestContent,
    {
      enabled: true,
      digestPeriodsJson: '["daily"]',
      minSignificance: "moderate",
      categoriesJson: '["pricing"]',
    },
  );

  assert.ok(scoped);
  assert.equal(scoped.totals.changes, 1);
  assert.equal(scoped.totals.major, 1);
  assert.equal(scoped.totals.moderate, 0);
  assert.equal(scoped.totals.minor, 0);
  assert.equal(scoped.competitors.length, 1);
  assert.equal(
    scoped.competitors[0].competitor.id,
    "comp_stripe",
  );
  assert.equal(scoped.changes.length, 1);
  assert.equal(
    scoped.changes[0].id,
    "chg_stripe_pricing_major",
  );

  const wrongPeriod = scopeDigestContentToRoutingPolicy(
    sampleDigestContent,
    {
      enabled: true,
      digestPeriodsJson: '["weekly"]',
    },
  );
  assert.equal(wrongPeriod, null);

  assert.equal(
    matchesDigestRoutingPolicy(sampleDigestContent, {
      enabled: true,
      digestPeriodsJson: '["daily"]',
      competitorIdsJson: '["comp_missing"]',
    }),
    false,
  );
});

test("THE-26.1: maskExternalChannelConfigSummary redacts secrets while keeping operator context", () => {
  assert.equal(
    maskExternalChannelConfigSummary(
      "slack",
      JSON.stringify({
        webhookUrl:
          "https://hooks.slack.com/services/T000/B000/SECRET123",
      }),
    ).summary,
    "Slack incoming webhook (https://hooks.slack.com/services/•••)",
  );

  assert.equal(
    maskExternalChannelConfigSummary(
      "telegram",
      JSON.stringify({
        botToken: "123456:ABCDEF1234567890",
        chatId: "-100987654321",
      }),
    ).summary,
    "Telegram chat -100987654321",
  );

  assert.ok(
    maskExternalChannelConfigSummary(
      "webhook",
      JSON.stringify({
        url: "https://api.example.com/webhooks/morrow",
        secret: "whsec_super_secret",
      }),
    ).summary.includes("https://api.example.com"),
  );
});

test("THE-26.3: notifyChangeByEmail enforces category, competitor, and min_significance routing per recipient", async (t) => {
  const { sqlite, db } = createD1Fixture(t);

  // Alice only wants major pricing changes for Stripe
  sqlite
    .prepare(
      `
        INSERT INTO notification_preferences (
          id,
          user_id,
          email_enabled,
          major_only,
          min_significance,
          categories_json,
          competitor_ids_json
        )
        VALUES (
          'pref_alice',
          'usr_alice',
          1,
          1,
          'major',
          '["pricing"]',
          '["comp_stripe"]'
        )
      `,
    )
    .run();

  // Bob only wants positioning changes (so neither pricing nor content should match Bob)
  sqlite
    .prepare(
      `
        INSERT INTO notification_preferences (
          id,
          user_id,
          email_enabled,
          major_only,
          min_significance,
          categories_json,
          competitor_ids_json
        )
        VALUES (
          'pref_bob',
          'usr_bob',
          1,
          0,
          'minor',
          '["positioning"]',
          '[]'
        )
      `,
    )
    .run();

  const sentPayloads = [];
  const fakeFetch = async (_url, init) => {
    sentPayloads.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({ id: `re_${sentPayloads.length}` }),
      { status: 200 },
    );
  };

  const env = {
    DB: db,
    RESEND_API_KEY: "re_test_key",
    MORROW_EMAIL_FROM: "Morrow <alerts@morrow.test>",
    MORROW_APP_URL: "https://morrow.test",
  };

  // 1. Major pricing change on Stripe -> matches Alice, skips Bob
  const majorResult = await notifyChangeByEmail(
    env,
    "chg_stripe_pricing_major",
    fakeFetch,
  );
  assert.deepEqual(majorResult, {
    changeId: "chg_stripe_pricing_major",
    changeFound: true,
    configured: true,
    recipientsFound: 2,
    eligibleRecipients: 1,
    sent: 1,
    alreadySent: 0,
    inFlight: 0,
    failed: 0,
  });
  assert.equal(sentPayloads.length, 1);
  assert.deepEqual(sentPayloads[0].to, [
    "alice@acme.test",
  ]);

  // 2. Minor content change on Adyen -> skips both Alice (major/pricing/Stripe) and Bob (positioning)
  const minorResult = await notifyChangeByEmail(
    env,
    "chg_adyen_content_minor",
    fakeFetch,
  );
  assert.deepEqual(minorResult, {
    changeId: "chg_adyen_content_minor",
    changeFound: true,
    configured: true,
    recipientsFound: 2,
    eligibleRecipients: 0,
    sent: 0,
    alreadySent: 0,
    inFlight: 0,
    failed: 0,
  });
});

test("THE-26.2 & THE-26.3: notifyDigestByEmail scopes digest per user, enforces idempotency via digest_email_deliveries, and retries failures", async (t) => {
  const { sqlite, db } = createD1Fixture(t);

  // Alice subscribes to daily digests but only for Stripe
  sqlite
    .prepare(
      `
        INSERT INTO notification_preferences (
          id,
          user_id,
          email_enabled,
          major_only,
          min_significance,
          categories_json,
          competitor_ids_json,
          digest_email_enabled,
          digest_periods_json
        )
        VALUES (
          'pref_alice',
          'usr_alice',
          1,
          0,
          'minor',
          '[]',
          '["comp_stripe"]',
          1,
          '["daily"]'
        )
      `,
    )
    .run();

  // Bob subscribes only to weekly digests
  sqlite
    .prepare(
      `
        INSERT INTO notification_preferences (
          id,
          user_id,
          email_enabled,
          major_only,
          min_significance,
          categories_json,
          competitor_ids_json,
          digest_email_enabled,
          digest_periods_json
        )
        VALUES (
          'pref_bob',
          'usr_bob',
          1,
          0,
          'minor',
          '[]',
          '[]',
          1,
          '["weekly"]'
        )
      `,
    )
    .run();

  const generated = await generateDigest(
    db,
    "ws_acme",
    "daily",
    "2026-10-13T00:00:00.000Z",
    "2026-10-14T00:00:00.000Z",
  );

  assert.equal(generated.status, "generated");
  assert.equal(generated.content.totals.changes, 2);

  let shouldFail = true;
  const sentEmails = [];
  const fakeFetch = async (_url, init) => {
    if (shouldFail) {
      return new Response("Resend temporary 503", {
        status: 503,
      });
    }
    const payload = JSON.parse(init.body);
    sentEmails.push(payload);
    return new Response(
      JSON.stringify({ id: "re_digest_1" }),
      { status: 200 },
    );
  };

  const env = {
    DB: db,
    RESEND_API_KEY: "re_test_key",
    MORROW_EMAIL_FROM: "Morrow <alerts@morrow.test>",
    MORROW_APP_URL: "https://morrow.test",
  };

  // First attempt fails
  const failedRun = await notifyDigestByEmail(
    env,
    generated.id,
    fakeFetch,
  );
  assert.deepEqual(failedRun, {
    digestId: generated.id,
    digestFound: true,
    configured: true,
    recipientsFound: 2,
    eligibleRecipients: 1,
    sent: 0,
    alreadySent: 0,
    inFlight: 0,
    failed: 1,
  });

  // Second attempt succeeds and scopes the digest to Stripe only for Alice
  shouldFail = false;
  const secondRun = await notifyDigestByEmail(
    env,
    generated.id,
    fakeFetch,
  );
  assert.deepEqual(secondRun, {
    digestId: generated.id,
    digestFound: true,
    configured: true,
    recipientsFound: 2,
    eligibleRecipients: 1,
    sent: 1,
    alreadySent: 0,
    inFlight: 0,
    failed: 0,
  });

  assert.equal(sentEmails.length, 1);
  assert.deepEqual(sentEmails[0].to, ["alice@acme.test"]);
  assert.ok(
    sentEmails[0].subject.includes(
      "1 meaningful change",
    ),
    "Subject reflects Alice's 1 scoped Stripe change rather than 2 total workspace changes",
  );
  assert.ok(sentEmails[0].text.includes("Stripe"));
  assert.ok(
    !sentEmails[0].text.includes("Adyen"),
    "Adyen is excluded by Alice's competitor filter",
  );

  // Third attempt is a no-op via digest_email_deliveries idempotency
  const thirdRun = await notifyDigestByEmail(
    env,
    generated.id,
    fakeFetch,
  );
  assert.deepEqual(thirdRun, {
    digestId: generated.id,
    digestFound: true,
    configured: true,
    recipientsFound: 2,
    eligibleRecipients: 1,
    sent: 0,
    alreadySent: 1,
    inFlight: 0,
    failed: 0,
  });

  const ledgerRow = {
    ...sqlite
      .prepare(
        `
          SELECT status, attempt_count, provider_message_id
          FROM digest_email_deliveries
          WHERE digest_id = ? AND user_id = 'usr_alice'
        `,
      )
      .get(generated.id),
  };
  assert.deepEqual(ledgerRow, {
    status: "sent",
    attempt_count: 2,
    provider_message_id: "re_digest_1",
  });
});

test("THE-26.3: external channels enforce per-channel routing filters for changes and digests", async (t) => {
  const { sqlite, db } = createD1Fixture(t);

  // Slack channel: only major pricing changes on Stripe, and only daily digests
  sqlite
    .prepare(
      `
        INSERT INTO external_notification_channels (
          id,
          workspace_id,
          channel,
          name,
          status,
          config_json,
          send_changes,
          send_digests,
          min_significance,
          categories_json,
          competitor_ids_json,
          digest_periods_json
        )
        VALUES
          (
            'ch_slack_pricing',
            'ws_acme',
            'slack',
            '#pricing-war-room',
            'active',
            '{"webhookUrl":"https://hooks.slack.com/services/T1/B1/S1"}',
            1,
            1,
            'major',
            '["pricing"]',
            '["comp_stripe"]',
            '["daily"]'
          ),
          (
            'ch_webhook_digest_only',
            'ws_acme',
            'webhook',
            'Weekly Digest Webhook',
            'active',
            '{"url":"https://api.acme.test/webhooks/morrow","secret":"whsec_123"}',
            0,
            1,
            'minor',
            '[]',
            '[]',
            '["weekly"]'
          )
      `,
    )
    .run();

  const deliveredRequests = [];
  const fakeFetch = async (url, init) => {
    deliveredRequests.push({
      url: String(url),
      body: JSON.parse(init.body),
    });
    return new Response("ok", { status: 200 });
  };

  const env = {
    DB: db,
    MORROW_APP_URL: "https://morrow.test",
  };

  // Minor Adyen content change matches neither channel
  const minorChangeRun =
    await notifyChangeByExternalChannels(
      env,
      "chg_adyen_content_minor",
      fakeFetch,
    );
  assert.deepEqual(minorChangeRun, {
    changeId: "chg_adyen_content_minor",
    changeFound: true,
    configured: true,
    channelsFound: 0,
    sent: 0,
    alreadySent: 0,
    inFlight: 0,
    failed: 0,
  });

  // Major Stripe pricing change matches only ch_slack_pricing (since ch_webhook_digest_only has send_changes = 0)
  const majorChangeRun =
    await notifyChangeByExternalChannels(
      env,
      "chg_stripe_pricing_major",
      fakeFetch,
    );
  assert.deepEqual(majorChangeRun, {
    changeId: "chg_stripe_pricing_major",
    changeFound: true,
    configured: true,
    channelsFound: 1,
    sent: 1,
    alreadySent: 0,
    inFlight: 0,
    failed: 0,
  });
  assert.equal(deliveredRequests.length, 1);
  assert.equal(
    deliveredRequests[0].url,
    "https://hooks.slack.com/services/T1/B1/S1",
  );

  // Daily digest matches ch_slack_pricing (scoped to 1 Stripe major pricing change) and skips ch_webhook_digest_only (weekly only)
  const generated = await generateDigest(
    db,
    "ws_acme",
    "daily",
    "2026-10-13T00:00:00.000Z",
    "2026-10-14T00:00:00.000Z",
  );

  const digestRun = await notifyDigestByExternalChannels(
    env,
    generated.id,
    fakeFetch,
  );
  assert.deepEqual(digestRun, {
    digestId: generated.id,
    digestFound: true,
    configured: true,
    channelsFound: 1,
    sent: 1,
    alreadySent: 0,
    inFlight: 0,
    failed: 0,
  });
  assert.equal(deliveredRequests.length, 2);
  assert.ok(
    deliveredRequests[1].body.text.includes("1 change"),
    "Slack digest message is scoped to the 1 matching Stripe pricing change",
  );
  assert.ok(
    !deliveredRequests[1].body.text.includes("Adyen"),
    "Adyen minor content change is filtered out of the Slack channel's digest",
  );
});

test("THE-26.4: lib/notification-settings manages user preferences and external channels with secret preservation and workspace isolation", async (t) => {
  const { db } = createD1Fixture(t);

  // 1. Default snapshot for Alice
  const initialSettings =
    await getWorkspaceNotificationSettings(
      db,
      "usr_alice",
    );
  assert.equal(initialSettings.workspace.id, "ws_acme");
  assert.equal(initialSettings.competitors.length, 2);
  assert.deepEqual(initialSettings.emailPreferences, {
    emailEnabled: true,
    digestEmailEnabled: false,
    minSignificance: "minor",
    categories: [],
    competitorIds: [],
    digestPeriods: ["weekly"],
    updatedAt: null,
  });

  // 2. Save Alice's email preferences (cross-workspace competitor ID comp_other is automatically stripped)
  const savedPrefs =
    await saveUserEmailNotificationPreferences(db, {
      userId: "usr_alice",
      emailEnabled: true,
      digestEmailEnabled: true,
      minSignificance: "moderate",
      categories: ["pricing", "policy"],
      competitorIds: ["comp_stripe", "comp_other"],
      digestPeriods: ["weekly"],
    });
  assert.equal(savedPrefs.minSignificance, "moderate");
  assert.deepEqual(savedPrefs.categories, [
    "pricing",
    "policy",
  ]);
  assert.deepEqual(savedPrefs.competitorIds, [
    "comp_stripe",
  ]);
  assert.deepEqual(savedPrefs.digestPeriods, ["weekly"]);

  // 3. Create a Telegram channel
  const created = await createWorkspaceExternalChannel(db, {
    userId: "usr_alice",
    name: "Exec Telegram Alerts",
    channel: "telegram",
    telegramBotToken: "123456:ABC-SECRET-TOKEN",
    telegramChatId: "-100555666",
    sendChanges: true,
    sendDigests: true,
    minSignificance: "major",
    categories: ["pricing"],
    competitorIds: ["comp_stripe"],
    digestPeriods: ["daily"],
  });
  assert.ok(created.id);

  // 4. Update the Telegram channel without re-entering the bot token -> preserves existing secret token
  await updateWorkspaceExternalChannel(db, {
    userId: "usr_alice",
    channelId: created.id,
    name: "Exec Telegram Alerts Updated",
    channel: "telegram",
    telegramBotToken: "",
    telegramChatId: "-100555777",
    sendChanges: true,
    sendDigests: false,
    minSignificance: "moderate",
    categories: ["pricing", "positioning"],
    competitorIds: [],
    digestPeriods: ["daily"],
  });

  const updatedSnapshot =
    await getWorkspaceNotificationSettings(
      db,
      "usr_alice",
    );
  assert.equal(
    updatedSnapshot.externalChannels.length,
    1,
  );
  const channelView = updatedSnapshot.externalChannels[0];
  assert.equal(
    channelView.name,
    "Exec Telegram Alerts Updated",
  );
  assert.equal(channelView.telegramChatId, "-100555777");
  assert.equal(
    channelView.configSummary,
    "Telegram chat -100555777",
  );
  assert.equal(channelView.sendChanges, true);
  assert.equal(channelView.sendDigests, false);
  assert.equal(channelView.minSignificance, "moderate");
  assert.deepEqual(channelView.categories, [
    "pricing",
    "positioning",
  ]);

  // 5. Cross-workspace user cannot pause, edit, or delete Alice's workspace channel
  await assert.rejects(
    () =>
      toggleWorkspaceExternalChannelStatus(db, {
        userId: "usr_outsider",
        channelId: created.id,
        currentStatus: "active",
      }),
    /Notification channel not found or access denied/,
  );

  await assert.rejects(
    () =>
      removeWorkspaceExternalChannel(db, {
        userId: "usr_outsider",
        channelId: created.id,
      }),
    /Notification channel not found or access denied/,
  );

  // 6. Pause and remove by workspace member succeeds
  const nextStatus =
    await toggleWorkspaceExternalChannelStatus(db, {
      userId: "usr_bob",
      channelId: created.id,
      currentStatus: "active",
    });
  assert.equal(nextStatus, "paused");

  await removeWorkspaceExternalChannel(db, {
    userId: "usr_alice",
    channelId: created.id,
  });

  const afterRemove =
    await getWorkspaceNotificationSettings(
      db,
      "usr_alice",
    );
  assert.equal(afterRemove.externalChannels.length, 0);
});
