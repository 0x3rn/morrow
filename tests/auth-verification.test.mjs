import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import test from "node:test";
import { createMorrowAuth } from "../lib/auth-config.ts";
import { sendAuthCode } from "../lib/auth-email.ts";

// Exercise Better Auth's real D1 dialect against SQLite, including actual migrations.
function d1Database(sqlite) {
  return {
    exec: async (sql) => sqlite.exec(sql),
    prepare(sql) {
      let bindings = [];
      return {
        bind(...values) { bindings = values; return this; },
        async all() {
          const results = sqlite.prepare(sql).all(...bindings);
          const meta = sqlite.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get();
          return { results, meta, success: true };
        },
        async first() { return sqlite.prepare(sql).get(...bindings) ?? null; },
        async run() { return this.all(); },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function fixture(t, { configured = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).filter((file) => file.endsWith(".sql")).sort()) {
    sqlite.exec(`BEGIN;\n${readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8")}\nCOMMIT;`);
  }
  t.after(() => sqlite.close());
  const emails = [];
  let providerFails = false;
  const configuredAuth = createMorrowAuth({
    DB: d1Database(sqlite),
    BETTER_AUTH_URL: "http://localhost:3001",
    BETTER_AUTH_SECRET: "morrow-tests-only-secret-at-least-32-characters",
    ...(configured ? { RESEND_API_KEY: "test-key", MORROW_EMAIL_FROM: "Morrow <auth@example.com>" } : {}),
  }, async (_url, request) => {
    if (providerFails) return Response.json({ message: "Provider unavailable" }, { status: 503 });
    const email = JSON.parse(request.body);
    emails.push({ ...email, code: email.text.match(/code is (\d{6})/)[1] });
    return Response.json({ id: `mail-${emails.length}` });
  });
  // Test credential validation without repeatedly allocating scrypt's memory.
  // Production continues to use Better Auth's default password hashing.
  const hash = async (password) => createHash("sha256").update(password).digest("hex");
  const auth = betterAuth({
    ...configuredAuth.options,
    emailAndPassword: {
      ...configuredAuth.options.emailAndPassword,
      password: { hash, verify: async ({ hash: stored, password }) => stored === await hash(password) },
    },
  });
  const cookies = new Map();
  async function call(path, body) {
    const response = await auth.handler(new Request(`http://localhost:3001/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: "http://localhost:3001",
        "Content-Type": "application/json",
        "cf-connecting-ip": "192.0.2.10",
        Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      const key = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!value || /max-age=0/i.test(cookie)) cookies.delete(key);
      else cookies.set(key, value);
    }
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { result = text; }
    return { status: response.status, body: result };
  }
  const credentials = { email: "person@example.com", password: "correct-password-123" };
  async function registerAndVerify() {
    assert.equal((await call("/sign-up/email", { ...credentials, name: "Test Person" })).status, 200);
    assert.equal((await call("/email-otp/verify-email", { email: credentials.email, otp: emails.at(-1).code })).status, 200);
  }
  async function challenge() {
    const result = await call("/sign-in/email", credentials);
    assert.equal(result.status, 200);
    assert.equal(result.body.twoFactorRedirect, true);
    assert.equal((await call("/two-factor/send-otp", {})).status, 200);
    return emails.at(-1).code;
  }
  return { sqlite, emails, cookies, call, credentials, registerAndVerify, challenge, failProvider: (value = true) => { providerFails = value; } };
}

test("signup verifies email, then login requires both password and code before issuing a session", async (t) => {
  const f = fixture(t);
  const signup = await f.call("/sign-up/email", { ...f.credentials, name: "Test Person" });
  assert.equal(signup.status, 200);
  assert.equal(signup.body.token, null);
  assert.match(f.emails[0].code, /^\d{6}$/);
  assert.equal((await f.call("/get-session")).body, null);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM workspaces").get().count, 1);
  assert.equal(f.sqlite.prepare("SELECT two_factor_enabled FROM users").get().two_factor_enabled, 1);
  assert.equal((await f.call("/email-otp/verify-email", { email: f.credentials.email, otp: "wrong-code" })).status, 400);
  assert.equal((await f.call("/email-otp/verify-email", { email: f.credentials.email, otp: f.emails[0].code })).status, 200);
  assert.equal((await f.call("/get-session")).body, null);

  assert.notEqual((await f.call("/sign-in/email", { ...f.credentials, password: "incorrect-password" })).status, 200);
  const code = await f.challenge();
  assert.equal((await f.call("/get-session")).body, null);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 0);
  assert.ok(f.sqlite.prepare("SELECT value FROM verifications").all().every(({ value }) => !value.includes(code)));
  const wrongCode = code === "000000" ? "111111" : "000000";
  assert.notEqual((await f.call("/two-factor/verify-otp", { code: wrongCode })).status, 200);
  assert.equal((await f.call("/get-session")).body, null);
  assert.equal((await f.call("/two-factor/verify-otp", { code })).status, 200);
  assert.equal((await f.call("/get-session")).body.user.email, f.credentials.email);
  assert.ok(![...f.cookies.keys()].some((key) => key.includes("trust_device")));
  await f.call("/sign-out", {});
  assert.notEqual((await f.call("/two-factor/verify-otp", { code })).status, 200);
  assert.equal((await f.call("/get-session")).body, null);
  assert.equal((await f.call("/sign-in/email", f.credentials)).body.twoFactorRedirect, true);
});

test("passwordless and two-factor opt-out endpoints cannot bypass mandatory codes", async (t) => {
  const f = fixture(t);
  await f.registerAndVerify();
  assert.equal((await f.call("/sign-in/email-otp", { email: f.credentials.email, otp: "123456" })).status, 404);
  assert.equal((await f.call("/email-otp/send-verification-otp", { email: f.credentials.email, type: "sign-in" })).status, 400);
  const code = await f.challenge();
  assert.equal((await f.call("/two-factor/verify-otp", { code, trustDevice: true })).status, 400);
  assert.equal((await f.call("/get-session")).body, null);
  assert.equal((await f.call("/two-factor/verify-otp", { code })).status, 200);
  assert.equal((await f.call("/two-factor/disable", { password: f.credentials.password })).status, 404);
});

test("expired codes do not grant access", async (t) => {
  const f = fixture(t);
  await f.registerAndVerify();
  const code = await f.challenge();
  f.sqlite.prepare("UPDATE verifications SET expires_at = 0 WHERE identifier LIKE '2fa-otp-%'").run();
  assert.notEqual((await f.call("/two-factor/verify-otp", { code })).status, 200);
  assert.equal((await f.call("/get-session")).body, null);
});

test("resending invalidates the previous login code", async (t) => {
  const f = fixture(t);
  await f.registerAndVerify();
  const oldCode = await f.challenge();
  assert.equal((await f.call("/two-factor/send-otp", {})).status, 200);
  const code = f.emails.at(-1).code;
  // Random codes can coincide; only assert rejection when the digits differ.
  if (code !== oldCode) assert.notEqual((await f.call("/two-factor/verify-otp", { code: oldCode })).status, 200);
  assert.equal((await f.call("/two-factor/verify-otp", { code })).status, 200);
});

test("incorrect codes exhaust the allowed attempts", async (t) => {
  const f = fixture(t);
  await f.registerAndVerify();
  const code = await f.challenge();
  const wrongCode = code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.notEqual((await f.call("/two-factor/verify-otp", { code: wrongCode })).status, 200);
  }
  const rejected = await f.call("/two-factor/verify-otp", { code });
  assert.notEqual(rejected.status, 200);
  assert.match(rejected.body.code, /TOO_MANY_ATTEMPTS/);
  assert.equal((await f.call("/get-session")).body, null);
});

test("resend requests are rate limited using persisted database state", async (t) => {
  const f = fixture(t);
  await f.registerAndVerify();
  await f.challenge();
  for (let count = 0; count < 2; count++) assert.equal((await f.call("/two-factor/send-otp", {})).status, 200);
  assert.equal((await f.call("/two-factor/send-otp", {})).status, 429);
  assert.ok(f.sqlite.prepare("SELECT COUNT(*) AS count FROM auth_rate_limits").get().count > 0);
});

test("missing email configuration blocks signup without creating an account", async (t) => {
  const f = fixture(t, { configured: false });
  assert.equal((await f.call("/sign-up/email", { ...f.credentials, name: "Test" })).status, 503);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
});

test("provider failures return an actionable error and leave login unauthenticated", async (t) => {
  const f = fixture(t);
  await f.registerAndVerify();
  await f.call("/sign-in/email", f.credentials);
  f.failProvider();
  const result = await f.call("/two-factor/send-otp", {});
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "EMAIL_DELIVERY_UNAVAILABLE");
  assert.equal((await f.call("/get-session")).body, null);
});

test("the mail adapter rejects invalid code formats and provider errors", async () => {
  const env = { RESEND_API_KEY: "test-key", MORROW_EMAIL_FROM: "auth@example.com" };
  await assert.rejects(sendAuthCode(env, "person@example.com", "<script>", "signup"), /six digits/);
  await assert.rejects(sendAuthCode(env, "person@example.com", "012345", "login", async () => new Response("Sensitive provider data", { status: 400 })), /could not be delivered/);
});

test("signup delivery failures can be recovered by resending without duplicating the workspace", async (t) => {
  const f = fixture(t);
  f.failProvider();
  const signup = await f.call("/sign-up/email", { ...f.credentials, name: "Test Person" });
  assert.equal(signup.status, 503);
  assert.equal((await f.call("/get-session")).body, null);
  f.failProvider(false);
  assert.equal((await f.call("/email-otp/send-verification-otp", { email: f.credentials.email, type: "email-verification" })).status, 200);
  assert.equal((await f.call("/email-otp/verify-email", { email: f.credentials.email, otp: f.emails.at(-1).code })).status, 200);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM workspaces").get().count, 1);
});

test("email verification never becomes a passwordless login for an existing verified account", async (t) => {
  const f = fixture(t);
  await f.registerAndVerify();
  await f.call("/email-otp/send-verification-otp", { email: f.credentials.email, type: "email-verification" });
  assert.equal((await f.call("/email-otp/verify-email", { email: f.credentials.email, otp: f.emails.at(-1).code })).status, 200);
  assert.equal((await f.call("/get-session")).body, null);
});

test("the migration requires codes for existing accounts and revokes password-only sessions", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    for (const file of ["0001_initial_schema.sql", "0002_add_auth_tables.sql"]) {
      sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
    sqlite.exec("INSERT INTO users (id, email) VALUES ('existing', 'existing@example.com'); INSERT INTO sessions (id, user_id, token, expires_at, created_at, updated_at) VALUES ('session', 'existing', 'old-token', 9999999999999, 0, 0)");
    sqlite.exec(readFileSync(new URL("../migrations/0008_add_email_verification.sql", import.meta.url), "utf8"));
    assert.equal(sqlite.prepare("SELECT two_factor_enabled FROM users").get().two_factor_enabled, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get().count, 0);
  } finally {
    sqlite.close();
  }
});
