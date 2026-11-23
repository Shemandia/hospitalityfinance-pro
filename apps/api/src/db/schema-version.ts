/**
 * Is a tenant's database at the schema this release needs? (WP-2 item 3, ARC-03)
 *
 * The registry records each tenant's last applied migration (schema_version);
 * the release's is the newest folder in src/db/tenant/migrations. A tenant
 * behind the release is under maintenance: the API answers 503 and workers
 * leave its jobs until the migration runner has brought it up to date. The
 * other tenants are not affected.
 *
 *   current     at the release's version
 *   behind      an older migration of this release: refused until migrated
 *   ahead       a migration this release does not know: a newer release has
 *               migrated it (rolling deploy, expand/contract); served
 *   unmanaged   no version recorded: built before WP-2 and not yet adopted;
 *               served as before, until adoption records a version
 */

import { migrationNames } from "./migrate.js";

export type SchemaState = "current" | "behind" | "ahead" | "unmanaged";

let names: string[] | null = null;
function releaseMigrations(): string[] {
  names ??= migrationNames("tenant");
  return names;
}

/** The tenant schema version this release needs: its newest migration. */
export function releaseSchemaVersion(): string {
  return releaseMigrations().at(-1)!;
}

export function schemaState(version: string | null | undefined): SchemaState {
  if (!version) return "unmanaged";
  const all = releaseMigrations();
  const index = all.indexOf(version);
  if (index === -1) return "ahead";
  return index === all.length - 1 ? "current" : "behind";
}

/** A tenant whose database is behind this release. Answered with 503. */
export class TenantMaintenanceError extends Error {
  readonly statusCode = 503;
  readonly code = "TENANT_MAINTENANCE";
  constructor(readonly tenantSlug: string) {
    super("This organisation is being updated. Try again in a few minutes.");
    this.name = "TenantMaintenanceError";
  }
}

/** Throws TenantMaintenanceError when the tenant's database is behind this release. */
export function assertSchemaServiceable(tenant: {
  slug: string;
  schemaVersion: string | null;
}): void {
  if (schemaState(tenant.schemaVersion) === "behind") {
    throw new TenantMaintenanceError(tenant.slug);
  }
}
