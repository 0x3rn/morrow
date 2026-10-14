import assert from "node:assert/strict";
import test from "node:test";

import {
  assertHttpsUrl,
  buildChangeDeliveryEvent,
  buildDigestDeliveryEvent,
  buildSlackPayload,
  buildTelegramMessage,
  deliverExternalEvent,
  isExternalDeliveryChannel,
  sendSlackNotification,
  sendTelegramNotification,
  sendWebhookNotification,
  signWebhookPayload,
  verifyWebhookSignature,
} from "../worker/external-delivery.ts";

const sampleChangeContext = {
  change_id: "chg_stripe_pricing_01",
  category: "pricing",
  significance: "major",
  summary:
    "Stripe raised its standard card processing tier from $49/month to $59/month.",
  why_it_matters:
    "Higher entry pricing creates room to position a lower-cost starter plan.",
  detected_at: "2026-09-28T10:15:00.000Z",
  monitored_page_id: "page_stripe_pricing",
  monitored_page_url: "https://stripe.com/pricing",
  monitored_page_label: "Pricing",
  competitor_id: "comp_stripe",
  competitor_name: "Stripe",
  competitor_domain: "stripe.com",
  workspace_id: "ws_acme",
};

const sampleGeneratedDigest = {
  id: "digest_weekly_01",
  workspaceId: "ws_acme",
  period: "weekly",
  windowStart: "2026-09-21T00:00:00.000Z",
  windowEnd: "2026-09-28T00:00:00.000Z",
  status: "generated",
  generatedAt: "2026-09-28T00:05:00.000Z",
  reused: false,
  content: {
    version: 1,
    workspaceId: "ws_acme",
    period: "weekly",
    windowStart: "2026-09-21T00:00:00.000Z",
    windowEnd: "2026-09-28T00:00:00.000Z",
    generatedAt: "2026-09-28T00:05:00.000Z",
    totals: {
      changes: 2,
      major: 1,
      moderate: 1,
      minor: 0,
    },
    categoryCounts: {
      pricing: 1,
      product: 0,
      feature: 1,
      positioning: 0,
      promotion: 0,
      policy: 0,
      navigation: 0,
      content: 0,
      other: 0,
    },
    competitors: [
      {
        competitor: {
          id: "comp_stripe",
          name: "Stripe",
          domain: "stripe.com",
        },
        changeCount: 2,
        majorChangeCount: 1,
        moderateChangeCount: 1,
        minorChangeCount: 0,
        categories: {
          pricing: 1,
          feature: 1,
        },
        changes: [
          {
            id: "chg_stripe_pricing_01",
            category: "pricing",
            significance: "major",
            summary:
              "Stripe raised its standard card processing tier from $49/month to $59/month.",
            whyItMatters:
              "Higher entry pricing creates room to position a lower-cost starter plan.",
            detectedAt: "2026-09-27T14:00:00.000Z",
            monitoredPage: {
              id: "page_stripe_pricing",
              url: "https://stripe.com/pricing",
              label: "Pricing",
            },
            competitor: {
              id: "comp_stripe",
              name: "Stripe",
              domain: "stripe.com",
            },
          },
        ],
      },
    ],
    changes: [],
  },
};

test("external delivery event builders produce versioned change and digest events and validate inputs", () => {
  assert.equal(isExternalDeliveryChannel("slack"), true);
  assert.equal(isExternalDeliveryChannel("telegram"), true);
  assert.equal(isExternalDeliveryChannel("webhook"), true);
  assert.equal(isExternalDeliveryChannel("email"), false);

  const changeEvent = buildChangeDeliveryEvent(
    sampleChangeContext,
    "https://morrow.example.com/some/path",
    {
      deliveryId: "deliv_change_01",
      occurredAt: "2026-09-28T10:15:05.000Z",
    },
  );

  assert.equal(changeEvent.version, 1);
  assert.equal(changeEvent.type, "change.detected");
  assert.equal(changeEvent.deliveryId, "deliv_change_01");
  assert.equal(changeEvent.workspaceId, "ws_acme");
  assert.equal(
    changeEvent.change.changeUrl,
    "https://morrow.example.com/dashboard/changes/chg_stripe_pricing_01",
  );
  assert.equal(
    changeEvent.change.competitorUrl,
    "https://morrow.example.com/dashboard/competitors/comp_stripe",
  );

  const digestEvent = buildDigestDeliveryEvent(
    sampleGeneratedDigest,
    "https://morrow.example.com",
    {
      deliveryId: "deliv_digest_01",
      occurredAt: "2026-09-28T00:05:05.000Z",
    },
  );

  assert.equal(digestEvent.version, 1);
  assert.equal(digestEvent.type, "digest.generated");
  assert.equal(digestEvent.deliveryId, "deliv_digest_01");
  assert.equal(
    digestEvent.digest.dashboardUrl,
    "https://morrow.example.com/dashboard",
  );
  assert.equal(
    digestEvent.digest.changesUrl,
    "https://morrow.example.com/dashboard/changes",
  );
  assert.equal(digestEvent.digest.totals.changes, 2);

  assert.throws(
    () =>
      buildChangeDeliveryEvent(
        {
          ...sampleChangeContext,
          category: "invalid_category",
        },
        "https://morrow.example.com",
      ),
    /Unsupported change category/,
  );

  assert.throws(
    () =>
      buildChangeDeliveryEvent(
        {
          ...sampleChangeContext,
          significance: "critical",
        },
        "https://morrow.example.com",
      ),
    /Unsupported change significance/,
  );

  assert.throws(
    () =>
      buildChangeDeliveryEvent(
        sampleChangeContext,
        "ftp://morrow.example.com",
      ),
    /MORROW_APP_URL must use HTTP or HTTPS/,
  );
});

