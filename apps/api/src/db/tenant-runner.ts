/**
 * The tenant migration runner (WP-2 item 3, ARC-03).
 *
 * Brings every provisioned tenant database to this release's schema:
 *
 *   for each tenant, oldest first:
 *     up to date               nothing to do, nothing recorded
 *     newer than this release  skipped (a later release migrated it)
 *     built before WP-2        skipped: it has no migration history or owner
 *                              role; adopt it first (db:adopt-tenant)
 *     otherwise                as the tenant's owner role: apply the pending
 *                              migrations, re-grant the application role, check
 *                              the security objects and the role's rights, then
 *                              record the new schema version in the registry
 *
 * Every attempt is a row in tenant_migration_runs (one run_id per run). The
 * runner stops at the first failure and exits non-zero; the failed tenant stays
 * under maintenance (the API answers 503 for it) and the others are served.
 * `resume` continues the last run under the same run id; `keepGoing` carries on
 * past a failure instead of stopping. Only one runner runs at a time (a
 * PostgreSQL advisory lock on the registry).
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "./client.js";
import { PrismaClient as RegistryClient } from "./registry-client.js";
import { registryDatabaseUrl } from "../config.js";
import {
  assertTenantSecurity,
  clearFailedMigrations,
  deployMigrations,
  migrationNames,
  schemaPath
} from "./migrate.js";
import { hasRoles, ownerConnectionUrl } from "./tenant-location.js";
import { assertApplicationRoleRights, grantApplicationRole } from "./tenant-roles.js";

export type RunnerOptions = {
  /** Continue the last run (same run id) instead of starting a new one. */
  resume?: boolean;
  /** Carry on past a failed tenant. Default: stop at the first failure. */
  keepGoing?: boolean;
  /** Only these tenant slugs. */
  only?: string[];
  /** Report what would be done; change nothing. */
  dryRun?: boolean;
  /** Another release's tenant schema.prisma (tests). */
  schema?: string;
  log?: (line: string) => void;
};

export type TenantOutcome = {
  slug: string;
  from: string | null;
  to: string;
  status: "UP_TO_DATE" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "WOULD_MIGRATE";
  detail?: string;
};

export type RunResult = { runId: string; target: string; outcomes: TenantOutcome[]; ok: boolean };

const LOCK_KEY = "hfp:tenant-migration-runner";

export class RunnerBusyError extends Error {
  constructor() {
    super("Another tenant migration run holds the lock; try again when it has finished.");
    this.name = "RunnerBusyError";
  }
}

function lockingUrl(url: string): string {
  // One connection, so the session-level advisory lock and its release use the same one.
  const u = new URL(url);
  u.searchParams.set("connection_limit", "1");
  return u.toString();
}

export async function runTenantMigrations(options: RunnerOptions = {}): Promise<RunResult> {
  const log = options.log ?? (() => {});
  const schema = options.schema ?? schemaPath("tenant");
  const release = migrationNames("tenant", schema);
  const target = release.at(-1)!;
  const registry = new RegistryClient({ datasourceUrl: lockingUrl(registryDatabaseUrl()) });

  try {
    const [lock] = await registry.$queryRawUnsafe<Array<{ locked: boolean }>>(
      `select pg_try_advisory_lock(hashtext('${LOCK_KEY}')) as locked`
    );
    if (!lock?.locked) throw new RunnerBusyError();

    let runId: string = randomUUID();
    if (options.resume) {
      const last = await registry.tenantMigrationRun.findFirst({ orderBy: { startedAt: "desc" } });
      if (last) runId = last.runId;
    }
    log(`Run ${runId}: tenant schema ${target}${options.dryRun ? " (dry run)" : ""}`);

    const tenants = await registry.tenant.findMany({
      where: {
        provisionedAt: { not: null },
        ...(options.only ? { slug: { in: options.only } } : {})
      },
      orderBy: { createdAt: "asc" }
    });

    const outcomes: TenantOutcome[] = [];
    let ok = true;
    for (const tenant of tenants) {
      const from = tenant.schemaVersion;
      const base = { slug: tenant.slug, from, to: target };
      const fromIndex = from ? release.indexOf(from) : -1;

      if (from === target) {
        outcomes.push({ ...base, status: "UP_TO_DATE" });
        continue;
      }
      const skip = !hasRoles(tenant)
        ? "built before WP-2: no migration history or owner role; adopt it first (db:adopt-tenant)"
        : from && fromIndex === -1
          ? `at ${from}, which this release does not know (a newer release migrated it)`
          : null;
      if (skip) {
        outcomes.push({ ...base, status: "SKIPPED", detail: skip });
        log(`  - ${tenant.slug}: skipped, ${skip}`);
        if (!options.dryRun) {
          await registry.tenantMigrationRun.create({
            data: {
              runId,
              tenantId: tenant.id,
              fromVersion: from,
              toVersion: target,
              status: "SKIPPED",
              error: skip,
              finishedAt: new Date()
            }
          });
        }
        continue;
      }
      if (options.dryRun) {
        outcomes.push({ ...base, status: "WOULD_MIGRATE" });
        log(`  ~ ${tenant.slug}: ${from ?? "(new)"} -> ${target}`);
        continue;
      }

      const row = await registry.tenantMigrationRun.create({
        data: { runId, tenantId: tenant.id, fromVersion: from, toVersion: target, status: "FAILED" }
      });
      try {
        const ownerUrl = ownerConnectionUrl(tenant);
        const owner = new PrismaClient({ datasourceUrl: ownerUrl });
        try {
          // A migration that failed in an earlier run left nothing behind
          // (one transaction); mark it rolled back so it is tried again.
          const retried = await clearFailedMigrations("tenant", owner, ownerUrl, schema);
          if (retried.length > 0) log(`    retrying ${retried.join(", ")}`);
          await deployMigrations("tenant", ownerUrl, schema);
          await grantApplicationRole(owner, {
            ownerRole: tenant.ownerRole!,
            appRole: tenant.appRole!
          });
          await assertTenantSecurity(owner, release);
          await assertApplicationRoleRights(owner, tenant.appRole!);
        } finally {
          await owner.$disconnect();
        }
        await registry.$transaction([
          registry.tenant.update({ where: { id: tenant.id }, data: { schemaVersion: target } }),
          registry.tenantMigrationRun.update({
            where: { id: row.id },
            data: { status: "SUCCEEDED", finishedAt: new Date() }
          })
        ]);
        outcomes.push({ ...base, status: "SUCCEEDED" });
        log(`  ✓ ${tenant.slug}: ${from ?? "(new)"} -> ${target}`);
      } catch (error) {
        const detail = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
        await registry.tenantMigrationRun.update({
          where: { id: row.id },
          data: { status: "FAILED", error: detail, finishedAt: new Date() }
        });
        outcomes.push({ ...base, status: "FAILED", detail });
        log(`  ✗ ${tenant.slug}: ${detail.split("\n")[0]}`);
        ok = false;
        if (!options.keepGoing) {
          log("Stopped at the first failure. Fix it, then run again with --resume.");
          break;
        }
      }
    }

    await registry.$queryRawUnsafe(`select pg_advisory_unlock(hashtext('${LOCK_KEY}'))`);
    return { runId, target, outcomes, ok };
  } finally {
    await registry.$disconnect();
  }
}
