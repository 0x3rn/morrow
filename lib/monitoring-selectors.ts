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

export interface DiscoveredMonitoringSection {
  selector: string;
  label: string;
  tagName: string;
  status: MonitoringSelectorMatchStatus;
  matchCount: number;
  preview: string;
}

const GENERATED_ID_PATTERN =
  /^(?:radix-|headlessui-|react-|mui-|chakra-|:r|[0-9a-f]{8,}|[a-z0-9]{16,})/i;

const CLEAN_ID_PATTERN =
  /^[a-zA-Z][a-zA-Z0-9_-]{1,64}$/;

const LANDMARK_LABELS: Record<string, string> = {
  header: "Header",
  nav: "Navigation",
  main: "Main content",
  section: "Section",
  article: "Article",
  aside: "Sidebar",
  footer: "Footer",
  table: "Table",
  form: "Form",
};

function humanizeIdentifier(value: string) {
  const cleaned = value
    .replace(/^#+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  return (
    cleaned.charAt(0).toUpperCase() +
    cleaned.slice(1)
  );
}

function escapeCssAttributeValue(
  value: string
) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function isUsableSingleSelector(
  $: ReturnType<typeof cheerio.load>,
  selector: string
) {
  if (
    !selector ||
    selector.length >
      MAX_MONITORING_SELECTOR_LENGTH
  ) {
    return false;
  }

  try {
    validationDocument(selector);
    return $(selector).length === 1;
  } catch {
    return false;
  }
}

const sampleElementList =
  validationDocument(
    "div"
  ).toArray();

type CheerioElement =
  (typeof sampleElementList)[number];

function buildStableSelectorForElement(
  $: ReturnType<typeof cheerio.load>,
  element: CheerioElement
): string | null {
  const tagName =
    element.tagName?.toLowerCase() || "div";

  const idAttr = (
    $(element).attr("id") || ""
  ).trim();

  if (
    idAttr &&
    CLEAN_ID_PATTERN.test(idAttr) &&
    !GENERATED_ID_PATTERN.test(idAttr)
  ) {
    const idSelector = `#${idAttr}`;
    if (isUsableSingleSelector($, idSelector)) {
      return idSelector;
    }
  }

  for (const attrName of [
    "data-section",
    "data-testid",
    "data-component",
    "aria-label",
  ]) {
    const rawValue = (
      $(element).attr(attrName) || ""
    ).trim();

    if (
      rawValue &&
      rawValue.length <= 64 &&
      !/[\r\n]/.test(rawValue)
    ) {
      const attrSelector = `${tagName}[${attrName}="${escapeCssAttributeValue(
        rawValue
      )}"]`;

      if (
        isUsableSingleSelector(
          $,
          attrSelector
        )
      ) {
        return attrSelector;
      }
    }
  }

  if (
    [
      "header",
      "nav",
      "main",
      "aside",
      "footer",
    ].includes(tagName) &&
    isUsableSingleSelector($, tagName)
  ) {
    return tagName;
  }

  const segments: string[] = [];
  let current: CheerioElement | null =
    element;

  while (
    current &&
    current.type === "tag"
  ) {
    const currentTag =
      current.tagName.toLowerCase();

    if (currentTag === "html") {
      break;
    }

    const currentId = (
      $(current).attr("id") || ""
    ).trim();

    if (
      currentId &&
      CLEAN_ID_PATTERN.test(currentId) &&
      !GENERATED_ID_PATTERN.test(
        currentId
      )
    ) {
      const anchor = `#${currentId}`;
      if (isUsableSingleSelector($, anchor)) {
        segments.unshift(anchor);
        const candidate =
          segments.join(" > ");
        if (
          isUsableSingleSelector(
            $,
            candidate
          )
        ) {
          return candidate;
        }
      }
    }

    if (
      currentTag === "body" ||
      ([
        "main",
        "header",
        "footer",
        "nav",
        "aside",
      ].includes(currentTag) &&
        isUsableSingleSelector(
          $,
          currentTag
        ))
    ) {
      segments.unshift(currentTag);
      const candidate =
        segments.join(" > ");
      if (
        isUsableSingleSelector(
          $,
          candidate
        )
      ) {
        return candidate;
      }
      if (currentTag === "body") {
        break;
      }
    }

    const parentNode: CheerioElement | null =
      current.parent &&
      current.parent.type === "tag"
        ? (current.parent as CheerioElement)
        : null;

    if (!parentNode) {
      segments.unshift(currentTag);
      break;
    }

    const sameTagSiblings = $(
      parentNode
    )
      .children(currentTag)
      .toArray();

    if (sameTagSiblings.length <= 1) {
      segments.unshift(currentTag);
    } else {
      const index =
        sameTagSiblings.indexOf(
          current
        ) + 1;
      segments.unshift(
        `${currentTag}:nth-of-type(${
          index > 0 ? index : 1
        })`
      );
    }

    current = parentNode;
  }

  const fullSelector =
    segments.join(" > ");

  if (
    isUsableSingleSelector(
      $,
      fullSelector
    )
  ) {
    return fullSelector;
  }

  return null;
}

