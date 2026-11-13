import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

function listRouteFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...listRouteFiles(path));
    } else if (/^route\.(ts|tsx|js|mjs)$/.test(entry)) {
      found.push(relative("app", path).split(sep).join("/"));
    }
  }
  return found.sort();
}

// Every HTTP route handler in the app. Adding a route requires adding it here,
// which forces a reviewer to confirm authentication, authorization and rate limits.
const REVIEWED_ROUTES = [
  "api/account/route.ts",
  "api/auth/[...all]/route.ts",
  "api/changes/[changeId]/screenshot/[side]/route.ts",
  "api/snapshots/[snapshotId]/screenshot/route.ts",
  "api/telegram/link/route.ts",
  "api/webhooks/lemonsqueezy/route.ts",
  "api/webhooks/telegram/route.ts",
];

test("no debug or diagnostic route is deployed", () => {
  const routes = listRouteFiles("app");
  const debugRoutes = routes.filter((route) =>
    /(^|\/)(db-test|debug|test|health|diagnostics?|seed|__[a-z]+)(\/|$)/i.test(route),
  );
  assert.deepEqual(debugRoutes, [], "debug routes must not ship to production");
});

test("route handlers match the reviewed inventory", () => {
  assert.deepEqual(listRouteFiles("app"), REVIEWED_ROUTES);
});
