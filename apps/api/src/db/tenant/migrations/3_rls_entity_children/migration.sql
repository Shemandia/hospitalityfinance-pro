-- Roadmap Stage 1 item 7 (WP-2, SEC-04): row-level security, forced, on
-- every entity-scoped table and its child tables.
--
-- Before this migration 23 tables linked to an entity had no policy, or (the
-- entities table) a policy the owner role was exempt from. The application
-- role could read and change another entity's journal lines, invoice lines,
-- allocations and so on whenever it could name their ids.
--
-- * Child tables (no entity column of their own) are visible exactly when
--   their owning parent row is: the EXISTS below runs under the parent's own
--   policy, so the child inherits the parent's entity rule, the bypass
--   included.
-- * transfer_batches has its own entity column: the standard policy.
-- * consolidation_runs belongs to its parent (group) entity, and
--   intercompany_journals to both of its entities.
-- * entities is forced, so the owner role is filtered like every other
--   table (it already had a policy).
--
-- login_audits is left out on purpose: it is the users' sign-in log, written
-- before any entity is chosen, and its entity column is optional
-- attribution. tests/integration/rls-coverage.test.ts lists it, with that
-- reason, as the one exemption.

ALTER TABLE "entities" FORCE ROW LEVEL SECURITY;

ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "journal_lines"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "journals" p WHERE p.id = "journal_lines".journal_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "journals" p WHERE p.id = "journal_lines".journal_id));

ALTER TABLE "recurring_journal_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurring_journal_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "recurring_journal_lines"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "recurring_journals" p WHERE p.id = "recurring_journal_lines".recurring_journal_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "recurring_journals" p WHERE p.id = "recurring_journal_lines".recurring_journal_id));

ALTER TABLE "ap_invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ap_invoice_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "ap_invoice_lines"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "ap_invoices" p WHERE p.id = "ap_invoice_lines".invoice_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "ap_invoices" p WHERE p.id = "ap_invoice_lines".invoice_id));

ALTER TABLE "ap_payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ap_payment_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "ap_payment_allocations"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "ap_payments" p WHERE p.id = "ap_payment_allocations".payment_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "ap_payments" p WHERE p.id = "ap_payment_allocations".payment_id));

ALTER TABLE "ar_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ar_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "ar_allocations"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "ar_receipts" p WHERE p.id = "ar_allocations".receipt_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "ar_receipts" p WHERE p.id = "ar_allocations".receipt_id));

ALTER TABLE "payment_run_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_run_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "payment_run_items"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "payment_runs" p WHERE p.id = "payment_run_items".payment_run_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "payment_runs" p WHERE p.id = "payment_run_items".payment_run_id));

ALTER TABLE "payment_run_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_run_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "payment_run_invoices"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "payment_runs" p WHERE p.id = "payment_run_invoices".payment_run_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "payment_runs" p WHERE p.id = "payment_run_invoices".payment_run_id));

ALTER TABLE "purchase_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "purchase_order_lines"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "purchase_orders" p WHERE p.id = "purchase_order_lines".purchase_order_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "purchase_orders" p WHERE p.id = "purchase_order_lines".purchase_order_id));

ALTER TABLE "goods_received_note_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_received_note_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "goods_received_note_lines"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "goods_received_notes" p WHERE p.id = "goods_received_note_lines".goods_received_note_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "goods_received_notes" p WHERE p.id = "goods_received_note_lines".goods_received_note_id));

ALTER TABLE "bank_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_transactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "bank_transactions"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "bank_statements" p WHERE p.id = "bank_transactions".bank_statement_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "bank_statements" p WHERE p.id = "bank_transactions".bank_statement_id));

ALTER TABLE "budget_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budget_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "budget_lines"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "budget_definitions" p WHERE p.id = "budget_lines".budget_definition_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "budget_definitions" p WHERE p.id = "budget_lines".budget_definition_id));

ALTER TABLE "report_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "report_runs"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "report_definitions" p WHERE p.id = "report_runs".definition_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "report_definitions" p WHERE p.id = "report_runs".definition_id));

ALTER TABLE "tax_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "tax_rates"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "tax_codes" p WHERE p.id = "tax_rates".tax_code_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "tax_codes" p WHERE p.id = "tax_rates".tax_code_id));

ALTER TABLE "analysis_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analysis_codes" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "analysis_codes"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "analysis_dimensions" p WHERE p.id = "analysis_codes".dimension_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "analysis_dimensions" p WHERE p.id = "analysis_codes".dimension_id));

ALTER TABLE "allocation_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allocation_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "allocation_sources"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "allocation_definitions" p WHERE p.id = "allocation_sources".definition_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "allocation_definitions" p WHERE p.id = "allocation_sources".definition_id));

ALTER TABLE "allocation_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allocation_targets" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "allocation_targets"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "allocation_definitions" p WHERE p.id = "allocation_targets".definition_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "allocation_definitions" p WHERE p.id = "allocation_targets".definition_id));

ALTER TABLE "authorization_team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "authorization_team_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "authorization_team_members"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "authorization_teams" p WHERE p.id = "authorization_team_members".team_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "authorization_teams" p WHERE p.id = "authorization_team_members".team_id));

ALTER TABLE "transfer_batch_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfer_batch_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "transfer_batch_items"
  USING (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "transfer_batches" p WHERE p.id = "transfer_batch_items".batch_id))
  WITH CHECK (app_rls_bypassed() OR EXISTS (SELECT 1 FROM "transfer_batches" p WHERE p.id = "transfer_batch_items".batch_id));

ALTER TABLE "transfer_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfer_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "transfer_batches"
  USING (app_rls_bypassed() OR (app_current_entity_id() IS NOT NULL AND (entity_id = app_current_entity_id())))
  WITH CHECK (app_rls_bypassed() OR (app_current_entity_id() IS NOT NULL AND (entity_id = app_current_entity_id())));

ALTER TABLE "consolidation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consolidation_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "consolidation_runs"
  USING (app_rls_bypassed() OR (app_current_entity_id() IS NOT NULL AND (parent_entity_id = app_current_entity_id())))
  WITH CHECK (app_rls_bypassed() OR (app_current_entity_id() IS NOT NULL AND (parent_entity_id = app_current_entity_id())));

ALTER TABLE "intercompany_journals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intercompany_journals" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_scope_policy ON "intercompany_journals"
  USING (app_rls_bypassed() OR (app_current_entity_id() IS NOT NULL AND (source_entity_id = app_current_entity_id() OR mirror_entity_id = app_current_entity_id())))
  WITH CHECK (app_rls_bypassed() OR (app_current_entity_id() IS NOT NULL AND (source_entity_id = app_current_entity_id() OR mirror_entity_id = app_current_entity_id())));
