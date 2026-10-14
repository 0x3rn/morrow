/*
 * THE-28.8 — Add owner_email column to workspace_subscriptions and backfill missing workspaces
 *
 * 1. Rebuilds workspace_subscriptions with owner_email placed right next to
 *    workspace_id and plan_id for easy lookup in the Cloudflare D1 table UI.
 * 2. Preserves all existing subscription rows while populating owner_email from
 *    the workspace creator's users.email.
 * 3. Backfills any workspaces that do not yet have a row in workspace_subscriptions
 *    onto the Free plan with their owner_email populated.
 * 4. Adds triggers so new workspace_subscriptions rows automatically populate
 *    owner_email and user email changes stay in sync.
 */

CREATE TABLE workspace_subscriptions_new (
    workspace_id TEXT PRIMARY KEY,
    owner_email TEXT,
    plan_id TEXT NOT NULL DEFAULT 'free'
        CHECK (plan_id IN ('free', 'personal', 'starter', 'growth', 'scale')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
    billing_interval TEXT NOT NULL DEFAULT 'monthly'
        CHECK (billing_interval IN ('monthly', 'annual')),
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0
        CHECK (cancel_at_period_end IN (0, 1)),
    current_period_start TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    current_period_end TEXT NOT NULL DEFAULT (datetime('now', '+30 days')),
    provider_customer_id TEXT,
    provider_subscription_id TEXT,
    provider_variant_id TEXT,
    provider_order_id TEXT,
    provider_status TEXT,
    provider_customer_portal_url TEXT,
    provider_update_payment_url TEXT,
    provider_updated_at TEXT,
    mutation_lock_id TEXT,
    mutation_locked_until TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE CASCADE,

    FOREIGN KEY (updated_by)
        REFERENCES users(id)
        ON DELETE SET NULL
);

INSERT INTO workspace_subscriptions_new (
    workspace_id,
    owner_email,
    plan_id,
    status,
    billing_interval,
    cancel_at_period_end,
    current_period_start,
    current_period_end,
    provider_customer_id,
    provider_subscription_id,
    provider_variant_id,
    provider_order_id,
    provider_status,
    provider_customer_portal_url,
    provider_update_payment_url,
    provider_updated_at,
    mutation_lock_id,
    mutation_locked_until,
    updated_by,
    created_at,
    updated_at
)
SELECT
    ws.workspace_id,
    (
        SELECT u.email
        FROM workspaces w
        INNER JOIN users u ON u.id = w.created_by
        WHERE w.id = ws.workspace_id
        LIMIT 1
    ),
    ws.plan_id,
    ws.status,
    ws.billing_interval,
    ws.cancel_at_period_end,
    ws.current_period_start,
    ws.current_period_end,
    ws.provider_customer_id,
    ws.provider_subscription_id,
    ws.provider_variant_id,
    ws.provider_order_id,
    ws.provider_status,
    ws.provider_customer_portal_url,
    ws.provider_update_payment_url,
    ws.provider_updated_at,
    ws.mutation_lock_id,
    ws.mutation_locked_until,
    ws.updated_by,
    ws.created_at,
    ws.updated_at
FROM workspace_subscriptions ws;

DROP TABLE workspace_subscriptions;

ALTER TABLE workspace_subscriptions_new
    RENAME TO workspace_subscriptions;

INSERT OR IGNORE INTO workspace_subscriptions (
    workspace_id,
    owner_email,
    plan_id,
    status,
    billing_interval,
    cancel_at_period_end,
    current_period_start,
    current_period_end,
    updated_by,
    created_at,
    updated_at
)
SELECT
    w.id,
    u.email,
    'free',
    'active',
    'monthly',
    0,
    w.created_at,
    datetime(w.created_at, '+30 days'),
    w.created_by,
    w.created_at,
    w.updated_at
FROM workspaces w
LEFT JOIN users u ON u.id = w.created_by;

CREATE INDEX idx_workspace_subscriptions_plan_status
    ON workspace_subscriptions (plan_id, status);

CREATE INDEX idx_workspace_subscriptions_owner_email
    ON workspace_subscriptions (owner_email);

CREATE UNIQUE INDEX idx_workspace_subscriptions_provider_sub_unique
    ON workspace_subscriptions (provider_subscription_id)
    WHERE provider_subscription_id IS NOT NULL;

CREATE TRIGGER trg_workspace_subscriptions_set_owner_email
AFTER INSERT ON workspace_subscriptions
FOR EACH ROW
WHEN NEW.owner_email IS NULL
BEGIN
    UPDATE workspace_subscriptions
    SET owner_email = (
        SELECT u.email
        FROM workspaces w
        INNER JOIN users u ON u.id = w.created_by
        WHERE w.id = NEW.workspace_id
        LIMIT 1
    )
    WHERE workspace_id = NEW.workspace_id;
END;

CREATE TRIGGER trg_users_sync_workspace_subscription_owner_email
AFTER UPDATE OF email ON users
FOR EACH ROW
WHEN NEW.email IS NOT OLD.email
BEGIN
    UPDATE workspace_subscriptions
    SET owner_email = NEW.email
    WHERE workspace_id IN (
        SELECT id FROM workspaces WHERE created_by = NEW.id
    );
END;

PRAGMA optimize;
