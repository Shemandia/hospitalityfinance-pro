import { NextResponse } from "next/server";
import { webConfig } from "../../../lib/server/config";
import { apiInternalUrl } from "../../../lib/server/api-proxy";

export async function GET() {
  const PLATFORM_KEY = webConfig().HFP_PLATFORM_KEY;
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
