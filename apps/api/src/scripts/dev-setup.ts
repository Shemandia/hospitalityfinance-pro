/**
 * One command from an empty PostgreSQL server to a development system you can
 * sign in to (WP-A step 9, acceptance 7).
 *
 *   pnpm dev:setup            (from the repository root)
 *
 * Reads apps/api/.env. Needs:
 *   DATABASE_URL           the demo tenant's database
 *   REGISTRY_DATABASE_URL  the tenant registry; a different database
 *   SEED_USER_PASSWORD     the demo users' password (the normal password rules)
 *   APP_BASE_URL           the web app's address, for the sign-in link
 *
 * Steps, each safe to repeat:
 *   1. Create both databases when they do not exist.
 *   2. Build the registry schema.
 *   3. Build the tenant database the way tenant provisioning does: schema,
 *      row-level security, audit immutability, performance objects, the
 *      access tables.
 *   4. Seed: system catalogue, demo tenant, properties, users with
 *      SEED_USER_PASSWORD, a tenant-wide Administrator assignment for
 *      admin@hfp.local; the tenant's setup is marked complete.
 *   5. Print the sign-in address.
 *
 * Refuses to run with NODE_ENV=production. There is no development sign-in
 * bypass: the admin is a real user with a real assignment.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient as RegistryClient } from "../db/registry-client.js";
import { passwordPolicyErrors } from "../services/password-policy.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEMO_TENANT_SLUG = "demo-hotels";
const DEMO_ADMIN_EMAIL = "admin@hfp.local";

function fail(message: string): never {
  console.error(`\ndev:setup: ${message}\n`);
  process.exit(1);
}

function required(name: string, purpose: string): string {
  const value = process.env[name];
  if (!value) fail(`${name} is not set. ${purpose} Set it in apps/api/.env.`);
  return value;
}

function databaseName(url: string, variable: string): string {
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    fail(`${variable} is not a valid connection string.`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(name)) {
    fail(`${variable} names the database "${name}"; use letters, digits, _ and - only.`);
  }
  return name;
}

/** Creates the database named in `url` when it does not exist. */
async function ensureDatabase(url: string, variable: string): Promise<void> {
  const name = databaseName(url, variable);
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const client = new RegistryClient({ datasourceUrl: maintenance.toString() });
  try {
    const rows = await client.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS "exists"`;
    if (rows[0]?.exists) {
      console.log(`Database ${name} exists.`);
      return;
    }
    // The name is checked above; identifiers cannot be bound as parameters.
    await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    console.log(`Created database ${name}.`);
  } catch (error) {
    fail(
      `could not check or create database ${name} (${variable}): ` +
        `${error instanceof Error ? error.message : error}\n` +
        `Create it yourself, or give the role CREATEDB.`
    );
  } finally {
    await client.$disconnect();
  }
}

function run(label: string, args: string[], env: Record<string, string>): void {
  console.log(`\n── ${label}`);
  const result = spawnSync("pnpm", args, {
    cwd: apiRoot,
    stdio: "inherit",
    env: { ...process.env, ...env }
  });
  if (result.status !== 0) fail(`${label} failed (exit ${result.status ?? result.signal}).`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    fail("refusing to run with NODE_ENV=production. This command seeds demo data and users.");
  }

  const tenantUrl = required("DATABASE_URL", "It is the demo tenant's database.");
  const registryUrl = required("REGISTRY_DATABASE_URL", "It is the tenant registry database.");
  const password = required("SEED_USER_PASSWORD", "It becomes the demo users' password.");
  const appBaseUrl = required("APP_BASE_URL", "It is the web app's address, for the sign-in link.");

  const problems = passwordPolicyErrors(password);
  if (problems.length > 0) {
    fail(`SEED_USER_PASSWORD does not meet the password rules: ${problems.join("; ")}.`);
  }
  if (
    databaseName(tenantUrl, "DATABASE_URL") === databaseName(registryUrl, "REGISTRY_DATABASE_URL")
  ) {
    fail(
      "DATABASE_URL and REGISTRY_DATABASE_URL name the same database. Building one schema " +
        "would remove the other's tables; use two databases."
    );
  }

  console.log("── Databases");
  await ensureDatabase(registryUrl, "REGISTRY_DATABASE_URL");
  await ensureDatabase(tenantUrl, "DATABASE_URL");

  run(
    "Registry schema",
    [
      "exec",
      "prisma",
      "db",
      "push",
      "--schema",
      "src/db/schema-registry.prisma",
      "--skip-generate"
    ],
    { REGISTRY_DATABASE_URL: registryUrl }
  );
  run("Tenant database", ["run", "db:build:tenant"], { DATABASE_URL: tenantUrl });
  run("Seed", ["exec", "tsx", "src/db/seed.ts"], {
    DATABASE_URL: tenantUrl,
    REGISTRY_DATABASE_URL: registryUrl,
    SEED_USER_PASSWORD: password
  });

  const registry = new RegistryClient({ datasourceUrl: registryUrl });
  const tenant = await registry.tenant
    .findUnique({ where: { slug: DEMO_TENANT_SLUG }, select: { tenantCode: true } })
    .finally(() => registry.$disconnect());
  if (!tenant) fail(`the seed ran but the registry has no ${DEMO_TENANT_SLUG} tenant.`);
  const tenantCode = tenant.tenantCode;
  const signIn = new URL(`/t/${tenantCode}/login`, appBaseUrl).toString();

  console.log(`
── Ready

  Sign in at  ${signIn}
  Email       ${DEMO_ADMIN_EMAIL}
  Password    the value of SEED_USER_PASSWORD
              (a user who already had a password keeps it)

  ${DEMO_ADMIN_EMAIL} holds Administrator for the whole tenant.
  Start the API, the web app and the workers: pnpm dev, and pnpm --filter @hfp/api workers.
`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
