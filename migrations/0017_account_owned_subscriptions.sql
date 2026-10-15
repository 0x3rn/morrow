/*
 * THE-28.10 — Tie subscriptions to the Owner account across all owned workspaces
 *
 * 1. Replaces the unique index on provider_subscription_id with a non-unique index
 *    so all workspaces owned by the same account can share the same Lemon Squeezy
 *    subscription record.
 * 2. Syncs any existing multi-workspace owner's workspaces to their highest active
 *    subscription plan and billing cycle.
 * 3. Adds SQLite triggers so:
 *    - Any newly created workspace automatically inherits its Owner's active
 *      subscription plan, billing interval, period dates, and provider metadata.
 *    - Updating a subscription on any workspace (via the Billing page, webhooks, or
 *      the Cloudflare D1 table UI) automatically syncs across all workspaces owned
 *      by that same Owner account.
 */

DROP INDEX IF EXISTS idx_workspace_subscriptions_provider_sub_unique;

CREATE INDEX IF NOT EXISTS idx_workspace_subscriptions_provider_sub
    ON workspace_subscriptions (provider_subscription_id)
    WHERE provider_subscription_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_workspace_subscriptions_align_period_on_update;

CREATE TRIGGER trg_workspace_subscriptions_align_period_on_update
AFTER UPDATE OF billing_interval, current_period_start ON workspace_subscriptions
FOR EACH ROW
WHEN NEW.provider_subscription_id IS NULL
  AND (
      (
          NEW.billing_interval = 'annual'
          AND (
              julianday(NEW.current_period_end) - julianday(NEW.current_period_start)
          ) < 300
      )
      OR (
          NEW.billing_interval = 'monthly'
          AND (
              julianday(NEW.current_period_end) - julianday(NEW.current_period_start)
          ) > 60
      )
  )
BEGIN
    UPDATE workspace_subscriptions
    SET current_period_end = CASE
        WHEN NEW.billing_interval = 'annual'
            THEN datetime(NEW.current_period_start, '+1 year')
        ELSE datetime(NEW.current_period_start, '+30 days')
    END
    WHERE workspace_id = NEW.workspace_id
       OR workspace_id IN (
           SELECT w_peer.id
           FROM workspaces w_self
           INNER JOIN workspaces w_peer
               ON w_peer.created_by = w_self.created_by
           WHERE w_self.id = NEW.workspace_id
             AND w_self.created_by IS NOT NULL
       );
END;

CREATE TRIGGER trg_workspace_subscriptions_inherit_owner_plan_on_insert
AFTER INSERT ON workspace_subscriptions
FOR EACH ROW
WHEN NEW.plan_id = 'free'
  AND NEW.provider_subscription_id IS NULL
  AND EXISTS (
      SELECT 1
      FROM workspaces w_self
      INNER JOIN workspaces w_peer
          ON w_peer.created_by = w_self.created_by
         AND w_peer.id != w_self.id
      INNER JOIN workspace_subscriptions ws_peer
          ON ws_peer.workspace_id = w_peer.id
      WHERE w_self.id = NEW.workspace_id
        AND w_self.created_by IS NOT NULL
        AND (
            ws_peer.plan_id != 'free'
            OR ws_peer.billing_interval != 'monthly'
            OR ws_peer.provider_subscription_id IS NOT NULL
        )
  )
