-- WP-2 item 2 (ARC-06): where each tenant database is and the two roles that
-- use it, with their passwords sealed by PLATFORM_ENCRYPTION_KEY; and the
-- tenant's schema version. database_url becomes optional: tenants
-- provisioned from now on have no plain-text connection string.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "app_password_enc" TEXT,
ADD COLUMN     "app_role" TEXT,
ADD COLUMN     "db_host" TEXT,
ADD COLUMN     "db_name" TEXT,
ADD COLUMN     "db_port" INTEGER,
ADD COLUMN     "owner_password_enc" TEXT,
ADD COLUMN     "owner_role" TEXT,
ADD COLUMN     "schema_version" TEXT,
ALTER COLUMN "database_url" DROP NOT NULL;

-- A tenant is reachable one way or the other: the old connection string, or
-- the whole new location. Never half of one.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_location_check" CHECK (
  "database_url" IS NOT NULL
  OR (
    "db_host" IS NOT NULL AND "db_port" IS NOT NULL AND "db_name" IS NOT NULL
    AND "owner_role" IS NOT NULL AND "owner_password_enc" IS NOT NULL
    AND "app_role" IS NOT NULL AND "app_password_enc" IS NOT NULL
  )
);
