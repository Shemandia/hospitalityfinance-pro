/**
 * RLS bypass — the one way to read or write across entities (AUT-14).
 *
 * `fn` runs inside a single transaction in which `app.bypass_rls` is set, so
 * the row-level security policies let every row of the tenant through. The
 * setting is transaction-local: it ends with the transaction and is never
 * visible to another connection.
 *
 * Every query made through `tx` stays on that transaction. Without the
 * `rlsBypass` flag the tenant clients would undo the bypass: the RLS
 * middleware re-runs model queries on RLS tables in a second transaction
 * scoped to the request's entity (losing both the bypass and atomicity), and
 * the entity-scope extension adds an entity filter to the query. The flag is
 * set on a copy of the request context that only `fn` and what it awaits can
 * see, so queries made elsewhere in the same request are scoped as usual.
 *
 * Callers must have authorised the cross-entity access themselves, and must
 * give an explicit entityId on every row they create.
 */

import { getRequestContext, runWithContext } from "./requestContext.js";

// The API passes plain, extended and proxied clients here; their $transaction
// signatures do not share a usable common type.
export async function withBypassRLS<T>(prisma: any, fn: (tx: any) => Promise<T>): Promise<T> {
  // Awaited inside the scope: a Prisma promise only starts when it is awaited,
  // and it must start while the flag is visible.
  return runWithContext({ ...getRequestContext(), rlsBypass: true }, async () => {
    return await prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
      return fn(tx);
    });
  });
}
