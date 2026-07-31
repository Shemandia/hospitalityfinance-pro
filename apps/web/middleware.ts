import { NextResponse, type NextRequest } from "next/server";

const TENANT_CODE_RE = /^[a-z0-9]{8}$/;
const isDev = process.env.NODE_ENV === "development";
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

function withCSP(response: NextResponse): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const csp = [
    "default-src 'self'",
    isDev
      ? `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${apiBaseUrl}${isDev ? " ws://localhost:3001" : ""}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; ");

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-nonce", nonce);

  return response;
}

export function middleware(request: NextRequest) {
  const { pathname, origin } = request.nextUrl;

  // Allow static assets, API routes, and special pages
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/api/")
  ) {
    return withCSP(NextResponse.next());
  }

  // Root page and static app routes
  if (pathname === "/" || pathname === "/tenant-not-found") {
    return withCSP(NextResponse.next());
  }

  // Platform admin routes
  if (pathname.startsWith("/platform")) {
    return withCSP(NextResponse.next());
  }

  // Extract tenant code from /t/{code}/... pattern
  const match = pathname.match(/^\/t\/([a-z0-9]{8})(\/|$)/);
  if (!match) {
    return withCSP(NextResponse.next());
  }

  const tenantCode = match[1];
  const subPath = pathname.slice(`/t/${tenantCode}`.length) || "/";

  // Public tenant routes (no auth needed)
  const publicPaths = ["/login", "/forgot-password", "/reset-password", "/change-password"];
  if (publicPaths.some((p) => subPath === p || subPath.startsWith(p + "?"))) {
    return withCSP(NextResponse.next());
  }

  // Check for access token cookie
  const accessToken = request.cookies.get("hfp_access_token");
  if (!accessToken) {
    const loginUrl = new URL(`/t/${tenantCode}/login`, origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated users on login page -> redirect to dashboard
  if (subPath === "/login") {
    return NextResponse.redirect(new URL(`/t/${tenantCode}/dashboard`, origin));
  }

  return withCSP(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
