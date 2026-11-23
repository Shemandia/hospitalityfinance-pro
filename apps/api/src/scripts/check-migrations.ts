/**
 * Fails when a schema and its migrations disagree (WP-2, ARC-03).
 *
 *   SHADOW_DATABASE_URL=postgresql://.../hfp_shadow pnpm --filter @hfp/api db:check:migrations
 *
 * For the registry and the tenant schema, Prisma applies every migration to the
 * shadow database (an empty scratch database; its contents are discarded) and
 * compares the result with schema.prisma. A model changed without a migration,
 * or a migration that does not match the model, prints the difference and
 * exits 1. Run in CI.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { API_ROOT, schemaPath, type SchemaKind } from "../db/migrate.js";
import { requireConfig } from "../config.js";
import { PrismaClient } from "../db/client.js";

const { SHADOW_DATABASE_URL } = requireConfig(["SHADOW_DATABASE_URL"], "db:check:migrations");
const prisma = resolve(API_ROOT, "node_modules/prisma/build/index.js");

/**
 * Empties the shadow database. Prisma resets only the public schema of the
 * shadow before applying the migrations, so a schema a migration creates
 * elsewhere (app_private, SEC-11) would survive one check and make the next
 * one fail. The shadow is scratch by definition.
 */
async function emptyShadow(): Promise<void> {
  const db = new PrismaClient({ datasourceUrl: SHADOW_DATABASE_URL });
  try {
    const schemas = await db.$queryRawUnsafe<Array<{ nspname: string }>>(
      `select nspname from pg_namespace
        where nspname not in ('public', 'information_schema') and nspname not like 'pg\\_%'`
    );
    for (const { nspname } of schemas) {
      await db.$executeRawUnsafe(`DROP SCHEMA "${nspname.replace(/"/g, '""')}" CASCADE`);
    }
  } finally {
    await db.$disconnect();
  }
}

let failed = false;
for (const kind of ["registry", "tenant"] as SchemaKind[]) {
  await emptyShadow();
  try {
    execFileSync(
      process.execPath,
      [
        prisma,
        "migrate",
        "diff",
        "--from-migrations",
        resolve(API_ROOT, "src/db", kind, "migrations"),
        "--to-schema-datamodel",
        schemaPath(kind),
        "--shadow-database-url",
        SHADOW_DATABASE_URL,
        "--exit-code"
      ],
      { cwd: API_ROOT, stdio: ["ignore", "pipe", "pipe"] }
    );
    console.log(`${kind}: migrations match schema.prisma`);
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
    failed = true;
    console.error(
      e.status === 2
        ? `${kind}: schema.prisma and the migrations differ. Create a migration (pnpm db:migrate:new:${kind}).\n${e.stdout}`
        : `${kind}: the check could not run.\n${e.stderr}${e.stdout}`
    );
  }
}
process.exit(failed ? 1 : 0);
