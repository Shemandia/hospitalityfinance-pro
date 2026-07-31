/**
 * RLS Bypass Helper
 *
 * Provides a safe, transaction-scoped way to bypass Row-Level Security
 * for admin/auth operations that need cross-entity reads.
 *
 * Instead of ALTER TABLE DISABLE/ENABLE RLS (which is a global DDL change
 * visible to all concurrent connections), this sets a transaction-local
 * session variable that RLS policies check: app.bypass_rls = 'true'.
 *
 * The bypass automatically reverts when the transaction ends — no cleanup needed,
 * no race condition possible.
 */

/**
 * Execute `fn` inside a transaction with RLS bypassed.
 *
 * Uses `set_config('app.bypass_rls', 'true', true)` — the third argument
 * makes it transaction-local, so the bypass is automatically reverted
 * when the transaction commits or rolls back.
 */
export async function withBypassRLS<T>(prisma: any, fn: (tx: any) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe("SELECT set_config('app.bypass_rls', 'true', true)");
    return fn(tx);
  });
}
