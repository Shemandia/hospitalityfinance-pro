"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../../../components/ui/card";
import { Building2, Mail, ArrowLeft, CheckCircle2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

export default function ForgotPasswordPage() {
  const params = useParams();
  const tenantCode = typeof params.code === "string" ? params.code : "";
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tenantCode }),
        credentials: "include"
      });

      if (res.ok) {
        setSent(true);
      } else {
        const json = await res.json().catch(() => null);
        setError(json?.errors?.[0]?.message ?? "Unable to send reset email. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
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

      <div className="w-full max-w-100 space-y-8 relative z-10 animate-fade-in">
        {/* Brand */}
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

        <Card className="glass-card shadow-[0_20px_60px_rgba(0,0,0,0.3)] border-white/10 rounded-2xl">
          <CardHeader className="text-center pb-2 pt-8">
            <CardTitle className="text-xl font-semibold tracking-tight text-foreground">
              {sent ? "Check your email" : "Forgot password"}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {sent
                ? "We sent a password reset link to your email"
                : "Enter your email and we'll send you a reset link"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pb-8 pt-4">
            {sent ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center">
                  <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                </div>
                <p className="text-sm text-center text-muted-foreground">
                  If an account exists for{" "}
                  <span className="font-medium text-foreground/80">{email}</span>, you will receive
                  an email with instructions to reset your password.
                </p>
                <a
                  href={`/t/${tenantCode}/login`}
                  className="flex items-center justify-center gap-2 text-sm text-emerald-600 hover:text-emerald-700 hover:underline"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to login
                </a>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-medium text-foreground/70">
                    Email address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    className="h-11 rounded-xl"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}

                <Button
                  type="submit"
                  variant="teal"
                  className="w-full h-11 font-medium text-sm rounded-xl shadow-[0_4px_16px_rgba(34,184,160,0.25)]"
                  disabled={loading || !email}
                >
                  {loading ? (
                    "Sending..."
                  ) : (
                    <>
                      <Mail className="h-3.5 w-3.5" />
                      Send reset link
                    </>
                  )}
                </Button>

                <a
                  href={`/t/${tenantCode}/login`}
                  className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground/80"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to login
                </a>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-white/20">
          &copy; {new Date().getFullYear()} HospitalityFinance Pro. All rights reserved.
        </p>
      </div>
    </main>
  );
}
