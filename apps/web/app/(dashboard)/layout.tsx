import type { ReactNode } from "react";
import { ErrorBoundary } from "../../components/error-boundary";
import { auth, signOut } from "../../auth";
import { LogOut, Building2, ChevronRight } from "lucide-react";
import { SidebarNav } from "../../components/sidebar-nav";
import { EntitySwitcher } from "../../components/entity-switcher";

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
            HospitalityFinance
            <br />
            <span className="text-(--color-accent) font-bold">Pro</span>
          </span>
        </div>

        {/* Entity Switcher */}
        <div className="pt-3">
          <EntitySwitcher />
        </div>

        {/* Navigation */}
        <SidebarNav />

        {/* User footer */}
        <div className="px-4 py-3 border-t border-white/10">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate">
                {session?.user?.email ?? "User"}
              </p>
              <p className="text-[10px] text-white/50 truncate uppercase">
                {(session?.user as any)?.roles
                  ?.map((r: string) => r.toUpperCase())
                  .find((r: string) => ["SUPERADMIN", "ADMIN", "CONTROLLER"].includes(r)) ??
                  "VIEWER"}
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
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
