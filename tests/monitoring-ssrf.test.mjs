import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { findFaviconUrl } from "../lib/competitor-favicon.ts";
import { UnsafeUrlError, normalizeMonitoredPageUrl } from "../lib/url-safety.ts";

test("monitored page URLs must be public http(s) URLs", () => {
  assert.equal(normalizeMonitoredPageUrl("example.com/pricing#plans"), "https://example.com/pricing");
  assert.equal(normalizeMonitoredPageUrl("http://example.com/a"), "http://example.com/a");
  for (const bad of [
    "http://localhost:8787/", "http://127.0.0.1/", "https://169.254.169.254/latest/meta-data/",
    "http://10.1.2.3/admin", "https://[::1]/", "file:///etc/passwd", "ftp://example.com/",
    "javascript:alert(1)", "https://user:pw@example.com/", "http://metadata.google.internal/",
  ]) {
    assert.throws(() => normalizeMonitoredPageUrl(bad), UnsafeUrlError, `${bad} must be rejected`);
  }
});

test("favicon discovery never requests internal redirect targets or returns unsafe icon URLs", async () => {
  const requested = [];
  const redirecting = async (url) => {
    requested.push(String(url));
    return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } });
  };
  assert.equal(await findFaviconUrl("example.com", redirecting), "https://example.com/favicon.ico");
  assert.deepEqual(requested, ["https://example.com/"]);

  const internalIcon = async () =>
    new Response('<link rel="icon" href="http://127.0.0.1/x.png"><link rel="shortcut icon" href="//cdn.example.org/i.png">');
  assert.equal(await findFaviconUrl("example.com", internalIcon), "https://cdn.example.org/i.png");

  const onlyUnsafe = async () => new Response('<link rel="icon" href="https://10.0.0.1/x.png">');
  assert.equal(await findFaviconUrl("example.com", onlyUnsafe), "https://example.com/favicon.ico");
});

test("server actions and the capture worker route outbound fetches through the SSRF guard", () => {
  const competitors = readFileSync("app/dashboard/competitors/actions.ts", "utf8");
  const pages = readFileSync("app/dashboard/competitors/[competitorId]/actions.ts", "utf8");
  const worker = readFileSync("worker/index.ts", "utf8");
  assert.match(competitors, /normalizeCompetitorDomain/);
  assert.match(competitors, /from "@\/lib\/competitor-favicon"/);
  assert.doesNotMatch(competitors, /await\s+fetch\(/, "competitor actions must not fetch user domains directly");
  assert.match(pages, /normalizeMonitoredPageUrl/);
  assert.match(pages, /fetchPublicText/);
  assert.doesNotMatch(pages, /await\s+fetch\(/, "page actions must not fetch user URLs directly");
  assert.match(worker, /assertPublicUrl/, "capture must re-validate stored URLs before rendering");
});
