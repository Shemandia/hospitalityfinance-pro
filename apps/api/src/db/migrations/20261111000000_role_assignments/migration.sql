-- WP-A (AUT-01, AUT-03): one assignment table for "who holds which role where".
--
-- role_assignments replaces the two older sources of roles:
--   * user_roles         (role per user, optionally per entity)
--   * entity_users.role  (deprecated enum: ADMIN, CONTROLLER, VIEWER, SUPERADMIN)
--
-- This is the EXPAND step. It creates the table and copies existing grants into
-- it. It does not drop user_roles, entity_users.role or the "EntityRole" enum:
-- the running code still reads them. The follow-up contract migration re-runs
-- the copy below (it is idempotent) and then drops them, once every reader and
-- writer has moved to AccessService.
--
-- Every statement is safe to re-run. Tenant databases were created with
-- `prisma db push` and carry no migration history (ARC-03), so until WP-2 this
-- file is applied with `pnpm db:migrate:access` and must tolerate a database
-- where `db push` has already created the table from the Prisma schema.
--
-- Requires PostgreSQL 15+ (UNIQUE ... NULLS NOT DISTINCT).

-- ── Table ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regtype('"AssignmentScope"') IS NULL THEN
    CREATE TYPE "AssignmentScope" AS ENUM ('TENANT', 'ENTITY');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "role_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "scope_type" "AssignmentScope" NOT NULL,
    "entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "role_assignments_entity_id_idx" ON "role_assignments"("entity_id");
CREATE INDEX IF NOT EXISTS "role_assignments_role_id_idx" ON "role_assignments"("role_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_assignments_user_id_fkey' AND conrelid = to_regclass('role_assignments')
  ) THEN
    ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_assignments_role_id_fkey' AND conrelid = to_regclass('role_assignments')
  ) THEN
    ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_assignments_entity_id_fkey' AND conrelid = to_regclass('role_assignments')
  ) THEN
    ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_entity_id_fkey"
      FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Integrity the Prisma schema cannot express ───────────────────────────────

-- A tenant-wide assignment has no entity; an entity assignment always has one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_assignments_scope_check' AND conrelid = to_regclass('role_assignments')
  ) THEN
    ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_scope_check" CHECK (
      ("scope_type" = 'TENANT' AND "entity_id" IS NULL)
      OR ("scope_type" = 'ENTITY' AND "entity_id" IS NOT NULL)
    );
  END IF;
END $$;

-- One row per (user, role, scope). A plain unique index treats NULL entity_id
-- values as distinct, which would allow the same tenant-wide grant twice (the
-- flaw in user_roles). `db push` creates the plain form; replace it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'role_assignments_user_id_role_id_entity_id_key'
      AND i.indrelid = to_regclass('role_assignments')
      AND i.indisunique
      AND i.indnullsnotdistinct
  ) THEN
    DROP INDEX IF EXISTS "role_assignments_user_id_role_id_entity_id_key";
    CREATE UNIQUE INDEX "role_assignments_user_id_role_id_entity_id_key"
      ON "role_assignments"("user_id", "role_id", "entity_id") NULLS NOT DISTINCT;
  END IF;
END $$;

-- ── Row-level security ───────────────────────────────────────────────────────
-- Assignments are read before any entity is selected and include tenant-wide
-- rows, so they cannot be scoped by app.current_entity_id. They are readable
-- and writable only inside a transaction that sets app.bypass_rls, which only
-- AccessService and the assignment admin code do. FORCE applies the policy to
-- the table owner too, so a query that forgets the bypass returns no rows
-- instead of every row.

CREATE OR REPLACE FUNCTION app_rls_bypassed()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN coalesce(current_setting('app.bypass_rls', true), '') = 'true';
END;
$$;

ALTER TABLE "role_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "role_assignments_bypass_only" ON "role_assignments";
CREATE POLICY "role_assignments_bypass_only" ON "role_assignments"
  USING (app_rls_bypassed())
  WITH CHECK (app_rls_bypassed());

-- ── Copy existing grants ─────────────────────────────────────────────────────
-- The copy preserves what each user can reach today; it never widens it.
--
-- 1. user_roles row with an entity        -> ENTITY assignment at that entity.
-- 2. user_roles row without an entity ("global"):
--      a. role is a system role           -> TENANT assignment.
--      b. otherwise                       -> ENTITY assignment at each entity the
--         user is a member of (entity_users). Today the token limits such a
--         user to those entities and the entities below them, which is exactly
--         what an ENTITY assignment grants. A user with no membership gets
--         nothing, as today.
-- 3. entity_users.role, only for users with no user_roles row at all (users who
--    were never moved off the deprecated column):
--      ADMIN / CONTROLLER / VIEWER -> the role with that code, ENTITY scope.
--      SUPERADMIN                  -> the system role TENANT_ADMIN, TENANT scope
--                                     (SUPERADMIN meant cross-entity admin).
--    The migration stops if a tenant holds such a row but not the target role,
--    rather than silently dropping someone's access.

