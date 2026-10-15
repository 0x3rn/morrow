/*
 * THE-28.9 — Align annual subscription current_period_end to 1 year after current_period_start
 *
 * 1. Fixes existing workspace_subscriptions rows where billing_interval = 'annual'
 *    still had the 30-day default current_period_end.
 * 2. Adds triggers on workspace_subscriptions so creating or editing a row's
 *    billing_interval or current_period_start in the D1 table UI automatically
 *    sets current_period_end to +1 year for annual and +30 days for monthly.
 */

UPDATE workspace_subscriptions
SET
    current_period_end = datetime(current_period_start, '+1 year'),
    updated_at = CURRENT_TIMESTAMP
WHERE billing_interval = 'annual'
  AND provider_subscription_id IS NULL
  AND (
      julianday(current_period_end) - julianday(current_period_start)
  ) < 300;

CREATE TRIGGER trg_workspace_subscriptions_align_period_on_insert
AFTER INSERT ON workspace_subscriptions
FOR EACH ROW
WHEN NEW.provider_subscription_id IS NULL
  AND NEW.billing_interval = 'annual'
  AND (
      julianday(NEW.current_period_end) - julianday(NEW.current_period_start)
  ) < 300
BEGIN
    UPDATE workspace_subscriptions
    SET current_period_end = datetime(NEW.current_period_start, '+1 year')
    WHERE workspace_id = NEW.workspace_id;
END;

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
    WHERE workspace_id = NEW.workspace_id;
END;

PRAGMA optimize;
