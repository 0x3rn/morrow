-- Email codes are mandatory for existing and newly created accounts.
ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (two_factor_enabled IN (0, 1));

CREATE TABLE two_factors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    secret TEXT NOT NULL,
    backup_codes TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 1 CHECK (verified IN (0, 1)),
    failed_verification_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_two_factors_secret ON two_factors(secret);

CREATE TABLE auth_rate_limits (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    count INTEGER NOT NULL,
    last_request INTEGER NOT NULL
);

-- Previously issued sessions did not require an email code. Users sign in again.
DELETE FROM sessions;
