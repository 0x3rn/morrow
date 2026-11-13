import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createTelegramLinkValidationHandler,
  createTelegramWebhookHandler,
  telegramSecretMatches,
} from "../lib/telegram-bot.ts";

const SECRET = "local-test-secret-value";

function fakeDb() {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      statements.push(sql);
      return {
        bind() { return this; },
        async run() { return { success: true, meta: { changes: 1 } }; },
        async first() { return null; },
        async all() { return { results: [] }; },
      };
    },
  };
}

function webhookRequest(secret) {
  return new Request("https://morrow.test/api/webhooks/telegram", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret === undefined ? {} : { "x-telegram-bot-api-secret-token": secret }) },
    body: JSON.stringify({ message: { chat: { id: 1 }, text: "hello" } }),
  });
}

test("telegramSecretMatches compares secrets without length or content shortcuts", () => {
  assert.equal(telegramSecretMatches(SECRET, SECRET), true);
  assert.equal(telegramSecretMatches(SECRET + "x", SECRET), false);
  assert.equal(telegramSecretMatches(SECRET.slice(0, -1), SECRET), false);
  assert.equal(telegramSecretMatches("", SECRET), false);
  assert.equal(telegramSecretMatches("é".repeat(10), "e".repeat(10)), false);
});

test("telegram webhook rejects missing and wrong secrets and accepts the right one", async () => {
  const handler = createTelegramWebhookHandler({ DB: fakeDb(), MORROW_TELEGRAM_WEBHOOK_SECRET: SECRET });
  assert.equal((await handler(webhookRequest(undefined))).status, 401);
  assert.equal((await handler(webhookRequest("wrong"))).status, 401);
  assert.equal((await handler(webhookRequest(SECRET + " "))).status, 200, "surrounding whitespace is trimmed like before");
  assert.equal((await handler(webhookRequest(SECRET))).status, 200);
});

test("telegram link validation accepts the secret by header or bearer token only", async () => {
  const handler = createTelegramLinkValidationHandler({ DB: fakeDb(), MORROW_TELEGRAM_WEBHOOK_SECRET: SECRET });
  const call = (headers) =>
    handler(new Request("https://morrow.test/api/telegram/link", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ code: "MRW-ABCDEFGH", chatId: "1" }),
    }));
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ authorization: "Bearer nope" })).status, 401);
  assert.notEqual((await call({ authorization: `Bearer ${SECRET}` })).status, 401);
  assert.notEqual((await call({ "x-telegram-bot-api-secret-token": SECRET })).status, 401);
});

test("telegram handlers fail closed when no secret is configured", async () => {
  for (const configured of [undefined, "", "   "]) {
    const env = { DB: fakeDb(), MORROW_TELEGRAM_WEBHOOK_SECRET: configured };
    const webhook = createTelegramWebhookHandler(env);
    const link = createTelegramLinkValidationHandler(env);
    assert.equal((await webhook(webhookRequest(undefined))).status, 503);
    assert.equal((await webhook(webhookRequest("anything"))).status, 503);
    const linkResponse = await link(new Request("https://morrow.test/api/telegram/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "MRW-ABCDEFGH", chatId: "1" }),
    }));
    assert.equal(linkResponse.status, 503);
  }
});

test("telegram handlers never compare the shared secret with !== or ===", () => {
  const source = readFileSync("lib/telegram-bot.ts", "utf8");
  assert.doesNotMatch(source, /providedSecret\s*[!=]==\s*configuredSecret/);
});
