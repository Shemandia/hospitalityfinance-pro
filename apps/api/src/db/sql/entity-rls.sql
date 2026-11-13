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

-- Returns TRUE when the current transaction has set app.bypass_rls = 'true'.
-- Used by RLS policies to allow admin/auth operations that need cross-entity reads
-- without toggling RLS on/off at the table level (which is global and race-prone).
CREATE OR REPLACE FUNCTION app_rls_bypassed()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN coalesce(current_setting('app.bypass_rls', true), '') = 'true';
END;
$$;

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_scope_policy ON entities;
CREATE POLICY entity_scope_policy
ON entities
USING (
  app_rls_bypassed()
  OR (
    app_current_entity_id() IS NOT NULL
    AND (
      id = app_current_entity_id()
      OR parent_id = app_current_entity_id()
    )
  )
)
WITH CHECK (
  app_rls_bypassed()
  OR (
    app_current_entity_id() IS NOT NULL
    AND (
      id = app_current_entity_id()
      OR parent_id = app_current_entity_id()
    )
  )
);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    -- Core tenanted tables (original 17)
    -- Role assignments are not in this loop: role_assignments has its own
    -- bypass-only policy (migration 20261111000000_role_assignments).
    'periods',
    'accounts',
    'journals',
    'journal_types',
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
    'payment_runs',
    -- Previously missing — added for full tenant isolation
    'customers',
    'ar_receipts',
    'bank_statements',
    'interface_definitions',
    'connector_mappings',
    'import_logs',
    'pms_statistics',
    'budget_definitions',
    'consolidation_run_entities',
    -- Entity-scoped tables added for complete RLS coverage
    'recurring_journals',
    'transfer_journal_ranges',
    'ledger_setups',
    'process_locks',
    'period_close_statuses',
    'analysis_dimensions',
    'allocation_definitions',
    'asset_categories',
    'fixed_assets',
    'depreciation_tables',
    'authorization_stages',
    'authorization_teams',
    'authorization_delegations',
    'rejection_codes',
    'authorization_sets',
    'journal_authorizations',
    'payment_profiles',
    'revaluation_profiles',
    'year_end_configs',
    'intercompany_account_pairs',
    -- Bank accounts and tax compliance
    'bank_accounts',
    'tax_codes'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS entity_scope_policy ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY entity_scope_policy ON %I
       USING (app_rls_bypassed() OR (app_current_entity_id() IS NOT NULL AND entity_id = app_current_entity_id()))
       WITH CHECK (app_rls_bypassed() OR (app_current_entity_id() IS NOT NULL AND entity_id = app_current_entity_id()))',
      table_name
    );
  END LOOP;
END $$;

-- Account type definitions may be system/global within the tenant
-- (entity_id IS NULL) or entity-specific. Reads can see both global
-- and current-entity rows; writes still require an active entity context.
ALTER TABLE account_type_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_type_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_type_definition_scope_policy ON account_type_definitions;
CREATE POLICY account_type_definition_scope_policy ON account_type_definitions
  USING (
    app_rls_bypassed()
    OR entity_id IS NULL
    OR (app_current_entity_id() IS NOT NULL AND entity_id = app_current_entity_id())
  )
  WITH CHECK (
    app_rls_bypassed()
    OR (
      app_current_entity_id() IS NOT NULL
      AND (entity_id IS NULL OR entity_id = app_current_entity_id())
    )
  );

-- The entity tree is read before any entity context is set (access
-- resolution, sign-in). Keep RLS enabled as defense-in-depth against any
-- non-owner DB connection, but do NOT force it on entities. The entity-scoped
-- business tables above remain FORCEd.
ALTER TABLE entities NO FORCE ROW LEVEL SECURITY;

-- ── Intercompany v2 RLS ──────────────────────────────────────────────────────
-- IC tables allow access when the current entity is EITHER side of the pair.

-- ic_entity_pairs: visible if current entity is entity_a or entity_b
ALTER TABLE ic_entity_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ic_entity_pairs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ic_pair_scope_policy ON ic_entity_pairs;
CREATE POLICY ic_pair_scope_policy ON ic_entity_pairs
  USING (
    app_rls_bypassed()
    OR (app_current_entity_id() IS NOT NULL
        AND (entity_a_id = app_current_entity_id() OR entity_b_id = app_current_entity_id()))
  )
  WITH CHECK (
    app_rls_bypassed()
    OR (app_current_entity_id() IS NOT NULL
        AND (entity_a_id = app_current_entity_id() OR entity_b_id = app_current_entity_id()))
  );

-- ic_account_mappings: visible via pair relationship (join to ic_entity_pairs)
ALTER TABLE ic_account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ic_account_mappings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ic_mapping_scope_policy ON ic_account_mappings;
CREATE POLICY ic_mapping_scope_policy ON ic_account_mappings
  USING (
    app_rls_bypassed()
    OR (app_current_entity_id() IS NOT NULL
        AND pair_id IN (
          SELECT id FROM ic_entity_pairs
          WHERE entity_a_id = app_current_entity_id() OR entity_b_id = app_current_entity_id()
        ))
  )
  WITH CHECK (
    app_rls_bypassed()
    OR (app_current_entity_id() IS NOT NULL
        AND pair_id IN (
          SELECT id FROM ic_entity_pairs
          WHERE entity_a_id = app_current_entity_id() OR entity_b_id = app_current_entity_id()
        ))
  );

-- ic_transactions: visible if current entity is initiator or counterparty
ALTER TABLE ic_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ic_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ic_txn_scope_policy ON ic_transactions;
CREATE POLICY ic_txn_scope_policy ON ic_transactions
  USING (
    app_rls_bypassed()
    OR (app_current_entity_id() IS NOT NULL
        AND (initiating_entity_id = app_current_entity_id() OR counterparty_entity_id = app_current_entity_id()))
  )
  WITH CHECK (
    app_rls_bypassed()
    OR (app_current_entity_id() IS NOT NULL
        AND (initiating_entity_id = app_current_entity_id() OR counterparty_entity_id = app_current_entity_id()))
  );

-- ic_reconciliation_snapshots: visible via pair relationship
ALTER TABLE ic_reconciliation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ic_reconciliation_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ic_recon_scope_policy ON ic_reconciliation_snapshots;
CREATE POLICY ic_recon_scope_policy ON ic_reconciliation_snapshots
  USING (
    app_rls_bypassed()
    OR (app_current_entity_id() IS NOT NULL
        AND pair_id IN (
          SELECT id FROM ic_entity_pairs
          WHERE entity_a_id = app_current_entity_id() OR entity_b_id = app_current_entity_id()
        ))
  )
  WITH CHECK (
    app_rls_bypassed()
    OR (app_current_entity_id() IS NOT NULL
        AND pair_id IN (
          SELECT id FROM ic_entity_pairs
          WHERE entity_a_id = app_current_entity_id() OR entity_b_id = app_current_entity_id()
        ))
  );
