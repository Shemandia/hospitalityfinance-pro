import { Home } from "lucide-react";
import { cookies } from "next/headers";
import { PlatformSidebar } from "../../components/platform-sidebar";

const SESSION_COOKIE = "hfp_platform_key";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  // Sidebar only renders for signed-in operators. The httpOnly session cookie
  // is the same one every platform proxy route requires, so this stays in
  // sync with the page-level login gates.
  const authenticated = (await cookies()).has(SESSION_COOKIE);

  return (
    <div className="flex h-screen flex-col bg-[#f8fafc]">
      <header className="flex-shrink-0 border-b border-slate-200 bg-white px-8 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-3">
          <div className="w-[34px] h-[34px] bg-emerald-500 rounded-[10px] flex items-center justify-center text-white shadow-[0_4px_10px_rgba(16,185,129,0.2)]">
            <Home className="h-[18px] w-[18px]" />
          </div>
          <div>
            <h2 className="text-[16px] font-extrabold text-slate-900 leading-none">Hospitality</h2>
            <span className="text-[10px] font-extrabold text-emerald-500 uppercase tracking-[0.1em]">
              Finance Pro
            </span>
          </div>
          <span className="ml-3 rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-1 text-[10px] font-extrabold text-amber-700 uppercase tracking-wider">
            Platform Admin
          </span>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {authenticated && <PlatformSidebar />}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
