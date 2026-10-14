import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { generateDigest } from "../worker/digest-generator.ts";
import { runDigestScheduler } from "../worker/digest-scheduler.ts";
import { verifyWebhookSignature } from "../worker/external-delivery.ts";
import {
  notifyChangeByExternalChannels,
  notifyDigestByExternalChannels,
  parseExternalChannelConfig,
} from "../worker/external-notifications.ts";

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
        VALUES ('usr_owner', 'owner@acme.test', 'Acme Owner')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO workspaces (id, name, created_by)
        VALUES
          ('ws_acme', 'Acme Workspace', 'usr_owner'),
          ('ws_other', 'Other Workspace', 'usr_owner')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES
          ('ws_acme', 'usr_owner', 'owner'),
          ('ws_other', 'usr_owner', 'owner')
      `,
    )
    .run();

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
        INSERT INTO monitored_pages (id, competitor_id, url, label, frequency_minutes, status)
        VALUES ('page_stripe_pricing', 'comp_stripe', 'https://stripe.com/pricing', 'Pricing', 60, 'active')
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO snapshots (id, monitored_page_id, content_hash, captured_at)
        VALUES
          ('snap_prev', 'page_stripe_pricing', 'hash_prev', '2026-09-27T10:00:00.000Z'),
          ('snap_curr', 'page_stripe_pricing', 'hash_curr', '2026-09-27T12:00:00.000Z')
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
          detected_at
        )
        VALUES (
          'chg_stripe_01',
          'page_stripe_pricing',
          'snap_prev',
          'snap_curr',
          'pricing',
          'major',
          'Stripe raised Pro tier pricing from $49/mo to $59/mo.',
          'Creates a wider pricing gap for startup buyers.',
          '2026-09-27T12:00:00.000Z'
        )
      `,
    )
    .run();

  return { sqlite, db };
}

