"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useTenantSlug } from "../hooks/use-tenant-slug";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

export function SetupGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const tenantSlug = useTenantSlug();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || !session) return;

    const token = (session as any).accessToken ?? "";
    // Prefer tenant slug from URL, fall back to session
    const slug = tenantSlug ?? (session as any).user?.tenantSlug ?? "";

    // Skip check if no tenant context (e.g., platform admin)
    if (!slug) {
      setChecked(true);
      return;
    }

    fetch(`${API_BASE}/api/v1/setup/progress`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Tenant-Slug": slug
      }
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.data && !json.data.isCompleted) {
          router.replace(`/${slug}/setup?step=${json.data.currentStep}`);
        } else {
          setChecked(true);
        }
      })
      .catch(() => {
        // If check fails, allow access (don't block on network errors)
        setChecked(true);
      });
  }, [session, status, router, tenantSlug]);

  if (!checked) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          <p className="text-sm font-medium text-slate-400">Checking setup status...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
