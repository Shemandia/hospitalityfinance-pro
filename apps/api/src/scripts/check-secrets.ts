/**
 * Lists the tenants whose registry row still holds a readable password: a
 * connection string from before WP-2 (docs/SECRETS-ROTATION.md). Adopt them
 * (db:adopt tenant <slug>), which seals the passwords and removes the string.
 *
 *   pnpm --filter @hfp/api db:check-secrets
 *
 * Exits 1 when any is found. Needs REGISTRY_DATABASE_URL.
 */
import { PrismaClient as RegistryClient } from "../db/registry-client.js";
import { registryDatabaseUrl } from "../config.js";
import { plaintextSecrets } from "../db/registry-secrets.js";

const registry = new RegistryClient({ datasourceUrl: registryDatabaseUrl() });
try {
  const rows = await registry.tenant.findMany({ select: { slug: true, databaseUrl: true } });
  const found = plaintextSecrets(rows);
  if (found.length === 0) {
    console.log(`No readable secrets in the registry (${rows.length} tenants checked).`);
  } else {
    console.error(
      `Readable passwords in the registry for: ${found.join(", ")}. Adopt these tenants.`
    );
    process.exitCode = 1;
  }
} finally {
  await registry.$disconnect();
}