function deriveSectionLabel(
  $: ReturnType<typeof cheerio.load>,
  element: CheerioElement,
  selector: string,
  index: number
): string {
  const tagName =
    element.tagName?.toLowerCase() || "div";

  const ariaLabel = normalizeSelectorPreview(
    $(element).attr("aria-label") || ""
  );

  if (
    ariaLabel &&
    ariaLabel.length <= 70
  ) {
    return ariaLabel;
  }

  const headingText = normalizeSelectorPreview(
    $(element)
      .find("h1, h2, h3, h4")
      .first()
      .text()
  );

  if (headingText) {
    return headingText.length > 70
      ? `${headingText.slice(0, 67)}…`
      : headingText;
  }

  for (const attrName of [
    "data-section",
    "id",
    "data-testid",
  ]) {
    const rawValue = (
      $(element).attr(attrName) || ""
    ).trim();

    if (
      rawValue &&
      !GENERATED_ID_PATTERN.test(rawValue)
    ) {
      const humanized =
        humanizeIdentifier(rawValue);
      if (
        humanized &&
        humanized.length <= 60
      ) {
        return humanized;
      }
    }
  }

  const baseLandmark =
    LANDMARK_LABELS[tagName] ||
    "Page section";

  if (selector.startsWith("#")) {
    const humanized =
      humanizeIdentifier(selector);
    if (humanized) {
      return humanized;
    }
  }

  return `${baseLandmark} ${index + 1}`;
}

