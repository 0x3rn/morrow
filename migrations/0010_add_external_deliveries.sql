/*
 * THE-25.2
 *
 * Persist workspace external notification destinations and
 * their delivery ledger for Slack, Telegram, and signed
 * HTTPS webhooks.
 *
 * notification_deliveries (0003) is user-scoped and
 * specific to immediate email change alerts. External
 * channels are workspace-scoped destinations and deliver
 * both persisted meaningful changes and generated digests.
 */

CREATE TABLE external_notification_channels (
    id TEXT PRIMARY KEY,

    workspace_id TEXT NOT NULL,

    channel TEXT NOT NULL
        CHECK (
            channel IN (
                'slack',
                'telegram',
                'webhook'
            )
        ),

    name TEXT NOT NULL
        CHECK (
            LENGTH(TRIM(name)) > 0
        ),

    status TEXT NOT NULL
        DEFAULT 'active'
        CHECK (
            status IN (
                'active',
                'paused'
            )
        ),

    config_json TEXT NOT NULL
        CHECK (
            json_valid(config_json)
        ),

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (
        workspace_id
    )
        REFERENCES workspaces(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_external_notification_channels_workspace
    ON external_notification_channels (
        workspace_id,
        status,
        id ASC
    );

CREATE TABLE external_notification_deliveries (
    id TEXT PRIMARY KEY,

    workspace_id TEXT NOT NULL,

    channel_id TEXT NOT NULL,

    channel TEXT NOT NULL
        CHECK (
            channel IN (
                'slack',
                'telegram',
                'webhook'
            )
        ),

    source_type TEXT NOT NULL
        CHECK (
            source_type IN (
                'change',
                'digest'
            )
        ),

    change_id TEXT,

    digest_id TEXT,

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

    FOREIGN KEY (
        workspace_id
    )
        REFERENCES workspaces(id)
        ON DELETE CASCADE,

    FOREIGN KEY (
        channel_id
    )
        REFERENCES external_notification_channels(id)
        ON DELETE CASCADE,

    FOREIGN KEY (
        change_id
    )
        REFERENCES changes(id)
        ON DELETE CASCADE,

    FOREIGN KEY (
        digest_id
    )
        REFERENCES digests(id)
        ON DELETE CASCADE,

    CHECK (
        (
            source_type = 'change'
            AND change_id IS NOT NULL
            AND digest_id IS NULL
        )
        OR
        (
            source_type = 'digest'
            AND digest_id IS NOT NULL
            AND change_id IS NULL
        )
    ),

    CHECK (
        (
            status = 'sending'
            AND claim_token IS NOT NULL
            AND claimed_at IS NOT NULL
            AND sent_at IS NULL
            AND last_error IS NULL
        )
        OR
        (
            status = 'sent'
            AND claim_token IS NULL
            AND sent_at IS NOT NULL
            AND last_error IS NULL
        )
        OR
        (
            status = 'failed'
            AND claim_token IS NULL
            AND sent_at IS NULL
            AND last_error IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX idx_external_deliveries_channel_change
    ON external_notification_deliveries (
        channel_id,
        change_id
    )
    WHERE source_type = 'change'
      AND change_id IS NOT NULL;

CREATE UNIQUE INDEX idx_external_deliveries_channel_digest
    ON external_notification_deliveries (
        channel_id,
        digest_id
    )
    WHERE source_type = 'digest'
      AND digest_id IS NOT NULL;

CREATE INDEX idx_external_deliveries_workspace
    ON external_notification_deliveries (
        workspace_id,
        created_at DESC
    );

CREATE INDEX idx_external_deliveries_status
    ON external_notification_deliveries (
        status,
        updated_at
    );

CREATE INDEX idx_external_deliveries_change
    ON external_notification_deliveries (
        change_id
    )
    WHERE change_id IS NOT NULL;

CREATE INDEX idx_external_deliveries_digest
    ON external_notification_deliveries (
        digest_id
    )
    WHERE digest_id IS NOT NULL;
