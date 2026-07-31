"use client";

import { useParams } from "next/navigation";

/**
 * Extracts the tenant code from the [code] URL segment.
 * Returns the code string, or null if not in a tenant route.
 */
export function useTenantSlug(): string | null {
  const params = useParams();
  // New route: /t/[code]/...
  const code = params?.code;
  if (typeof code === "string") return code;
  // Legacy fallback
  const tenant = params?.tenant;
  if (typeof tenant === "string") return tenant;
  return null;
}
