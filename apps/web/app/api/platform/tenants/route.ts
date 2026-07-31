import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";
const COOKIE_NAME = "hfp_platform_key";

/**
 * GET /api/platform/tenants — proxy tenant list using httpOnly cookie.
 * The platform key is read from the server-side cookie, never from the client.
 */
export async function GET() {
  const cookieStore = await cookies();
  const key = cookieStore.get(COOKIE_NAME)?.value;
  if (!key) {
    return NextResponse.json({ data: null, error: "Not authenticated." }, { status: 401 });
  }

  try {
    const res = await fetch(`${API_BASE}/api/v1/platform/tenants`, {
      headers: { "X-Platform-Key": key }
    });
    if (!res.ok) {
      return NextResponse.json({ data: null, error: "Backend error." }, { status: res.status });
    }
    const json = await res.json();
    return NextResponse.json(json);
  } catch {
    return NextResponse.json({ data: null, error: "Cannot reach API server." }, { status: 502 });
  }
}
