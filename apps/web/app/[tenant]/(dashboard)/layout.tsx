import type { ReactNode } from "react";
import { ErrorBoundary } from "../../../components/error-boundary";
import { SetupGuard } from "../../../components/setup-guard";
import { auth, signOut } from "../../../auth";
import { LogOut, Building2, Search, Bell } from "lucide-react";
import { SidebarNav } from "../../../components/sidebar-nav";
import { EntitySwitcher } from "../../../components/entity-switcher";
import { MobileSidebarToggle } from "../../../components/mobile-sidebar";

export default async function DashboardLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const session = await auth();

  const userRole =
    (session?.user as any)?.roles
      ?.map((r: string) => r.toUpperCase())
      .find((r: string) => ["SUPERADMIN", "ADMIN", "CONTROLLER"].includes(r)) ?? "VIEWER";

  const initials = (session?.user?.email ?? "U")[0].toUpperCase();
  const userName = session?.user?.name || session?.user?.email?.split("@")[0] || "User";

  return (
    <div className="h-screen flex bg-[#F8FAFC] overflow-hidden">
      {/* ── Desktop Sidebar (hidden on mobile) ───────────────────────────── */}
      <aside className="hidden lg:flex w-72 shrink-0 flex-col bg-white border-r border-slate-100 h-screen overflow-y-auto">
        {/* Brand */}
        <div className="px-6 py-6 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-emerald-600 text-white shadow-lg shadow-emerald-200">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="font-bold text-slate-800 text-lg leading-none">Hospitality</p>
            <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-600">
              Finance Pro
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-5 h-px bg-slate-100" />

        {/* Entity Switcher */}
        <div className="pt-4 px-1">
          <EntitySwitcher />
        </div>

        {/* Navigation */}
        <SidebarNav />

        {/* User footer */}
        <div className="mx-4 mb-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Current User
          </p>
          <p className="text-sm font-bold text-slate-800 mt-1 truncate">{userName}</p>
          <div className="flex items-center justify-between mt-2">
            <span className="inline-flex items-center rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 border border-emerald-100">
              {userRole}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: `/${tenant}/login` });
              }}
            >
              <button
                type="submit"
                title="Sign out"
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Dev auth warning banner */}
        {process.env.ENABLE_DEV_AUTH === "true" && (
          <div className="bg-amber-500 text-white text-center text-xs font-semibold py-1.5 px-4 shrink-0 z-40">
            DEV AUTH ACTIVE — Do not use in production.
          </div>
        )}

        {/* Top bar */}
        <header className="h-14 lg:h-16 bg-white border-b border-slate-100 flex items-center justify-between px-4 lg:px-8 shrink-0 z-30">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <MobileSidebarToggle />

            {/* Mobile brand (visible only on small screens) */}
            <div className="flex items-center gap-2 lg:hidden">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-emerald-600 text-white shadow-md shadow-emerald-200">
                <Building2 className="h-4 w-4" />
              </div>
              <span className="font-bold text-slate-800 text-sm">HFP</span>
            </div>

            {/* Search — full on desktop, icon-only on mobile */}
            <div className="relative hidden sm:block">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 h-4.5 w-4.5"
                aria-hidden="true"
              />
              <input
                type="text"
                aria-label="Search"
                className="pl-10 pr-4 py-2 lg:py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 ring-emerald-500 outline-none transition-all w-48 md:w-64 lg:w-72 text-sm text-slate-700 placeholder:text-slate-400"
                placeholder="Search..."
              />
            </div>
            <button
              type="button"
              aria-label="Search"
              className="sm:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors"
            >
              <Search className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Notifications (new)"
              className="relative p-2 lg:p-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-all duration-200"
            >
              <Bell className="h-4 w-4 lg:h-5 lg:w-5" aria-hidden="true" />
              <span
                className="absolute top-1.5 right-1.5 lg:top-2 lg:right-2 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white"
                aria-hidden="true"
              />
            </button>

            {/* Mobile user avatar */}
            <div className="lg:hidden h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white bg-emerald-600 shadow-md shadow-emerald-200">
              {initials}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 xl:p-10 overflow-y-auto content-scroll">
          <ErrorBoundary>
            <SetupGuard>{children}</SetupGuard>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
