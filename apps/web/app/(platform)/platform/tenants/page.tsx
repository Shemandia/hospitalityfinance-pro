"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

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
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="w-full max-w-sm space-y-4">
          <h2 className="text-xl font-semibold text-slate-900">Platform Authentication</h2>
          <p className="text-sm text-slate-500">
            Enter your platform API key to access tenant management.
          </p>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleKeySubmit()}
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Platform API key"
          />
          {keyError && <p className="text-sm text-red-500">{keyError}</p>}
          <button
            onClick={handleKeySubmit}
            disabled={!keyInput}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Authenticate
          </button>
        </div>
      </div>
    );
  }

  return <TenantList platformKey={platformKey} />;
}

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

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      ACTIVE: "bg-emerald-100 text-emerald-700",
      PROVISIONING: "bg-blue-100 text-blue-700",
      PENDING: "bg-slate-100 text-slate-600",
      FAILED: "bg-red-100 text-red-700"
    };
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? colors.PENDING}`}
      >
        {status ?? "PENDING"}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Tenants</h1>
        <Link
          href="/platform/tenants/onboard"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Onboard New Tenant
        </Link>
      </div>
      <div className="mt-6 overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Slug</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Admin</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Provisioned</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : tenants.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No tenants yet
                </td>
              </tr>
            ) : (
              tenants.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">{t.slug}</td>
                  <td className="px-4 py-3 text-slate-500">{t.adminEmail}</td>
                  <td className="px-4 py-3">{statusBadge(t.provisioningStatus)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {t.provisionedAt ? new Date(t.provisionedAt).toLocaleDateString("en-US") : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
