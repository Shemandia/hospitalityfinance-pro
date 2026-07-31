-- CreateEnum
CREATE TYPE "LicenseType" AS ENUM ('TRIAL', 'STANDARD', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "ProvisioningStatus" AS ENUM ('PENDING', 'PROVISIONING', 'ACTIVE', 'FAILED');

-- CreateEnum
CREATE TYPE "ProvisioningStepStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "tenant_code" VARCHAR(8) NOT NULL,
    "name" TEXT NOT NULL,
    "database_url" TEXT NOT NULL,
    "domain" TEXT,
    "admin_email" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT 'standard',
    "max_properties" INTEGER NOT NULL DEFAULT 10,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "provisioned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "provisioning_status" "ProvisioningStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_entitlements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "license_type" "LicenseType" NOT NULL,
    "max_properties" INTEGER NOT NULL DEFAULT 10,
    "max_users" INTEGER NOT NULL DEFAULT 50,
    "enabled_modules" TEXT[],
    "max_concurrent_sessions" INTEGER NOT NULL DEFAULT 10,
    "subscription_start_date" DATE NOT NULL,
    "subscription_end_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" VARCHAR(255),
    "updated_by" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_provisioning_steps" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "step_name" VARCHAR(50) NOT NULL,
    "step_order" INTEGER NOT NULL,
    "status" "ProvisioningStepStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_provisioning_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_tenant_code_key" ON "tenants"("tenant_code");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_entitlements_tenant_id_key" ON "tenant_entitlements"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_provisioning_steps_tenant_id_idx" ON "tenant_provisioning_steps"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_provisioning_steps" ADD CONSTRAINT "tenant_provisioning_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

