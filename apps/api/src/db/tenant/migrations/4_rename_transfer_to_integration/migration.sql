-- Transfer Desk is renamed Integrations (owner, 21 November 2026; import plan
-- section 6b). Every database object named transfer_* becomes integration_*,
-- and the four Transfer* enum types become Integration*. Data, grants,
-- row-level security and policies move with the objects; only names change.
-- No function, view or policy body refers to these tables by name.

DO $$
DECLARE
  r record;
BEGIN
  -- 1. Tables.
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname LIKE 'transfer\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I RENAME TO %I', r.relname,
                   'integration_' || substr(r.relname, length('transfer_') + 1));
  END LOOP;

  -- 2. Constraints (renaming a primary key or unique constraint renames its index).
  FOR r IN
    SELECT con.conname, cls.relname AS tbl
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = cls.relnamespace
     WHERE n.nspname = 'public' AND con.conname LIKE 'transfer\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', r.tbl, r.conname,
                   'integration_' || substr(r.conname, length('transfer_') + 1));
  END LOOP;

  -- 3. Other indexes and sequences.
  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('i', 'S') AND c.relname LIKE 'transfer\_%'
  LOOP
    EXECUTE format(CASE r.relkind WHEN 'i' THEN 'ALTER INDEX public.%I RENAME TO %I'
                                  ELSE 'ALTER SEQUENCE public.%I RENAME TO %I' END,
                   r.relname, 'integration_' || substr(r.relname, length('transfer_') + 1));
  END LOOP;

  -- 4. Enum types.
  FOR r IN
    SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype = 'e' AND t.typname LIKE 'Transfer%'
  LOOP
    EXECUTE format('ALTER TYPE public.%I RENAME TO %I', r.typname,
                   'Integration' || substr(r.typname, length('Transfer') + 1));
  END LOOP;
END;
$$;

-- A name longer than 63 characters is shortened by Prisma its own way: the
-- prefix swap above gives a different one for this index.
ALTER INDEX "integration_lookup_rows_table_id_business_unit_range_from_rang_"
  RENAME TO "integration_lookup_rows_table_id_business_unit_range_from_r_idx";

-- Permissions keep their ids, so role grants follow the new codes. (The
-- permissions table has no row-level security.)
UPDATE "permissions" SET "code" = 'INTEGRATIONS_READ', "category" = 'Integrations'
 WHERE "code" = 'TRANSFER_DESK_READ';
UPDATE "permissions" SET "code" = 'INTEGRATIONS_RUN', "category" = 'Integrations',
       "description" = 'Run integration profiles'
 WHERE "code" = 'TRANSFER_DESK_EXECUTE';
UPDATE "permissions" SET "code" = 'INTEGRATIONS_CONFIG', "category" = 'Integrations'
 WHERE "code" = 'TRANSFER_DESK_CONFIG';
-- The older connector permissions (removed with the connectors, plan step 9).
UPDATE "permissions" SET "category" = 'Integrations (connectors)'
 WHERE "code" IN ('INTEGRATION_READ', 'INTEGRATION_IMPORT', 'INTEGRATION_CONFIG');
