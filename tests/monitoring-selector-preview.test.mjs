import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeMonitoringSelectors, normalizeMonitoringSelectorInput,
} from "../lib/monitoring-selectors.ts";

const html = `
<!doctype html>
<html>
  <body>
    <main>
      <section class="pricing">
        <h2>Pricing</h2>

        <div class="plan">
          Pro — $49 per month
        </div>

        <div class="live-counter">
          12,843 customers online
        </div>
      </section>

      <section id="features">
        <div class="feature-card">
          Analytics
        </div>

        <div class="feature-card">
          Alerts
        </div>
      </section>
    </main>

    <script>
      console.log("noise");
    </script>
  </body>
</html>
`;

test(
  "reports matched include selectors",
  () => {
    const result =
      analyzeMonitoringSelectors(
        html,
        [".pricing"],
        []
      );

    assert.equal(
      result
        .includeMatches[0]
        .status,
      "matched"
    );

    assert.equal(
      result
        .includeMatches[0]
        .matchCount,
      1
    );

    assert.match(
      result
        .includeMatches[0]
        .preview,
      /\$49 per month/
    );
  }
);

test(
  "reports unmatched selectors",
  () => {
    const result =
      analyzeMonitoringSelectors(
        html,
        [
          ".does-not-exist",
        ],
        []
      );

    assert.deepEqual(
      result.includeMatches[0],
      {
        selector:
          ".does-not-exist",
        status: "unmatched",
        matchCount: 0,
        preview: "",
      }
    );
  }
);

test(
  "reports selectors matching multiple elements",
  () => {
    const result =
      analyzeMonitoringSelectors(
        html,
        [".feature-card"],
        []
      );

    assert.equal(
      result
        .includeMatches[0]
        .matchCount,
      2
    );

    assert.match(
      result
        .includeMatches[0]
        .preview,
      /Analytics/
    );

    assert.match(
      result
        .includeMatches[0]
        .preview,
      /Alerts/
    );
  }
);

test(
  "reports ignore selector matches",
  () => {
    const result =
      analyzeMonitoringSelectors(
        html,
        [],
        [".live-counter"]
      );

    assert.equal(
      result
        .ignoreMatches[0]
        .status,
      "matched"
    );

    assert.equal(
      result
        .ignoreMatches[0]
        .matchCount,
      1
    );
  }
);

test(
  "ignore regions are removed before include preview",
  () => {
    const result =
      analyzeMonitoringSelectors(
        html,
        [".pricing"],
        [".live-counter"]
      );

    assert.match(
      result
        .includeMatches[0]
        .preview,
      /\$49 per month/
    );

    assert.doesNotMatch(
      result
        .includeMatches[0]
        .preview,
      /12,843 customers/
    );
  }
);

test(
  "invalid selectors are reported without throwing",
  () => {
    const result =
      analyzeMonitoringSelectors(
        html,
        ["["],
        []
      );

    assert.equal(
      result
        .includeMatches[0]
        .status,
      "invalid"
    );
  }
);

test(
  "preview normalization preserves invalid CSS for analysis",
  () => {
    assert.deepEqual(
      normalizeMonitoringSelectorInput(
        `
          .pricing
          [
          .pricing
        `
      ),
      [
        ".pricing",
        "[",
      ]
    );
  }
);