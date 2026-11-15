/**
 * The tenant database passwords sealed in the registry (docs/SECRETS-ROTATION.md).
 *
 *   pnpm --filter @hfp/api db:reseal-secrets
 *     Key rotation: opens every sealed password (with PLATFORM_ENCRYPTION_KEY or
 *     PLATFORM_ENCRYPTION_KEY_PREVIOUS) and seals it again with
 *     PLATFORM_ENCRYPTION_KEY. Passwords do not change. Safe to repeat.
 *
 *   pnpm --filter @hfp/api db:reset-tenant-passwords [--tenant <slug>]...
 *     Gives each tenant's owner and application roles new passwords, as the
 *     registry's role (which administers them), and seals them with
 *     PLATFORM_ENCRYPTION_KEY. The recovery when the key is lost, and the way
 *     to rotate the database passwords themselves. Open connections keep
 *     working; new ones use the new passwords once the services' registry
 *     cache refreshes (within a minute) or they restart.
 *
 * Needs REGISTRY_DATABASE_URL and PLATFORM_ENCRYPTION_KEY.
 */
import { PrismaClient as RegistryClient } from "../db/registry-client.js";
import { registryDatabaseUrl } from "../config.js";
import { randomPassword } from "../db/scram.js";
import { hasRoles, type NewLocation } from "../db/tenant-location.js";
import { createTenantDatabase } from "../db/tenant-roles.js";
import { PrismaClient } from "../db/client.js";
import { open, platformKeyId, seal, sealedWith } from "../shared/secret-box.js";

const [command, ...rest] = process.argv.slice(2);
const only: string[] = [];
for (let i = 0; i < rest.length; i++)
  if (rest[i] === "--tenant" && rest[i + 1]) only.push(rest[++i]!);

const registry = new RegistryClient({ datasourceUrl: registryDatabaseUrl() });
const tenants = (
  await registry.tenant.findMany({
    where: only.length ? { slug: { in: only } } : {},
    orderBy: { createdAt: "asc" }
  })
).filter((t): t is typeof t & NewLocation => hasRoles(t));

let failed = 0;
if (command === "reseal") {
  const current = platformKeyId();
  for (const t of tenants) {
    try {
      const data = {
        ownerPasswordEnc: seal(open(t.ownerPasswordEnc)),
        appPasswordEnc: seal(open(t.appPasswordEnc))
      };
      const before = [sealedWith(t.ownerPasswordEnc), sealedWith(t.appPasswordEnc)].join("/");
      await registry.tenant.update({ where: { id: t.id }, data });
      console.log(`  ✓ ${t.slug}: ${before} -> ${current}`);
    } catch (error) {
      failed++;
      console.error(`  ✗ ${t.slug}: ${error instanceof Error ? error.message : error}`);
    }
  }
} else if (command === "reset") {
  const platformUrl = new URL(registryDatabaseUrl());
  for (const t of tenants) {
    const server = new URL(platformUrl);
    server.hostname = t.dbHost;
    server.port = String(t.dbPort);
    server.pathname = "/postgres";
    const platform = new PrismaClient({ datasourceUrl: server.toString() });
    try {
      const ownerPassword = randomPassword();
      const appPassword = randomPassword();
      // createTenantDatabase sets the roles' passwords when they exist and
      // leaves the database as it is; it also re-checks the connect rights.
      await createTenantDatabase(platform, { ...t, ownerPassword, appPassword });
      await registry.tenant.update({
        where: { id: t.id },
        data: { ownerPasswordEnc: seal(ownerPassword), appPasswordEnc: seal(appPassword) }
      });
      console.log(`  ✓ ${t.slug}: new passwords for ${t.ownerRole}, ${t.appRole}`);
    } catch (error) {
      failed++;
      console.error(`  ✗ ${t.slug}: ${error instanceof Error ? error.message : error}`);
    } finally {
      await platform.$disconnect();
    }
  }
} else {
  console.error("Usage: tenant-secrets reseal | reset [--tenant <slug>]...");
  process.exit(2);
}

await registry.$disconnect();
console.log(`${tenants.length - failed} of ${tenants.length} tenant(s) done.`);
process.exit(failed ? 1 : 0);
