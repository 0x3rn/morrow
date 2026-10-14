/*
 * THE-26.2 — Add notification preferences and channel routing schema
 *
 * 1. Extends notification_preferences with min_significance, categories_json,
 *    competitor_ids_json, digest_email_enabled, and digest_periods_json.
 * 2. Extends external_notification_channels with min_significance, categories_json,
 *    competitor_ids_json, and digest_periods_json.
 * 3. Creates digest_email_deliveries for idempotent scheduled digest email delivery.
 */

ALTER TABLE notification_preferences
    ADD COLUMN min_significance TEXT NOT NULL DEFAULT 'minor'
    CHECK (min_significance IN ('minor', 'moderate', 'major'));

ALTER TABLE notification_preferences
    ADD COLUMN categories_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(categories_json));

ALTER TABLE notification_preferences
    ADD COLUMN competitor_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(competitor_ids_json));

ALTER TABLE notification_preferences
    ADD COLUMN digest_email_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (digest_email_enabled IN (0, 1));

ALTER TABLE notification_preferences
    ADD COLUMN digest_periods_json TEXT NOT NULL DEFAULT '["weekly"]'
    CHECK (json_valid(digest_periods_json));

UPDATE notification_preferences
SET min_significance = 'major'
WHERE major_only = 1;

ALTER TABLE external_notification_channels
    ADD COLUMN send_changes INTEGER NOT NULL DEFAULT 1
    CHECK (send_changes IN (0, 1));

ALTER TABLE external_notification_channels
    ADD COLUMN send_digests INTEGER NOT NULL DEFAULT 1
    CHECK (send_digests IN (0, 1));

ALTER TABLE external_notification_channels
    ADD COLUMN min_significance TEXT NOT NULL DEFAULT 'minor'
    CHECK (min_significance IN ('minor', 'moderate', 'major'));

ALTER TABLE external_notification_channels
    ADD COLUMN categories_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(categories_json));

ALTER TABLE external_notification_channels
    ADD COLUMN competitor_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(competitor_ids_json));

ALTER TABLE external_notification_channels
    ADD COLUMN digest_periods_json TEXT NOT NULL DEFAULT '["daily","weekly","monthly"]'
    CHECK (json_valid(digest_periods_json));

CREATE TABLE digest_email_deliveries (
    id TEXT PRIMARY KEY,
    digest_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sending'
        CHECK (status IN ('sending', 'sent', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 1
        CHECK (attempt_count >= 1),
    claim_token TEXT,
    claimed_at TEXT,
    provider_message_id TEXT,
    last_error TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (digest_id, user_id),

    FOREIGN KEY (digest_id)
        REFERENCES digests(id)
        ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_digest_email_deliveries_digest
    ON digest_email_deliveries (digest_id);

CREATE INDEX idx_digest_email_deliveries_user
    ON digest_email_deliveries (user_id);

CREATE INDEX idx_digest_email_deliveries_status
    ON digest_email_deliveries (status, updated_at);

PRAGMA optimize;
