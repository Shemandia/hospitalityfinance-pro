import { NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";
const PLATFORM_KEY = process.env.HFP_PLATFORM_KEY;

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (!PLATFORM_KEY) {
    return NextResponse.json({ data: null, error: "Platform key not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${API_BASE}/api/v1/platform/tenants/${slug}`, {
      headers: { "X-Platform-Key": PLATFORM_KEY },
      next: { revalidate: 60 }
    });

    if (!res.ok) {
      return NextResponse.json({ data: null, error: "Tenant not found" }, { status: 404 });
    }

    const json = await res.json();
    const t = json.data;
    return NextResponse.json({
      data: { id: t.id, slug: t.slug, name: t.name }
    });
  } catch {
    return NextResponse.json({ data: null, error: "Service unavailable" }, { status: 502 });
  }
}
