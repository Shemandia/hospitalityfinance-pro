-- WP-2 item 3: each tenant's result in each run of the tenant migration
-- runner (db:migrate:tenants).

-- CreateEnum
CREATE TYPE "MigrationRunStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "tenant_migration_runs" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "from_version" TEXT,
    "to_version" TEXT NOT NULL,
    "status" "MigrationRunStatus" NOT NULL,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "tenant_migration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_migration_runs_run_id_idx" ON "tenant_migration_runs"("run_id");

-- CreateIndex
CREATE INDEX "tenant_migration_runs_tenant_id_started_at_idx" ON "tenant_migration_runs"("tenant_id", "started_at");

-- AddForeignKey
ALTER TABLE "tenant_migration_runs" ADD CONSTRAINT "tenant_migration_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
