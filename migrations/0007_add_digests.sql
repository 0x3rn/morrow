/*
 * THE-24.1
 *
 * Persist generated reporting periods for Morrow digests.
 *
 * A digest belongs to one workspace and represents one
 * closed reporting window. Generation and delivery are
 * intentionally separate concerns:
 *
 * - THE-24.1 establishes persistence and idempotency.
 * - Later THE-24 units populate digest content, schedule
 *   generation, and deliver reports.
 *
 * The unique reporting-window constraint prevents scheduler
 * retries from creating duplicate digests for the same
 * workspace and period.
 */

CREATE TABLE digests (
    id TEXT PRIMARY KEY,

    workspace_id TEXT NOT NULL,

    period TEXT NOT NULL
        CHECK (
            period IN (
                'daily',
                'weekly',
                'monthly'
            )
        ),

    window_start TEXT NOT NULL,

    window_end TEXT NOT NULL,

    status TEXT NOT NULL
        DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'generated',
                'failed'
            )
        ),

    change_count INTEGER NOT NULL
        DEFAULT 0
        CHECK (change_count >= 0),

    major_change_count INTEGER NOT NULL
        DEFAULT 0
        CHECK (major_change_count >= 0),

    moderate_change_count INTEGER NOT NULL
        DEFAULT 0
        CHECK (moderate_change_count >= 0),

    minor_change_count INTEGER NOT NULL
        DEFAULT 0
        CHECK (minor_change_count >= 0),

    content_json TEXT,

    generated_at TEXT,

    failure_reason TEXT,

    created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE CASCADE,

    CHECK (
        datetime(window_end) >
        datetime(window_start)
    ),

    CHECK (
        (
            status = 'generated'
            AND generated_at IS NOT NULL
            AND content_json IS NOT NULL
            AND failure_reason IS NULL
        )
        OR
        (
            status = 'failed'
            AND generated_at IS NULL
            AND failure_reason IS NOT NULL
        )
        OR
        (
            status = 'pending'
            AND generated_at IS NULL
            AND content_json IS NULL
            AND failure_reason IS NULL
        )
    ),

    UNIQUE (
        workspace_id,
        period,
        window_start,
        window_end
    )
);

CREATE INDEX idx_digests_workspace
    ON digests (
        workspace_id
    );

CREATE INDEX idx_digests_workspace_period
    ON digests (
        workspace_id,
        period,
        window_end DESC
    );

CREATE INDEX idx_digests_status
    ON digests (
        status
    );

CREATE INDEX idx_digests_created_at
    ON digests (
        created_at DESC
    );
