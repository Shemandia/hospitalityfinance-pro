-- Roadmap Stage 1 item 8 (WP-2, HC-40, HC-35, HC-37): plans in the registry,
-- and per-tenant entitlements as a plan plus the tenant's own exceptions.
--
-- Before: each entitlement row copied its limits from column defaults (10
-- properties, 50 users, 10 sessions) and a licence type enum; the upload
-- size and import concurrency were platform settings only.
--
-- After: plans hold the limits; an entitlement names its plan and overrides
-- only what differs (null, or an empty module list, means "as the plan").
-- The three plans are seeded with exactly the values in use until now, so
-- no tenant's limits change. Upload size and import concurrency are null in
-- every plan: the platform settings apply, as before, until the platform
-- administrator sets them. modules/tenant/entitlements.ts is the only reader.

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "max_properties" INTEGER NOT NULL,
    "max_users" INTEGER NOT NULL,
    "max_concurrent_sessions" INTEGER NOT NULL,
    "enabled_modules" TEXT[],
    "upload_max_mb" INTEGER,
    "import_concurrency" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- The plans that existed as licence types, with the values used until now.
INSERT INTO "plans" ("id", "code", "name", "max_properties", "max_users",
                     "max_concurrent_sessions", "enabled_modules", "is_default", "updated_at")
VALUES
  (gen_random_uuid()::text, 'TRIAL',      'Trial',      10, 50, 10, ARRAY['GL','AP','AR','REPORTING'], false, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'STANDARD',   'Standard',   10, 50, 10, ARRAY['GL','AP','AR','REPORTING'], true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ENTERPRISE', 'Enterprise', 10, 50, 10, ARRAY['GL','AP','AR','REPORTING'], false, CURRENT_TIMESTAMP);

-- AlterTable: the entitlement names a plan; its limits become exceptions.
ALTER TABLE "tenant_entitlements"
ADD COLUMN     "import_concurrency" INTEGER,
ADD COLUMN     "plan_id" TEXT,
ADD COLUMN     "upload_max_mb" INTEGER,
ALTER COLUMN "max_properties" DROP NOT NULL,
ALTER COLUMN "max_properties" DROP DEFAULT,
ALTER COLUMN "max_users" DROP NOT NULL,
ALTER COLUMN "max_users" DROP DEFAULT,
ALTER COLUMN "max_concurrent_sessions" DROP NOT NULL,
ALTER COLUMN "max_concurrent_sessions" DROP DEFAULT;

UPDATE "tenant_entitlements" e
   SET "plan_id" = p."id"
  FROM "plans" p
 WHERE p."code" = e."license_type"::text;

-- A value equal to the plan's is not an exception.
UPDATE "tenant_entitlements" e
   SET "max_properties" = CASE WHEN e."max_properties" = p."max_properties" THEN NULL ELSE e."max_properties" END,
       "max_users" = CASE WHEN e."max_users" = p."max_users" THEN NULL ELSE e."max_users" END,
       "max_concurrent_sessions" = CASE WHEN e."max_concurrent_sessions" = p."max_concurrent_sessions" THEN NULL ELSE e."max_concurrent_sessions" END,
       "enabled_modules" = CASE WHEN e."enabled_modules" = p."enabled_modules" THEN ARRAY[]::text[] ELSE e."enabled_modules" END
  FROM "plans" p
 WHERE p."id" = e."plan_id";

ALTER TABLE "tenant_entitlements" DROP COLUMN "license_type";

-- Every tenant has an entitlement: those without one (built before
-- provisioning recorded it) get the default plan, unchanged limits.
INSERT INTO "tenant_entitlements" ("id", "tenant_id", "plan_id", "enabled_modules",
                                   "subscription_start_date", "created_by", "updated_at")
SELECT gen_random_uuid()::text, t."id", p."id", ARRAY[]::text[], t."created_at"::date,
       'migration 3_plans', CURRENT_TIMESTAMP
  FROM "tenants" t
  JOIN "plans" p ON p."is_default"
 WHERE NOT EXISTS (SELECT 1 FROM "tenant_entitlements" e WHERE e."tenant_id" = t."id");

ALTER TABLE "tenant_entitlements" ALTER COLUMN "plan_id" SET NOT NULL;

-- DropEnum
DROP TYPE "LicenseType";

-- AddForeignKey
ALTER TABLE "tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
