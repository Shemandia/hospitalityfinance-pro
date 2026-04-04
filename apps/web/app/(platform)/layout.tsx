export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-slate-900">HospitalityFinance Pro</span>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Platform Admin
          </span>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
