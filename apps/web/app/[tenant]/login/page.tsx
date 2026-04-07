"use client";

import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../../components/ui/card";
import { Building2, AlertTriangle, Lock, Loader2 } from "lucide-react";

const isDev = process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH === "true";

type TenantInfo = {
  id: string;
  slug: string;
  name: string;
};

const schema = z.object({
  email: isDev ? z.string().min(1, "Email required") : z.string().email("Valid email required"),
  password: isDev ? z.string().optional() : z.string().min(1, "Password required")
});

export default function TenantLoginPage() {
  const params = useParams();
  const tenantSlug = typeof params.tenant === "string" ? params.tenant : "";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [tenantLoading, setTenantLoading] = useState(true);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: isDev ? "admin@hfp.local" : "", password: "" }
  });

  // Fetch tenant display info (slug is already validated by [tenant]/layout.tsx)
  useEffect(() => {
    if (!tenantSlug) {
      setTenantLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/tenants/${tenantSlug}`);
        if (res.ok) {
          const data = await res.json();
          if (data.data) setTenantInfo(data.data);
        }
      } catch {
        // Layout already validated the tenant — if API fails, show slug as fallback
      } finally {
        setTenantLoading(false);
      }
    })();
  }, [tenantSlug]);

  async function handleLogin(values: z.infer<typeof schema>) {
    setLoading(true);
    setError("");
    const result = await signIn("credentials", {
      email: values.email,
      password: values.password ?? "",
      tenantSlug,
      redirect: true,
      callbackUrl: `/${tenantSlug}/dashboard`
    });
    if (result?.error) {
      setError(result.error === "CredentialsSignin" ? "Invalid email or password." : result.error);
      setLoading(false);
    }
  }

  if (tenantLoading) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#0a1221]">
        <Loader2 className="h-8 w-8 animate-spin text-white/40" />
      </main>
    );
  }

  const displayName = tenantInfo?.name ?? tenantSlug;

  return (
    <main className="min-h-screen grid place-items-center p-6 relative overflow-hidden bg-[#0a1221]">
      {/* Background gradient */}
      <div className="absolute inset-0 login-bg" />

      {/* Floating orbs */}
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
              Welcome back
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Sign in to <span className="font-medium text-foreground/80">{displayName}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pb-8 pt-4">
            {isDev && (
              <div className="flex gap-2.5 rounded-xl bg-amber-50/80 border border-amber-200/50 px-3.5 py-3 text-xs text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                <span>
                  Development mode — signing in to{" "}
                  <span className="font-mono font-medium">{tenantSlug}</span>
                </span>
              </div>
            )}

            <form onSubmit={form.handleSubmit(handleLogin)} className="space-y-4">
              {/* Tenant badge */}
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50/80 border border-emerald-200/50 px-3.5 py-2.5">
                <Building2 className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-medium text-emerald-800">{displayName}</span>
                <span className="ml-auto text-xs font-mono text-emerald-600/60">{tenantSlug}</span>
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs font-medium text-foreground/70">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className="h-11 rounded-xl"
                  {...form.register("email")}
                />
                {form.formState.errors.email && (
                  <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>

              {/* Password (hidden in dev mode) */}
              {!isDev && (
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs font-medium text-foreground/70">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    className="h-11 rounded-xl"
                    {...form.register("password")}
                  />
                  {form.formState.errors.password && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.password.message}
                    </p>
                  )}
                </div>
              )}

              <p className="text-[11px] text-muted-foreground/70 bg-muted/40 rounded-xl px-3.5 py-2.5 leading-relaxed">
                After login, use the entity switcher in the sidebar to select your property.
              </p>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button
                type="submit"
                variant="teal"
                className="w-full h-11 font-medium text-sm rounded-xl shadow-[0_4px_16px_rgba(34,184,160,0.25)]"
                disabled={loading}
              >
                {loading ? (
                  "Signing in..."
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    Sign In
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-white/20">
          &copy; {new Date().getFullYear()} HospitalityFinance Pro. All rights reserved.
        </p>
      </div>
    </main>
  );
}
