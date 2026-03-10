import Link from "next/link";
import type { ReactNode } from "react";
import { auth, signOut } from "../../auth";
import {
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
  LogOut,
  Building2,
  ChevronRight,
  CalendarDays,
  Clock,
  Activity,
  Layers,
  Plug,
  GitBranch,
  Users,
  Upload,
  FileUp,
  Banknote,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Separator } from "../../components/ui/separator";

const navGroups = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "General Ledger",
    items: [
      { href: "/gl/accounts", label: "Chart of Accounts", icon: PieChart },
      { href: "/gl/accounts/import", label: "Import COA", icon: Upload },
      { href: "/gl/journals", label: "General Journal", icon: BookOpen },
      { href: "/gl/trial-balance", label: "Trial Balance", icon: Scale },
    ],
  },
  {
    label: "Payables & Receivables",
    items: [
      { href: "/ap", label: "Accounts Payable", icon: CreditCard },
      { href: "/ap/suppliers", label: "Suppliers", icon: Users },
      { href: "/ap/payment-runs", label: "Payment Runs", icon: Banknote },
      { href: "/ar", label: "Accounts Receivable", icon: FileText },
      { href: "/ar/ageing", label: "AR Ageing", icon: Clock },
    ],
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
    ],
  },
  {
    label: "Multi-Entity",
    items: [
      { href: "/consolidation", label: "Consolidation", icon: Layers },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/periods", label: "Periods", icon: CalendarDays },
      { href: "/audit", label: "Audit Log", icon: ClipboardList },
      { href: "/settings/integrations", label: "Integrations", icon: Plug },
      { href: "/settings/integrations/saf-import", label: "SAF Import", icon: FileUp },
      { href: "/settings/integrations/transfer-desk", label: "Transfer Desk", icon: GitBranch },
    ],
  },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  return (
    <div className="min-h-screen flex bg-surface">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-(--color-primary) text-white flex flex-col">
        {/* Brand */}
        <div className="px-5 py-4 flex items-center gap-2 border-b border-white/10">
          <Building2 className="h-5 w-5 text-(--color-accent)" />
          <span className="font-semibold text-sm leading-tight">
            HospitalityFinance<br />
            <span className="text-(--color-accent) font-bold">Pro</span>
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map(({ href, label, icon: Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="flex items-center gap-2.5 px-2 py-2 rounded-md text-sm text-white/80 hover:text-white hover:bg-white/10 transition-colors group"
                    >
                      <Icon className="h-4 w-4 opacity-70 group-hover:opacity-100" />
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-4 py-3 border-t border-white/10">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate">{session?.user?.email ?? "User"}</p>
              <p className="text-[10px] text-white/50 truncate">
                {(session?.user as any)?.roles?.[0] ?? "Viewer"}
              </p>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                title="Sign out"
                className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 bg-white border-b border-border flex items-center px-6 gap-2 shrink-0">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">HospitalityFinance Pro</span>
        </header>

        <main className="flex-1 p-4 sm:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