test("Slack adapter builds fallback + structured blocks, escapes mrkdwn, enforces HTTPS, and bounds errors", async () => {
  const changeEvent = buildChangeDeliveryEvent(
    {
      ...sampleChangeContext,
      competitor_name: "Stripe <Billing & Co>",
      summary: "Plan changed: <Starter> & Pro > Enterprise",
    },
    "https://morrow.example.com",
    {
      deliveryId: "deliv_slack_01",
      occurredAt: "2026-09-28T10:15:05.000Z",
    },
  );

  const slackPayload = buildSlackPayload(changeEvent);
  assert.match(
    slackPayload.text,
    /Major: Stripe <Billing & Co> pricing change/,
  );
  assert.equal(slackPayload.blocks.length, 3);
  assert.equal(slackPayload.blocks[0].type, "header");
  assert.equal(slackPayload.blocks[1].type, "section");
  assert.match(
    slackPayload.blocks[1].text.text,
    /Stripe &lt;Billing &amp; Co&gt;/,
  );
  assert.match(
    slackPayload.blocks[1].text.text,
    /&lt;Starter&gt; &amp; Pro &gt; Enterprise/,
  );

  const digestPayload = buildSlackPayload(
    buildDigestDeliveryEvent(
      sampleGeneratedDigest,
      "https://morrow.example.com",
    ),
  );
  assert.match(
    digestPayload.text,
    /Morrow Weekly Digest \(2 changes\)/,
  );
  assert.match(
    digestPayload.blocks[1].text.text,
    /\*Active competitors:\*/,
  );

  const requests = [];
  const result = await sendSlackNotification(
    {
      webhookUrl:
        "https://hooks.slack.com/services/T000/B000/X000",
      event: changeEvent,
    },
    async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response("ok", {
        status: 200,
        headers: {
          "x-slack-req-id": "req_slack_123",
        },
      });
    },
  );

  assert.equal(result.channel, "slack");
  assert.equal(result.providerMessageId, "req_slack_123");
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].input,
    "https://hooks.slack.com/services/T000/B000/X000",
  );
  assert.equal(requests[0].init.method, "POST");
  const sentBody = JSON.parse(requests[0].init.body);
  assert.equal(sentBody.blocks.length, 3);

  await assert.rejects(
    () =>
      sendSlackNotification(
        {
          webhookUrl:
            "http://hooks.slack.com/services/T000/B000/X000",
          event: changeEvent,
        },
        async () => new Response("ok"),
      ),
    /Slack webhook URL must use HTTPS/,
  );

  await assert.rejects(
    () =>
      sendSlackNotification(
        {
          webhookUrl:
            "https://hooks.slack.com/services/T000/B000/X000",
          event: changeEvent,
        },
        async () =>
          new Response("invalid_payload ".repeat(100), {
            status: 400,
          }),
      ),
    (error) => {
      assert.match(
        error.message,
        /^Slack webhook delivery failed \(400\): invalid_payload/,
      );
      assert.ok(error.message.length <= 560);
      return true;
    },
  );
});

