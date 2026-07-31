"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, Plus, LogOut, type LucideIcon } from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: "Tenant Management",
    items: [
      { href: "/platform/tenants", label: "Tenant Directory", icon: Building2, exact: true },
      { href: "/platform/tenants/onboard", label: "Onboard New Tenant", icon: Plus }
    ]
  }
];

export function PlatformSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (item: NavItem) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(item.href + "/");

  const handleSignOut = async () => {
    try {
      await fetch("/api/platform/auth", { method: "DELETE" });
    } finally {
      router.push("/platform/tenants");
      router.refresh();
      // The page-level gates re-check the session cookie on mount.
      window.location.reload();
    }
  };

  return (
    <aside className="flex w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-1">
            <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">
              {group.label}
            </div>
            <ul className="space-y-0.5 mt-0.5">
              {group.items.map((item) => {
                const active = isActive(item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl text-sm transition-all duration-200 group ${
                        active
                          ? "bg-emerald-600 text-white font-medium shadow-md shadow-emerald-100"
                          : "text-slate-500 hover:bg-emerald-50 hover:text-emerald-700"
                      }`}
                    >
                      <Icon
                        className={`h-4.5 w-4.5 shrink-0 transition-all duration-200 ${
                          active ? "text-white" : "text-slate-400 group-hover:text-emerald-600"
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-100 px-3 py-3">
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 px-4 py-2.5 rounded-2xl text-sm text-slate-500 transition-all duration-200 hover:bg-red-50 hover:text-red-600 group"
        >
          <LogOut className="h-4.5 w-4.5 shrink-0 text-slate-400 group-hover:text-red-500" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