DO $$
DECLARE
  missing text;
BEGIN
  PERFORM set_config('app.bypass_rls', 'true', true);

  IF to_regclass('user_roles') IS NOT NULL THEN
    -- 1. Entity-scoped grants.
    INSERT INTO "role_assignments" ("id", "user_id", "role_id", "scope_type", "entity_id", "created_at")
    SELECT gen_random_uuid()::text, ur."user_id", ur."role_id", 'ENTITY', ur."entity_id", min(ur."created_at")
    FROM "user_roles" ur
    WHERE ur."entity_id" IS NOT NULL
    GROUP BY ur."user_id", ur."role_id", ur."entity_id"
    ON CONFLICT ("user_id", "role_id", "entity_id") DO NOTHING;

    -- 2a. Global grants of system roles.
    INSERT INTO "role_assignments" ("id", "user_id", "role_id", "scope_type", "entity_id", "created_at")
    SELECT gen_random_uuid()::text, ur."user_id", ur."role_id", 'TENANT', NULL, min(ur."created_at")
    FROM "user_roles" ur
    JOIN "roles" r ON r."id" = ur."role_id"
    WHERE ur."entity_id" IS NULL AND r."is_system"
    GROUP BY ur."user_id", ur."role_id"
    ON CONFLICT ("user_id", "role_id", "entity_id") DO NOTHING;

    -- 2b. Global grants of ordinary roles, narrowed to the user's memberships.
    INSERT INTO "role_assignments" ("id", "user_id", "role_id", "scope_type", "entity_id", "created_at")
    SELECT gen_random_uuid()::text, ur."user_id", ur."role_id", 'ENTITY', eu."entity_id", min(ur."created_at")
    FROM "user_roles" ur
    JOIN "roles" r ON r."id" = ur."role_id"
    JOIN "entity_users" eu ON eu."user_id" = ur."user_id"
    WHERE ur."entity_id" IS NULL AND NOT r."is_system"
    GROUP BY ur."user_id", ur."role_id", eu."entity_id"
    ON CONFLICT ("user_id", "role_id", "entity_id") DO NOTHING;
  END IF;

  -- 3. The deprecated entity_users.role column, while it still exists.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'entity_users' AND column_name = 'role'
  ) AND to_regclass('user_roles') IS NOT NULL THEN
    CREATE TEMP TABLE "_legacy_entity_roles" ON COMMIT DROP AS
    SELECT eu."user_id",
           eu."entity_id",
           eu."created_at",
           eu."role"::text AS "legacy_role",
           CASE WHEN eu."role"::text = 'SUPERADMIN' THEN 'TENANT_ADMIN' ELSE eu."role"::text END AS "role_code",
           (eu."role"::text = 'SUPERADMIN') AS "tenant_wide"
    FROM "entity_users" eu
    WHERE eu."role" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "user_roles" ur WHERE ur."user_id" = eu."user_id");

    SELECT string_agg(DISTINCT l."legacy_role" || ' -> ' || l."role_code", ', ')
    INTO missing
    FROM "_legacy_entity_roles" l
    WHERE NOT EXISTS (
      SELECT 1 FROM "roles" r
      WHERE r."code" = l."role_code" AND (r."is_system" OR NOT l."tenant_wide")
    );

    IF missing IS NOT NULL THEN
      RAISE EXCEPTION
        'role_assignments migration: entity_users.role values have no matching role row (%). Create the role(s) or clear the legacy values, then re-run.',
        missing;
    END IF;

    INSERT INTO "role_assignments" ("id", "user_id", "role_id", "scope_type", "entity_id", "created_at")
    SELECT gen_random_uuid()::text, l."user_id", r."id", 'ENTITY', l."entity_id", min(l."created_at")
    FROM "_legacy_entity_roles" l
    JOIN "roles" r ON r."code" = l."role_code"
    WHERE NOT l."tenant_wide"
    GROUP BY l."user_id", r."id", l."entity_id"
    ON CONFLICT ("user_id", "role_id", "entity_id") DO NOTHING;

    INSERT INTO "role_assignments" ("id", "user_id", "role_id", "scope_type", "entity_id", "created_at")
    SELECT gen_random_uuid()::text, l."user_id", r."id", 'TENANT', NULL, min(l."created_at")
    FROM "_legacy_entity_roles" l
    JOIN "roles" r ON r."code" = l."role_code" AND r."is_system"
    WHERE l."tenant_wide"
    GROUP BY l."user_id", r."id"
    ON CONFLICT ("user_id", "role_id", "entity_id") DO NOTHING;

    DROP TABLE "_legacy_entity_roles";
  END IF;
END $$;