test("Telegram adapter formats change and digest messages, returns message_id, and handles Bot API errors", async () => {
  const changeEvent = buildChangeDeliveryEvent(
    sampleChangeContext,
    "https://morrow.example.com",
    {
      deliveryId: "deliv_tg_01",
      occurredAt: "2026-09-28T10:15:05.000Z",
    },
  );

  const text = buildTelegramMessage(changeEvent);
  assert.match(text, /Morrow competitor alert \(Major\)/);
  assert.match(text, /Stripe \(stripe\.com\)/);
  assert.match(
    text,
    /https:\/\/morrow\.example\.com\/dashboard\/changes\/chg_stripe_pricing_01/,
  );

  const requests = [];
  const result = await sendTelegramNotification(
    {
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      chatId: "-100987654321",
      event: changeEvent,
    },
    async (input, init) => {
      requests.push({ input: String(input), init });
      return Response.json({
        ok: true,
        result: {
          message_id: 4242,
        },
      });
    },
  );

  assert.equal(result.channel, "telegram");
  assert.equal(result.providerMessageId, "4242");
  assert.equal(
    requests[0].input,
    "https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage",
  );
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.chat_id, "-100987654321");
  assert.equal(body.disable_web_page_preview, true);

  await assert.rejects(
    () =>
      sendTelegramNotification(
        {
          botToken: "bad/token",
          chatId: "-100987654321",
          event: changeEvent,
        },
        async () => Response.json({ ok: true }),
      ),
    /Telegram bot token contains invalid URL characters/,
  );

  await assert.rejects(
    () =>
      sendTelegramNotification(
        {
          botToken: "123456:VALID_TOKEN",
          chatId: "-100987654321",
          event: changeEvent,
        },
        async () =>
          Response.json(
            {
              ok: false,
              description:
                "Bad Request: chat not found",
            },
            { status: 400 },
          ),
      ),
    /Telegram delivery failed \(400\): Bad Request: chat not found/,
  );

  await assert.rejects(
    () =>
      sendTelegramNotification(
        {
          botToken: "123456:VALID_TOKEN",
          chatId: "-100987654321",
          event: changeEvent,
        },
        async () =>
          Response.json({
            ok: true,
            result: {},
          }),
      ),
    /Telegram delivery succeeded but returned no message_id/,
  );
});

test("Webhook adapter computes deterministic HMAC-SHA256 signatures, sets Morrow headers, and enforces HTTPS", async () => {
  const digestEvent = buildDigestDeliveryEvent(
    sampleGeneratedDigest,
    "https://morrow.example.com",
    {
      deliveryId: "deliv_webhook_01",
      occurredAt: "2026-09-28T00:05:05.000Z",
    },
  );

  const rawBody = JSON.stringify(digestEvent);
  const signature = await signWebhookPayload(
    "whsec_morrow_test_secret_key",
    "1790553905",
    rawBody,
  );
  assert.match(signature, /^sha256=[0-9a-f]{64}$/);

  const valid = await verifyWebhookSignature(
    "whsec_morrow_test_secret_key",
    "1790553905",
    rawBody,
    signature,
  );
  assert.equal(valid, true);

  const invalid = await verifyWebhookSignature(
    "whsec_wrong_secret",
    "1790553905",
    rawBody,
    signature,
  );
  assert.equal(invalid, false);

  let capturedRequest = null;
  const result = await deliverExternalEvent(
    {
      channel: "webhook",
      url: "https://events.customer.example/morrow/webhook",
      secret: "whsec_morrow_test_secret_key",
      timestamp: "1790553905",
    },
    digestEvent,
    async (input, init) => {
      capturedRequest = { input: String(input), init };
      return Response.json(
        { id: "evt_ack_99" },
        { status: 202 },
      );
    },
  );

  assert.equal(result.channel, "webhook");
  assert.equal(result.providerMessageId, "evt_ack_99");
  assert.equal(result.signature, signature);
  assert.equal(
    capturedRequest.init.headers["X-Morrow-Event"],
    "digest.generated",
  );
  assert.equal(
    capturedRequest.init.headers["X-Morrow-Delivery"],
    "deliv_webhook_01",
  );
  assert.equal(
    capturedRequest.init.headers["X-Morrow-Timestamp"],
    "1790553905",
  );
  assert.equal(
    capturedRequest.init.headers["X-Morrow-Signature"],
    signature,
  );
  assert.equal(capturedRequest.init.body, rawBody);

  assert.throws(
    () =>
      assertHttpsUrl(
        "https://user:pass@events.customer.example/hook",
        "Webhook destination URL",
      ),
    /must not embed credentials/,
  );

  await assert.rejects(
    () =>
      sendWebhookNotification(
        {
          url: "http://events.customer.example/morrow/webhook",
          secret: "whsec_morrow_test_secret_key",
          event: digestEvent,
        },
        async () => new Response("ok"),
      ),
    /Webhook destination URL must use HTTPS/,
  );

  await assert.rejects(
    () =>
      sendWebhookNotification(
        {
          url: "https://events.customer.example/morrow/webhook",
          secret: "whsec_morrow_test_secret_key",
          event: digestEvent,
        },
        async () =>
          Response.json(
            { message: "Downstream queue overloaded" },
            { status: 503 },
          ),
      ),
    /Webhook delivery failed \(503\): Downstream queue overloaded/,
  );
});
