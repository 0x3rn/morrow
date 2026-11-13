import assert from "node:assert/strict";
import test from "node:test";

async function loadHeaders(nodeEnv) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    const module = await import(`../next.config.ts?env=${nodeEnv}`);
    const config = module.default;
    assert.equal(typeof config.headers, "function", "next.config must define security headers");
    const rules = await config.headers();
    const all = rules.find((rule) => rule.source === "/:path*");
    assert.ok(all, "security headers must apply to every path");
    return { config, headers: new Map(all.headers.map((h) => [h.key, h.value])) };
  } finally {
    process.env.NODE_ENV = previous;
  }
}

test("production responses carry the full security header set", async () => {
  const { config, headers } = await loadHeaders("production");
  assert.equal(config.poweredByHeader, false);
  assert.match(headers.get("Strict-Transport-Security"), /max-age=\d{8,}; includeSubDomains/);
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.match(headers.get("Permissions-Policy"), /camera=\(\)/);
  assert.match(headers.get("Permissions-Policy"), /microphone=\(\)/);
  assert.match(headers.get("Permissions-Policy"), /geolocation=\(\)/);
  assert.equal(headers.get("Cross-Origin-Opener-Policy"), "same-origin");
});

test("production CSP blocks framing, plugins, foreign forms and eval", async () => {
  const { headers } = await loadHeaders("production");
  const csp = headers.get("Content-Security-Policy");
  assert.ok(csp, "Content-Security-Policy must be set");
  const directives = new Map(
    csp.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const [name, ...values] = part.split(/\s+/);
      return [name, values];
    }),
  );
  assert.deepEqual(directives.get("default-src"), ["'self'"]);
  assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("base-uri"), ["'self'"]);
  assert.deepEqual(directives.get("form-action"), ["'self'"]);
  assert.deepEqual(directives.get("connect-src"), ["'self'"]);
  assert.ok(directives.has("upgrade-insecure-requests"));
  assert.ok(!directives.get("script-src").includes("'unsafe-eval'"));
  assert.ok(!directives.get("script-src").some((value) => value === "*" || value.startsWith("http")));
});

test("development keeps HSTS and upgrade-insecure-requests off so localhost still works", async () => {
  const { headers } = await loadHeaders("development");
  assert.equal(headers.has("Strict-Transport-Security"), false);
  assert.ok(!headers.get("Content-Security-Policy").includes("upgrade-insecure-requests"));
});
