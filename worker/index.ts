import * as cheerio from "cheerio/slim";
import handler from "vinext/server/fetch-handler";
import { launch } from "@cloudflare/playwright";
import { diffLines } from "diff";

import {
  classifyChange,
  type ClassifiableDiffPart,
} from "./change-classifier";

import {
  summarizeChange,
  type MorrowAiBinding,
} from "./change-summarizer";

import {
  notifyChangeByEmail,
} from "./change-email";

interface Env {
  DB: D1Database;
  VINEXT_KV_CACHE: KVNamespace;
  BROWSER: BrowserRun;
  IMAGES: ImagesBinding;
  ASSETS: Fetcher;
  morrow_snapshots: R2Bucket;

  /*
   * THE-16
   *
   * Workers AI is optional at the TypeScript boundary
   * because summarization must never become a hard
   * dependency for storing a legitimate detected change.
   *
   * Wrangler should still provide this binding normally.
   */
  AI?: MorrowAiBinding;

  /*
   * THE-19
   *
   * Email configuration is also optional at the Worker
   * boundary.
   *
   * A monitoring run must remain valid when email has not
   * been configured yet or when the provider is unavailable.
   */
  RESEND_API_KEY?: string;
  MORROW_EMAIL_FROM?: string;
  MORROW_APP_URL?: string;
}

interface MonitoredPageRow {
  id: string;
  url: string;
  frequency_minutes: number;
  last_checked_at: string | null;
  next_check_at: string | null;
}

interface SnapshotRow {
  id: string;
  monitored_page_id: string;
  content_hash: string | null;
  text_object_key: string | null;
  html_object_key: string | null;
  screenshot_object_key: string | null;
  http_status: number | null;
  captured_at: string;
}

interface CaptureResult {
  html: string;
  screenshot: Uint8Array;
  status: number;
  title: string;
}

interface MeaningfulDiffPart
  extends ClassifiableDiffPart {
  added: boolean;
  removed: boolean;
  value: string;
}

/*
 * ------------------------------------------------------
 * Capture configuration
 * ------------------------------------------------------
 */

const MAX_CAPTURE_ATTEMPTS = 2;

const DUE_PAGE_LIMIT = 50;

/*
 * A temporary 10-minute claim prevents another scheduler
 * invocation from immediately picking the same page while
 * the current Browser Run capture is still processing.
 */
const CLAIM_MINUTES = 10;

/*
 * Historical volatility detection is intentionally
 * conservative.
 *
 * We need enough historical snapshots to observe a
 * repeated appear/disappear pattern before suppressing
 * anything automatically.
 */
const VOLATILITY_HISTORY_LIMIT = 6;
const MIN_VOLATILITY_SNAPSHOTS = 4;
const MIN_VOLATILITY_TRANSITIONS = 3;
const MIN_VOLATILITY_PRESENT = 2;
const MIN_VOLATILITY_ABSENT = 2;

/*
 * ------------------------------------------------------
 * THE-14 static noise filtering
 * ------------------------------------------------------
 */

