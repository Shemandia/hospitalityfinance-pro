import { notFound } from "next/navigation";
import type { ReactNode } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

export default async function TenantLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const isValid = await validateTenantCode(code);
  if (!isValid) {
    notFound();
  }

  return <>{children}</>;
}

async function validateTenantCode(code: string): Promise<boolean> {
  if (!/^[a-z0-9]{8}$/.test(code)) {
    return false;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/tenant/${code}`, {
      next: { revalidate: 60 }
    });
    return res.ok;
  } catch {
    return true; // Allow through if API unreachable
  }
}
