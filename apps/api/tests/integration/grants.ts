import type { PrismaClient } from "../../src/db/client.js";

const TRANSIENT = /tuple concurrently updated/;

/**
 * Runs GRANT/REVOKE (and role) statements one test file at a time. CI runs
 * the integration files in parallel, and PostgreSQL refuses two updates of
 * the same catalog row at once ("tuple concurrently updated"): grants on the
 * same tables or the shared test database. Every file that grants to a test
 * role takes this lock first; the lock and the statements share one
 * transaction. A conflict with an update outside the lock is retried: the
 * statements are safe to repeat.
 */
export async function underGrantLock(db: PrismaClient, statements: string[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(hashtext('hfp:integration-test-grants'))`
          );
          for (const sql of statements) await tx.$executeRawUnsafe(sql);
        },
        { maxWait: 60_000, timeout: 120_000 }
      );
      return;
    } catch (error) {
      if (attempt >= 8 || !TRANSIENT.test(String((error as Error)?.message))) throw error;
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
}

/** Revokes and drops a test login role, if it was created. */
export async function dropTestRole(
  db: PrismaClient,
  role: string,
  statements: string[]
): Promise<void> {
  const found = await db.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM pg_roles WHERE rolname = '${role}'`
  );
  if (found.length > 0) await underGrantLock(db, statements);
}
