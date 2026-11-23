/**
 * Adopts databases built before WP-2 (src/db/tenant-adoption.ts).
 *
 *   pnpm --filter @hfp/api db:adopt registry [--dry-run]
 *   pnpm --filter @hfp/api db:adopt tenant <slug> [--dry-run]
 *
 * The registry first, then each tenant. --dry-run compares and reports, and
 * changes nothing. Stop the API and the workers that still connect with the
 * old connection string before adopting a tenant: afterwards only the
 * tenant's own roles may connect.
 *
 * Needs REGISTRY_DATABASE_URL and PLATFORM_ENCRYPTION_KEY; the registry's
 * role must own the tenant database and have CREATEROLE.
 */
import { AdoptionRefused, adoptRegistry, adoptTenant } from "../db/tenant-adoption.js";

const [what, slugOrFlag, ...rest] = process.argv.slice(2);
const dryRun = process.argv.includes("--dry-run");
const log = (line: string) => console.log(line);

try {
  if (what === "registry") {
    console.log(`Registry${dryRun ? " (dry run)" : ""}:`);
    await adoptRegistry({ dryRun, log });
  } else if (what === "tenant" && slugOrFlag && !slugOrFlag.startsWith("--")) {
    console.log(`Tenant ${slugOrFlag}${dryRun ? " (dry run)" : ""}:`);
    const report = await adoptTenant(slugOrFlag, { dryRun, log });
    if (report.adopted) console.log(`${slugOrFlag} adopted.`);
  } else {
    console.error("Usage: db:adopt registry [--dry-run] | db:adopt tenant <slug> [--dry-run]");
    process.exit(2);
  }
  void rest;
} catch (error) {
  if (error instanceof AdoptionRefused) {
    console.error(`Refused: ${error.message}`);
    for (const line of error.diff?.missing ?? []) console.error(`  - ${line}`);
    for (const line of error.diff?.extra ?? []) console.error(`  + ${line}`);
  } else {
    console.error(error);
  }
  process.exit(1);
}
