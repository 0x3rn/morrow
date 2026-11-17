/*
 * Page availability.
 *
 * A monitored page that is broken is not a content change by the
 * competitor. Comparing an error page's text with the working page's
 * text produces a false "the page changed" alert, so a broken capture
 * is handled here instead of by the diff pipeline.
 *
 * A capture counts as broken when:
 *   - the server answered with an HTTP error (4xx or 5xx),
 *   - the page loaded but came back empty, or
 *   - the page answered 200 but shows an error, block or "try again"
 *     message instead of its content (a "soft" error page).
 *
 * This module is pure (no database, no network) so it can be tested
 * directly from the terminal.
 */

export type AvailabilityTransition =
  | "became_unreachable"
  | "recovered"
  | "still_unreachable"
  | "none";

export type FailureReason =
  | "http_error"
  | "error_page"
  | "blank";

export interface PageHealth {
  failed: boolean;
  reason: FailureReason | null;
  httpStatus: number | null;
  /* The phrase that gave an error page away, for logs only. */
  matched: string | null;
}

export interface AvailabilityNotice {
  summary: string;
  whyItMatters: string;
}

/*
 * Error pages are short. A real page that merely mentions "page not
 * found" or "try again later" somewhere in a long article must not be
 * flagged, so phrase matching only applies to short readable text.
 */
const MAX_ERROR_PAGE_CHARS = 1500;

const ERROR_PAGE_PATTERNS: readonly RegExp[] = [
  /\bpage (?:was )?not found\b/,
  /\bpage (?:could not|couldn't|can't|cannot) be (?:found|loaded)\b/,
  /\b(?:could not|couldn't|can't|cannot) (?:load|find) (?:this|the) page\b/,
  /\bpage (?:doesn't|does not) exist\b/,
  /\bsomething went wrong\b/,
  /\ban? (?:unexpected )?error (?:has )?occurred\b/,
  /\bunexpected error\b/,
  /\btry again (?:in a moment|later|shortly)\b/,
  /\b(?:temporarily|currently) unavailable\b/,
  /\bservice unavailable\b/,
  /\bbad gateway\b/,
  /\bgateway time-?out\b/,
  /\binternal server error\b/,
  /\bapplication error\b/,
  /\baccess denied\b/,
  /\byou (?:don't|do not) have permission to (?:access|view)\b/,
  /\bjust a moment\b/,
  /\bchecking your browser\b/,
  /\bverify(?:ing)? (?:that )?you are (?:a )?human\b/,
  /\battention required\b/,
  /\benable javascript and cookies to continue\b/,
  /\bunusual traffic\b/,
  /\bare you a robot\b/,
  /\bcaptcha\b/,
  /\bpardon our interruption\b/,
  /\b(?:you have been|you've been|request) blocked\b/,
  /\bunder maintenance\b/,
  /\bdown for (?:scheduled )?maintenance\b/,
  /\bbe right back\b/,
  /\b(?:error|http)\s*(?:code\s*)?[:#]?\s*(?:4\d\d|5\d\d)\b/,
  /\b(?:4\d\d|5\d\d)\s*[-:]?\s*(?:not found|forbidden|bad gateway|service unavailable|internal server error|gateway time-?out)\b/,
];

/*
 * 4xx and 5xx mean the server refused or failed to serve the page.
 * A missing status (older snapshots) is treated as a working page.
 */
export function isErrorStatus(
  status: number | null | undefined
): boolean {
  return (
    typeof status === "number" &&
    Number.isFinite(status) &&
    status >= 400
  );
}

function normalizeForMatching(
  text: string
) {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * `text` is the page's readable text. Pass null when it is not
 * available (for example an older snapshot whose text is gone): the
 * text checks are then skipped rather than guessed.
 */
export function assessPageHealth(
  status: number | null | undefined,
  text: string | null
): PageHealth {
  const httpStatus =
    typeof status === "number" &&
    Number.isFinite(status)
      ? status
      : null;

  if (isErrorStatus(status)) {
    return {
      failed: true,
      reason: "http_error",
      httpStatus,
      matched: null,
    };
  }

  if (text !== null) {
    const normalized =
      normalizeForMatching(text);

    if (normalized.length === 0) {
      return {
        failed: true,
        reason: "blank",
        httpStatus,
        matched: null,
      };
    }

    if (
      normalized.length <=
      MAX_ERROR_PAGE_CHARS
    ) {
      for (const pattern of ERROR_PAGE_PATTERNS) {
        const match =
          pattern.exec(normalized);

        if (match) {
          return {
            failed: true,
            reason: "error_page",
            httpStatus,
            matched: match[0],
          };
        }
      }
    }
  }

  return {
    failed: false,
    reason: null,
    httpStatus,
    matched: null,
  };
}

export function detectAvailabilityTransition(
  previous: PageHealth,
  current: PageHealth
): AvailabilityTransition {
  if (!previous.failed && current.failed) {
    return "became_unreachable";
  }

  if (previous.failed && !current.failed) {
    return "recovered";
  }

  if (previous.failed && current.failed) {
    return "still_unreachable";
  }

  return "none";
}

export interface AvailabilityNoticeOptions {
  /*
   * True when Morrow found a good snapshot from before the problem
   * and will compare the recovered page against it.
   */
  comparingWithEarlierVersion?: boolean;
}

/*
 * Only the two transitions the user should hear about produce text.
 * A page that keeps failing, or keeps working, produces nothing, so a
 * long outage sends one "stopped working" notice and one "working
 * again" notice.
 */
export function buildAvailabilityNotice(
  transition: AvailabilityTransition,
  previous: PageHealth,
  current: PageHealth,
  options: AvailabilityNoticeOptions = {}
): AvailabilityNotice | null {
  if (transition === "became_unreachable") {
    return {
      summary:
        describeProblem(current),

      whyItMatters:
        "This looks like a problem on their side, not a change to the page. Morrow will tell you when it works normally again.",
    };
  }

  if (transition === "recovered") {
    return {
      summary:
        describeRecovery(
          previous,
          current
        ),

      whyItMatters:
        options.comparingWithEarlierVersion
          ? "This is not an edit by the competitor. Morrow is now comparing the page with the last good version from before the problem, and will send a separate alert if anything changed."
          : "This is not an edit by the competitor. Morrow will compare future checks against this working version of the page.",
    };
  }

  return null;
}

function describeProblem(
  current: PageHealth
) {
  switch (current.reason) {
    case "error_page":
      return "The page stopped working normally. It is showing an error message instead of its normal content.";

    case "blank":
      return "The page stopped showing content. It loaded, but came back empty.";

    default:
      return `The page stopped loading. It returned an error (HTTP ${formatStatus(
        current.httpStatus
      )}) instead of its normal content.`;
  }
}

function describeRecovery(
  previous: PageHealth,
  current: PageHealth
) {
  switch (previous.reason) {
    case "error_page":
      return "The page is working again. The last check showed an error message; now it shows its normal content.";

    case "blank":
      return "The page has content again. The last check came back empty.";

    default:
      return `The page is loading again. The last check returned an error (HTTP ${formatStatus(
        previous.httpStatus
      )}); now it loads normally (HTTP ${formatStatus(
        current.httpStatus
      )}).`;
  }
}

function formatStatus(
  status: number | null | undefined
) {
  return typeof status === "number" &&
    Number.isFinite(status)
    ? String(Math.trunc(status))
    : "unknown";
}
