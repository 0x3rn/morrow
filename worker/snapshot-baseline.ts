/*
 * Choosing what a new capture is compared against.
 *
 * Normally the new capture is compared with the previous one. When the
 * previous capture was a broken page, the useful comparison is with the
 * last good capture from before the problem, so anything the competitor
 * really changed while the page was down is still reported.
 *
 * Database and storage access are passed in, so this can be tested
 * against a real SQLite database without the Worker runtime.
 */

import {
  assessPageHealth,
  isErrorStatus,
  type PageHealth,
} from "./page-availability.ts";

export interface SnapshotRow {
  id: string;
  monitored_page_id: string;
  content_hash: string | null;
  text_object_key: string | null;
  html_object_key: string | null;
  screenshot_object_key: string | null;
  http_status: number | null;
  captured_at: string;
}

export type ReadSnapshotText = (
  objectKey: string | null
) => Promise<string | null>;

export interface SnapshotQueryDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{
        results?: T[];
      }>;
    };
  };
}

/*
 * How many earlier captures to look through for a good one. An
 * outage that long would need hundreds of failed checks in a row.
 */
export const LAST_GOOD_SNAPSHOT_SCAN_LIMIT = 10;

/*
 * Health of the previous capture. Its text is read from storage only
 * when it differs from the current text; when the hash is the same
 * the current readable text IS the previous text.
 */
export async function assessPreviousSnapshotHealth(
  readText: ReadSnapshotText,
  previousSnapshot: SnapshotRow,
  currentReadableText: string,
  textIsIdentical: boolean
): Promise<PageHealth> {
  if (
    isErrorStatus(
      previousSnapshot.http_status
    )
  ) {
    return assessPageHealth(
      previousSnapshot.http_status,
      null
    );
  }

  const previousText =
    textIsIdentical
      ? currentReadableText
      : await readText(
          previousSnapshot.text_object_key
        );

  return assessPageHealth(
    previousSnapshot.http_status,
    previousText
  );
}

/*
 * The newest earlier capture that was a working page. Returns null
 * when there is none (for example the very first capture was already
 * broken). A capture whose text is gone cannot be compared, and a
 * "200" error page is not a good baseline either, so both are skipped.
 */
export async function getLastGoodSnapshot(
  db: SnapshotQueryDb,
  readText: ReadSnapshotText,
  monitoredPageId: string,
  currentSnapshotId: string
): Promise<SnapshotRow | null> {
  const result =
    await db
      .prepare(
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

            AND (
              http_status IS NULL
              OR http_status < 400
            )

          ORDER BY
            captured_at DESC

          LIMIT ?
        `
      )
      .bind(
        monitoredPageId,
        currentSnapshotId,
        LAST_GOOD_SNAPSHOT_SCAN_LIMIT
      )
      .all<SnapshotRow>();

  for (
    const candidate
    of result.results ?? []
  ) {
    const text =
      await readText(
        candidate.text_object_key
      );

    if (
      text !== null &&
      !assessPageHealth(
        candidate.http_status,
        text
      ).failed
    ) {
      return candidate;
    }
  }

  return null;
}
