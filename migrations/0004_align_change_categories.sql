/*
 * THE-20 release migration
 *
 * The original changes.category CHECK constraint
 * predates the final THE-15 classifier vocabulary.
 *
 * Legacy schema:
 *
 *   features
 *   landing_page
 *
 * Current authoritative classifier vocabulary:
 *
 *   pricing
 *   product
 *   feature
 *   positioning
 *   promotion
 *   policy
 *   navigation
 *   content
 *   other
 *
 * SQLite does not support directly replacing a
 * CHECK constraint, so the affected tables are
 * rebuilt.
 *
 * notification_deliveries is rebuilt as well
 * because it has a foreign key to changes.
 *
 * D1 runs migrations with foreign-key enforcement
 * active. defer_foreign_keys allows the temporary
 * schema transition while still requiring all
 * relationships to be valid when the migration
 * finishes.
 */

PRAGMA defer_foreign_keys = ON;


/*
 * --------------------------------------------------
 * 1. Build the corrected changes table
 * --------------------------------------------------
 */

CREATE TABLE changes_new (
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
 * Preserve historical changes.
 *
 * "features" has a direct modern equivalent:
 *
 *   features -> feature
 *
 * "landing_page" no longer has a one-to-one
 * semantic category in the deterministic
 * classifier.
 *
 * Mapping it to "other" preserves the historical
 * change without inventing a more specific meaning
 * such as positioning or content.
 */

INSERT INTO changes_new (
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

    CASE category
        WHEN 'features'
            THEN 'feature'

        WHEN 'landing_page'
            THEN 'other'

        ELSE category
    END,

    significance,
    summary,
    why_it_matters,
    previous_text,
    current_text,
    diff_json,
    detected_at

FROM changes;


/*
 * --------------------------------------------------
 * 2. Rebuild the delivery child table
 * --------------------------------------------------
 *
 * Dropping changes while the existing delivery
 * table still references it could trigger unwanted
 * foreign-key/cascade behavior.
 *
 * The child data is therefore copied first.
 */

CREATE TABLE notification_deliveries_new (
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
        REFERENCES changes_new(id)
        ON DELETE CASCADE,

    FOREIGN KEY (
        user_id
    )
        REFERENCES users(id)
        ON DELETE CASCADE
);


INSERT INTO notification_deliveries_new (
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

FROM notification_deliveries;


/*
 * --------------------------------------------------
 * 3. Replace the old tables
 * --------------------------------------------------
 */

DROP TABLE notification_deliveries;

DROP TABLE changes;

ALTER TABLE changes_new
RENAME TO changes;

ALTER TABLE notification_deliveries_new
RENAME TO notification_deliveries;


/*
 * --------------------------------------------------
 * 4. Restore indexes
 * --------------------------------------------------
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
 * All parent/child relationships must now be valid.
 */

PRAGMA defer_foreign_keys = OFF;

PRAGMA optimize;