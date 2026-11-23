-- WP-2 item 9 (OPS-07): every backup of a tenant database or of the registry,
-- taken by db:backup or the backup worker. The dump and its manifest are
-- files under BACKUP_DIR; a row records where they are and how the backup
-- went. A tenant's rows outlive the tenant (tenant_id is set to null).

-- CreateEnum
CREATE TYPE "BackupTarget" AS ENUM ('TENANT', 'REGISTRY');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'PRUNED');

-- CreateTable
CREATE TABLE "database_backups" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "target" "BackupTarget" NOT NULL,
    "tenant_id" TEXT,
    "label" VARCHAR(50) NOT NULL,
    "db_name" TEXT NOT NULL,
    "schema_version" TEXT,
    "file" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "sha256" VARCHAR(64),
    "row_counts" JSONB,
    "status" "BackupStatus" NOT NULL,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "pruned_at" TIMESTAMP(3),

    CONSTRAINT "database_backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "database_backups_run_id_idx" ON "database_backups"("run_id");

-- CreateIndex
CREATE INDEX "database_backups_label_started_at_idx" ON "database_backups"("label", "started_at");

-- AddForeignKey
ALTER TABLE "database_backups" ADD CONSTRAINT "database_backups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
