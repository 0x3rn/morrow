CREATE TABLE notification_deliveries (
    id TEXT PRIMARY KEY,

    change_id TEXT NOT NULL,
    user_id TEXT NOT NULL,

    channel TEXT NOT NULL DEFAULT 'email',

    status TEXT NOT NULL DEFAULT 'sending'
        CHECK (
            status IN (
                'sending',
                'sent',
                'failed'
            )
        ),

    attempt_count INTEGER NOT NULL DEFAULT 0
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