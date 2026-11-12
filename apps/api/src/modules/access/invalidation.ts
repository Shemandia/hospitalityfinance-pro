/**
 * Applying a change that alters who can do what.
 *
 * The cache is invalidated on both sides of the write:
 *
 *  - before, so that a cache that cannot be reached stops the change instead of
 *    leaving a stale grant behind once it comes back (fail closed);
 *  - after, because a request running during the write may have read the old
 *    rows and cached them under the fresh key.
 *
 * `scope` says whose access the change can alter: named users (their grants or
 * active flag changed) or the whole tenant (a role, a role's permissions or
 * the entity tree changed).
 */

import { getAccessService } from "./runtime.js";

export type AccessChangeScope = { users: readonly string[] } | "tenant";

async function invalidate(tenantId: string, scope: AccessChangeScope): Promise<void> {
  const service = getAccessService();
  if (scope === "tenant") {
    await service.invalidateTenant(tenantId);
    return;
  }
  for (const userId of new Set(scope.users)) {
    await service.invalidateUser({ tenantId, userId });
  }
}

export async function changeAccess<T>(
  tenantId: string,
  scope: AccessChangeScope,
  write: () => Promise<T>
): Promise<T> {
  await invalidate(tenantId, scope);
  const result = await write();
  await invalidate(tenantId, scope);
  return result;
}
