"use client";

import { useEffect, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "./auth-provider";

/**
 * Decides, before any of the dashboard is drawn, whether the user may see it.
 *
 * The decision uses the access context the app loads once at sign-in
 * (GET /api/v1/context): no extra request, and nothing of the dashboard
 * flashes on screen while it is made.
 *
 *   loading          a loader, nothing else
 *   signed out       to the sign-in page
 *   unavailable      a message and a retry; never the dashboard
 *   setup unfinished to the setup wizard, at the step it stopped
 *   otherwise        the dashboard
 */
export function SetupGuard({ children }: { children: ReactNode }) {
  const { status, context, error, reloadContext } = useAuth();
  const router = useRouter();
  const params = useParams();
  const code = typeof params?.code === "string" ? params.code : "";

  const setupPending = status === "authenticated" && context !== null && !context.setup.isCompleted;

  useEffect(() => {
    if (!code) return;
    if (status === "unauthenticated") {
      router.replace(`/t/${code}/login`);
    } else if (setupPending && context) {
      router.replace(`/t/${code}/setup?step=${context.setup.currentStep}`);
    }
  }, [code, status, setupPending, context, router]);

  if (status === "unavailable") {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-8">
        <div className="max-w-md rounded-lg border border-amber-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-slate-700">{error ?? "Your access could not be loaded."}</p>
          <button
            type="button"
            onClick={() => void reloadContext()}
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (status !== "authenticated" || setupPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          <p className="text-sm font-medium text-slate-400">
            {setupPending ? "Opening the setup wizard..." : "Loading..."}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
