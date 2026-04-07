import { notFound } from "next/navigation";
import type { ReactNode } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";
const PLATFORM_KEY = process.env.HFP_PLATFORM_KEY;

/**
 * Validates the tenant slug against the registry on every request.
 * If the tenant doesn't exist or is inactive, renders a 404.
 * This runs server-side for ALL routes under /[tenant]/*.
 */
export default async function TenantLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;

  // Validate tenant exists in the registry
  const isValid = await validateTenant(tenant);
  if (!isValid) {
    notFound();
  }

  return <>{children}</>;
}

async function validateTenant(slug: string): Promise<boolean> {
  // Quick format check before hitting the API
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
    return false;
  }

  if (!PLATFORM_KEY) {
    // Without platform key, can't validate — allow through
    // (dev environments without key configured)
    return true;
  }

  try {
    const res = await fetch(`${API_BASE}/api/v1/platform/tenants/${slug}`, {
      headers: { "X-Platform-Key": PLATFORM_KEY },
      next: { revalidate: 60 } // Cache for 60s to avoid hammering the API
    });

    if (!res.ok) return false;

    const json = await res.json();
    return json.data?.isActive !== false;
  } catch {
    // If API is unreachable, allow through to avoid blocking all tenant routes
    // The downstream auth/setup checks will catch unauthorized access
    return true;
  }
}
