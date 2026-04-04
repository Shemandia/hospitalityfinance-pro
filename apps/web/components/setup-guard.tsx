"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function SetupGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || !session) return;

    const token = (session as any).accessToken ?? "";
    const tenantSlug = (session as any).user?.tenantSlug ?? "";

    // Skip check if no tenant context (e.g., platform admin)
    if (!tenantSlug) {
      setChecked(true);
      return;
    }

    fetch(`${API_BASE}/api/v1/setup/progress`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Tenant-Slug": tenantSlug
      }
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.data && !json.data.isCompleted) {
          router.replace(`/setup?step=${json.data.currentStep}`);
        } else {
          setChecked(true);
        }
      })
      .catch(() => {
        // If check fails, allow access (don't block on network errors)
        setChecked(true);
      });
  }, [session, status, router]);

  if (!checked) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-slate-400">Loading...</p>
      </div>
    );
  }

  return <>{children}</>;
}
