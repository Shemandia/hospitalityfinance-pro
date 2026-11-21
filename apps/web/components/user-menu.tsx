"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { useAuth } from "./auth-provider";

/** The signed-in user's menu in the top bar: name, organisation, profile, sign out. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const code = typeof params.code === "string" ? params.code : "";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const name = user.name || user.email.split("@")[0] || "User";
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "U";

  async function signOut() {
    setOpen(false);
    await logout();
    router.push(`/t/${code}/login`);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${name}`}
        className="flex items-center gap-2 rounded-xl p-1 lg:pr-2.5 border border-transparent hover:bg-slate-50 hover:border-slate-200 transition-colors"
      >
        <span className="h-8 w-8 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center justify-center">
          {initials}
        </span>
        <span className="hidden lg:flex flex-col items-start leading-tight max-w-[10rem]">
          <span className="text-sm font-semibold text-slate-800 truncate max-w-full">{name}</span>
          <span className="text-[11px] text-slate-400 truncate max-w-full">{user.tenantName}</span>
        </span>
        <ChevronDown className="hidden lg:block h-3.5 w-3.5 text-slate-400" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded-xl bg-white border border-slate-200 shadow-xl shadow-slate-200/50 p-1.5"
        >
          <div className="px-3 py-2.5">
            <p className="text-sm font-semibold text-slate-800 truncate">{name}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 truncate">
              {user.tenantName}
            </p>
          </div>
          <div className="my-1 h-px bg-slate-100" />
          <Link
            role="menuitem"
            href={`/t/${code}/settings/profile`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50"
          >
            <UserRound className="h-4 w-4 text-slate-400" aria-hidden />
            Profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="h-4 w-4 text-slate-400" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
