import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiInternalUrl } from "../../../../lib/server/api-proxy";

const COOKIE_NAME = "hfp_platform_key";

/**
 * GET /api/platform/plans — the plans a new tenant can be given, with their
 * limits (registry table plans). The platform key stays in the server-side
 * cookie.
 */
export async function GET() {
  const cookieStore = await cookies();
  const key = cookieStore.get(COOKIE_NAME)?.value;
  if (!key) {
    return NextResponse.json({ data: null, error: "Not authenticated." }, { status: 401 });
  }
  try {
    const res = await fetch(`${apiInternalUrl()}/api/v1/platform/plans`, {
      headers: { "X-Platform-Key": key },
      cache: "no-store"
    });
    const json = await res
      .json()
      .catch(() => ({ data: null, errors: [{ message: `Server error: ${res.status}` }] }));
    return NextResponse.json(json, { status: res.status });
  } catch {
    return NextResponse.json({ data: null, error: "Cannot reach API server." }, { status: 502 });
  }
}
