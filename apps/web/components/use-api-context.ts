"use client";

import type { ApiContext } from "../lib/gl-api";
import { useEntity } from "./entity-provider";
import { useTenantSlug } from "../hooks/use-tenant-slug";
import { useSession } from "./auth-provider";

export function useApiContext(): ApiContext | null {
  const { data: session } = useSession();
  const { entityId } = useEntity();
  const accessToken = session?.accessToken;
  const urlTenantSlug = useTenantSlug();
  // The session's slug is authoritative — the /t/[code] URL segment is the
  // tenant CODE, not the slug, and must not be sent as X-Tenant-Slug.
  const tenantSlug = session?.user?.tenantSlug ?? urlTenantSlug ?? undefined;

  if (!accessToken || !entityId) {
    return null;
  }

  return { accessToken, entityId, tenantSlug, tenantCode: session?.user?.tenantCode };
}
