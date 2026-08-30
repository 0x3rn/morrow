ALTER TABLE users
ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0
CHECK (email_verified IN (0, 1));

ALTER TABLE users
ADD COLUMN image TEXT;


CREATE TABLE sessions (
    id TEXT PRIMARY KEY,

    user_id TEXT NOT NULL,

    token TEXT NOT NULL UNIQUE,

    expires_at INTEGER NOT NULL,

    ip_address TEXT,

    user_agent TEXT,

    created_at INTEGER NOT NULL,

    updated_at INTEGER NOT NULL,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


CREATE TABLE accounts (
    id TEXT PRIMARY KEY,

    user_id TEXT NOT NULL,

    issuer TEXT NOT NULL,

    account_id TEXT NOT NULL,

    provider_id TEXT NOT NULL,

    access_token TEXT,

    refresh_token TEXT,

    access_token_expires_at INTEGER,

    refresh_token_expires_at INTEGER,

    scope TEXT,

    id_token TEXT,

    password TEXT,

    created_at INTEGER NOT NULL,

    updated_at INTEGER NOT NULL,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    UNIQUE (issuer, account_id)
);


CREATE TABLE verifications (
    id TEXT PRIMARY KEY,

    identifier TEXT NOT NULL,

    value TEXT NOT NULL,

    expires_at INTEGER NOT NULL,

    created_at INTEGER NOT NULL,

    updated_at INTEGER NOT NULL
);


CREATE INDEX idx_sessions_user
ON sessions(user_id);

CREATE INDEX idx_accounts_user
ON accounts(user_id);

CREATE INDEX idx_verifications_identifier
ON verifications(identifier);