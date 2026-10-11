-- Short-lived, session-bound approvals for account security changes.
CREATE TABLE account_change_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('email', 'password')),
    stage TEXT NOT NULL CHECK (stage IN ('current-email', 'new-email')),
    original_email TEXT NOT NULL,
    new_email TEXT,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1)),
    expires_at INTEGER NOT NULL,
    last_sent_at INTEGER NOT NULL,
    claim_token TEXT,
    UNIQUE (user_id, purpose),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
