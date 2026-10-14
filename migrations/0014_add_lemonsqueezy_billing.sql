/*
 * THE-28.5 — Add Free & Personal plans, Lemon Squeezy payment provider integration,
 * checkout sessions, webhook idempotency tracking, out-of-order event protection,
 * and concurrency locks
 */

CREATE TABLE workspace_subscriptions_new (
    workspace_id TEXT PRIMARY KEY,
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
    plan_id,
    status,
    billing_interval,
    cancel_at_period_end,
    current_period_start,
    current_period_end,
    provider_customer_id,
    provider_subscription_id,
    updated_by,
    created_at,
    updated_at
)
SELECT
    workspace_id,
    CASE
        WHEN provider_subscription_id IS NULL AND plan_id = 'starter' THEN 'free'
        ELSE plan_id
    END,
    status,
    billing_interval,
    cancel_at_period_end,
    current_period_start,
    current_period_end,
    provider_customer_id,
    provider_subscription_id,
    updated_by,
    created_at,
    updated_at
FROM workspace_subscriptions;

DROP TABLE workspace_subscriptions;

ALTER TABLE workspace_subscriptions_new
    RENAME TO workspace_subscriptions;

CREATE INDEX idx_workspace_subscriptions_plan_status
    ON workspace_subscriptions (plan_id, status);

CREATE UNIQUE INDEX idx_workspace_subscriptions_provider_sub_unique
    ON workspace_subscriptions (provider_subscription_id)
    WHERE provider_subscription_id IS NOT NULL;

CREATE TABLE workspace_checkout_sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    target_plan_id TEXT NOT NULL
        CHECK (target_plan_id IN ('personal', 'starter', 'growth', 'scale')),
    billing_interval TEXT NOT NULL
        CHECK (billing_interval IN ('monthly', 'annual')),
    provider_store_id TEXT NOT NULL,
    provider_variant_id TEXT NOT NULL,
    provider_checkout_id TEXT NOT NULL UNIQUE,
    checkout_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'expired')),
    completed_subscription_id TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE CASCADE,

    FOREIGN KEY (actor_user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_workspace_checkout_sessions_workspace_status
    ON workspace_checkout_sessions (workspace_id, status, created_at DESC);

CREATE TABLE billing_webhook_deliveries (
    delivery_key TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    provider_subscription_id TEXT,
    workspace_id TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('processing', 'processed', 'ignored_stale', 'failed')),
    payload_sha256 TEXT NOT NULL,
    error_message TEXT,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT
);

CREATE INDEX idx_billing_webhook_deliveries_subscription
    ON billing_webhook_deliveries (provider_subscription_id, received_at DESC);

CREATE TABLE workspace_billing_events_new (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    actor_user_id TEXT,
    event_type TEXT NOT NULL
        CHECK (
            event_type IN (
                'subscription_initialized',
                'checkout_initiated',
                'plan_upgraded',
                'plan_downgraded',
                'billing_interval_changed',
                'cancellation_scheduled',
                'subscription_reactivated',
                'subscription_canceled',
                'payment_succeeded',
                'payment_failed'
            )
        ),
    previous_plan_id TEXT,
    new_plan_id TEXT NOT NULL,
    billing_interval TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (workspace_id)
        REFERENCES workspaces(id)
        ON DELETE CASCADE,

    FOREIGN KEY (actor_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
);

INSERT INTO workspace_billing_events_new (
    id,
    workspace_id,
    actor_user_id,
    event_type,
    previous_plan_id,
    new_plan_id,
    billing_interval,
    details_json,
    created_at
)
SELECT
    id,
    workspace_id,
    actor_user_id,
    event_type,
    previous_plan_id,
    new_plan_id,
    billing_interval,
    details_json,
    created_at
FROM workspace_billing_events;

DROP TABLE workspace_billing_events;

ALTER TABLE workspace_billing_events_new
    RENAME TO workspace_billing_events;

CREATE INDEX idx_workspace_billing_events_workspace_created
    ON workspace_billing_events (workspace_id, created_at DESC);

PRAGMA optimize;
