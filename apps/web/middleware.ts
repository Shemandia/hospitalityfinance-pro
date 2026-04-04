import { NextResponse } from "next/server";
import { auth } from "./auth";

const PUBLIC_PATHS = new Set(["/login"]);

export default auth((request) => {
  const { pathname, origin } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.has(pathname);
  const isAuthRoute = pathname.startsWith("/api/auth") || pathname === "/api/tenants";
  const isPlatformRoute = pathname.startsWith("/platform");
  const isAssetPath =
    pathname.startsWith("/_next") || pathname === "/favicon.ico" || pathname.startsWith("/images");

  if (isAuthRoute || isAssetPath || isPlatformRoute) {
    return NextResponse.next();
  }

  if (!request.auth && !isPublic) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (request.auth && isPublic) {
    return NextResponse.redirect(new URL("/", origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"]
};