const noiseLinePatterns = [
  /^we use cookies\b/i,
  /^this (?:website|site) uses cookies\b/i,
  /^manage cookies$/i,
  /^manage cookie preferences$/i,
  /^cookie settings$/i,
  /^cookie preferences$/i,
  /^accept all$/i,
  /^accept all cookies$/i,
  /^reject all$/i,
  /^reject all cookies$/i,
  /^allow all$/i,
  /^necessary cookies only$/i,

  /^(?:last updated|updated|generated|refreshed)\s+(?:just now|\d+\s+(?:seconds?|minutes?|hours?)\s+ago)$/i,

  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i,

  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,

  /^[0-9a-f]{32,128}$/i,

  /^(?:request|session|trace|correlation|build)[ _-]?id\s*[:#]?\s*[a-z0-9._:-]{8,}$/i,
];

/*
 * ------------------------------------------------------
 * Text helpers
 * ------------------------------------------------------
 */

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

/*
 * Commercial content must not be discarded merely because
 * it changes frequently.
 *
 * This protects the most strategically important lines
 * from THE-14 historical volatility suppression.
 */
function isProtectedBusinessLine(
  line: string
) {
  return (
    /[$€£¥₦₹]/.test(line) ||

    /\b(?:usd|eur|gbp|ngn|cad|aud|jpy|inr)\b/i.test(
      line
    ) ||

    /\d+(?:[.,]\d+)?\s*%/.test(
      line
    ) ||

    /\b(?:price|pricing|fee|fees|per month|per year|monthly|annually|annual plan|discount)\b/i.test(
      line
    )
  );
}

function isStaticNoiseLine(
  line: string
) {
  if (
    isProtectedBusinessLine(
      line
    )
  ) {
    return false;
  }

  return noiseLinePatterns.some(
    (pattern) =>
      pattern.test(line)
  );
}

function filterStaticNoise(
  text: string
) {
  return splitNormalizedLines(
    text
  ).filter(
    (line) =>
      !isStaticNoiseLine(line)
  );
}

function countChangedLines(
  value: string
) {
  return value
    .split(/\r?\n/)
    .map(normalizeReadableLine)
    .filter(Boolean)
    .length;
}

/*
 * ------------------------------------------------------
 * HTML → readable text
 * ------------------------------------------------------
 */

function extractReadableText(
  html: string
) {
  const $ =
    cheerio.load(html);

  /*
   * These elements do not represent readable competitor
   * content and create unnecessary diff noise.
   */
  $(
    "script, style, noscript, template, svg, canvas, iframe"
  ).remove();

  /*
   * Insert line boundaries for common block elements before
   * reading the body's text.
   *
   * This keeps line-level comparison useful instead of
   * collapsing an entire page into one enormous string.
   */
  $("br").replaceWith("\n");

  $(
    [
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
    ].join(",")
  ).each((_, element) => {
    $(element).append("\n");
  });

  const rawText =
    $("body").text();

  return splitNormalizedLines(
    rawText
  ).join("\n");
}

/*
 * ------------------------------------------------------
 * Hashing
 * ------------------------------------------------------
 */

async function sha256(
  value: string
) {
  const bytes =
    new TextEncoder().encode(
      value
    );

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      bytes
    );

  return Array.from(
    new Uint8Array(digest)
  )
    .map((byte) =>
      byte
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
}

/*
 * ------------------------------------------------------
 * Browser Run capture
 * ------------------------------------------------------
 */

async function captureRenderedPage(
  env: Env,
  pageToCapture: MonitoredPageRow
): Promise<CaptureResult> {
  let lastError:
    unknown = null;

  for (
    let attempt = 1;
    attempt <=
    MAX_CAPTURE_ATTEMPTS;
    attempt++
  ) {
    let browser:
      Awaited<
        ReturnType<typeof launch>
      > | null = null;

    let context:
      Awaited<
        ReturnType<
          Awaited<
            ReturnType<
              typeof launch
            >
          >["newContext"]
        >
      > | null = null;

    try {
      browser =
        await launch(
          env.BROWSER
        );

      /*
       * THE-14 deterministic environment.
       *
       * These settings substantially reduce false changes
       * caused by browser-controlled region/language/
       * viewport differences.
       */
      context =
        await browser.newContext(
          {
            locale: "en-GB",

            timezoneId:
              "Europe/London",

            viewport: {
              width: 1440,
              height: 900,
            },

            userAgent:
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",

            extraHTTPHeaders: {
              "Accept-Language":
                "en-GB,en;q=0.9",
            },
          }
        );

      const page =
        await context.newPage();

      const response =
        await page.goto(
          pageToCapture.url,
          {
            waitUntil:
              "networkidle",

            timeout:
              45_000,
          }
        );

      /*
       * Give delayed client-side content a short stable
       * window after network idle.
       */
      await page.waitForTimeout(
        750
      );

      const html =
        await page.content();

      const title =
        await page.title();

      const screenshot =
        await page.screenshot({
          fullPage: true,
          type: "png",
        });

      const status =
        response?.status() ??
        200;

      console.log(
        "Morrow captured rendered page",
        {
          id:
            pageToCapture.id,

          url:
            pageToCapture.url,

          status,

          title,

          htmlLength:
            html.length,
        }
      );

      return {
        html,

        screenshot:
          new Uint8Array(
            screenshot
          ),

        status,

        title,
      };
    } catch (error) {
      lastError = error;

      console.warn(
        "Morrow capture attempt failed",
        {
          id:
            pageToCapture.id,

          url:
            pageToCapture.url,

          attempt,

          maxAttempts:
            MAX_CAPTURE_ATTEMPTS,

          error:
            error instanceof
            Error
              ? error.message
              : String(error),
        }
      );
    } finally {
      if (context) {
        try {
          await context.close();
        } catch {
          /*
           * Local Browser Run can emit teardown/network
           * warnings after useful work already completed.
           */
        }
      }

      if (browser) {
        try {
          await browser.close();
        } catch {
          /*
           * Preserve the original capture result/error.
           */
        }
      }
    }
  }

  throw (
    lastError ??
    new Error(
      "Rendered page capture failed."
    )
  );
}

/*
 * ------------------------------------------------------
 * R2 helpers
 * ------------------------------------------------------
 */

async function readSnapshotText(
  env: Env,
  objectKey:
    string | null
) {
  if (!objectKey) {
    return null;
  }

  const object =
    await env.morrow_snapshots.get(
      objectKey
    );

  if (!object) {
    return null;
  }

  return object.text();
}

async function storeSnapshotObjects(
  env: Env,
  monitoredPageId: string,
  snapshotId: string,
  readableText: string,
  html: string,
  screenshot: Uint8Array
) {
  const baseKey =
    `snapshots/${monitoredPageId}/${snapshotId}`;

  const textObjectKey =
    `${baseKey}/page.txt`;

  const htmlObjectKey =
    `${baseKey}/page.html`;

  const screenshotObjectKey =
    `${baseKey}/screenshot.png`;

  await Promise.all([
    env.morrow_snapshots.put(
      textObjectKey,
      readableText,
      {
        httpMetadata: {
          contentType:
            "text/plain; charset=utf-8",
        },
      }
    ),

    env.morrow_snapshots.put(
      htmlObjectKey,
      html,
      {
        httpMetadata: {
          contentType:
            "text/html; charset=utf-8",
        },
      }
    ),

    env.morrow_snapshots.put(
      screenshotObjectKey,
      screenshot,
      {
        httpMetadata: {
          contentType:
            "image/png",
        },
      }
    ),
  ]);

  return {
    textObjectKey,
    htmlObjectKey,
    screenshotObjectKey,
  };
}

/*
 * ------------------------------------------------------
 * Previous snapshot
 * ------------------------------------------------------
 */

async function getPreviousSnapshot(
  env: Env,
  monitoredPageId: string
) {
  return env.DB.prepare(
    `
      SELECT
        id,
        monitored_page_id,
        content_hash,
        text_object_key,
        html_object_key,
        screenshot_object_key,
        http_status,
        captured_at

      FROM snapshots

      WHERE monitored_page_id = ?

      ORDER BY
        captured_at DESC

      LIMIT 1
    `
  )
    .bind(
      monitoredPageId
    )
    .first<SnapshotRow>();
}

/*
 * ------------------------------------------------------
 * THE-14 historical volatility detection
 * ------------------------------------------------------
 */

async function getHistoricalVolatileLines(
  env: Env,
  monitoredPageId: string,
  currentSnapshotId: string,
  currentStaticLines: string[]
) {
  const historicalResult =
    await env.DB.prepare(
      `
        SELECT
          id,
          monitored_page_id,
          content_hash,
          text_object_key,
          html_object_key,
          screenshot_object_key,
          http_status,
          captured_at

        FROM snapshots

        WHERE monitored_page_id = ?

          AND id != ?

          AND text_object_key
              IS NOT NULL

        ORDER BY
          captured_at DESC

        LIMIT ?
      `
    )
      .bind(
        monitoredPageId,
        currentSnapshotId,
        VOLATILITY_HISTORY_LIMIT -
          1
      )
      .all<SnapshotRow>();

  const historicalRows =
    historicalResult.results ??
    [];

  /*
   * Convert DESC DB order to chronological order.
   */
  historicalRows.reverse();

  const lineSets:
    Set<string>[] = [];

  for (
    const snapshot
    of historicalRows
  ) {
    const text =
      await readSnapshotText(
        env,
        snapshot.text_object_key
      );

    if (!text) {
      continue;
    }

    const filteredLines =
      filterStaticNoise(
        text
      );

    lineSets.push(
      new Set(
        filteredLines
      )
    );
  }

  /*
   * Include the current snapshot as the newest observation.
   */
  lineSets.push(
    new Set(
      currentStaticLines
    )
  );

  if (
    lineSets.length <
    MIN_VOLATILITY_SNAPSHOTS
  ) {
    return new Set<string>();
  }

  const candidateLines =
    new Set<string>();

  for (
    const lineSet
    of lineSets
  ) {
    for (
      const line
      of lineSet
    ) {
      if (
        !isProtectedBusinessLine(
          line
        )
      ) {
        candidateLines.add(
          line
        );
      }
    }
  }

  const volatileLines =
    new Set<string>();

  for (
    const line
    of candidateLines
  ) {
    const presence =
      lineSets.map(
        (lineSet) =>
          lineSet.has(line)
      );

    const presentCount =
      presence.filter(
        Boolean
      ).length;

    const absentCount =
      presence.length -
      presentCount;

    let transitions = 0;

    for (
      let index = 1;
      index <
      presence.length;
      index++
    ) {
      if (
        presence[index] !==
        presence[index - 1]
      ) {
        transitions++;
      }
    }

    if (
      transitions >=
        MIN_VOLATILITY_TRANSITIONS &&
      presentCount >=
        MIN_VOLATILITY_PRESENT &&
      absentCount >=
        MIN_VOLATILITY_ABSENT
    ) {
      volatileLines.add(
        line
      );
    }
  }

  return volatileLines;
}

function removeVolatileLines(
  lines: string[],
  volatileLines:
    Set<string>
) {
  if (
    volatileLines.size === 0
  ) {
    return lines;
  }

  return lines.filter(
    (line) =>
      isProtectedBusinessLine(
        line
      ) ||
      !volatileLines.has(line)
  );
}

/*
 * ------------------------------------------------------
 * Diff calculation
 * ------------------------------------------------------
 */

function calculateMeaningfulDiff(
  previousLines: string[],
  currentLines: string[]
) {
  const previousText =
    previousLines.join("\n");

  const currentText =
    currentLines.join("\n");

  const rawDiff =
    diffLines(
      previousText,
      currentText
    );

  const meaningfulDiffParts:
    MeaningfulDiffPart[] =
    rawDiff
      .filter(
        (part) =>
          Boolean(
            part.added ||
            part.removed
          )
      )
      .map((part) => ({
        added:
          Boolean(
            part.added
          ),

        removed:
          Boolean(
            part.removed
          ),

        value:
          part.value,
      }));

  const addedLines =
    meaningfulDiffParts
      .filter(
        (part) =>
          part.added
      )
      .reduce(
        (
          total,
          part
        ) =>
          total +
          countChangedLines(
            part.value
          ),
        0
      );

  const removedLines =
    meaningfulDiffParts
      .filter(
        (part) =>
          part.removed
      )
      .reduce(
        (
          total,
          part
        ) =>
          total +
          countChangedLines(
            part.value
          ),
        0
      );

  return {
    meaningfulDiffParts,
    addedLines,
    removedLines,

    hasMeaningfulTextChange:
      meaningfulDiffParts.length >
      0,
  };
}

/*
 * ------------------------------------------------------
 * THE-19 notification isolation
 * ------------------------------------------------------
 */

async function notifyPersistedChange(
  env: Env,
  changeId: string
) {
  try {
    const notificationResult =
      await notifyChangeByEmail(
        env,
        changeId
      );

    console.log(
      "Morrow change email notification processed",
      notificationResult
    );
  } catch (error) {
    /*
     * The change already exists in D1 at this point.
     *
     * Notification infrastructure is downstream of the
     * intelligence pipeline. A notification error therefore
     * must never be allowed to invalidate the persisted
     * change, the snapshot, or the successful capture.
     */
    console.error(
      "Morrow change email notification failed after persistence",
      {
        changeId,

        error:
          error instanceof
          Error
            ? error.message
            : String(error),
      }
    );
  }
}

/*
 * ------------------------------------------------------
 * Snapshot/change pipeline
 * ------------------------------------------------------
 */

async function processCapturedPage(
  env: Env,
  pageToCapture:
    MonitoredPageRow,
  ctx: ExecutionContext
) {
  const previousSnapshot =
    await getPreviousSnapshot(
      env,
      pageToCapture.id
    );

  console.log(
    "Morrow previous snapshot lookup",
    {
      monitoredPageId:
        pageToCapture.id,

      previousSnapshotId:
        previousSnapshot?.id ??
        null,

      previousContentHash:
        previousSnapshot?.content_hash ??
        null,
    }
  );

  const capture =
    await captureRenderedPage(
      env,
      pageToCapture
    );

  const capturedAt =
    new Date().toISOString();

  const readableText =
    extractReadableText(
      capture.html
    );

  const contentHash =
    await sha256(
      readableText
    );

  const snapshotId =
    crypto.randomUUID();

  const {
    textObjectKey,
    htmlObjectKey,
    screenshotObjectKey,
  } =
    await storeSnapshotObjects(
      env,
      pageToCapture.id,
      snapshotId,
      readableText,
      capture.html,
      capture.screenshot
    );

  await env.DB.prepare(
    `
      INSERT INTO snapshots (
        id,
        monitored_page_id,
        content_hash,
        text_object_key,
        html_object_key,
        screenshot_object_key,
        http_status,
        captured_at
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        datetime(?)
      )
    `
  )
    .bind(
      snapshotId,
      pageToCapture.id,
      contentHash,
      textObjectKey,
      htmlObjectKey,
      screenshotObjectKey,
      capture.status,
      capturedAt
    )
    .run();

  console.log(
    "Morrow snapshot stored",
    {
      monitoredPageId:
        pageToCapture.id,

      snapshotId,

      contentHash,

      textObjectKey,

      htmlObjectKey,

      screenshotObjectKey,

      readableTextLength:
        readableText.length,
    }
  );

  /*
   * ----------------------------------------------------
   * First capture = baseline only.
   * ----------------------------------------------------
   */

  if (!previousSnapshot) {
    console.log(
      "Morrow baseline snapshot created",
      {
        monitoredPageId:
          pageToCapture.id,

        snapshotId,
      }
    );

    await updateCaptureSchedule(
      env,
      pageToCapture,
      capturedAt
    );

    return;
  }

  const contentChanged =
    previousSnapshot.content_hash !==
    contentHash;

  console.log(
    "Morrow snapshot hash comparison",
    {
      monitoredPageId:
        pageToCapture.id,

      previousSnapshotId:
        previousSnapshot.id,

      currentSnapshotId:
        snapshotId,

      previousContentHash:
        previousSnapshot.content_hash,

      currentContentHash:
        contentHash,

      contentChanged,
    }
  );

  /*
   * THE-13 fast path.
   *
   * Identical readable-text hash means we do not load
   * the previous R2 object and do not perform diff work.
   */
  if (!contentChanged) {
    console.log(
      "Morrow page content unchanged",
      {
        monitoredPageId:
          pageToCapture.id,

        previousSnapshotId:
          previousSnapshot.id,

        currentSnapshotId:
          snapshotId,
      }
    );

    await updateCaptureSchedule(
      env,
      pageToCapture,
      capturedAt
    );

    return;
  }

  const previousReadableText =
    await readSnapshotText(
      env,
      previousSnapshot.text_object_key
    );

  console.log(
    "Morrow previous snapshot text loaded",
    {
      monitoredPageId:
        pageToCapture.id,

      previousSnapshotId:
        previousSnapshot.id,

      loaded:
        Boolean(
          previousReadableText
        ),

      previousTextLength:
        previousReadableText?.length ??
        0,
    }
  );

  if (
    previousReadableText ===
    null
  ) {
    /*
     * Snapshot evidence is incomplete.
     *
     * We still preserve the current snapshot, but we do
     * not invent a diff against missing previous text.
     */
    console.warn(
      "Morrow previous snapshot text unavailable",
      {
        monitoredPageId:
          pageToCapture.id,

        previousSnapshotId:
          previousSnapshot.id,

        textObjectKey:
          previousSnapshot.text_object_key,
      }
    );

    await updateCaptureSchedule(
      env,
      pageToCapture,
      capturedAt
    );

    return;
  }

  /*
   * ----------------------------------------------------
   * THE-14 static noise filtering
   * ----------------------------------------------------
   */

  const previousRawLines =
    splitNormalizedLines(
      previousReadableText
    );

  const currentRawLines =
    splitNormalizedLines(
      readableText
    );

  const previousStaticLines =
    filterStaticNoise(
      previousReadableText
    );

  const currentStaticLines =
    filterStaticNoise(
      readableText
    );

  console.log(
    "Morrow noise filtering applied",
    {
      monitoredPageId:
        pageToCapture.id,

      previousRawLines:
        previousRawLines.length,

      currentRawLines:
        currentRawLines.length,

      previousFilteredLines:
        previousStaticLines.length,

      currentFilteredLines:
        currentStaticLines.length,

      previousSuppressedLines:
        previousRawLines.length -
        previousStaticLines.length,

      currentSuppressedLines:
        currentRawLines.length -
        currentStaticLines.length,
    }
  );

  /*
   * ----------------------------------------------------
   * THE-14 historical volatility filtering
   * ----------------------------------------------------
   */

  const volatileLines =
    await getHistoricalVolatileLines(
      env,
      pageToCapture.id,
      snapshotId,
      currentStaticLines
    );

  const previousMeaningfulLines =
    removeVolatileLines(
      previousStaticLines,
      volatileLines
    );

  const currentMeaningfulLines =
    removeVolatileLines(
      currentStaticLines,
      volatileLines
    );

  console.log(
    "Morrow volatility filtering applied",
    {
      monitoredPageId:
        pageToCapture.id,

      volatileLineCount:
        volatileLines.size,

      previousLinesBefore:
        previousStaticLines.length,

      previousLinesAfter:
        previousMeaningfulLines.length,

      currentLinesBefore:
        currentStaticLines.length,

      currentLinesAfter:
        currentMeaningfulLines.length,
    }
  );

  /*
   * ----------------------------------------------------
   * THE-13 + THE-14 meaningful diff
   * ----------------------------------------------------
   */

  const {
    meaningfulDiffParts,
    addedLines,
    removedLines,
    hasMeaningfulTextChange,
  } =
    calculateMeaningfulDiff(
      previousMeaningfulLines,
      currentMeaningfulLines
    );

  console.log(
    "Morrow text diff calculated",
    {
      monitoredPageId:
        pageToCapture.id,

      previousSnapshotId:
        previousSnapshot.id,

      currentSnapshotId:
        snapshotId,

      hasMeaningfulTextChange,

      addedLines,

      removedLines,

      diffPartCount:
        meaningfulDiffParts.length,
    }
  );

  /*
   * Raw hash changed, but THE-14 says all of that change
   * was noise.
   */
  if (
    !hasMeaningfulTextChange
  ) {
    console.log(
      "Morrow raw change suppressed as noise",
      {
        monitoredPageId:
          pageToCapture.id,

        previousSnapshotId:
          previousSnapshot.id,

        currentSnapshotId:
          snapshotId,

        previousContentHash:
          previousSnapshot.content_hash,

        currentContentHash:
          contentHash,
      }
    );

    await updateCaptureSchedule(
      env,
      pageToCapture,
      capturedAt
    );

    return;
  }

  /*
   * ----------------------------------------------------
   * THE-15 deterministic classification
   * ----------------------------------------------------
   */

  const classification =
    classifyChange(
      meaningfulDiffParts
    );

  console.log(
    "Morrow change classified",
    {
      monitoredPageId:
        pageToCapture.id,

      category:
        classification.category,

      significance:
        classification.significance,

      confidence:
        classification.confidence,

      reasons:
        classification.reasons,

      signals:
        classification.signals,
    }
  );

  /*
   * ----------------------------------------------------
   * THE-16 human-readable summarization
   * ----------------------------------------------------
   *
   * THE-15 remains authoritative.
   *
   * The model receives the already-decided category and
   * significance plus bounded changed evidence.
   *
   * If AI fails, summarizeChange() returns its deterministic
   * fallback rather than preventing persistence.
   */

  const changeSummary =
    await summarizeChange(
      env.AI,
      {
        category:
          classification.category,

        significance:
          classification.significance,

        classificationConfidence:
          classification.confidence,

        classificationReasons:
          classification.reasons,

        addedLines,

        removedLines,

        parts:
          meaningfulDiffParts,
      }
    );

  console.log(
    "Morrow change summarized",
    {
      monitoredPageId:
        pageToCapture.id,

      category:
        classification.category,

      significance:
        classification.significance,

      summarySource:
        changeSummary.source,

      summaryModel:
        changeSummary.model,

      summary:
        changeSummary.summary,

      whyItMatters:
        changeSummary.whyItMatters,

      hasPreviousEvidence:
        Boolean(
          changeSummary.previousText
        ),

      hasCurrentEvidence:
        Boolean(
          changeSummary.currentText
        ),
    }
  );

  /*
   * Full page copies remain in R2.
   *
   * diff_json stores only changed evidence + audit metadata.
   *
   * previous_text/current_text are bounded evidence selected
   * by THE-16, not full snapshots.
   */
  const diffJson =
    JSON.stringify({
      addedLines,

      removedLines,

      classification: {
        confidence:
          classification.confidence,

        reasons:
          classification.reasons,

        signals:
          classification.signals,
      },

      summarization: {
        source:
          changeSummary.source,

        model:
          changeSummary.model,
      },

      parts:
        meaningfulDiffParts,
    });

  const changeId =
    crypto.randomUUID();

  await env.DB.prepare(
    `
      INSERT INTO changes (
        id,
        monitored_page_id,
        previous_snapshot_id,
        current_snapshot_id,
        category,
        significance,
        summary,
        why_it_matters,
        previous_text,
        current_text,
        diff_json
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
    `
  )
    .bind(
      changeId,

      pageToCapture.id,

      previousSnapshot.id,

      snapshotId,

      classification.category,

      classification.significance,

      changeSummary.summary,

      changeSummary.whyItMatters,

      changeSummary.previousText,

      changeSummary.currentText,

      diffJson
    )
    .run();

  console.log(
    "Morrow change recorded",
    {
      changeId,

      monitoredPageId:
        pageToCapture.id,

      previousSnapshotId:
        previousSnapshot.id,

      currentSnapshotId:
        snapshotId,

      category:
        classification.category,

      significance:
        classification.significance,

      summarySource:
        changeSummary.source,

      summaryModel:
        changeSummary.model,

      addedLines,

      removedLines,
    }
  );

  /*
   * ----------------------------------------------------
   * THE-19 asynchronous email notification
   * ----------------------------------------------------
   *
   * The change has already been safely persisted.
   *
   * waitUntil() lets notification delivery continue after
   * the capture path has moved on without making email a
   * hard dependency of the monitoring pipeline.
   *
   * notifyPersistedChange() catches its own errors, while
   * notification_deliveries supplies persistent
   * change/user/channel idempotency.
   */
  ctx.waitUntil(
    notifyPersistedChange(
      env,
      changeId
    )
  );

  await updateCaptureSchedule(
    env,
    pageToCapture,
    capturedAt
  );
}

/*
 * ------------------------------------------------------
 * Scheduler state updates
 * ------------------------------------------------------
 */

async function updateCaptureSchedule(
  env: Env,
  pageToCapture:
    MonitoredPageRow,
  capturedAt: string
) {
  const frequencyMinutes =
    Math.max(
      1,
      Number(
        pageToCapture.frequency_minutes
      ) || 1440
    );

  await env.DB.prepare(
    `
      UPDATE monitored_pages

      SET
        last_checked_at =
          datetime(?),

        next_check_at =
          datetime(
            ?,
            '+' || ? || ' minutes'
          ),

        updated_at =
          CURRENT_TIMESTAMP

      WHERE id = ?
    `
  )
    .bind(
      capturedAt,
      capturedAt,
      frequencyMinutes,
      pageToCapture.id
    )
    .run();

  console.log(
    "Morrow capture schedule updated",
    {
      id:
        pageToCapture.id,

      lastCheckedAt:
        capturedAt,

      frequencyMinutes,
    }
  );
}

/*
 * ------------------------------------------------------
 * Scheduler query
 * ------------------------------------------------------
 */

async function getDueMonitoredPages(
  env: Env,
  now: string
) {
  const result =
    await env.DB.prepare(
      `
        SELECT
          monitored_pages.id,
          monitored_pages.url,
          monitored_pages.frequency_minutes,
          monitored_pages.last_checked_at,
          monitored_pages.next_check_at

        FROM monitored_pages

        INNER JOIN competitors
          ON competitors.id =
             monitored_pages.competitor_id

        WHERE
          monitored_pages.status =
            'active'

          AND competitors.status =
            'active'

          AND (
            monitored_pages.next_check_at
              IS NULL

            OR datetime(
              monitored_pages.next_check_at
            ) <= datetime(?)
          )

        ORDER BY
          COALESCE(
            monitored_pages.next_check_at,
            monitored_pages.created_at
          ) ASC

        LIMIT ?
      `
    )
      .bind(
        now,
        DUE_PAGE_LIMIT
      )
      .all<MonitoredPageRow>();

  return (
    result.results ??
    []
  );
}

async function claimMonitoredPages(
  env: Env,
  pages:
    MonitoredPageRow[],
  now: string
) {
  const claimed:
    MonitoredPageRow[] =
    [];

  for (
    const page
    of pages
  ) {
    const result =
      await env.DB.prepare(
        `
          UPDATE monitored_pages

          SET
            next_check_at =
              datetime(
                ?,
                '+${CLAIM_MINUTES} minutes'
              ),

            updated_at =
              CURRENT_TIMESTAMP

          WHERE id = ?

            AND status =
              'active'

            AND (
              next_check_at IS NULL

              OR datetime(
                next_check_at
              ) <= datetime(?)
            )
        `
      )
        .bind(
          now,
          page.id,
          now
        )
        .run();

    const changes =
      result.meta?.changes ??
      0;

    if (changes > 0) {
      claimed.push(page);
    }
  }

  return claimed;
}

/*
 * ------------------------------------------------------
 * Scheduled capture loop
 * ------------------------------------------------------
 */

async function runMorrowScheduler(
  env: Env,
  controller:
    ScheduledController,
  ctx: ExecutionContext
) {
  const scheduledAt =
    new Date(
      controller.scheduledTime
    ).toISOString();

  console.log(
    "Morrow scheduler fired",
    {
      cron:
        controller.cron,

      scheduledAt,
    }
  );

  const duePages =
    await getDueMonitoredPages(
      env,
      scheduledAt
    );

  console.log(
    "Morrow due monitored pages",
    {
      count:
        duePages.length,

      pages:
        duePages.map(
          (page) => ({
            id:
              page.id,

            url:
              page.url,

            frequencyMinutes:
              page.frequency_minutes,

            lastCheckedAt:
              page.last_checked_at,

            nextCheckAt:
              page.next_check_at,
          })
        ),
    }
  );

  if (
    duePages.length === 0
  ) {
    return;
  }

  const claimedPages =
    await claimMonitoredPages(
      env,
      duePages,
      scheduledAt
    );

  console.log(
    "Morrow claimed monitored pages",
    {
      count:
        claimedPages.length,

      pages:
        claimedPages.map(
          (page) => ({
            id:
              page.id,

            url:
              page.url,

            frequencyMinutes:
              page.frequency_minutes,
          })
        ),
    }
  );

  for (
    const pageToCapture
    of claimedPages
  ) {
    try {
      await processCapturedPage(
        env,
        pageToCapture,
        ctx
      );
    } catch (error) {
      console.error(
        "Morrow page capture failed",
        {
          id:
            pageToCapture.id,

          url:
            pageToCapture.url,

          error:
            error instanceof
            Error
              ? error.message
              : String(error),
        }
      );

      /*
       * The initial claim already scheduled a retry window
       * approximately 10 minutes later.
       *
       * We deliberately do not mark last_checked_at as a
       * successful check here.
       */
    }
  }
}

/*
 * ------------------------------------------------------
 * Worker entry point
 * ------------------------------------------------------
 */

export default {
  /*
   * All ordinary Next.js requests continue through vinext.
   *
   * Passing env and ctx through is important so the vinext
   * request handler retains access to Worker bindings and
   * ctx.waitUntil().
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    return handler.fetch(
      request,
      env,
      ctx
    );
  },

  /*
   * Cloudflare Cron Trigger / local scheduled endpoint.
   */
  async scheduled(
    controller:
      ScheduledController,

    env: Env,

    ctx:
      ExecutionContext
  ) {
    try {
      await runMorrowScheduler(
        env,
        controller,
        ctx
      );
    } catch (error) {
      console.error(
        "Morrow scheduler fatal error",
        {
          cron:
            controller.cron,

          scheduledAt:
            new Date(
              controller.scheduledTime
            ).toISOString(),

          error:
            error instanceof
            Error
              ? error.message
              : String(error),
        }
      );

      throw error;
    }
  },
} satisfies ExportedHandler<Env>;