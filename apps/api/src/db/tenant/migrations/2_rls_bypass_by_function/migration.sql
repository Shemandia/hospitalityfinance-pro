-- SEC-11 (P0): the application role could turn row-level security off by
-- setting app.bypass_rls itself (with set_config, SET, or the connection's
-- options), because app_rls_bypassed() trusted that setting from anyone.
--
-- From here on the setting only counts for:
--   * the database owner (the owner role of a provisioned or adopted tenant;
--     the application role never is the owner), and
--   * a transaction granted the bypass by app_begin_rls_bypass(), a SECURITY
--     DEFINER function owned by the owner role. It records the transaction
--     in app_private.rls_bypass_grants, which only the owner can read or
--     write; the application role has no rights on schema app_private.
--
-- The policies keep calling app_rls_bypassed(); none of them changes.

CREATE SCHEMA app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

-- One row per transaction granted the bypass. A transaction id is never
-- reused, so a row left after its transaction ends grants nothing; old rows
-- are removed by the next grant.
CREATE TABLE app_private.rls_bypass_grants (
  xact       xid8        PRIMARY KEY,
  granted_to name        NOT NULL DEFAULT session_user,
  granted_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON app_private.rls_bypass_grants FROM PUBLIC;

-- Grants the bypass to the calling transaction, and to it alone. Call it
-- inside the transaction that needs it (withBypassRLS does).
CREATE FUNCTION app_begin_rls_bypass()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM app_private.rls_bypass_grants
   WHERE xact < pg_snapshot_xmin(pg_current_snapshot());
  INSERT INTO app_private.rls_bypass_grants (xact)
  VALUES (pg_current_xact_id())
  ON CONFLICT (xact) DO NOTHING;
  PERFORM set_config('app.bypass_rls', 'true', true);
END;
$$;

REVOKE ALL ON FUNCTION app_begin_rls_bypass() FROM PUBLIC;

-- Whether the current transaction was granted the bypass. SECURITY DEFINER
-- so that it can read the grants table; it reveals nothing else.
CREATE FUNCTION app_rls_bypass_granted()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_private.rls_bypass_grants
     WHERE xact = pg_current_xact_id_if_assigned()
  );
$$;

-- Called by every policy, as the role running the query (not SECURITY
-- DEFINER: current_user must be the caller). The setting is checked first,
-- so queries without it cost no more than before.
CREATE OR REPLACE FUNCTION app_rls_bypassed()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF coalesce(current_setting('app.bypass_rls', true), '') <> 'true' THEN
    RETURN false;
  END IF;
  IF current_user = (SELECT pg_get_userbyid(datdba) FROM pg_database
                      WHERE datname = current_database()) THEN
    RETURN true;
  END IF;
  RETURN app_rls_bypass_granted();
END;
$$;

-- Any role that may run a policy check must be able to call the helper; it
-- only answers for the caller's own transaction.
GRANT EXECUTE ON FUNCTION app_rls_bypass_granted() TO PUBLIC;
