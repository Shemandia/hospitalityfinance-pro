-- WP-2 item 2: the tenant's system user (HC-38) and a refresh of the
-- reporting view that the application role may call.

-- ── The system user ──────────────────────────────────────────────────────────
-- Records work no person did (scheduled imports, automations) instead of a
-- "system" string or an entity id in a user column (IMP-01). Inactive and
-- without a password, so it can never sign in; at most one per tenant.

ALTER TABLE "users" ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "users_one_system_user" ON "users" ("is_system") WHERE "is_system";

INSERT INTO "users" ("id", "email", "name", "is_active", "is_system", "updated_at")
VALUES (gen_random_uuid()::text, 'system@hfp.invalid', 'System', false, true, CURRENT_TIMESTAMP);

-- ── Refreshing the period-balance view ───────────────────────────────────────
-- Only a view's owner may refresh it, and the application role owns nothing.
-- This function runs with its owner's rights (SECURITY DEFINER) and does only
-- that. The view aggregates entity-scoped tables whose policies apply to the
-- owner too (FORCE), so it lifts them for the refresh alone and restores the
-- caller's setting afterwards. EXECUTE is granted to the application role at
-- provisioning, not to PUBLIC.

CREATE FUNCTION refresh_period_balances()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  previous text := coalesce(current_setting('app.bypass_rls', true), '');
BEGIN
  PERFORM set_config('app.bypass_rls', 'true', true);
  REFRESH MATERIALIZED VIEW mv_period_account_balances;
  PERFORM set_config('app.bypass_rls', previous, true);
END;
$$;

REVOKE ALL ON FUNCTION refresh_period_balances() FROM PUBLIC;
