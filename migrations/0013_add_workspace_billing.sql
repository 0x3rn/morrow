/*
 * THE-28.2 — Add workspace billing subscriptions and billing audit events
 *
 * 1. Adds workspace_subscriptions to store each workspace's subscription plan
 *    ('starter', 'growth', 'scale'), status ('trialing', 'active', 'past_due',
 *    'canceled'), billing interval ('monthly', 'annual'), renewal period window,
 *    and external payment provider references.
 * 2. Backfills workspace_subscriptions for existing workspaces on the Starter plan.
 * 3. Adds workspace_billing_events to record an immutable audit trail of plan
 *    upgrades, downgrades, interval changes, and cancellation/reactivation actions.
 */

CREATE TABLE workspace_subscriptions (
    workspace_id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL DEFAULT 'starter'
        CHECK (plan_id IN ('starter', 'growth', 'scale')),
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

CREATE INDEX idx_workspace_subscriptions_plan_status
    ON workspace_subscriptions (plan_id, status);

INSERT OR IGNORE INTO workspace_subscriptions (
    workspace_id,
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
    workspaces.id,
    'starter',
    'active',
    'monthly',
    0,
    workspaces.created_at,
    datetime(workspaces.created_at, '+30 days'),
    workspaces.created_by,
    workspaces.created_at,
    workspaces.updated_at
FROM workspaces;

CREATE TABLE workspace_billing_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    actor_user_id TEXT,
    event_type TEXT NOT NULL
        CHECK (
            event_type IN (
                'subscription_initialized',
                'plan_upgraded',
                'plan_downgraded',
                'billing_interval_changed',
                'cancellation_scheduled',
                'subscription_reactivated',
                'subscription_canceled'
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

CREATE INDEX idx_workspace_billing_events_workspace_created
    ON workspace_billing_events (workspace_id, created_at DESC);

PRAGMA optimize;
