-- Multi-tenant RLS policies for the Entity-based tenancy model.
-- These policies depend on the PostgreSQL session variable:
--   app.current_entity_id
--
-- NOTE:
-- 1) Table owners bypass RLS unless FORCE ROW LEVEL SECURITY is enabled.
-- 2) The application now sets app.current_entity_id for key write transactions.
-- 3) Keep application-level entity scoping enabled as a defense-in-depth layer.

CREATE OR REPLACE FUNCTION app_current_entity_id()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  value_text text;
BEGIN
  value_text := current_setting('app.current_entity_id', true);
  IF value_text IS NULL OR value_text = '' THEN
    RETURN NULL;
  END IF;

  RETURN value_text;
END;
$$;

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_scope_policy ON entities;
CREATE POLICY entity_scope_policy
ON entities
USING (
  app_current_entity_id() IS NOT NULL
  AND (
    id = app_current_entity_id()
    OR parent_id = app_current_entity_id()
  )
)
WITH CHECK (
  app_current_entity_id() IS NOT NULL
  AND (
    id = app_current_entity_id()
    OR parent_id = app_current_entity_id()
  )
);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'entity_users',
    'user_roles',
    'periods',
    'accounts',
    'journals',
    'account_period_balances',
    'approval_rules',
    'journal_approvals',
    'audit_events',
    'report_definitions',
    'suppliers',
    'ap_invoices',
    'ar_invoices',
    'ap_payments',
    'purchase_orders',
    'goods_received_notes',
    'payment_runs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS entity_scope_policy ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY entity_scope_policy ON %I
       USING (app_current_entity_id() IS NOT NULL AND entity_id = app_current_entity_id())
       WITH CHECK (app_current_entity_id() IS NOT NULL AND entity_id = app_current_entity_id())',
      table_name
    );
  END LOOP;
END $$;
