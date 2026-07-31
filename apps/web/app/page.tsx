"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ArrowRight, Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

export default function LandingPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const trimmed = code.trim().toLowerCase();
    if (!/^[a-z0-9]{8}$/.test(trimmed)) {
      setError("Please enter a valid 8-character organisation code");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/tenant/${trimmed}`);
      if (res.ok) {
        router.push(`/t/${trimmed}/login`);
      } else {
        setError("Organisation not found");
      }
    } catch {
      setError("Unable to verify organisation. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center p-6 relative overflow-hidden bg-[#0a1221]">
      <div className="absolute inset-0 login-bg" />
      <div className="login-orb login-orb-1 w-96 h-96 -top-32 -right-32 bg-accent" />
      <div className="login-orb login-orb-2 w-72 h-72 -bottom-20 -left-20 bg-brand-teal-dark" />
      <div className="login-orb login-orb-3 w-48 h-48 top-1/3 right-1/4 bg-brand-gold" />

      <div className="w-full max-w-md space-y-8 relative z-10 animate-fade-in">
        <div className="flex items-center gap-3.5 justify-center">
          <div className="h-12 w-12 rounded-xl flex items-center justify-center sidebar-brand-icon shadow-[0_4px_16px_rgba(34,184,160,0.3)]">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <div>
            <p className="font-bold text-white leading-tight text-xl tracking-tight">
              HospitalityFinance
            </p>
            <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-accent">PRO</p>
          </div>
        </div>

        <div className="glass-card shadow-[0_20px_60px_rgba(0,0,0,0.3)] border-white/10 rounded-2xl p-8">
          <div className="text-center mb-6">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Welcome</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Enter your organisation code to continue
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="code" className="text-xs font-medium text-foreground/70">
                Organisation Code
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase())}
                maxLength={8}
                placeholder="e.g. 4369021c"
                className="w-full h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-mono tracking-wider text-center focus:ring-2 ring-emerald-500 outline-none transition-all"
                autoComplete="off"
              />
            </div>

            {error && <p className="text-xs text-destructive text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading || code.trim().length !== 8}
              className="w-full h-11 font-medium text-sm rounded-xl shadow-[0_4px_16px_rgba(34,184,160,0.25)] bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-white/20">
          &copy; {new Date().getFullYear()} HospitalityFinance Pro. All rights reserved.
        </p>
      </div>
    </main>
  );
}
