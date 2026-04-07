"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTenantSlugSafe } from "../hooks/use-tenant-router";
import {
  Building2,
  LayoutDashboard,
  BookOpen,
  Scale,
  CreditCard,
  FileText,
  TrendingUp,
  DollarSign,
  PieChart,
  ClipboardList,
  BarChart3,
  BarChart2,
  Clock,
  Activity,
  Layers,
  Plug,
  GitBranch,
  Users,
  Upload,
  FileUp,
  Banknote,
  ShieldCheck,
  Landmark,
  CalendarDays,
  ChevronDown,
  Tags,
  SlidersHorizontal,
  type LucideIcon
} from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: "Dashboards",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboard/gm", label: "General Manager", icon: Building2 },
      { href: "/dashboard/controller", label: "Financial Controller", icon: Scale },
      { href: "/dashboard/cfo", label: "CFO", icon: TrendingUp },
      { href: "/dashboard/directors", label: "Directors", icon: PieChart },
      { href: "/dashboard/ap", label: "AP Clerk", icon: CreditCard },
      { href: "/dashboard/ar", label: "AR Clerk", icon: FileText },
      { href: "/dashboard/night-audit", label: "Night Auditor", icon: Clock },
      { href: "/dashboard/cost-controller", label: "Cost Controller", icon: DollarSign }
    ]
  },
  {
    label: "General Ledger",
    items: [
      { href: "/gl/accounts", label: "Chart of Accounts", icon: PieChart },
      { href: "/gl/accounts/import", label: "Import COA", icon: Upload },
      { href: "/gl/journals", label: "General Journal", icon: BookOpen },
      { href: "/gl/journals/new", label: "New Journal", icon: FileText },
      { href: "/gl/trial-balance", label: "Trial Balance", icon: Scale },
      { href: "/settings/journal-types", label: "Journal Types", icon: Tags },
      { href: "/settings/account-types", label: "Account Types", icon: SlidersHorizontal }
    ]
  },
  {
    label: "Payables & Receivables",
    items: [
      { href: "/ap", label: "Accounts Payable", icon: CreditCard },
      { href: "/ap/suppliers", label: "Suppliers", icon: Users },
      { href: "/ap/payment-runs", label: "Payment Runs", icon: Banknote },
      { href: "/ar", label: "Accounts Receivable", icon: FileText },
      { href: "/ar/ageing", label: "AR Ageing", icon: Clock }
    ]
  },
  {
    label: "Finance",
    items: [
      { href: "/fx", label: "FX Rates", icon: TrendingUp },
      { href: "/budget", label: "Budget", icon: DollarSign },
      { href: "/budget/variance", label: "Variance Report", icon: BarChart2 },
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/reports/usali-pl", label: "USALI P&L", icon: BarChart2 },
      { href: "/reports/balance-sheet", label: "Balance Sheet", icon: Scale },
      { href: "/reports/cashflow", label: "Cash Flow", icon: Activity },
      { href: "/reports/builder", label: "Report Builder", icon: SlidersHorizontal },
      { href: "/bank/reconciliation", label: "Bank Recon", icon: Landmark }
    ]
  },
  {
    label: "Multi-Entity",
    items: [{ href: "/consolidation", label: "Consolidation", icon: Layers }]
  },
  {
    label: "Transfer Desk",
    items: [{ href: "/transfer-desk", label: "Transfer Desk", icon: Plug }]
  },
  {
    label: "Admin",
    items: [
      { href: "/settings/profile", label: "My Profile", icon: Users },
      { href: "/settings/properties", label: "Properties", icon: Building2 },
      { href: "/settings/users", label: "User Management", icon: Users },
      { href: "/settings/user-assignments", label: "User Assignments", icon: Building2 },
      { href: "/settings/roles", label: "Roles & Permissions", icon: ShieldCheck },
      { href: "/periods", label: "Periods", icon: CalendarDays },
      { href: "/audit", label: "Audit Log", icon: ClipboardList },
      { href: "/settings/approval-rules", label: "Approval Rules", icon: ShieldCheck },
      { href: "/settings/integrations", label: "Integrations", icon: Plug },
      { href: "/settings/integrations/saf-import", label: "SAF Import", icon: FileUp },
      { href: "/settings/integrations/transfer-desk", label: "Transfer Desk", icon: GitBranch }
    ]
  }
];

export function SidebarNav() {
  const pathname = usePathname();
  const tenantSlug = useTenantSlugSafe();
  const prefix = tenantSlug ? `/${tenantSlug}` : "";

  // Prefix all nav hrefs with tenant slug
  const prefixedNavGroups = navGroups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      href: `${prefix}${item.href}`
    }))
  }));

  const initialOpen = () => {
    const set = new Set<string>();
    for (const group of prefixedNavGroups) {
      for (const item of group.items) {
        if (pathname === item.href || pathname.startsWith(item.href + "/")) {
          set.add(group.label);
          break;
        }
      }
    }
    set.add("Dashboards");
    return set;
  };

  const [openGroups, setOpenGroups] = useState<Set<string>>(initialOpen);

  const toggle = (label: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <nav className="flex-1 overflow-y-auto sidebar-scroll px-3 py-4 space-y-0.5">
      {prefixedNavGroups.map((group) => {
        const isOpen = openGroups.has(group.label);
        const hasActiveItem = group.items.some((item) => isActive(item.href));

        return (
          <div key={group.label} className="mb-1">
            {/* Group header */}
            <button
              type="button"
              onClick={() => toggle(group.label)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-[0.15em] transition-all duration-200 ${
                hasActiveItem && !isOpen
                  ? "text-emerald-600"
                  : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center gap-2">
                {group.label}
                {!isOpen && hasActiveItem && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                )}
              </span>
              <ChevronDown
                className={`h-3 w-3 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
              />
            </button>

            {/* Group items */}
            <div
              className={`overflow-hidden transition-all duration-250 ease-in-out ${
                isOpen ? "max-h-150 opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <ul className="space-y-0.5 mt-0.5">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
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
                        <span className="truncate">{label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
