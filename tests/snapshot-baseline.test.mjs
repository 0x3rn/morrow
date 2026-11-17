import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  LAST_GOOD_SNAPSHOT_SCAN_LIMIT,
  assessPreviousSnapshotHealth,
  getLastGoodSnapshot,
} from "../worker/snapshot-baseline.ts";

const GOOD = "Pricing\nStarter $20\nTeam $60\nBusiness $150\nGet started";
const GOOD_EDITED = "Pricing\nStarter $25\nTeam $60\nBusiness $150\nGet started";
const SOFT_ERROR = "We couldn't load this page. Please try again in a moment.";

/* A real SQLite database built from the project's own migrations. */
function createDatabase() {
  const db = new DatabaseSync(":memory:");
  const dir = join(import.meta.dirname, "..", "migrations");

  db.exec("PRAGMA foreign_keys = ON;");

  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith(".sql")) {
      db.exec(readFileSync(join(dir, file), "utf8"));
    }
  }

  db.exec(`
    INSERT INTO users (id, name, email) VALUES ('u1', 'Owner', 'o@example.test');
    INSERT INTO workspaces (id, name, created_by) VALUES ('w1', 'Team', 'u1');
    INSERT INTO competitors (id, workspace_id, name, domain)
      VALUES ('c1', 'w1', 'Corstack', 'corstack.dev');
    INSERT INTO monitored_pages (id, competitor_id, url, label)
      VALUES ('p1', 'c1', 'https://corstack.dev/', 'Homepage'),
             ('p2', 'c1', 'https://corstack.dev/other', 'Other');
  `);

  return db;
}

/* Same shape as the D1 methods the code uses. */
function d1(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);

      return {
        bind(...values) {
          return {
            async all() {
              return { results: statement.all(...values) };
            },
          };
        },
      };
    },
  };
}

/* Stands in for R2: object key -> readable text. */
function storage(texts) {
  const reads = [];

  return {
    reads,
    async read(key) {
      reads.push(key);
      return key !== null && key in texts ? texts[key] : null;
    },
  };
}

let clock = 0;

