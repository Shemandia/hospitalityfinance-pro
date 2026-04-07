import { NextResponse } from "next/server";
import { auth } from "./auth";

/** Tenant slug regex — must match the provisioning validation */
const TENANT_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";
const PLATFORM_KEY = process.env.HFP_PLATFORM_KEY;

/** In-memory cache: slug -> { valid: boolean, expiresAt: number } */
const tenantCache = new Map<string, { valid: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

async function isTenantValid(slug: string): Promise<boolean> {
  // Check cache first
  const cached = tenantCache.get(slug);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.valid;
  }

  if (!PLATFORM_KEY) {
    // Without platform key, can't validate — allow through
    return true;
  }

  try {
    const res = await fetch(`${API_BASE}/api/v1/platform/tenants/${slug}`, {
      headers: { "X-Platform-Key": PLATFORM_KEY }
    });

    const valid = res.ok;
    tenantCache.set(slug, { valid, expiresAt: Date.now() + CACHE_TTL_MS });
    return valid;
  } catch {
    // If API unreachable, allow through — downstream checks will handle it
    return true;
  }
}

export default auth(async (request) => {
  const { pathname, origin } = request.nextUrl;

  // Let asset, auth API, and tenant API routes pass through
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/tenants")
  ) {
    return NextResponse.next();
  }

  // Platform admin routes — no tenant prefix needed
  if (pathname.startsWith("/platform")) {
    return NextResponse.next();
  }

  // Root page and static app routes
  if (pathname === "/" || pathname === "/tenant-not-found") {
    return NextResponse.next();
  }

  // Extract tenant slug from first path segment: /essque-hotels/dashboard -> essque-hotels
  const segments = pathname.split("/").filter(Boolean);
  const tenantSlug = segments[0];

  // If first segment doesn't look like a tenant slug, pass through (will 404 naturally)
  if (!tenantSlug || !TENANT_SLUG_RE.test(tenantSlug)) {
    return NextResponse.next();
  }

  // Validate tenant exists in registry before any auth redirect
  const valid = await isTenantValid(tenantSlug);
  if (!valid) {
    return NextResponse.redirect(new URL("/tenant-not-found", origin));
  }

  // Determine the sub-path after the tenant slug
  const subPath = "/" + segments.slice(1).join("/");
  const isLoginPage = subPath === "/login";

  // Unauthenticated users can only access the login page
  if (!request.auth && !isLoginPage) {
    const loginUrl = new URL(`/${tenantSlug}/login`, origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated users on login page -> redirect to dashboard
  if (request.auth && isLoginPage) {
    return NextResponse.redirect(new URL(`/${tenantSlug}/dashboard`, origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"]
};
