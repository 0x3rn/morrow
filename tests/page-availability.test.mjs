import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPageHealth,
  buildAvailabilityNotice,
  detectAvailabilityTransition,
  isErrorStatus,
} from "../worker/page-availability.ts";

const GOOD_PAGE = `
Portfolio
Selected Work
Luxe Hotel
Hospitality, Business
Visit Website
Pricing
Clear, upfront pricing.
Launch
Starting from $150
Up to 2 Pages
Mobile Responsive Design
Basic SEO Setup
Contact Form Integration
Starting from $300
Starting from $600
Starting from $1,500
`;

const longArticle =
  "Handling a page not found error well matters. ".repeat(60) +
  "If something went wrong, please try again later.";

const ok = (text = GOOD_PAGE) => assessPageHealth(200, text);

/* ---------- HTTP status ---------- */

test("isErrorStatus treats 4xx and 5xx as errors only", () => {
  for (const status of [400, 404, 429, 500, 503]) {
    assert.equal(isErrorStatus(status), true, String(status));
  }

  for (const status of [200, 204, 301, 399]) {
    assert.equal(isErrorStatus(status), false, String(status));
  }
});

test("isErrorStatus treats missing or invalid status as working", () => {
  assert.equal(isErrorStatus(null), false);
  assert.equal(isErrorStatus(undefined), false);
  assert.equal(isErrorStatus(Number.NaN), false);
  assert.equal(isErrorStatus("500"), false);
});

test("an HTTP error is a failure whatever the text says", () => {
  const health = assessPageHealth(500, GOOD_PAGE);

  assert.equal(health.failed, true);
  assert.equal(health.reason, "http_error");
  assert.equal(health.httpStatus, 500);
});

/* ---------- soft error pages (HTTP 200) ---------- */

test("the real example: a 200 page that says it could not load is a failure", () => {
  const health = assessPageHealth(
    200,
    "We couldn't load this page. Please try again in a moment or email hello@corstack.dev."
  );

  assert.equal(health.failed, true);
  assert.equal(health.reason, "error_page");
});

test("'couldn't load this page' is caught on its own, with no other phrase", () => {
  for (const text of [
    "We couldn't load this page.",
    "We could not load this page.",
    "This page couldn't be loaded.",
  ]) {
    assert.equal(assessPageHealth(200, text).reason, "error_page", text);
  }
});

test("common error, block and challenge pages are caught", () => {
  const errorPages = [
    "Page not found. The page you are looking for does not exist.",
    "404 Not Found",
    "Error 503\nService Unavailable",
    "502 Bad Gateway",
    "Something went wrong. Please refresh.",
    "An unexpected error occurred.",
    "Access denied. You don't have permission to access this resource.",
    "Just a moment...\nChecking your browser before accessing the site.",
    "Attention Required! | Cloudflare\nPlease enable JavaScript and cookies to continue",
    "Verify you are human by completing the action below.",
    "We detected unusual traffic from your network.",
    "Sorry, you have been blocked.",
    "Pardon Our Interruption",
    "We are down for scheduled maintenance. Be right back.",
    "This site is temporarily unavailable. Try again later.",
    "Internal Server Error",
  ];

  for (const text of errorPages) {
    const health = assessPageHealth(200, text);

    assert.equal(health.failed, true, text);
    assert.equal(health.reason, "error_page", text);
    assert.ok(health.matched, text);
  }
});

test("matching ignores case, curly apostrophes and extra whitespace", () => {
  const health = assessPageHealth(
    200,
    "  WE   COULDN’T   LOAD\n\nTHIS   PAGE  "
  );

  assert.equal(health.failed, true);
});

test("an empty or whitespace-only page is a failure", () => {
  assert.equal(assessPageHealth(200, "").reason, "blank");
  assert.equal(assessPageHealth(200, "   \n\t ").reason, "blank");
});

test("unknown text (null) skips the text checks instead of guessing", () => {
  assert.equal(assessPageHealth(200, null).failed, false);
  assert.equal(assessPageHealth(null, null).failed, false);
});

/* ---------- pages that must NOT be flagged ---------- */

test("a normal pricing page is healthy", () => {
  const health = ok();

  assert.equal(health.failed, false);
  assert.equal(health.reason, null);
});

test("short real pages are healthy", () => {
  const pages = [
    "Pricing\nStarter $20\nTeam $60\nBusiness $150\nGet started",
    "Contact us\nWe'd love to hear from you. Email hello@example.com",
    "Careers\nWe are hiring a designer and an engineer.",
    "Changelog\nv2.1 adds SSO. v2.0 adds webhooks.",
  ];

  for (const text of pages) {
    assert.equal(assessPageHealth(200, text).failed, false, text);
  }
});

