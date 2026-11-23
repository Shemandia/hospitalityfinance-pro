/**
 * The tenant's system user (HC-38).
 *
 * Work no person did (a scheduled import, an automation) is recorded as this
 * user, never as a "system" string or an entity id (IMP-01, which broke the
 * created_by foreign key). Each tenant database has exactly one, created by
 * the tenant migration 1_system_user_and_view_refresh; it is inactive, has no
 * password and cannot sign in.
 */

import { prisma } from "../../db/prisma.js";
import { getRequestContext } from "../../db/requestContext.js";

const ids = new Map<string, string>();

/** The bound tenant's system user id. Cached per tenant. */
export async function systemUserId(): Promise<string> {
  const { tenantSlug } = getRequestContext();
  const cached = tenantSlug ? ids.get(tenantSlug) : undefined;
  if (cached) return cached;
  const row = await prisma.user.findFirst({ where: { isSystem: true }, select: { id: true } });
  if (!row) {
    throw new Error(
      "This tenant database has no system user; apply the tenant migrations (1_system_user_and_view_refresh)."
    );
  }
  if (tenantSlug) ids.set(tenantSlug, row.id);
  return row.id;
}

/** The user doing the current work: the request's or job's, else the system user. */
export async function actingUserId(): Promise<string> {
  return getRequestContext().userId ?? (await systemUserId());
}

/** The signed-in user's id. Throws on a route that is reached without one. */
export function signedInUserId(request: { user?: unknown }): string {
  const user = request.user as { id?: string; sub?: string } | undefined;
  const id = user?.id ?? user?.sub;
  if (!id) throw Object.assign(new Error("Sign-in required."), { statusCode: 401 });
  return id;
}
