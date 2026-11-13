import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createMorrowAuth } from "../lib/auth-config.ts";

// Same SQLite-backed D1 shape and real migrations as auth-verification.test.mjs.
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
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      return results;
    },
  };
}

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(`BEGIN;\n${readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8")}\nCOMMIT;`);
  }
  t.after(() => sqlite.close());
  return d1Database(sqlite);
}

async function withNodeEnv(value, run) {
  const previous = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

test("production refuses to start auth without an application URL", async (t) => {
  const DB = database(t);
  await withNodeEnv("production", () => {
    assert.throws(
      () => createMorrowAuth({ DB, BETTER_AUTH_SECRET: "a-secret-for-tests-only-32-characters" }),
      /BETTER_AUTH_URL or MORROW_APP_URL must be set in production/,
    );
    assert.throws(
      () => createMorrowAuth({ DB, BETTER_AUTH_SECRET: "a-secret-for-tests-only-32-characters", BETTER_AUTH_URL: "   " }),
      /must be set in production/,
    );
  });
});

test("production refuses to start auth without a secret", async (t) => {
  const DB = database(t);
  await withNodeEnv("production", () => {
    assert.throws(
      () => createMorrowAuth({ DB, MORROW_APP_URL: "https://morrow.example" }),
      /BETTER_AUTH_SECRET must be set in production/,
    );
  });
});

test("production starts when both the URL and the secret are configured", async (t) => {
  const DB = database(t);
  await withNodeEnv("production", async () => {
    const auth = createMorrowAuth({
      DB,
      MORROW_APP_URL: "https://morrow.example/ignored/path",
      BETTER_AUTH_SECRET: "a-secret-for-tests-only-32-characters",
    });
    assert.equal(auth.options.baseURL, "https://morrow.example", "path is stripped to the canonical origin");
    assert.deepEqual(auth.options.trustedOrigins, ["https://morrow.example"]);
    await auth.$context;
  });
});

test("development stays zero-configuration", async (t) => {
  const DB = database(t);
  for (const env of ["development", undefined]) {
    await withNodeEnv(env, async () => {
      const auth = createMorrowAuth({ DB });
      assert.equal(auth.options.baseURL, "http://localhost:3001");
      await auth.$context;
    });
  }
});
