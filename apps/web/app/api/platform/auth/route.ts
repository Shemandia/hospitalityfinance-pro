import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  isPlatformLoginConfigured,
  verifyPlatformCredentials
} from "../../../../lib/platform-auth";

const COOKIE_NAME = "hfp_platform_key";
const COOKIE_MAX_AGE = 60 * 60 * 4; // 4 hours
const FAILED_LOGIN_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST /api/platform/auth — operator sign-in with username/password.
 *
 * Credentials are verified against PLATFORM_ADMIN_USERNAME /
 * PLATFORM_ADMIN_PASSWORD_HASH (scrypt) on this server. On success the
 * platform machine key (HFP_PLATFORM_KEY) is stored in an httpOnly cookie so
 * downstream proxy routes can attach X-Platform-Key — the operator never sees
 * or handles the raw key.
 */
export async function POST(request: NextRequest) {
  if (!isPlatformLoginConfigured() || !process.env.HFP_PLATFORM_KEY) {
    return NextResponse.json(
      {
        error:
          "Platform login is not configured. Set PLATFORM_ADMIN_USERNAME, PLATFORM_ADMIN_PASSWORD_HASH and HFP_PLATFORM_KEY on the web server."
      },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!verifyPlatformCredentials(username, password)) {
    await sleep(FAILED_LOGIN_DELAY_MS);
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  // Set httpOnly cookie — never exposed to client JS
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, process.env.HFP_PLATFORM_KEY, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/platform/auth — clear the platform session cookie.
 */
export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  return NextResponse.json({ ok: true });
}

/**
 * GET /api/platform/auth — check if the platform session cookie is set.
 */
export async function GET() {
  const cookieStore = await cookies();
  const has = cookieStore.has(COOKIE_NAME);
  return NextResponse.json({ authenticated: has });
}
