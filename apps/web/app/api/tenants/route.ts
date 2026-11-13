import { NextResponse } from "next/server";
import { apiInternalUrl } from "../../../lib/server/api-proxy";

const PLATFORM_KEY = process.env.HFP_PLATFORM_KEY;

export async function GET() {
  if (!PLATFORM_KEY) {
    return NextResponse.json({ data: [] }, { status: 503 });
  }
  try {
    const res = await fetch(`${apiInternalUrl()}/api/v1/platform/tenants`, {
      headers: { "X-Platform-Key": PLATFORM_KEY },
      next: { revalidate: 60 }
    });

    if (!res.ok) {
      return NextResponse.json({ data: [] }, { status: res.status });
    }

    const json = await res.json();
    const tenants = (json.data ?? []).map((t: { id: string; slug: string; name: string }) => ({
      id: t.id,
      slug: t.slug,
      name: t.name
    }));

    return NextResponse.json({ data: tenants });
  } catch {
    return NextResponse.json({ data: [] }, { status: 502 });
  }
}
