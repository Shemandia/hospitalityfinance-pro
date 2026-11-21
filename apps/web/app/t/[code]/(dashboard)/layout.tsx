import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "../../../../components/error-boundary";
import { SetupGuard } from "../../../../components/setup-guard";
import { UserMenu } from "../../../../components/user-menu";
import { Building2, Search, Bell } from "lucide-react";
import { SidebarNav } from "../../../../components/sidebar-nav";
import { PropertySwitcher } from "../../../../components/property-switcher";
import { PeriodProvider } from "../../../../components/period-provider";
import { PeriodSelector } from "../../../../components/period-selector";
import { MobileSidebarToggle } from "../../../../components/mobile-sidebar";

export default async function DashboardLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return (
    // Nothing of the dashboard is drawn until the guard has decided (setup, session).
    <SetupGuard>
      <Suspense>
        <PeriodProvider>
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

              {/* Navigation */}
              <SidebarNav />
            </aside>

            {/* ── Main area ────────────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
              {/* Top bar: property | search | notifications, account */}
              <header className="h-14 lg:h-16 bg-white border-b border-slate-100 flex items-center gap-2 sm:gap-4 px-3 sm:px-4 lg:px-8 shrink-0 z-30">
                <div className="flex flex-1 basis-0 items-center gap-2 min-w-0">
                  <MobileSidebarToggle />
                  <PropertySwitcher />
                  <PeriodSelector />
                </div>

                <div className="relative hidden sm:block shrink">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 h-4.5 w-4.5"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    aria-label="Search"
                    className="pl-10 pr-4 py-2 lg:py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 ring-emerald-500 outline-none transition-all w-44 md:w-64 lg:w-80 text-sm text-slate-700 placeholder:text-slate-400"
                    placeholder="Search..."
                  />
                </div>

                <div className="flex flex-1 basis-0 items-center justify-end gap-1 sm:gap-2">
                  <button
                    type="button"
                    aria-label="Search"
                    className="sm:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    <Search className="h-5 w-5" />
                  </button>
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
                  <UserMenu />
                </div>
              </header>

              <main className="flex-1 p-4 sm:p-6 lg:p-8 xl:p-10 overflow-y-auto content-scroll">
                <ErrorBoundary>{children}</ErrorBoundary>
              </main>
            </div>
          </div>
        </PeriodProvider>
      </Suspense>
    </SetupGuard>
  );
}
