"use client";

import { usePathname, useRouter, useParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Returns the tenant slug for the current request.
 *
 * Reads from `useParams().tenant` first (the canonical source inside a
 * `[tenant]` route segment). Falls back to parsing the first segment of
 * `usePathname()` so callers still work in client components that mount
 * before the params hook has resolved.
 */
export function useTenantSlugSafe(): string | null {
  const params = useParams();
  const fromParams = params?.tenant;
  if (typeof fromParams === "string" && fromParams.length > 0) return fromParams;

  const pathname = usePathname();
  if (!pathname) return null;
  const first = pathname.split("/")[1] ?? "";
  // Skip platform/admin routes that aren't tenant-scoped
  if (!first || first === "platform" || first === "tenant-not-found") return null;
  return first;
}

/**
 * Prepends the tenant slug to a path. If the path is already tenant-prefixed
 * or absolute (http…) or has no tenant context, it is returned unchanged.
 */
export function useTenantHref(): (path: string) => string {
  const tenant = useTenantSlugSafe();
  return useCallback(
    (path: string) => {
      if (!path.startsWith("/")) return path;
      if (path.startsWith("http")) return path;
      if (!tenant) return path;
      // Already prefixed (e.g. caller passed `/${tenant}/foo`)
      if (path === `/${tenant}` || path.startsWith(`/${tenant}/`)) return path;
      return `/${tenant}${path}`;
    },
    [tenant]
  );
}

/**
 * Wraps `useRouter()` so push/replace automatically include the tenant slug
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
