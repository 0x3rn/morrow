CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    auth_provider TEXT,
    auth_provider_user_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE RESTRICT
);

CREATE TABLE workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner'
        CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (workspace_id, user_id),

    FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE competitors (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    favicon_url TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE CASCADE,

    UNIQUE (workspace_id, domain)
);

CREATE TABLE monitored_pages (
    id TEXT PRIMARY KEY,
    competitor_id TEXT NOT NULL,
    url TEXT NOT NULL,
    label TEXT,
    frequency_minutes INTEGER NOT NULL DEFAULT 1440
        CHECK (frequency_minutes >= 60),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused')),
    last_checked_at TEXT,
    next_check_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (competitor_id)
        REFERENCES competitors(id)
        ON DELETE CASCADE,

    UNIQUE (competitor_id, url)
);

CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    monitored_page_id TEXT NOT NULL,
    content_hash TEXT,
    text_object_key TEXT,
    html_object_key TEXT,
    screenshot_object_key TEXT,
    http_status INTEGER,
    captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (monitored_page_id)
        REFERENCES monitored_pages(id)
        ON DELETE CASCADE
);

CREATE TABLE changes (
    id TEXT PRIMARY KEY,
    monitored_page_id TEXT NOT NULL,
    previous_snapshot_id TEXT,
    current_snapshot_id TEXT NOT NULL,

    category TEXT NOT NULL DEFAULT 'other'
        CHECK (
            category IN (
                'pricing',
                'product',
                'features',
                'positioning',
                'landing_page',
                'promotion',
                'policy',
                'navigation',
                'content',
                'other'
            )
        ),

    significance TEXT NOT NULL DEFAULT 'minor'
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

    detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (monitored_page_id)
        REFERENCES monitored_pages(id)
        ON DELETE CASCADE,

    FOREIGN KEY (previous_snapshot_id)
        REFERENCES snapshots(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (current_snapshot_id)
        REFERENCES snapshots(id)
        ON DELETE RESTRICT
);

CREATE TABLE notification_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,

    email_enabled INTEGER NOT NULL DEFAULT 1
        CHECK (email_enabled IN (0, 1)),

    major_only INTEGER NOT NULL DEFAULT 0
        CHECK (major_only IN (0, 1)),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_competitors_workspace
ON competitors(workspace_id);

CREATE INDEX idx_monitored_pages_competitor
ON monitored_pages(competitor_id);

CREATE INDEX idx_monitored_pages_next_check
ON monitored_pages(next_check_at);

CREATE INDEX idx_snapshots_page
ON snapshots(monitored_page_id);

CREATE INDEX idx_snapshots_captured_at
ON snapshots(captured_at);

CREATE INDEX idx_changes_page
ON changes(monitored_page_id);

CREATE INDEX idx_changes_detected_at
ON changes(detected_at);

CREATE INDEX idx_changes_significance
ON changes(significance);

PRAGMA optimize;