BEGIN
    UPDATE workspace_subscriptions
    SET
        plan_id = COALESCE(
            (
                SELECT ws_peer.plan_id
                FROM workspaces w_self
                INNER JOIN workspaces w_peer
                    ON w_peer.created_by = w_self.created_by
                   AND w_peer.id != w_self.id
                INNER JOIN workspace_subscriptions ws_peer
                    ON ws_peer.workspace_id = w_peer.id
                WHERE w_self.id = NEW.workspace_id
                ORDER BY
                    CASE ws_peer.plan_id
                        WHEN 'scale' THEN 5
                        WHEN 'growth' THEN 4
                        WHEN 'starter' THEN 3
                        WHEN 'personal' THEN 2
                        ELSE 1
                    END DESC,
                    datetime(ws_peer.updated_at) DESC
                LIMIT 1
            ),
            NEW.plan_id
        ),
        status = COALESCE(
            (
                SELECT ws_peer.status
                FROM workspaces w_self
                INNER JOIN workspaces w_peer
                    ON w_peer.created_by = w_self.created_by
                   AND w_peer.id != w_self.id
                INNER JOIN workspace_subscriptions ws_peer
                    ON ws_peer.workspace_id = w_peer.id
                WHERE w_self.id = NEW.workspace_id
                ORDER BY
                    CASE ws_peer.plan_id
                        WHEN 'scale' THEN 5
                        WHEN 'growth' THEN 4
                        WHEN 'starter' THEN 3
                        WHEN 'personal' THEN 2
                        ELSE 1
                    END DESC,
                    datetime(ws_peer.updated_at) DESC
                LIMIT 1
            ),
            NEW.status
        ),
        billing_interval = COALESCE(
            (
                SELECT ws_peer.billing_interval
                FROM workspaces w_self
                INNER JOIN workspaces w_peer
                    ON w_peer.created_by = w_self.created_by
                   AND w_peer.id != w_self.id
                INNER JOIN workspace_subscriptions ws_peer
                    ON ws_peer.workspace_id = w_peer.id
                WHERE w_self.id = NEW.workspace_id
                ORDER BY
                    CASE ws_peer.plan_id
                        WHEN 'scale' THEN 5
                        WHEN 'growth' THEN 4
                        WHEN 'starter' THEN 3
                        WHEN 'personal' THEN 2
                        ELSE 1
                    END DESC,
                    datetime(ws_peer.updated_at) DESC
                LIMIT 1
            ),
            NEW.billing_interval
        ),
        cancel_at_period_end = COALESCE(
            (
                SELECT ws_peer.cancel_at_period_end
                FROM workspaces w_self
                INNER JOIN workspaces w_peer
                    ON w_peer.created_by = w_self.created_by
                   AND w_peer.id != w_self.id
                INNER JOIN workspace_subscriptions ws_peer
                    ON ws_peer.workspace_id = w_peer.id
                WHERE w_self.id = NEW.workspace_id
                ORDER BY
                    CASE ws_peer.plan_id
                        WHEN 'scale' THEN 5
                        WHEN 'growth' THEN 4
                        WHEN 'starter' THEN 3
                        WHEN 'personal' THEN 2
                        ELSE 1
                    END DESC,
                    datetime(ws_peer.updated_at) DESC
                LIMIT 1
            ),
            NEW.cancel_at_period_end
        ),
        current_period_start = COALESCE(
            (
                SELECT ws_peer.current_period_start
                FROM workspaces w_self
                INNER JOIN workspaces w_peer
                    ON w_peer.created_by = w_self.created_by
                   AND w_peer.id != w_self.id
                INNER JOIN workspace_subscriptions ws_peer
                    ON ws_peer.workspace_id = w_peer.id
                WHERE w_self.id = NEW.workspace_id
                ORDER BY
                    CASE ws_peer.plan_id
                        WHEN 'scale' THEN 5
                        WHEN 'growth' THEN 4
                        WHEN 'starter' THEN 3
                        WHEN 'personal' THEN 2
                        ELSE 1
                    END DESC,
                    datetime(ws_peer.updated_at) DESC
                LIMIT 1
            ),
            NEW.current_period_start
        ),
        current_period_end = COALESCE(
            (
                SELECT ws_peer.current_period_end
                FROM workspaces w_self
                INNER JOIN workspaces w_peer
                    ON w_peer.created_by = w_self.created_by
                   AND w_peer.id != w_self.id
                INNER JOIN workspace_subscriptions ws_peer
                    ON ws_peer.workspace_id = w_peer.id
                WHERE w_self.id = NEW.workspace_id
                ORDER BY
                    CASE ws_peer.plan_id
                        WHEN 'scale' THEN 5
                        WHEN 'growth' THEN 4
                        WHEN 'starter' THEN 3
                        WHEN 'personal' THEN 2
                        ELSE 1
                    END DESC,
                    datetime(ws_peer.updated_at) DESC
                LIMIT 1
            ),
            NEW.current_period_end
        ),
        provider_customer_id = (
            SELECT ws_peer.provider_customer_id
            FROM workspaces w_self
            INNER JOIN workspaces w_peer
                ON w_peer.created_by = w_self.created_by
               AND w_peer.id != w_self.id
            INNER JOIN workspace_subscriptions ws_peer
                ON ws_peer.workspace_id = w_peer.id
            WHERE w_self.id = NEW.workspace_id
            ORDER BY
                CASE ws_peer.plan_id
                    WHEN 'scale' THEN 5
                    WHEN 'growth' THEN 4
                    WHEN 'starter' THEN 3
                    WHEN 'personal' THEN 2
                    ELSE 1
                END DESC,
                datetime(ws_peer.updated_at) DESC
            LIMIT 1
        ),
        provider_subscription_id = (
            SELECT ws_peer.provider_subscription_id
            FROM workspaces w_self
            INNER JOIN workspaces w_peer
                ON w_peer.created_by = w_self.created_by
               AND w_peer.id != w_self.id
            INNER JOIN workspace_subscriptions ws_peer
                ON ws_peer.workspace_id = w_peer.id
            WHERE w_self.id = NEW.workspace_id
            ORDER BY
                CASE ws_peer.plan_id
                    WHEN 'scale' THEN 5
                    WHEN 'growth' THEN 4
                    WHEN 'starter' THEN 3
                    WHEN 'personal' THEN 2
                    ELSE 1
                END DESC,
                datetime(ws_peer.updated_at) DESC
            LIMIT 1
        ),
        provider_variant_id = (
            SELECT ws_peer.provider_variant_id
            FROM workspaces w_self
            INNER JOIN workspaces w_peer
                ON w_peer.created_by = w_self.created_by
               AND w_peer.id != w_self.id
            INNER JOIN workspace_subscriptions ws_peer
                ON ws_peer.workspace_id = w_peer.id
            WHERE w_self.id = NEW.workspace_id
            ORDER BY
                CASE ws_peer.plan_id
                    WHEN 'scale' THEN 5
                    WHEN 'growth' THEN 4
                    WHEN 'starter' THEN 3
                    WHEN 'personal' THEN 2
                    ELSE 1
                END DESC,
                datetime(ws_peer.updated_at) DESC
            LIMIT 1
        ),
        provider_order_id = (
            SELECT ws_peer.provider_order_id
            FROM workspaces w_self
            INNER JOIN workspaces w_peer
                ON w_peer.created_by = w_self.created_by
               AND w_peer.id != w_self.id
            INNER JOIN workspace_subscriptions ws_peer
                ON ws_peer.workspace_id = w_peer.id
            WHERE w_self.id = NEW.workspace_id
            ORDER BY
                CASE ws_peer.plan_id
                    WHEN 'scale' THEN 5
                    WHEN 'growth' THEN 4
                    WHEN 'starter' THEN 3
                    WHEN 'personal' THEN 2
                    ELSE 1
                END DESC,
                datetime(ws_peer.updated_at) DESC
            LIMIT 1
        ),
        provider_status = (
            SELECT ws_peer.provider_status
            FROM workspaces w_self
            INNER JOIN workspaces w_peer
                ON w_peer.created_by = w_self.created_by
               AND w_peer.id != w_self.id
            INNER JOIN workspace_subscriptions ws_peer
                ON ws_peer.workspace_id = w_peer.id
            WHERE w_self.id = NEW.workspace_id
            ORDER BY
                CASE ws_peer.plan_id
                    WHEN 'scale' THEN 5
                    WHEN 'growth' THEN 4
                    WHEN 'starter' THEN 3
                    WHEN 'personal' THEN 2
                    ELSE 1
                END DESC,
                datetime(ws_peer.updated_at) DESC
            LIMIT 1
        ),
        provider_customer_portal_url = (
            SELECT ws_peer.provider_customer_portal_url
            FROM workspaces w_self
            INNER JOIN workspaces w_peer
                ON w_peer.created_by = w_self.created_by
               AND w_peer.id != w_self.id
            INNER JOIN workspace_subscriptions ws_peer
                ON ws_peer.workspace_id = w_peer.id
            WHERE w_self.id = NEW.workspace_id
            ORDER BY
                CASE ws_peer.plan_id
                    WHEN 'scale' THEN 5
                    WHEN 'growth' THEN 4
                    WHEN 'starter' THEN 3
                    WHEN 'personal' THEN 2
                    ELSE 1
                END DESC,
                datetime(ws_peer.updated_at) DESC
            LIMIT 1
        ),
        provider_update_payment_url = (
            SELECT ws_peer.provider_update_payment_url
            FROM workspaces w_self
            INNER JOIN workspaces w_peer
                ON w_peer.created_by = w_self.created_by
               AND w_peer.id != w_self.id
            INNER JOIN workspace_subscriptions ws_peer
                ON ws_peer.workspace_id = w_peer.id
            WHERE w_self.id = NEW.workspace_id
            ORDER BY
                CASE ws_peer.plan_id
                    WHEN 'scale' THEN 5
                    WHEN 'growth' THEN 4
                    WHEN 'starter' THEN 3
                    WHEN 'personal' THEN 2
                    ELSE 1
                END DESC,
                datetime(ws_peer.updated_at) DESC
            LIMIT 1
        ),
        provider_updated_at = (
            SELECT ws_peer.provider_updated_at
            FROM workspaces w_self
            INNER JOIN workspaces w_peer
                ON w_peer.created_by = w_self.created_by
               AND w_peer.id != w_self.id
            INNER JOIN workspace_subscriptions ws_peer
                ON ws_peer.workspace_id = w_peer.id
            WHERE w_self.id = NEW.workspace_id
            ORDER BY
                CASE ws_peer.plan_id
                    WHEN 'scale' THEN 5
                    WHEN 'growth' THEN 4
                    WHEN 'starter' THEN 3
                    WHEN 'personal' THEN 2
                    ELSE 1
                END DESC,
                datetime(ws_peer.updated_at) DESC
            LIMIT 1
        )
    WHERE workspace_id = NEW.workspace_id;
