import * as cheerio from "cheerio/slim";

export const MAX_MONITORING_SELECTORS = 20;
export const MAX_MONITORING_SELECTOR_LENGTH = 500;

const validationDocument =
  cheerio.load(
    "<html><body><div></div></body></html>"
  );

export function normalizeMonitoringSelectorInput(
  value: string
) {
  const selectors = [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((selector) =>
          selector.trim()
        )
        .filter(Boolean)
    ),
  ];

  if (
    selectors.length >
    MAX_MONITORING_SELECTORS
  ) {
    throw new Error(
      `Use no more than ${MAX_MONITORING_SELECTORS} selectors.`
    );
  }

  for (
    const selector
    of selectors
  ) {
    if (
      selector.length >
      MAX_MONITORING_SELECTOR_LENGTH
    ) {
      throw new Error(
        `Each selector must be ${MAX_MONITORING_SELECTOR_LENGTH} characters or fewer.`
      );
    }
  }

  return selectors;
}

export function parseMonitoringSelectorInput(
  value: string
) {
  const selectors =
    normalizeMonitoringSelectorInput(
      value
    );

  for (
    const selector
    of selectors
  ) {
    try {
      validationDocument(
        selector
      );
    } catch {
      throw new Error(
        `Invalid CSS selector: ${selector}`
      );
    }
  }

  return selectors;
}

export type MonitoringSelectorMatchStatus =
  | "matched"
  | "unmatched"
  | "invalid";

export interface MonitoringSelectorMatch {
  selector: string;
  status: MonitoringSelectorMatchStatus;
  matchCount: number;
  preview: string;
}

export interface MonitoringSelectorAnalysis {
  includeMatches: MonitoringSelectorMatch[];
  ignoreMatches: MonitoringSelectorMatch[];
}

const NON_READABLE_SELECTOR =
  "script, style, noscript, template, svg, canvas, iframe";

const SELECTOR_PREVIEW_LENGTH = 180;

function normalizeSelectorPreview(
  value: string
) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSelectorMatch(
  $: ReturnType<typeof cheerio.load>,
  selector: string
): MonitoringSelectorMatch {
  try {
    const matches =
      $(selector);

    if (
      matches.length === 0
    ) {
      return {
        selector,
        status: "unmatched",
        matchCount: 0,
        preview: "",
      };
    }

    const preview =
      matches
        .toArray()
        .slice(0, 3)
        .map((element) =>
          normalizeSelectorPreview(
            $(element).text()
          )
        )
        .filter(Boolean)
        .join(" • ")
        .slice(
          0,
          SELECTOR_PREVIEW_LENGTH
        );

    return {
      selector,
      status: "matched",
      matchCount:
        matches.length,
      preview,
    };
  } catch {
    return {
      selector,
      status: "invalid",
      matchCount: 0,
      preview: "",
    };
  }
}

export function analyzeMonitoringSelectors(
  html: string,
  includeSelectorsInput: string[],
  ignoreSelectorsInput: string[]
): MonitoringSelectorAnalysis {
  const includeSelectors = [
    ...new Set(
      includeSelectorsInput
        .map((selector) =>
          selector.trim()
        )
        .filter(Boolean)
    ),
  ];

  const ignoreSelectors = [
    ...new Set(
      ignoreSelectorsInput
        .map((selector) =>
          selector.trim()
        )
        .filter(Boolean)
    ),
  ];

  const $ =
    cheerio.load(html);

  $(
    NON_READABLE_SELECTOR
  ).remove();

  const ignoreMatches:
    MonitoringSelectorMatch[] =
      [];

  /*
   * Ignore selectors are inspected
   * and removed sequentially.
   *
   * This mirrors the Worker:
   * ignore regions are removed
   * before included sections are
   * extracted.
   */
  for (
    const selector
    of ignoreSelectors
  ) {
    const result =
      getSelectorMatch(
        $,
        selector
      );

    ignoreMatches.push(
      result
    );

    if (
      result.status ===
      "matched"
    ) {
      try {
        $(selector).remove();
      } catch {
        // Defensive only.
      }
    }
  }

  const includeMatches =
    includeSelectors.map(
      (selector) =>
        getSelectorMatch(
          $,
          selector
        )
    );

  return {
    includeMatches,
    ignoreMatches,
  };
}