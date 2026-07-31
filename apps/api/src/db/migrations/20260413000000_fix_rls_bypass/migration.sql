-- Fix RLS policies to honour app.bypass_rls session variable.
--
-- Previously, entity_scope_policy only checked app_current_entity_id().
-- The withBypassRLS() helper sets app.bypass_rls = 'true' but the policies
-- never checked it, making the bypass a no-op. This caused auth/profile
-- queries (which run without entity context) to return empty roles, entities,
-- and permissions.

DO $$
DECLARE
  tbl text;
  all_tables text[];
BEGIN
  -- Collect all tables with entity_scope_policy (excluding 'entities' which has a special policy)
  SELECT array_agg(c.relname::text) INTO all_tables
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  WHERE p.polname = 'entity_scope_policy'
    AND c.relname != 'entities';

  IF all_tables IS NOT NULL THEN
    FOREACH tbl IN ARRAY all_tables LOOP
      EXECUTE format('DROP POLICY IF EXISTS entity_scope_policy ON %I', tbl);
      EXECUTE format(
        'CREATE POLICY entity_scope_policy ON %I
         USING (
           current_setting(''app.bypass_rls'', true) = ''true''
           OR (app_current_entity_id() IS NOT NULL AND entity_id = app_current_entity_id())
         )
         WITH CHECK (
           current_setting(''app.bypass_rls'', true) = ''true''
           OR (app_current_entity_id() IS NOT NULL AND entity_id = app_current_entity_id())
         )', tbl);
    END LOOP;
  END IF;

  -- Entities table: special policy (matches id OR parent_id)
  IF EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE p.polname = 'entity_scope_policy' AND c.relname = 'entities'
  ) THEN
    DROP POLICY IF EXISTS entity_scope_policy ON entities;
    CREATE POLICY entity_scope_policy ON entities
      USING (
        current_setting('app.bypass_rls', true) = 'true'
        OR (
          app_current_entity_id() IS NOT NULL
          AND (id = app_current_entity_id() OR parent_id = app_current_entity_id())
        )
      )
      WITH CHECK (
        current_setting('app.bypass_rls', true) = 'true'
        OR (
          app_current_entity_id() IS NOT NULL
          AND (id = app_current_entity_id() OR parent_id = app_current_entity_id())
        )
      );
  END IF;
END $$;
