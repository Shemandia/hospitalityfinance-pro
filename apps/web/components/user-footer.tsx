"use client";

import { useAuth } from "./auth-provider";
import { useRouter, useParams } from "next/navigation";
import { LogOut } from "lucide-react";

export function UserFooter() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const code = typeof params.code === "string" ? params.code : "";

  if (!user) return null;

  const initials = (user.email ?? "U")[0].toUpperCase();
  const userName = user.name || user.email?.split("@")[0] || "User";
  const upperRoles = (user.roles ?? []).map((r: string) => r.toUpperCase());
  const userRole =
    upperRoles.includes("TENANT_ADMIN") || upperRoles.includes("SUPERADMIN")
      ? "TENANT_ADMIN"
      : (upperRoles[0] ?? "VIEWER");

  async function handleLogout() {
    await logout();
    router.push(`/t/${code}/login`);
  }

  return (
    <div className="mx-4 mb-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Current User</p>
      <p className="text-sm font-bold text-slate-800 mt-1 truncate">{userName}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="inline-flex items-center rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 border border-emerald-100">
          {userRole}
        </span>
        <button
          type="button"
          onClick={handleLogout}
          title="Sign out"
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