function addSnapshot(db, id, status, textKey, hash, pageId = "p1") {
  clock += 1;

  db.prepare(
    `INSERT INTO snapshots
       (id, monitored_page_id, content_hash, text_object_key, http_status, captured_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    pageId,
    hash,
    textKey,
    status,
    `2026-11-15 05:${String(clock).padStart(2, "0")}:00`
  );
}

const row = (overrides) => ({
  id: "x",
  monitored_page_id: "p1",
  content_hash: "h",
  text_object_key: "t",
  html_object_key: null,
  screenshot_object_key: null,
  http_status: 200,
  captured_at: "2026-11-15 05:00:00",
  ...overrides,
});

/* ---------- assessPreviousSnapshotHealth ---------- */

test("previous HTTP error: failed, and storage is never read", async () => {
  const store = storage({});
  const health = await assessPreviousSnapshotHealth(
    store.read,
    row({ http_status: 500 }),
    GOOD,
    false
  );

  assert.equal(health.failed, true);
  assert.equal(health.reason, "http_error");
  assert.equal(store.reads.length, 0);
});

test("identical text: reuses the current text, no storage read", async () => {
  const store = storage({});
  const health = await assessPreviousSnapshotHealth(
    store.read,
    row(),
    GOOD,
    true
  );

  assert.equal(health.failed, false);
  assert.equal(store.reads.length, 0);
});

test("different text: reads the previous text and spots a 200 error page", async () => {
  const store = storage({ t: SOFT_ERROR });
  const health = await assessPreviousSnapshotHealth(
    store.read,
    row(),
    GOOD,
    false
  );

  assert.deepEqual(store.reads, ["t"]);
  assert.equal(health.failed, true);
  assert.equal(health.reason, "error_page");
});

test("previous text missing from storage is not guessed to be an error", async () => {
  const store = storage({});
  const health = await assessPreviousSnapshotHealth(
    store.read,
    row(),
    GOOD,
    false
  );

  assert.equal(health.failed, false);
});

/* ---------- getLastGoodSnapshot against real SQL ---------- */

test("skips the HTTP error and returns the last good capture before it", async () => {
  const db = createDatabase();

  addSnapshot(db, "s1", 200, "k1", "h1");
  addSnapshot(db, "s2", 200, "k2", "h2");
  addSnapshot(db, "s3", 500, "k3", "h3");
  addSnapshot(db, "s4", 200, "k4", "h4"); // the new capture

  const store = storage({ k1: GOOD, k2: GOOD, k3: "x", k4: GOOD });
  const found = await getLastGoodSnapshot(d1(db), store.read, "p1", "s4");

  assert.equal(found.id, "s2");
});

test("skips a 200 error page too", async () => {
  const db = createDatabase();

  addSnapshot(db, "s1", 200, "k1", "h1");
  addSnapshot(db, "s2", 200, "k2", "h2"); // soft error
  addSnapshot(db, "s3", 503, "k3", "h3");
  addSnapshot(db, "s4", 200, "k4", "h4");

  const store = storage({ k1: GOOD, k2: SOFT_ERROR, k3: "", k4: GOOD });
  const found = await getLastGoodSnapshot(d1(db), store.read, "p1", "s4");

  assert.equal(found.id, "s1");
});

test("older snapshots with no recorded status still count as good", async () => {
  const db = createDatabase();

  addSnapshot(db, "s1", null, "k1", "h1");
  addSnapshot(db, "s2", 500, "k2", "h2");
  addSnapshot(db, "s3", 200, "k3", "h3");

  const store = storage({ k1: GOOD, k3: GOOD });
  const found = await getLastGoodSnapshot(d1(db), store.read, "p1", "s3");

  assert.equal(found.id, "s1");
});

test("returns null when there is no good capture (first capture was broken)", async () => {
  const db = createDatabase();

  addSnapshot(db, "s1", 500, "k1", "h1");
  addSnapshot(db, "s2", 200, "k2", "h2");

  const store = storage({ k1: "", k2: GOOD });

  assert.equal(await getLastGoodSnapshot(d1(db), store.read, "p1", "s2"), null);
});

test("never returns the current capture or another page's capture", async () => {
  const db = createDatabase();

  addSnapshot(db, "other", 200, "ko", "ho", "p2");
  addSnapshot(db, "s1", 500, "k1", "h1");
  addSnapshot(db, "s2", 200, "k2", "h2");

  const store = storage({ ko: GOOD, k1: "", k2: GOOD });

  assert.equal(await getLastGoodSnapshot(d1(db), store.read, "p1", "s2"), null);
});

test("a candidate whose stored text is gone is skipped", async () => {
  const db = createDatabase();

  addSnapshot(db, "s1", 200, "k1", "h1");
  addSnapshot(db, "s2", 200, "k2", "h2"); // text missing from storage
  addSnapshot(db, "s3", 200, "k3", "h3");

  const store = storage({ k1: GOOD, k3: GOOD });
  const found = await getLastGoodSnapshot(d1(db), store.read, "p1", "s3");

  assert.equal(found.id, "s1");
});

test("gives up after the scan limit instead of reading the whole history", async () => {
  const db = createDatabase();
  const texts = {};

  addSnapshot(db, "good", 200, "kg", "hg");
  texts.kg = GOOD;

  for (let i = 0; i < LAST_GOOD_SNAPSHOT_SCAN_LIMIT; i += 1) {
    addSnapshot(db, `soft${i}`, 200, `ks${i}`, `hs${i}`);
    texts[`ks${i}`] = SOFT_ERROR;
  }

  addSnapshot(db, "now", 200, "kn", "hn");
  texts.kn = GOOD;

  const store = storage(texts);
  const found = await getLastGoodSnapshot(d1(db), store.read, "p1", "now");

  assert.equal(found, null);
  assert.equal(store.reads.length, LAST_GOOD_SNAPSHOT_SCAN_LIMIT);
});

/* ---------- the user's scenarios, end to end ---------- */

test("outage, page back unchanged: notice only, no change to report", async () => {
  const db = createDatabase();

  addSnapshot(db, "s1", 200, "k1", "hash-good");
  addSnapshot(db, "s2", 500, "k2", "hash-error");
  addSnapshot(db, "s3", 200, "k3", "hash-good"); // recovered, same content

  const store = storage({ k1: GOOD, k3: GOOD });
  const baseline = await getLastGoodSnapshot(d1(db), store.read, "p1", "s3");

  assert.equal(baseline.id, "s1");
  assert.equal(baseline.content_hash === "hash-good", true); // fast path: no change
});

test("outage, page back with a real edit: baseline is the pre-outage page", async () => {
  const db = createDatabase();

  addSnapshot(db, "s1", 200, "k1", "hash-old");
  addSnapshot(db, "s2", 500, "k2", "hash-error");
  addSnapshot(db, "s3", 200, "k3", "hash-new"); // recovered with a new price

  const store = storage({ k1: GOOD, k3: GOOD_EDITED });
  const baseline = await getLastGoodSnapshot(d1(db), store.read, "p1", "s3");
  const baselineText = await store.read(baseline.text_object_key);

  assert.equal(baseline.id, "s1");
  assert.notEqual(baseline.content_hash, "hash-new"); // change will be detected
  assert.match(baselineText, /Starter \$20/); // the OLD price is the "before"
});
