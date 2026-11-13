import assert from "node:assert/strict";
import test from "node:test";

import {
  UnsafeUrlError,
  assertPublicUrl,
  fetchPublicText,
  isPublicHostname,
  normalizeCompetitorDomain,
} from "../lib/url-safety.ts";
import { assertHttpsUrl } from "../worker/external-delivery.ts";

const BLOCKED_HOSTS = [
  "localhost", "LOCALHOST.", "app.localhost", "intranet", "printer.local", "db.internal",
  "metadata.google.internal", "127.0.0.1", "127.1.2.3", "10.0.0.5", "172.16.0.1", "172.31.255.255",
  "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
  "[::1]", "[::]", "[fd00::1]", "[fe80::1]", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]",
  "[::ffff:a9fe:a9fe]", "[64:ff9b::7f00:1]", "[2002:7f00:1::]", "[2001:db8::1]", "[ff02::1]",
];

const ALLOWED_HOSTS = [
  "example.com", "www.competitor.io", "sub.domain.co.uk", "8.8.8.8", "172.32.0.1", "[2606:4700:4700::1111]", "xn--bcher-kva.example.org",
];

test("private, loopback, metadata and internal hosts are rejected", () => {
  for (const host of BLOCKED_HOSTS) {
    assert.equal(isPublicHostname(host), false, `${host} must be blocked`);
  }
});

test("public hosts are accepted", () => {
  for (const host of ALLOWED_HOSTS) {
    assert.equal(isPublicHostname(host), true, `${host} must be allowed`);
  }
});

test("URL parser normalised IP forms are blocked (decimal, hex, octal, short)", () => {
  for (const raw of ["http://2130706433/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://127.1/", "https://[::ffff:127.0.0.1]/"]) {
    assert.throws(() => assertPublicUrl(raw, { protocols: ["http:", "https:"] }), UnsafeUrlError, raw);
  }
});

test("assertPublicUrl enforces scheme, credentials and host", () => {
  assert.throws(() => assertPublicUrl("file:///etc/passwd", { protocols: ["http:", "https:"] }), /HTTP or HTTPS/);
  assert.throws(() => assertPublicUrl("ftp://example.com/", { protocols: ["http:", "https:"] }), /HTTP or HTTPS/);
  assert.throws(() => assertPublicUrl("http://example.com/"), /HTTPS/);
  assert.throws(() => assertPublicUrl("https://user:pw@example.com/"), /credentials/);
  assert.throws(() => assertPublicUrl("https://169.254.169.254/latest/meta-data/"), /public website/);
  assert.throws(() => assertPublicUrl("not a url"), /valid URL/);
  assert.equal(assertPublicUrl("https://example.com/a?b=1#c").hostname, "example.com");
});

test("competitor domains are normalised and internal or malformed input rejected", () => {
  assert.equal(normalizeCompetitorDomain(" https://www.Example.COM/pricing?x=1 "), "example.com");
  assert.equal(normalizeCompetitorDomain("sub.example.co.uk/"), "sub.example.co.uk");
  for (const bad of ["", "localhost", "127.0.0.1", "169.254.169.254", "10.0.0.1", "example.com@evil.com", "user:pw@example.com", "example.com:8080", "exa mple.com", "[::1]", "intranet", "a.internal", "javascript:alert(1)", "evil.com\\@good.com"]) {
    assert.throws(() => normalizeCompetitorDomain(bad), UnsafeUrlError, `"${bad}" must be rejected`);
  }
});

test("webhook and Slack URLs cannot target internal hosts", () => {
  assert.throws(() => assertHttpsUrl("https://127.0.0.1/hook", "Webhook URL"), /public website/);
  assert.throws(() => assertHttpsUrl("https://169.254.169.254/latest", "Webhook URL"), /public website/);
  assert.throws(() => assertHttpsUrl("https://localhost/hook", "Webhook URL"), /public website/);
  assert.throws(() => assertHttpsUrl("https://[::1]/hook", "Webhook URL"), /public website/);
  assert.equal(assertHttpsUrl("https://hooks.slack.com/services/T0/B0/X0", "Slack webhook URL"), "https://hooks.slack.com/services/T0/B0/X0");
});

function redirectResponse(location) {
  return new Response(null, { status: 302, headers: { location } });
}

test("fetchPublicText re-validates every redirect hop", async () => {
  const requested = [];
  const fetcher = async (url) => {
    requested.push(String(url));
    return redirectResponse("http://169.254.169.254/latest/meta-data/");
  };
  await assert.rejects(() => fetchPublicText("https://example.com/", { fetcher }), UnsafeUrlError);
  assert.deepEqual(requested, ["https://example.com/"], "the internal redirect target must never be requested");
});

test("fetchPublicText blocks internal start URLs without requesting them", async () => {
  let called = false;
  const fetcher = async () => { called = true; return new Response("secret"); };
  await assert.rejects(() => fetchPublicText("http://localhost:8787/admin", { fetcher }), UnsafeUrlError);
  await assert.rejects(() => fetchPublicText("file:///etc/passwd", { fetcher }), UnsafeUrlError);
  assert.equal(called, false);
});

test("fetchPublicText follows public redirects, limits hops and body size", async () => {
  const fetcher = async (url) =>
    String(url) === "https://example.com/" ? redirectResponse("/next") : new Response("hello world");
  const result = await fetchPublicText("https://example.com/", { fetcher });
  assert.equal(result.text, "hello world");
  assert.equal(result.url, "https://example.com/next");

  const loop = async () => redirectResponse("https://example.com/again");
  await assert.rejects(() => fetchPublicText("https://example.com/", { fetcher: loop, maxRedirects: 2 }), /redirects/);

  const big = async () => new Response("x".repeat(5000));
  await assert.rejects(() => fetchPublicText("https://example.com/", { fetcher: big, maxBytes: 1000 }), /too large/);
});
