"use client";

import { useParams } from "next/navigation";

/**
 * Extracts the tenant slug from the [tenant] URL segment.
 * Returns the slug string, or null if not in a tenant route.
 */
export function useTenantSlug(): string | null {
  const params = useParams();
  const tenant = params?.tenant;
  if (typeof tenant === "string") return tenant;
  return null;
}