export function discoverMonitoringSections(
  html: string,
  existingIncludeSelectorsInput: string[] = []
): DiscoveredMonitoringSection[] {
  const $ = cheerio.load(html);

  $(NON_READABLE_SELECTOR).remove();

  const existingSelectors = [
    ...new Set(
      existingIncludeSelectorsInput
        .map((selector) =>
          selector.trim()
        )
        .filter(Boolean)
    ),
  ];

  const candidateElements: CheerioElement[] =
    [];
  const seenElements =
    new Set<CheerioElement>();

  function addCandidate(
    element: CheerioElement
  ) {
    if (seenElements.has(element)) {
      return;
    }

    const tagName =
      element.tagName?.toLowerCase() || "";

    if (
      !tagName ||
      [
        "html",
        "head",
        "body",
        "script",
        "style",
      ].includes(tagName)
    ) {
      return;
    }

    const text =
      normalizeSelectorPreview(
        $(element).text()
      );

    if (text.length < 20) {
      return;
    }

    seenElements.add(element);
    candidateElements.push(element);
  }

  $(
    "header, nav, main > section, main > article, section, article, aside, footer, [data-section], [role='region']"
  ).each((_, el) => {
    if (el.type === "tag") {
      addCandidate(el);
    }
  });

  $("main > div, body > div, div[id], table").each(
    (_, el) => {
      if (el.type !== "tag") {
        return;
      }

      const $el = $(el);
      const idAttr = (
        $el.attr("id") || ""
      ).trim();

      const hasCleanId =
        Boolean(idAttr) &&
        CLEAN_ID_PATTERN.test(idAttr) &&
        !GENERATED_ID_PATTERN.test(idAttr);

      const hasHeading =
        $el.find("h1, h2, h3").length > 0;

      if (
        hasCleanId ||
        hasHeading ||
        el.tagName.toLowerCase() === "table"
      ) {
        addCandidate(el);
      }
    }
  );

  if (candidateElements.length === 0) {
    $("main, body > *").each((_, el) => {
      if (el.type === "tag") {
        addCandidate(el);
      }
    });
  }

  /*
   * Filter out overly broad container elements (e.g. a root #app
   * wrapper or <main>) when 2+ more granular child candidates
   * already exist inside them.
   */
  const filteredCandidates =
    candidateElements.filter(
      (candidate) => {
        const descendantCandidates =
          candidateElements.filter(
            (other) =>
              other !== candidate &&
              $.contains(
                candidate,
                other
              )
          );

        if (
          descendantCandidates.length >= 2
        ) {
          return false;
        }

        if (
          descendantCandidates.length === 1
        ) {
          const parentLen =
            normalizeSelectorPreview(
              $(candidate).text()
            ).length;
          const childLen =
            normalizeSelectorPreview(
              $(
                descendantCandidates[0]
              ).text()
            ).length;

          if (
            parentLen > 0 &&
            childLen / parentLen >= 0.85
          ) {
            return false;
          }
        }

        return true;
      }
    );

  const bodyOrder = $("body")
    .find("*")
    .toArray();

  filteredCandidates.sort(
    (left, right) =>
      bodyOrder.indexOf(left) -
      bodyOrder.indexOf(right)
  );

  const results: DiscoveredMonitoringSection[] =
    [];
  const seenSelectors =
    new Set<string>();
  const seenPreviews =
    new Set<string>();

  for (const element of filteredCandidates) {
    if (
      results.length >=
      MAX_MONITORING_SELECTORS
    ) {
      break;
    }

    const selector =
      buildStableSelectorForElement(
        $,
        element
      );

    if (
      !selector ||
      seenSelectors.has(selector)
    ) {
      continue;
    }

    const match = getSelectorMatch(
      $,
      selector
    );

    if (
      match.status !== "matched" ||
      !match.preview
    ) {
      continue;
    }

    const previewKey =
      match.preview.toLowerCase();

    if (seenPreviews.has(previewKey)) {
      continue;
    }

    seenSelectors.add(selector);
    seenPreviews.add(previewKey);

    results.push({
      selector,
      label: deriveSectionLabel(
        $,
        element,
        selector,
        results.length
      ),
      tagName:
        element.tagName?.toLowerCase() ||
        "section",
      status: match.status,
      matchCount: match.matchCount,
      preview: match.preview,
    });
  }

  /*
   * Ensure any previously saved selectors are always represented
   * in the list (even if they were removed from the page and now
   * have status === "unmatched").
   */
  for (const existingSelector of existingSelectors) {
    if (seenSelectors.has(existingSelector)) {
      continue;
    }

    const match = getSelectorMatch(
      $,
      existingSelector
    );

    let derivedLabel =
      humanizeIdentifier(existingSelector);

    if (match.status === "matched") {
      const firstEl = $(
        existingSelector
      ).get(0);
      if (
        firstEl &&
        firstEl.type === "tag"
      ) {
        derivedLabel =
          deriveSectionLabel(
            $,
            firstEl,
            existingSelector,
            results.length
          );
      }
    }

    seenSelectors.add(existingSelector);

    results.unshift({
      selector: existingSelector,
      label:
        derivedLabel ||
        `Saved section (${existingSelector})`,
      tagName: "section",
      status: match.status,
      matchCount: match.matchCount,
      preview: match.preview,
    });
  }

  return results.slice(
    0,
    MAX_MONITORING_SELECTORS
  );
}