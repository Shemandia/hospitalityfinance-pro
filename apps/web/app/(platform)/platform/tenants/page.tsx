"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Plus, ArrowRight, ExternalLink, Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  adminEmail: string;
  provisioningStatus: string;
  isActive: boolean;
  provisionedAt: string | null;
  createdAt: string;
};

export default function TenantListPage() {
  const [platformKey, setPlatformKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const stored = sessionStorage.getItem("hfp-platform-key");
    if (stored) setPlatformKey(stored);
    setChecking(false);
  }, []);

  const handleKeySubmit = async () => {
    setKeyError("");
    try {
      const res = await fetch(`${API_BASE}/api/v1/platform/tenants`, {
        headers: { "X-Platform-Key": keyInput }
      });
      if (res.ok) {
        sessionStorage.setItem("hfp-platform-key", keyInput);
        setPlatformKey(keyInput);
      } else {
        setKeyError("Invalid platform key.");
      }
    } catch {
      setKeyError("Cannot reach API server.");
    }
  };

  if (checking) return null;

  if (!platformKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc]">
        <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_10px_30px_rgba(0,0,0,0.03)]">
          <div className="mb-6">
            <h2 className="text-xl font-extrabold text-slate-900">Platform Authentication</h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Enter your platform API key to access tenant management.
            </p>
          </div>

          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleKeySubmit()}
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            placeholder="Platform API key"
          />

          {keyError && <p className="mt-2 text-sm text-red-500">{keyError}</p>}

          <button
            onClick={handleKeySubmit}
            disabled={!keyInput}
            className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white shadow-[0_4px_12px_rgba(16,185,129,0.25)] transition-colors hover:bg-emerald-600 disabled:opacity-50"
          >
            Authenticate
          </button>
        </div>
      </div>
    );
  }

  return <TenantList platformKey={platformKey} />;
}

/* -------------------------------------------------------------------------- */

function TenantList({ platformKey }: { platformKey: string }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/platform/tenants`, {
      headers: { "X-Platform-Key": platformKey }
    })
      .then((r) => r.json())
      .then((json) => setTenants(json.data ?? []))
      .finally(() => setLoading(false));
  }, [platformKey]);

  /* ---- Status badge ---- */
  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      ACTIVE: "bg-emerald-50 text-emerald-700 border border-emerald-100",
      PROVISIONING: "bg-blue-50 text-blue-700 border border-blue-100",
      PENDING: "bg-slate-100 text-slate-600 border border-slate-200",
      FAILED: "bg-red-50 text-red-700 border border-red-100"
    };
    const label = status ?? "PENDING";
    return (
      <span
        className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${styles[label] ?? styles.PENDING}`}
      >
        {label}
      </span>
    );
  };

  /* ---- Initials helper ---- */
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();

  /* ---- Skeleton cards (loading state) ---- */
  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8fafc]">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="flex items-center justify-between">
            <div className="h-9 w-36 animate-pulse rounded-xl bg-slate-200" />
            <div className="h-12 w-52 animate-pulse rounded-2xl bg-slate-200" />
          </div>
          <div className="mt-8 space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.03)]"
              >
                <div className="h-11 w-11 animate-pulse rounded-xl bg-slate-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
                  <div className="h-3 w-56 animate-pulse rounded bg-slate-100" />
                </div>
                <div className="h-6 w-20 animate-pulse rounded-full bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ---- Empty state ---- */
  if (tenants.length === 0) {
    return (
      <div className="min-h-screen bg-[#f8fafc]">
        <div className="mx-auto max-w-5xl px-6 py-10">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-[32px] font-extrabold leading-tight text-slate-900">Tenants</h1>
          </div>

          {/* Empty card */}
          <div className="mt-16 flex flex-col items-center rounded-3xl border border-slate-200 bg-white px-8 py-16 shadow-[0_10px_30px_rgba(0,0,0,0.03)]">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
              <Building2 className="h-8 w-8 text-slate-400" />
            </div>
            <h2 className="mt-5 text-lg font-extrabold text-slate-900">No tenants yet</h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Onboard your first tenant to get started.
            </p>
            <Link
              href="/platform/tenants/onboard"
              className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-6 py-3 text-sm font-bold text-white shadow-[0_4px_12px_rgba(15,23,42,0.2)] transition-colors hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Onboard New Tenant
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ---- Tenant list ---- */
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-[32px] font-extrabold leading-tight text-slate-900">Tenants</h1>
          <Link
            href="/platform/tenants/onboard"
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-6 py-3 text-sm font-bold text-white shadow-[0_4px_12px_rgba(15,23,42,0.2)] transition-colors hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Onboard New Tenant
          </Link>
        </div>

        {/* Cards */}
        <div className="mt-8 space-y-4">
          {tenants.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_10px_40px_rgba(0,0,0,0.06)]"
            >
              {/* Avatar */}
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-sm font-extrabold text-emerald-500">
                {initials(t.name)}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-lg font-bold text-slate-900">{t.name}</span>
                  <span className="inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    {t.slug}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-slate-400">{t.adminEmail}</p>
              </div>

              {/* Status + Actions */}
              <div className="flex shrink-0 items-center gap-3">
                {statusBadge(t.provisioningStatus)}

                {t.provisioningStatus === "ACTIVE" && (
                  <>
                    <Link
                      href={`/login?tenant=${t.slug}`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      Setup Wizard
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                    <a
                      href={`/login?tenant=${t.slug}`}
                      className="inline-flex items-center gap-1 text-sm font-bold text-emerald-500 transition-colors hover:text-emerald-600"
                    >
                      Login
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