END;

CREATE TRIGGER trg_workspace_subscriptions_sync_owner_workspaces_on_update
AFTER UPDATE OF
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
    provider_updated_at
ON workspace_subscriptions
FOR EACH ROW
WHEN OLD.plan_id IS NOT NEW.plan_id
  OR OLD.status IS NOT NEW.status
  OR OLD.billing_interval IS NOT NEW.billing_interval
  OR OLD.cancel_at_period_end IS NOT NEW.cancel_at_period_end
  OR OLD.current_period_start IS NOT NEW.current_period_start
  OR OLD.current_period_end IS NOT NEW.current_period_end
  OR OLD.provider_customer_id IS NOT NEW.provider_customer_id
  OR OLD.provider_subscription_id IS NOT NEW.provider_subscription_id
  OR OLD.provider_variant_id IS NOT NEW.provider_variant_id
  OR OLD.provider_order_id IS NOT NEW.provider_order_id
  OR OLD.provider_status IS NOT NEW.provider_status
  OR OLD.provider_customer_portal_url IS NOT NEW.provider_customer_portal_url
  OR OLD.provider_update_payment_url IS NOT NEW.provider_update_payment_url
  OR OLD.provider_updated_at IS NOT NEW.provider_updated_at
BEGIN
    UPDATE workspace_subscriptions
    SET
        plan_id = NEW.plan_id,
        status = NEW.status,
        billing_interval = NEW.billing_interval,
        cancel_at_period_end = NEW.cancel_at_period_end,
        current_period_start = NEW.current_period_start,
        current_period_end = NEW.current_period_end,
        provider_customer_id = NEW.provider_customer_id,
        provider_subscription_id = NEW.provider_subscription_id,
        provider_variant_id = NEW.provider_variant_id,
        provider_order_id = NEW.provider_order_id,
        provider_status = NEW.provider_status,
        provider_customer_portal_url = NEW.provider_customer_portal_url,
        provider_update_payment_url = NEW.provider_update_payment_url,
        provider_updated_at = NEW.provider_updated_at,
        updated_by = NEW.updated_by,
        updated_at = NEW.updated_at
    WHERE workspace_id != NEW.workspace_id
      AND workspace_id IN (
          SELECT w_peer.id
          FROM workspaces w_self
          INNER JOIN workspaces w_peer
              ON w_peer.created_by = w_self.created_by
          WHERE w_self.id = NEW.workspace_id
            AND w_self.created_by IS NOT NULL
      )
      AND (
          plan_id IS NOT NEW.plan_id
          OR status IS NOT NEW.status
          OR billing_interval IS NOT NEW.billing_interval
          OR cancel_at_period_end IS NOT NEW.cancel_at_period_end
          OR current_period_start IS NOT NEW.current_period_start
          OR current_period_end IS NOT NEW.current_period_end
          OR provider_customer_id IS NOT NEW.provider_customer_id
          OR provider_subscription_id IS NOT NEW.provider_subscription_id
          OR provider_variant_id IS NOT NEW.provider_variant_id
          OR provider_order_id IS NOT NEW.provider_order_id
          OR provider_status IS NOT NEW.provider_status
          OR provider_customer_portal_url IS NOT NEW.provider_customer_portal_url
          OR provider_update_payment_url IS NOT NEW.provider_update_payment_url
          OR provider_updated_at IS NOT NEW.provider_updated_at
      );
END;

PRAGMA optimize;
