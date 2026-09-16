import * as cheerio from "cheerio/slim";

export interface SelectorListParseResult {
  selectors: string[];
  valid: boolean;
  error: string | null;
}

export interface MonitoringScopeResult {
  text: string;

  mode:
    | "whole_page"
    | "selected_sections";

  includeSelectors: string[];
  ignoreSelectors: string[];

  matchedIncludeSelectors: string[];
  unmatchedIncludeSelectors: string[];
  invalidIncludeSelectors: string[];

  matchedIgnoreSelectors: string[];
  unmatchedIgnoreSelectors: string[];
  invalidIgnoreSelectors: string[];

  hasUsableIncludeSelectors: boolean;
}

const NON_READABLE_SELECTOR =
  "script, style, noscript, template, svg, canvas, iframe";

const BLOCK_ELEMENTS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
].join(",");

function normalizeReadableLine(
  value: string
) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitNormalizedLines(
  text: string
) {
  return text
    .split(/\r?\n/)
    .map(normalizeReadableLine)
    .filter(Boolean);
}

function normalizeSelectorList(
  selectors: string[]
) {
  return [
    ...new Set(
      selectors
        .map((selector) =>
          selector.trim()
        )
        .filter(Boolean)
    ),
  ];
}

export function parseSelectorListJson(
  value:
    | string
    | null
    | undefined
): SelectorListParseResult {
  if (
    value === null ||
    value === undefined ||
    value.trim() === ""
  ) {
    return {
      selectors: [],
      valid: true,
      error: null,
    };
  }

  let parsed: unknown;

  try {
    parsed =
      JSON.parse(value);
  } catch {
    return {
      selectors: [],
      valid: false,
      error:
        "Selector configuration is not valid JSON.",
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      selectors: [],
      valid: false,
      error:
        "Selector configuration must be a JSON array.",
    };
  }

  if (
    parsed.some(
      (item) =>
        typeof item !== "string"
    )
  ) {
    return {
      selectors: [],
      valid: false,
      error:
        "Every selector must be a string.",
    };
  }

  return {
    selectors:
      normalizeSelectorList(
        parsed
      ),

    valid: true,
    error: null,
  };
}

export function extractReadableText(
  html: string
) {
  const $ =
    cheerio.load(html);

  $(
    NON_READABLE_SELECTOR
  ).remove();

  $("br").replaceWith("\n");

  $(BLOCK_ELEMENTS).each(
    (_, element) => {
      $(element).append("\n");
    }
  );

  const rawText =
    $("body").length > 0
      ? $("body").text()
      : $.root().text();

  return splitNormalizedLines(
    rawText
  ).join("\n");
}

function applyIgnoreSelectors(
  $: ReturnType<
    typeof cheerio.load
  >,
  selectors: string[]
) {
  const matched: string[] = [];
  const unmatched: string[] = [];
  const invalid: string[] = [];

  for (
    const selector
    of selectors
  ) {
    try {
      const matches =
        $(selector);

      if (
        matches.length === 0
      ) {
        unmatched.push(
          selector
        );

        continue;
      }

      matched.push(
        selector
      );

      matches.remove();
    } catch {
      invalid.push(
        selector
      );
    }
  }

  return {
    matched,
    unmatched,
    invalid,
  };
}

function collectIncludedElements(
  $: ReturnType<
    typeof cheerio.load
  >,
  selectors: string[]
) {
  const selectedElements =
    new Set<object>();

  const matched: string[] = [];
  const unmatched: string[] = [];
  const invalid: string[] = [];

  let usableSelectorCount = 0;

  for (
    const selector
    of selectors
  ) {
    try {
      const matches =
        $(selector);

      usableSelectorCount++;

      if (
        matches.length === 0
      ) {
        unmatched.push(
          selector
        );

        continue;
      }

      matched.push(
        selector
      );

      for (
        const element
        of matches.toArray()
      ) {
        selectedElements.add(
          element
        );
      }
    } catch {
      invalid.push(
        selector
      );
    }
  }

  /*
   * Read selected elements in DOM order instead of selector
   * configuration order. This keeps comparison output stable
   * when multiple selectors are configured.
   */
  const body =
    $("body").toArray();

  const descendants =
    $("body")
      .find("*")
      .toArray();

  const orderedSelected =
    [
      ...body,
      ...descendants,
    ].filter(
      (element) =>
        selectedElements.has(
          element
        )
    );

  /*
   * If both a parent and one of its children were selected,
   * use only the parent. Otherwise the child's text would
   * appear twice in the comparison representation.
   */
  const topLevelSelected =
    orderedSelected.filter(
      (element) => {
        let parent =
          element.parent;

        while (parent) {
          if (
            selectedElements.has(
              parent
            )
          ) {
            return false;
          }

          parent =
            parent.parent;
        }

        return true;
      }
    );

  return {
    elements:
      topLevelSelected,

    matched,
    unmatched,
    invalid,

    hasUsableSelectors:
      usableSelectorCount > 0,
  };
}

export function extractMonitoringScope(
  html: string,
  includeSelectorsInput:
    string[] = [],
  ignoreSelectorsInput:
    string[] = []
): MonitoringScopeResult {
  const includeSelectors =
    normalizeSelectorList(
      includeSelectorsInput
    );

  const ignoreSelectors =
    normalizeSelectorList(
      ignoreSelectorsInput
    );

  const $ =
    cheerio.load(html);

  /*
   * Non-readable content should never participate in
   * comparison regardless of monitoring configuration.
   */
  $(
    NON_READABLE_SELECTOR
  ).remove();

  /*
   * Ignore regions are removed before include regions are
   * collected so exclusions work inside monitored sections.
   */
  const ignoreResult =
    applyIgnoreSelectors(
      $,
      ignoreSelectors
    );

  /*
   * No include selectors means Morrow keeps its original
   * whole-page monitoring behaviour.
   */
  if (
    includeSelectors.length ===
    0
  ) {
    return {
      text:
        extractReadableText(
          $("body").html() ??
            ""
        ),

      mode: "whole_page",

      includeSelectors,
      ignoreSelectors,

      matchedIncludeSelectors:
        [],

      unmatchedIncludeSelectors:
        [],

      invalidIncludeSelectors:
        [],

      matchedIgnoreSelectors:
        ignoreResult.matched,

      unmatchedIgnoreSelectors:
        ignoreResult.unmatched,

      invalidIgnoreSelectors:
        ignoreResult.invalid,

      hasUsableIncludeSelectors:
        true,
    };
  }

  const includeResult =
    collectIncludedElements(
      $,
      includeSelectors
    );

  const scopedHtml =
    includeResult.elements
      .map((element) =>
        $.html(element)
      )
      .join("\n");

  return {
    text:
      extractReadableText(
        scopedHtml
      ),

    mode:
      "selected_sections",

    includeSelectors,
    ignoreSelectors,

    matchedIncludeSelectors:
      includeResult.matched,

    unmatchedIncludeSelectors:
      includeResult.unmatched,

    invalidIncludeSelectors:
      includeResult.invalid,

    matchedIgnoreSelectors:
      ignoreResult.matched,

    unmatchedIgnoreSelectors:
      ignoreResult.unmatched,

    invalidIgnoreSelectors:
      ignoreResult.invalid,

    hasUsableIncludeSelectors:
      includeResult.hasUsableSelectors,
  };
}