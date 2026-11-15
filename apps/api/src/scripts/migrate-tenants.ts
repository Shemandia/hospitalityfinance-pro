/**
 * Migrates every tenant database to this release's schema (src/db/tenant-runner.ts).
 *
 *   pnpm --filter @hfp/api db:migrate:tenants [--dry-run] [--resume] [--keep-going]
 *                                             [--tenant <slug>]...
 *
 * Deploy order for a release: apply the registry migrations
 * (db:migrate:deploy:registry), run this, then switch traffic to the new
 * release. Exits 1 when any tenant failed; the failed tenant answers 503
 * (under maintenance) until a later run succeeds.
 *
 * Needs REGISTRY_DATABASE_URL and PLATFORM_ENCRYPTION_KEY.
 */
import { RunnerBusyError, runTenantMigrations } from "../db/tenant-runner.js";

const args = process.argv.slice(2);
const only: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--tenant" && args[i + 1]) only.push(args[++i]!);
}

try {
  const result = await runTenantMigrations({
    dryRun: args.includes("--dry-run"),
    resume: args.includes("--resume"),
    keepGoing: args.includes("--keep-going"),
    only: only.length > 0 ? only : undefined,
    log: (line) => console.log(line)
  });
  const count = (status: string) => result.outcomes.filter((o) => o.status === status).length;
  console.log(
    `\n${count("SUCCEEDED")} migrated, ${count("UP_TO_DATE")} up to date, ` +
      `${count("SKIPPED")} skipped, ${count("FAILED")} failed` +
      (count("WOULD_MIGRATE") ? `, ${count("WOULD_MIGRATE")} would migrate` : "") +
      ` (run ${result.runId}).`
  );
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(error instanceof RunnerBusyError ? error.message : error);
  process.exit(1);
}
