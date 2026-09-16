import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_MONITORING_SELECTOR_LENGTH,
  MAX_MONITORING_SELECTORS,
  parseMonitoringSelectorInput,
} from "../lib/monitoring-selectors.ts";

test(
  "empty input returns no selectors",
  () => {
    assert.deepEqual(
      parseMonitoringSelectorInput(
        ""
      ),
      []
    );
  }
);

test(
  "selectors are trimmed and deduplicated",
  () => {
    assert.deepEqual(
      parseMonitoringSelectorInput(
        `
          .pricing
          #hero
          .pricing
        `
      ),
      [
        ".pricing",
        "#hero",
      ]
    );
  }
);

test(
  "common CSS selectors are accepted",
  () => {
    assert.deepEqual(
      parseMonitoringSelectorInput(
        [
          ".pricing",
          "#hero",
          "main > section",
          "[data-plan='pro']",
          ".card:nth-child(2)",
        ].join("\n")
      ),
      [
        ".pricing",
        "#hero",
        "main > section",
        "[data-plan='pro']",
        ".card:nth-child(2)",
      ]
    );
  }
);

test(
  "invalid CSS selectors are rejected",
  () => {
    assert.throws(
      () =>
        parseMonitoringSelectorInput(
          ".pricing\n["
        ),
      /Invalid CSS selector/
    );
  }
);

test(
  "selector count is limited",
  () => {
    const selectors =
      Array.from(
        {
          length:
            MAX_MONITORING_SELECTORS +
            1,
        },
        (_, index) =>
          `.section-${index}`
      ).join("\n");

    assert.throws(
      () =>
        parseMonitoringSelectorInput(
          selectors
        ),
      /no more than/
    );
  }
);

test(
  "individual selector length is limited",
  () => {
    const selector =
      `.${"a".repeat(
        MAX_MONITORING_SELECTOR_LENGTH
      )}`;

    assert.throws(
      () =>
        parseMonitoringSelectorInput(
          selector
        ),
      /characters or fewer/
    );
  }
);