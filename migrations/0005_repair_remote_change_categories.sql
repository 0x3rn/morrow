/*
 * THE-20 remote schema repair
 * ---------------------------------------------
 *
 * Why this migration exists:
 *
 * 0004_align_change_categories.sql is already
 * recorded as applied in the remote D1 migration
 * history, but the remote changes table still has
 * the older category CHECK constraint.
 *
 * D1 tracks migration filenames. An already-applied
 * migration must not be repaired by editing and
 * attempting to replay the same filename.
 *
 * 0005 therefore performs a fresh, safe rebuild.
 *
 *
 * This migration is deliberately compatible with
 * BOTH possible source schemas:
 *
 * Legacy:
 *   features
 *   landing_page
 *
 * Current:
 *   feature
 *
 *
 * Category normalization:
 *
 * features
 *   -> feature
 *
 * landing_page
 *   -> other
 *
 * feature
 *   -> feature
 *
 * all current valid values
 *   -> unchanged
 *
 * any unexpected historical value
 *   -> other
 *
 *
 * notification_deliveries is preserved because it
 * references changes and contains important delivery
 * state such as:
 *
 * - status
 * - attempt_count
 * - provider_message_id
 * - sent_at
 * - failure details
 *
 * The temporary delivery backup has no foreign keys.
 * The final notification_deliveries table is created
 * only after the final changes table is in place.
 */

PRAGMA defer_foreign_keys = ON;


/*
 * ==================================================
 * 1. Build corrected changes table
 * ==================================================
 */

CREATE TABLE changes_repaired (
    id TEXT PRIMARY KEY,

    monitored_page_id TEXT NOT NULL,

    previous_snapshot_id TEXT,

    current_snapshot_id TEXT NOT NULL,

    category TEXT NOT NULL
        DEFAULT 'other'
        CHECK (
            category IN (
                'pricing',
                'product',
                'feature',
                'positioning',
                'promotion',
                'policy',
                'navigation',
                'content',
                'other'
            )
        ),

    significance TEXT NOT NULL
        DEFAULT 'minor'
        CHECK (
            significance IN (
                'minor',
                'moderate',
                'major'
            )
        ),

    summary TEXT,

    why_it_matters TEXT,

    previous_text TEXT,

    current_text TEXT,

    diff_json TEXT,

    detected_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (
        monitored_page_id
    )
        REFERENCES monitored_pages(id)
        ON DELETE CASCADE,

    FOREIGN KEY (
        previous_snapshot_id
    )
        REFERENCES snapshots(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (
        current_snapshot_id
    )
        REFERENCES snapshots(id)
        ON DELETE RESTRICT
);


/*
 * ==================================================
 * 2. Copy and normalize all existing changes
 * ==================================================
 */

INSERT INTO changes_repaired (
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
    diff_json,
    detected_at
)

SELECT
    id,

    monitored_page_id,

    previous_snapshot_id,

    current_snapshot_id,

    CASE
        WHEN category = 'features'
            THEN 'feature'

        WHEN category = 'landing_page'
            THEN 'other'

        WHEN category = 'pricing'
            THEN 'pricing'

        WHEN category = 'product'
            THEN 'product'

        WHEN category = 'feature'
            THEN 'feature'

        WHEN category = 'positioning'
            THEN 'positioning'

        WHEN category = 'promotion'
            THEN 'promotion'

        WHEN category = 'policy'
            THEN 'policy'

        WHEN category = 'navigation'
            THEN 'navigation'

        WHEN category = 'content'
            THEN 'content'

        WHEN category = 'other'
            THEN 'other'

        /*
         * Defensive historical fallback.
         *
         * An unknown old category must not make the
         * release migration fail or cause data loss.
         */
        ELSE 'other'
    END,

    CASE
        WHEN significance IN (
            'minor',
            'moderate',
            'major'
        )
            THEN significance

        /*
         * Same defensive approach for unexpected
         * historical significance values.
         */
        ELSE 'minor'
    END,

    summary,

    why_it_matters,

    previous_text,

    current_text,

    diff_json,

    detected_at

FROM changes;


/*
 * ==================================================
 * 3. Back up notification delivery data
 * ==================================================
 *
 * This temporary table intentionally has no
 * foreign-key constraints.
 */

CREATE TABLE notification_deliveries_backup AS

SELECT
    id,
    change_id,
    user_id,
    channel,
    status,
    attempt_count,
    claim_token,
    claimed_at,
    provider_message_id,
    last_error,
    sent_at,
    created_at,
    updated_at

FROM notification_deliveries;


/*
 * ==================================================
 * 4. Remove the old child and parent tables
 * ==================================================
 *
 * Child first.
 */

DROP TABLE notification_deliveries;

DROP TABLE changes;


/*
 * ==================================================
 * 5. Promote repaired changes table
 * ==================================================
 */

ALTER TABLE changes_repaired
RENAME TO changes;


/*
 * ==================================================
 * 6. Recreate notification delivery table
 * ==================================================
 */

CREATE TABLE notification_deliveries (
    id TEXT PRIMARY KEY,

    change_id TEXT NOT NULL,

    user_id TEXT NOT NULL,

    channel TEXT NOT NULL
        DEFAULT 'email',

    status TEXT NOT NULL
        DEFAULT 'sending'
        CHECK (
            status IN (
                'sending',
                'sent',
                'failed'
            )
        ),

    attempt_count INTEGER NOT NULL
        DEFAULT 0
        CHECK (
            attempt_count >= 0
        ),

    claim_token TEXT,

    claimed_at TEXT,

    provider_message_id TEXT,

    last_error TEXT,

    sent_at TEXT,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (
        change_id,
        user_id,
        channel
    ),

    FOREIGN KEY (
        change_id
    )
        REFERENCES changes(id)
        ON DELETE CASCADE,

    FOREIGN KEY (
        user_id
    )
        REFERENCES users(id)
        ON DELETE CASCADE
);


/*
 * ==================================================
 * 7. Restore every delivery record
 * ==================================================
 */

INSERT INTO notification_deliveries (
    id,
    change_id,
    user_id,
    channel,
    status,
    attempt_count,
    claim_token,
    claimed_at,
    provider_message_id,
    last_error,
    sent_at,
    created_at,
    updated_at
)

SELECT
    id,
    change_id,
    user_id,
    channel,
    status,
    attempt_count,
    claim_token,
    claimed_at,
    provider_message_id,
    last_error,
    sent_at,
    created_at,
    updated_at

FROM notification_deliveries_backup;


/*
 * ==================================================
 * 8. Remove temporary backup
 * ==================================================
 */

DROP TABLE notification_deliveries_backup;


/*
 * ==================================================
 * 9. Restore changes indexes
 * ==================================================
 */

CREATE INDEX idx_changes_page
    ON changes (
        monitored_page_id
    );

CREATE INDEX idx_changes_detected_at
    ON changes (
        detected_at
    );

CREATE INDEX idx_changes_significance
    ON changes (
        significance
    );


/*
 * ==================================================
 * 10. Restore notification delivery indexes
 * ==================================================
 */

CREATE INDEX idx_notification_deliveries_change
    ON notification_deliveries (
        change_id
    );

CREATE INDEX idx_notification_deliveries_user
    ON notification_deliveries (
        user_id
    );

CREATE INDEX idx_notification_deliveries_status
    ON notification_deliveries (
        status,
        updated_at
    );


/*
 * ==================================================
 * 11. Re-enable immediate FK checking
 * ==================================================
 *
 * D1 will also validate the transaction at commit.
 */

PRAGMA defer_foreign_keys = OFF;

PRAGMA optimize;