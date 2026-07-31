import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";
const COOKIE_NAME = "hfp_platform_key";
// The backend's CSRF hook requires an allowed Origin on every mutating
// request. Server-to-server fetches send none by default, so this proxy must
// identify itself as the web app explicitly.
const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

/**
 * POST /api/platform/provision — proxy tenant provisioning using httpOnly cookie.
 * The platform key is read from the server-side cookie, never from the client.
 * Streams the response body through for SSE-style progress updates.
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const key = cookieStore.get(COOKIE_NAME)?.value;
  if (!key) {
    return NextResponse.json({ data: null, error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ data: null, error: "Invalid request body." }, { status: 400 });
  }

  try {
    const res = await fetch(`${API_BASE}/api/v1/platform/tenants/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Platform-Key": key,
        Origin: APP_ORIGIN
      },
      body: JSON.stringify(body)
    });

    if (!res.ok || !res.body) {
      const json = await res
        .json()
        .catch(() => ({ errors: [{ message: `Server error: ${res.status}` }] }));
      return NextResponse.json(json, { status: res.status });
    }

    // Stream the response body through to the client
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
        "Transfer-Encoding": "chunked"
      }
    });
  } catch {
    return NextResponse.json({ data: null, error: "Cannot reach API server." }, { status: 502 });
  }
}