test("a long page that merely mentions an error is healthy", () => {
  assert.ok(longArticle.length > 1500);
  assert.equal(assessPageHealth(200, longArticle).failed, false);
});

/* ---------- transitions ---------- */

test("detectAvailabilityTransition covers every combination", () => {
  const good = ok();
  const bad = assessPageHealth(500, null);
  const soft = assessPageHealth(200, "Something went wrong.");

  assert.equal(detectAvailabilityTransition(good, good), "none");
  assert.equal(detectAvailabilityTransition(good, bad), "became_unreachable");
  assert.equal(detectAvailabilityTransition(good, soft), "became_unreachable");
  assert.equal(detectAvailabilityTransition(bad, good), "recovered");
  assert.equal(detectAvailabilityTransition(soft, good), "recovered");
  assert.equal(detectAvailabilityTransition(bad, soft), "still_unreachable");
  assert.equal(detectAvailabilityTransition(soft, bad), "still_unreachable");
});

/* ---------- notice wording ---------- */

test("HTTP recovery notice names both statuses and says it is not an edit", () => {
  const notice = buildAvailabilityNotice(
    "recovered",
    assessPageHealth(500, null),
    ok()
  );

  assert.ok(notice);
  assert.match(notice.summary, /loading again/);
  assert.match(notice.summary, /HTTP 500/);
  assert.match(notice.summary, /HTTP 200/);
  assert.match(notice.whyItMatters, /not an edit by the competitor/);
  assert.doesNotMatch(
    `${notice.summary} ${notice.whyItMatters}`,
    /pricing|updated|strategy/i
  );
});

test("soft-error recovery notice talks about the error message, not a status", () => {
  const notice = buildAvailabilityNotice(
    "recovered",
    assessPageHealth(200, "Something went wrong."),
    ok()
  );

  assert.match(notice.summary, /working again/);
  assert.match(notice.summary, /error message/);
  assert.doesNotMatch(notice.summary, /HTTP/);
});

test("blank pages have their own wording", () => {
  const down = buildAvailabilityNotice(
    "became_unreachable",
    ok(),
    assessPageHealth(200, "")
  );
  const up = buildAvailabilityNotice(
    "recovered",
    assessPageHealth(200, ""),
    ok()
  );

  assert.match(down.summary, /came back empty/);
  assert.match(up.summary, /has content again/);
});

test("outage notices describe each kind of problem", () => {
  const http = buildAvailabilityNotice(
    "became_unreachable",
    ok(),
    assessPageHealth(503, null)
  );
  const soft = buildAvailabilityNotice(
    "became_unreachable",
    ok(),
    assessPageHealth(200, "Access denied")
  );

  assert.match(http.summary, /stopped loading.*HTTP 503/);
  assert.match(soft.summary, /showing an error message/);
  assert.match(http.whyItMatters, /tell you when it works normally again/);
});

test("recovery notice promises a comparison only when one will happen", () => {
  const bad = assessPageHealth(500, null);

  const withCompare = buildAvailabilityNotice("recovered", bad, ok(), {
    comparingWithEarlierVersion: true,
  });
  const without = buildAvailabilityNotice("recovered", bad, ok(), {
    comparingWithEarlierVersion: false,
  });

  assert.match(withCompare.whyItMatters, /last good version/);
  assert.match(withCompare.whyItMatters, /separate alert/);
  assert.doesNotMatch(without.whyItMatters, /last good version/);
  assert.match(without.whyItMatters, /future checks/);
});

test("no notice for a page that keeps failing or keeps working", () => {
  const bad = assessPageHealth(500, null);

  assert.equal(buildAvailabilityNotice("still_unreachable", bad, bad), null);
  assert.equal(buildAvailabilityNotice("none", ok(), ok()), null);
});

test("one outage produces exactly two notices over a sequence of checks", () => {
  const checks = [
    assessPageHealth(200, GOOD_PAGE),
    assessPageHealth(200, GOOD_PAGE),
    assessPageHealth(500, null),
    assessPageHealth(200, "Something went wrong."),
    assessPageHealth(502, null),
    assessPageHealth(200, GOOD_PAGE),
    assessPageHealth(200, GOOD_PAGE),
  ];
  const sent = [];

  for (let i = 1; i < checks.length; i += 1) {
    const transition = detectAvailabilityTransition(checks[i - 1], checks[i]);

    if (buildAvailabilityNotice(transition, checks[i - 1], checks[i])) {
      sent.push(transition);
    }
  }

  assert.deepEqual(sent, ["became_unreachable", "recovered"]);
});
