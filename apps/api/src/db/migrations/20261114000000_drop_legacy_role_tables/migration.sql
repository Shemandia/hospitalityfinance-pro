-- WP-A (AUT-03): the CONTRACT step after 20261111000000_role_assignments.
--
-- role_assignments is the only record of who holds which role where. This
-- drops what it replaced:
--   * user_roles          (role per user, optionally per entity)
--   * entity_users        (membership, with the deprecated role column);
--                         membership gave no permissions of its own, and who
--                         can open a property is now decided by assignments
--   * the "EntityRole" enum used by entity_users.role
--
-- It refuses to run until the expand migration has copied the old grants
-- (role_assignments carries the comment "legacy grants copied ..."), so no
-- grant can be lost by running the two out of order.
--
-- Safe to re-run; a database that never had the old tables is left alone.
-- Applied by `pnpm db:migrate:access` (after the expand step) and by
-- `db:build:tenant` before the schema push (ARC-03: tenant databases have no
-- migration history until WP-2).

DO $$
BEGIN
  IF to_regclass('user_roles') IS NULL
     AND to_regclass('entity_users') IS NULL
     AND to_regtype('"EntityRole"') IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('role_assignments') IS NULL
     OR coalesce(obj_description(to_regclass('role_assignments'), 'pg_class'), '')
          NOT LIKE 'legacy grants copied%' THEN
    RAISE EXCEPTION
      'drop_legacy_role_tables: the old grants have not been copied into role_assignments yet. Apply 20261111000000_role_assignments first (pnpm db:migrate:access runs both in order).';
  END IF;

  DROP TABLE IF EXISTS "user_roles";
  DROP TABLE IF EXISTS "entity_users";
  DROP TYPE IF EXISTS "EntityRole";
END $$;