test("migration 0010 enforces external notification channel and delivery ledger constraints and indexes", (t) => {
  const { sqlite } = createD1Fixture(t);

  const indexes = sqlite
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND tbl_name IN (
            'external_notification_channels',
            'external_notification_deliveries'
          )
          AND name NOT LIKE 'sqlite_autoindex_%'
        ORDER BY name ASC
      `,
    )
    .all()
    .map((row) => row.name);

  assert.deepEqual(indexes, [
    "idx_external_deliveries_change",
    "idx_external_deliveries_channel_change",
    "idx_external_deliveries_channel_digest",
    "idx_external_deliveries_digest",
    "idx_external_deliveries_status",
    "idx_external_deliveries_workspace",
    "idx_external_notification_channels_workspace",
  ]);

  assert.throws(() => {
    sqlite
      .prepare(
        `
          INSERT INTO external_notification_channels (
            id, workspace_id, channel, name, status, config_json
          )
          VALUES ('ch_bad', 'ws_acme', 'discord', 'Discord', 'active', '{}')
        `,
      )
      .run();
  }, /CHECK constraint failed/);

  assert.throws(() => {
    sqlite
      .prepare(
        `
          INSERT INTO external_notification_channels (
            id, workspace_id, channel, name, status, config_json
          )
          VALUES ('ch_bad_json', 'ws_acme', 'slack', 'Slack', 'active', '{not json')
        `,
      )
      .run();
  }, /CHECK constraint failed/);

  sqlite
    .prepare(
      `
        INSERT INTO external_notification_channels (
          id, workspace_id, channel, name, status, config_json
        )
        VALUES (
          'ch_slack_1',
          'ws_acme',
          'slack',
          'Product Alerts',
          'active',
          '{"webhookUrl":"https://hooks.slack.com/services/T1/B1/X1"}'
        )
      `,
    )
    .run();

  assert.throws(() => {
    sqlite
      .prepare(
        `
          INSERT INTO external_notification_deliveries (
            id, workspace_id, channel_id, channel, source_type, change_id, digest_id,
            status, attempt_count, claim_token, claimed_at
          )
          VALUES (
            'del_bad_source', 'ws_acme', 'ch_slack_1', 'slack', 'change', NULL, NULL,
            'sending', 1, 'tok_1', CURRENT_TIMESTAMP
          )
        `,
      )
      .run();
  }, /CHECK constraint failed/);

  assert.throws(() => {
    sqlite
      .prepare(
        `
          INSERT INTO external_notification_deliveries (
            id, workspace_id, channel_id, channel, source_type, change_id,
            status, attempt_count, claim_token, claimed_at, sent_at
          )
          VALUES (
            'del_bad_state', 'ws_acme', 'ch_slack_1', 'slack', 'change', 'chg_stripe_01',
            'sent', 1, 'tok_should_be_null', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `,
      )
      .run();
  }, /CHECK constraint failed/);

  sqlite
    .prepare(
      `
        INSERT INTO external_notification_deliveries (
          id, workspace_id, channel_id, channel, source_type, change_id,
          status, attempt_count, claim_token, claimed_at
        )
        VALUES (
          'del_valid_1', 'ws_acme', 'ch_slack_1', 'slack', 'change', 'chg_stripe_01',
          'sending', 1, 'tok_1', CURRENT_TIMESTAMP
        )
      `,
    )
    .run();

  assert.throws(() => {
    sqlite
      .prepare(
        `
          INSERT INTO external_notification_deliveries (
            id, workspace_id, channel_id, channel, source_type, change_id,
            status, attempt_count, claim_token, claimed_at
          )
          VALUES (
            'del_dup_1', 'ws_acme', 'ch_slack_1', 'slack', 'change', 'chg_stripe_01',
            'sending', 1, 'tok_2', CURRENT_TIMESTAMP
          )
        `,
      )
      .run();
  }, /UNIQUE constraint failed/);
});

test("parseExternalChannelConfig validates Slack, Telegram, and webhook destination configurations", () => {
  assert.deepEqual(
    parseExternalChannelConfig(
      "slack",
      JSON.stringify({
        webhookUrl:
          "https://hooks.slack.com/services/T1/B1/X1",
      }),
    ),
    {
      channel: "slack",
      webhookUrl:
        "https://hooks.slack.com/services/T1/B1/X1",
    },
  );

  assert.deepEqual(
    parseExternalChannelConfig(
      "telegram",
      JSON.stringify({
        botToken: "12345:ABCDEF",
        chatId: "-100123456",
      }),
    ),
    {
      channel: "telegram",
      botToken: "12345:ABCDEF",
      chatId: "-100123456",
    },
  );

  assert.deepEqual(
    parseExternalChannelConfig(
      "webhook",
      JSON.stringify({
        url: "https://customer.example/morrow/events",
        secret: "whsec_secret_123",
      }),
    ),
    {
      channel: "webhook",
      url: "https://customer.example/morrow/events",
      secret: "whsec_secret_123",
    },
  );

  assert.throws(
    () =>
      parseExternalChannelConfig(
        "slack",
        JSON.stringify({
          webhookUrl:
            "http://hooks.slack.com/services/T1/B1/X1",
        }),
      ),
    /must use HTTPS/,
  );

  assert.throws(
    () =>
      parseExternalChannelConfig(
        "webhook",
        JSON.stringify({
          url: "https://customer.example/morrow/events",
          secret: "   ",
        }),
      ),
    /Webhook signing secret must be a non-empty string/,
  );
});

test("notifyChangeByExternalChannels delivers across Slack, Telegram, and webhook with idempotency, failure isolation, and retry", async (t) => {
  const { sqlite, db } = createD1Fixture(t);

  sqlite
    .prepare(
      `
        INSERT INTO external_notification_channels (
          id, workspace_id, channel, name, status, config_json
        )
        VALUES
          (
            'ch_1_slack',
            'ws_acme',
            'slack',
            'Slack Alerts',
            'active',
            '{"webhookUrl":"https://hooks.slack.com/services/T1/B1/X1"}'
          ),
          (
            'ch_2_telegram',
            'ws_acme',
            'telegram',
            'Telegram Ops',
            'active',
            '{"botToken":"99999:BOT_TOKEN","chatId":"-100555"}'
          ),
          (
            'ch_3_webhook',
            'ws_acme',
            'webhook',
            'Customer Webhook',
            'active',
            '{"url":"https://events.acme.test/morrow","secret":"whsec_acme_secret"}'
          ),
          (
            'ch_4_paused',
            'ws_acme',
            'slack',
            'Paused Slack',
            'paused',
            '{"webhookUrl":"https://hooks.slack.com/services/T1/B1/PAUSED"}'
          ),
          (
            'ch_5_other_ws',
            'ws_other',
            'slack',
            'Other Workspace Slack',
            'active',
            '{"webhookUrl":"https://hooks.slack.com/services/T2/B2/OTHER"}'
          )
      `,
    )
    .run();

  const missingResult =
    await notifyChangeByExternalChannels(
      {
        DB: db,
        MORROW_APP_URL: "https://morrow.example.com",
      },
      "chg_does_not_exist",
    );
  assert.equal(missingResult.changeFound, false);
  assert.equal(missingResult.sent, 0);

  const unconfiguredResult =
    await notifyChangeByExternalChannels(
      {
        DB: db,
      },
      "chg_stripe_01",
    );
  assert.equal(unconfiguredResult.changeFound, true);
  assert.equal(unconfiguredResult.configured, false);
  assert.equal(unconfiguredResult.channelsFound, 3);
  assert.equal(unconfiguredResult.sent, 0);

  const calls = [];
  let failWebhook = true;

  const fetcher = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.startsWith("https://hooks.slack.com/")) {
      return new Response("ok", {
        status: 200,
        headers: {
          "x-slack-req-id": "slack_msg_01",
        },
      });
    }

    if (url.startsWith("https://api.telegram.org/")) {
      return Response.json({
        ok: true,
        result: {
          message_id: 7788,
        },
      });
    }

    if (url === "https://events.acme.test/morrow") {
      if (failWebhook) {
        return Response.json(
          { message: "Temporary downstream timeout" },
          { status: 503 },
        );
      }

      const verified = await verifyWebhookSignature(
        "whsec_acme_secret",
        init.headers["X-Morrow-Timestamp"],
        init.body,
        init.headers["X-Morrow-Signature"],
      );
      assert.equal(verified, true);
      return Response.json(
        { id: "webhook_msg_01" },
        { status: 200 },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const firstRun = await notifyChangeByExternalChannels(
    {
      DB: db,
      MORROW_APP_URL: "https://morrow.example.com",
    },
    "chg_stripe_01",
    fetcher,
  );

  assert.deepEqual(firstRun, {
    changeId: "chg_stripe_01",
    changeFound: true,
    configured: true,
    channelsFound: 3,
    sent: 2,
    alreadySent: 0,
    inFlight: 0,
    failed: 1,
  });
  assert.equal(calls.length, 3);

  const ledgerAfterFirst = sqlite
    .prepare(
      `
        SELECT channel_id, channel, status, attempt_count, provider_message_id, last_error
        FROM external_notification_deliveries
        WHERE change_id = 'chg_stripe_01'
        ORDER BY channel_id ASC
      `,
    )
    .all()
    .map((row) => ({ ...row }));

  assert.deepEqual(ledgerAfterFirst, [
    {
      channel_id: "ch_1_slack",
      channel: "slack",
      status: "sent",
      attempt_count: 1,
      provider_message_id: "slack_msg_01",
      last_error: null,
    },
    {
      channel_id: "ch_2_telegram",
      channel: "telegram",
      status: "sent",
      attempt_count: 1,
      provider_message_id: "7788",
      last_error: null,
    },
    {
      channel_id: "ch_3_webhook",
      channel: "webhook",
      status: "failed",
      attempt_count: 1,
      provider_message_id: null,
      last_error:
        "Webhook delivery failed (503): Temporary downstream timeout",
    },
  ]);

  // Underlying change record remains untouched after partial provider failure
  const persistedChange = sqlite
    .prepare(
      "SELECT id FROM changes WHERE id = 'chg_stripe_01'",
    )
    .get();
  assert.equal(persistedChange.id, "chg_stripe_01");

  // Retry succeeds for the failed webhook without re-sending to Slack or Telegram
  failWebhook = false;
  const secondRun = await notifyChangeByExternalChannels(
    {
      DB: db,
      MORROW_APP_URL: "https://morrow.example.com",
    },
    "chg_stripe_01",
    fetcher,
  );

  assert.deepEqual(secondRun, {
    changeId: "chg_stripe_01",
    changeFound: true,
    configured: true,
    channelsFound: 3,
    sent: 1,
    alreadySent: 2,
    inFlight: 0,
    failed: 0,
  });
  assert.equal(calls.length, 4);

  const webhookRow = {
    ...sqlite
      .prepare(
        `
          SELECT status, attempt_count, provider_message_id, last_error
          FROM external_notification_deliveries
          WHERE channel_id = 'ch_3_webhook'
            AND change_id = 'chg_stripe_01'
        `,
      )
      .get(),
  };

  assert.deepEqual(webhookRow, {
    status: "sent",
    attempt_count: 2,
    provider_message_id: "webhook_msg_01",
    last_error: null,
  });

  // Third call suppresses all three channels without making any network request
  const thirdRun = await notifyChangeByExternalChannels(
    {
      DB: db,
      MORROW_APP_URL: "https://morrow.example.com",
    },
    "chg_stripe_01",
    fetcher,
  );

  assert.deepEqual(thirdRun, {
    changeId: "chg_stripe_01",
    changeFound: true,
    configured: true,
    channelsFound: 3,
    sent: 0,
    alreadySent: 3,
    inFlight: 0,
    failed: 0,
  });
  assert.equal(calls.length, 4);
});

test("stale sending claims are recovered after 15 minutes while fresh sending claims are skipped as inFlight", async (t) => {
  const { sqlite, db } = createD1Fixture(t);

  sqlite
    .prepare(
      `
        INSERT INTO external_notification_channels (
          id, workspace_id, channel, name, status, config_json
        )
        VALUES (
          'ch_slack_claim',
          'ws_acme',
          'slack',
          'Slack Claim Test',
          'active',
          '{"webhookUrl":"https://hooks.slack.com/services/T1/B1/CLAIM"}'
        )
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        INSERT INTO external_notification_deliveries (
          id, workspace_id, channel_id, channel, source_type, change_id,
          status, attempt_count, claim_token, claimed_at
        )
        VALUES (
          'deliv_inflight',
          'ws_acme',
          'ch_slack_claim',
          'slack',
          'change',
          'chg_stripe_01',
          'sending',
          1,
          'tok_fresh',
          datetime('now')
        )
      `,
    )
    .run();

  let networkCalls = 0;
  const fetcher = async () => {
    networkCalls += 1;
    return new Response("ok", { status: 200 });
  };

  const inFlightRun = await notifyChangeByExternalChannels(
    {
      DB: db,
      MORROW_APP_URL: "https://morrow.example.com",
    },
    "chg_stripe_01",
    fetcher,
  );

  assert.equal(inFlightRun.inFlight, 1);
  assert.equal(inFlightRun.sent, 0);
  assert.equal(networkCalls, 0);

  // Age the sending claim past 15 minutes to simulate a terminated Worker isolate
  sqlite
    .prepare(
      `
        UPDATE external_notification_deliveries
        SET claimed_at = datetime('now', '-16 minutes')
        WHERE id = 'deliv_inflight'
      `,
    )
    .run();

  const recoveredRun = await notifyChangeByExternalChannels(
    {
      DB: db,
      MORROW_APP_URL: "https://morrow.example.com",
    },
    "chg_stripe_01",
    fetcher,
  );

  assert.equal(recoveredRun.sent, 1);
  assert.equal(recoveredRun.inFlight, 0);
  assert.equal(networkCalls, 1);

  const row = {
    ...sqlite
      .prepare(
        "SELECT status, attempt_count, claim_token FROM external_notification_deliveries WHERE id = 'deliv_inflight'",
      )
      .get(),
  };
  assert.deepEqual(row, {
    status: "sent",
    attempt_count: 2,
    claim_token: null,
  });
});

test("notifyDigestByExternalChannels and runDigestScheduler deliver generated digests downstream and retry failed channels on reuse ticks", async (t) => {
  const { sqlite, db } = createD1Fixture(t);

  sqlite
    .prepare(
      `
        INSERT INTO external_notification_channels (
          id, workspace_id, channel, name, status, config_json
        )
        VALUES
          (
            'ch_digest_slack',
            'ws_acme',
            'slack',
            'Exec Digest Slack',
            'active',
            '{"webhookUrl":"https://hooks.slack.com/services/T1/B1/DIGEST"}'
          ),
          (
            'ch_digest_webhook',
            'ws_acme',
            'webhook',
            'Exec Digest Webhook',
            'active',
            '{"url":"https://events.acme.test/digest","secret":"whsec_digest_secret"}'
          )
      `,
    )
    .run();

  let failWebhook = true;
  const deliveredPayloads = [];

  const fetcher = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://hooks.slack.com/")) {
      deliveredPayloads.push({
        channel: "slack",
        body: JSON.parse(init.body),
      });
      return new Response("ok", {
        status: 200,
        headers: { "x-slack-req-id": "slack_digest_01" },
      });
    }

    if (url === "https://events.acme.test/digest") {
      if (failWebhook) {
        return new Response("gateway timeout", {
          status: 504,
        });
      }
      const event = JSON.parse(init.body);
      deliveredPayloads.push({
        channel: "webhook",
        body: event,
      });
      return Response.json(
        { id: "wh_digest_01" },
        { status: 200 },
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  // Run scheduler at 2026-09-28T00:00:00.000Z (Monday -> runs daily + weekly digests)
  const firstTick = await runDigestScheduler(
    db,
    "2026-09-28T00:00:00.000Z",
    {
      deliverDigest: (digest) =>
        notifyDigestByExternalChannels(
          {
            DB: db,
            MORROW_APP_URL: "https://morrow.example.com",
          },
          digest.id,
          fetcher,
        ),
    },
  );

  // Two workspaces * two due windows (daily + weekly) = 4 generated digests, 0 scheduler failures
  assert.equal(firstTick.generatedCount, 4);
  assert.equal(firstTick.failedCount, 0);

  const acmeDigests = sqlite
    .prepare(
      `
        SELECT id, period, status, change_count
        FROM digests
        WHERE workspace_id = 'ws_acme'
        ORDER BY period ASC
      `,
    )
    .all();
  assert.equal(acmeDigests.length, 2);

  // For ws_acme's 2 digests: Slack succeeded (2), Webhook failed (2)
  const firstTickDeliveries = sqlite
    .prepare(
      `
        SELECT channel, status, attempt_count
        FROM external_notification_deliveries
        WHERE workspace_id = 'ws_acme'
          AND source_type = 'digest'
        ORDER BY digest_id ASC, channel_id ASC
      `,
    )
    .all();
  assert.equal(firstTickDeliveries.length, 4);
  assert.equal(
    firstTickDeliveries.filter((d) => d.status === "sent")
      .length,
    2,
  );
  assert.equal(
    firstTickDeliveries.filter((d) => d.status === "failed")
      .length,
    2,
  );

  // Next 5-minute retry tick (00:05:00.000Z) reuses the generated digests and retries only the failed webhook deliveries
  failWebhook = false;
  const secondTick = await runDigestScheduler(
    db,
    "2026-09-28T00:05:00.000Z",
    {
      deliverDigest: (digest) =>
        notifyDigestByExternalChannels(
          {
            DB: db,
            MORROW_APP_URL: "https://morrow.example.com",
          },
          digest.id,
          fetcher,
        ),
    },
  );

  assert.equal(secondTick.generatedCount, 0);
  assert.equal(secondTick.reusedCount, 4);
  assert.equal(secondTick.failedCount, 0);

  const secondTickDeliveries = sqlite
    .prepare(
      `
        SELECT channel, status, attempt_count, provider_message_id
        FROM external_notification_deliveries
        WHERE workspace_id = 'ws_acme'
          AND source_type = 'digest'
        ORDER BY channel ASC
      `,
    )
    .all()
    .map((row) => ({ ...row }));

  assert.deepEqual(secondTickDeliveries, [
    {
      channel: "slack",
      status: "sent",
      attempt_count: 1,
      provider_message_id: "slack_digest_01",
    },
    {
      channel: "slack",
      status: "sent",
      attempt_count: 1,
      provider_message_id: "slack_digest_01",
    },
    {
      channel: "webhook",
      status: "sent",
      attempt_count: 2,
      provider_message_id: "wh_digest_01",
    },
    {
      channel: "webhook",
      status: "sent",
      attempt_count: 2,
      provider_message_id: "wh_digest_01",
    },
  ]);

  // Verify direct call with an existing generated digest is now completely idempotent
  const repeatResult = await notifyDigestByExternalChannels(
    {
      DB: db,
      MORROW_APP_URL: "https://morrow.example.com",
    },
    acmeDigests[0].id,
    fetcher,
  );
  assert.equal(repeatResult.sent, 0);
  assert.equal(repeatResult.alreadySent, 2);
  assert.equal(repeatResult.failed, 0);

  // Confirm generateDigest reuse still works cleanly
  const reused = await generateDigest(
    db,
    "ws_acme",
    "daily",
    "2026-09-27T00:00:00.000Z",
    "2026-09-28T00:00:00.000Z",
  );
  assert.equal(reused.reused, true);
});
