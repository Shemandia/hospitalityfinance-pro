"use client";

import { usePathname, useRouter, useParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Returns the tenant code for the current request.
 *
 * Reads from `useParams().code` first (the canonical source inside a
 * `t/[code]` route segment). Falls back to `useParams().tenant` for legacy
 * routes, then to parsing the pathname.
 */
export function useTenantSlugSafe(): string | null {
  const params = useParams();

  // New route: /t/[code]/...
  const fromCode = params?.code;
  if (typeof fromCode === "string" && fromCode.length > 0) return fromCode;

  // Legacy fallback
  const fromTenant = params?.tenant;
  if (typeof fromTenant === "string" && fromTenant.length > 0) return fromTenant;

  // Pathname fallback: extract from /t/{code}/...
  const pathname = usePathname();
  if (!pathname) return null;
  const match = pathname.match(/^\/t\/([a-z0-9]{8})(\/|$)/);
  if (match) return match[1];

  return null;
}

/**
 * Prepends the tenant code to a path using the /t/{code} pattern.
 * If the path is already tenant-prefixed, absolute (http...), or has no
 * tenant context, it is returned unchanged.
 */
export function useTenantHref(): (path: string) => string {
  const code = useTenantSlugSafe();
  return useCallback(
    (path: string) => {
      if (!path.startsWith("/")) return path;
      if (path.startsWith("http")) return path;
      if (!code) return path;
      // Already prefixed with new pattern
      if (path === `/t/${code}` || path.startsWith(`/t/${code}/`)) return path;
      return `/t/${code}${path}`;
    },
    [code]
  );
}

/**
 * Wraps `useRouter()` so push/replace automatically include the tenant code
 * for tenant-relative paths.
 */
export function useTenantRouter() {
  const router = useRouter();
  const href = useTenantHref();
  return {
    push: (path: string) => router.push(href(path)),
    replace: (path: string) => router.replace(href(path)),
    back: () => router.back(),
    forward: () => router.forward(),
    refresh: () => router.refresh()
  };
}
