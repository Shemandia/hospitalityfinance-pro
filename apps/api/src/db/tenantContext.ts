import { Prisma, PrismaClient } from "./client.js";
import { getRequestContext } from "./requestContext.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Set the RLS entity context on a database connection.
 * Also increments `_rlsDepth` so the RLS middleware knows not to re-wrap.
 *
 * If you call this manually inside a $transaction, you MUST call
 * `clearEntityDbContext()` in a finally block when the transaction ends.
 */
export async function setEntityDbContext(db: DbClient, entityId: string): Promise<void> {
  if (!("$executeRaw" in db) || typeof db.$executeRaw !== "function") {
    return;
  }
  await db.$executeRaw`SELECT set_config('app.current_entity_id', ${entityId}, true)`;
  const ctx = getRequestContext();
  ctx._rlsDepth++;
}

/**
 * Decrement the RLS depth counter after a manually-managed transaction ends.
 * Must be called in a finally block paired with `setEntityDbContext`.
 */
export function clearEntityDbContext(): void {
  const ctx = getRequestContext();
  ctx._rlsDepth = Math.max(0, ctx._rlsDepth - 1);
}

/**
 * Execute a callback inside an interactive transaction with RLS context set.
 * This is the preferred API for any code that needs entity-scoped DB access
 * within an explicit transaction.
 *
 * Usage:
 *   const result = await withEntityRLS(prisma, entityId, async (tx) => {
 *     return tx.account.create({ data: { ... } });
 *   });
 */
export async function withEntityRLS<T>(
  db: PrismaClient,
  entityId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeout?: number }
): Promise<T> {
  const ctx = getRequestContext();
  ctx._rlsDepth++;
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_entity_id', ${entityId}, true)`;
        return fn(tx);
      },
      { timeout: options?.timeout ?? 30000 }
    );
  } finally {
    ctx._rlsDepth = Math.max(0, ctx._rlsDepth - 1);
  }
}

// `withRLSBypassed` was deleted in QW3 (2026-04-07).
//
// The helper used `ALTER TABLE … DISABLE ROW LEVEL SECURITY` inside a
// transaction to bypass RLS on a list of tables. Two problems:
//   1. ALTER TABLE is DDL and mutates global table state for the whole DB,
//      not just the current transaction. Every concurrent request on every
//      other connection sees RLS disabled until the re-enable runs. This
//      is documented as CRIT-1 in `docs/superpowers/specs/finalv1 findings.md`.
//   2. It had zero callers in the live codebase — the comment in
//      `apps/api/src/modules/gl/router.ts:238` claiming COA import used it
//      was stale; COA import actually uses `withEntityRLS`.
//
// If you ever need to bypass RLS for a bulk operation, use
// `SET LOCAL row_security = off` inside a transaction (transaction-local,
// per-connection, automatically reverts on COMMIT/ROLLBACK), or grant the
// API role `BYPASSRLS` and switch role per-tx.
