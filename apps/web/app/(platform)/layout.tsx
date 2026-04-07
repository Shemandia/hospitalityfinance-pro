import { Home } from "lucide-react";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
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
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
