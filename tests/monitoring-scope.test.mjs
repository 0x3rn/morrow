import assert from "node:assert/strict";
import test from "node:test";

import {
  extractMonitoringScope,
  parseSelectorListJson,
} from "../worker/monitoring-scope.ts";

const html = `
<!doctype html>
<html>
  <body>
    <header>
      Navigation
    </header>

    <main>
      <section class="hero">
        <h1>Build better products</h1>
        <p>Ship faster.</p>
      </section>

      <section class="pricing">
        <h2>Pricing</h2>

        <div class="plan">
          <span>Pro</span>
          <span>$49 per month</span>
        </div>

        <div class="live-counter">
          12,843 customers online
        </div>
      </section>

      <section class="reviews">
        <p>Rotating customer review</p>
      </section>
    </main>

    <footer>
      Copyright
    </footer>

    <script>
      console.log("noise");
    </script>
  </body>
</html>
`;

test(
  "empty selector configuration keeps whole-page monitoring",
  () => {
    const result =
      extractMonitoringScope(
        html
      );

    assert.equal(
      result.mode,
      "whole_page"
    );

    assert.match(
      result.text,
      /Build better products/
    );

    assert.match(
      result.text,
      /\$49 per month/
    );

    assert.match(
      result.text,
      /Rotating customer review/
    );

    assert.doesNotMatch(
      result.text,
      /console\.log/
    );
  }
);

test(
  "include selectors limit comparison to selected sections",
  () => {
    const result =
      extractMonitoringScope(
        html,
        [".pricing"]
      );

    assert.equal(
      result.mode,
      "selected_sections"
    );

    assert.match(
      result.text,
      /Pricing/
    );

    assert.match(
      result.text,
      /\$49 per month/
    );

    assert.doesNotMatch(
      result.text,
      /Build better products/
    );

    assert.doesNotMatch(
      result.text,
      /Rotating customer review/
    );
  }
);

test(
  "ignore selectors remove content from whole-page comparison",
  () => {
    const result =
      extractMonitoringScope(
        html,
        [],
        [".reviews"]
      );

    assert.match(
      result.text,
      /Build better products/
    );

    assert.doesNotMatch(
      result.text,
      /Rotating customer review/
    );

    assert.deepEqual(
      result
        .matchedIgnoreSelectors,
      [".reviews"]
    );
  }
);

test(
  "ignore selectors work inside an included section",
  () => {
    const result =
      extractMonitoringScope(
        html,
        [".pricing"],
        [".live-counter"]
      );

    assert.match(
      result.text,
      /\$49 per month/
    );

    assert.doesNotMatch(
      result.text,
      /12,843 customers online/
    );
  }
);

test(
  "missing include selector does not throw",
  () => {
    const result =
      extractMonitoringScope(
        html,
        [".does-not-exist"]
      );

    assert.equal(
      result.text,
      ""
    );

    assert.deepEqual(
      result
        .unmatchedIncludeSelectors,
      [".does-not-exist"]
    );

    assert.equal(
      result
        .hasUsableIncludeSelectors,
      true
    );
  }
);

test(
  "invalid include selector does not crash extraction",
  () => {
    const result =
      extractMonitoringScope(
        html,
        ["["]
      );

    assert.equal(
      result.text,
      ""
    );

    assert.deepEqual(
      result
        .invalidIncludeSelectors,
      ["["]
    );

    assert.equal(
      result
        .hasUsableIncludeSelectors,
      false
    );
  }
);

test(
  "invalid ignore selector does not remove valid page content",
  () => {
    const result =
      extractMonitoringScope(
        html,
        [],
        ["["]
      );

    assert.match(
      result.text,
      /Build better products/
    );

    assert.deepEqual(
      result
        .invalidIgnoreSelectors,
      ["["]
    );
  }
);

test(
  "overlapping include selectors do not duplicate nested content",
  () => {
    const result =
      extractMonitoringScope(
        html,
        [
          ".pricing",
          ".pricing .plan",
        ]
      );

    const occurrences =
      result.text.split(
        "$49 per month"
      ).length - 1;

    assert.equal(
      occurrences,
      1
    );
  }
);

test(
  "selector JSON parser trims and deduplicates selectors",
  () => {
    const result =
      parseSelectorListJson(
        '[" .pricing ", ".hero", ".pricing"]'
      );

    assert.equal(
      result.valid,
      true
    );

    assert.deepEqual(
      result.selectors,
      [
        ".pricing",
        ".hero",
      ]
    );
  }
);

test(
  "selector JSON parser rejects malformed configuration",
  () => {
    const malformed =
      parseSelectorListJson(
        "{bad json"
      );

    assert.equal(
      malformed.valid,
      false
    );

    const wrongType =
      parseSelectorListJson(
        '{"selector":".pricing"}'
      );

    assert.equal(
      wrongType.valid,
      false
    );

    const nonStrings =
      parseSelectorListJson(
        '[".pricing", 123]'
      );

    assert.equal(
      nonStrings.valid,
      false
    );
  }
);