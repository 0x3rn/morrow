import * as cheerio from "cheerio/slim";

export const MAX_MONITORING_SELECTORS = 20;
export const MAX_MONITORING_SELECTOR_LENGTH = 500;

const validationDocument =
  cheerio.load(
    "<html><body><div></div></body></html>"
  );

export function parseMonitoringSelectorInput(
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