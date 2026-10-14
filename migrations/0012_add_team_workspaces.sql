/*
 * THE-27.2 — Add team workspaces, active workspace selection, and member invitations
 *
 * 1. Extends users with active_workspace_id so multi-workspace users can switch
 *    between shared workspaces while single-workspace users fall back to their
 *    earliest joined workspace.
 * 2. Adds workspace_invitations to track pending, accepted, and revoked team
 *    invitations by email with role-based access control.
 */

ALTER TABLE users
    ADD COLUMN active_workspace_id TEXT;

CREATE INDEX idx_users_active_workspace
    ON users (active_workspace_id);

CREATE INDEX idx_workspace_members_user_joined
    ON workspace_members (user_id, joined_at);

CREATE TABLE workspace_invitations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('admin', 'member', 'viewer')),
    invited_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'revoked')),
    responded_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (workspace_id, email),

    FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE CASCADE,

    FOREIGN KEY (invited_by)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_workspace_invitations_workspace
    ON workspace_invitations (workspace_id, status);

CREATE INDEX idx_workspace_invitations_email
    ON workspace_invitations (email, status);

PRAGMA optimize;
