import Link from "next/link";
import { Building2, AlertTriangle } from "lucide-react";

export default function TenantNotFoundPage() {
  return (
    <main className="min-h-screen grid place-items-center p-6 bg-[#0a1221]">
      <div className="w-full max-w-md space-y-8 text-center">
        {/* Brand */}
        <div className="flex items-center gap-3 justify-center">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-emerald-600 text-white">
            <Building2 className="h-5 w-5" />
          </div>
          <span className="font-bold text-white text-lg">HospitalityFinance Pro</span>
        </div>

        {/* Error card */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
          <div className="h-14 w-14 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="h-7 w-7 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Tenant Not Found</h2>
          <p className="text-sm text-white/50 mb-6">
            This workspace does not exist or is no longer active. Please check the URL and try
            again.
          </p>
          <Link
            href="/platform/tenants"
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/20 transition-colors"
          >
            View Available Tenants
          </Link>
        </div>
      </div>
    </main>
  );
}
