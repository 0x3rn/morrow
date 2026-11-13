import assert from "node:assert/strict";
import test from "node:test";

import { createLemonSqueezyWebhookHandler } from "../lib/lemonsqueezy.ts";

const URL_ = "https://morrow.example.com/api/webhooks/lemonsqueezy";
const dbThatMustNotBeUsed = {
  prepare() { throw new Error("database must not be touched for rejected payloads"); },
  batch() { throw new Error("database must not be touched for rejected payloads"); },
};
const handler = createLemonSqueezyWebhookHandler({
  DB: dbThatMustNotBeUsed,
  LEMONSQUEEZY_WEBHOOK_SECRET: "test-only-webhook-secret",
});

test("webhook rejects a declared oversized body before reading or verifying it", async () => {
  const response = await handler(new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024), "x-signature": "0".repeat(64) },
    body: "{}",
  }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).ok, false);
});

test("webhook rejects an oversized body even when content-length is missing", async () => {
  const body = JSON.stringify({ pad: "x".repeat(1024 * 1024 + 10) });
  const response = await handler(new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": "0".repeat(64) },
    body,
  }));
  assert.equal(response.status, 413);
});

test("webhook still reaches signature verification for normal-sized bodies", async () => {
  const response = await handler(new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": "0".repeat(64) },
    body: JSON.stringify({ meta: { event_name: "subscription_created" } }),
  }));
  assert.notEqual(response.status, 413);
  assert.ok(response.status >= 400 && response.status < 500, `forged signature is a client error, got ${response.status}`);
});
