"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../components/auth-provider";
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
import { Building2, Lock, ShieldAlert } from "lucide-react";

// Same origin: the web app proxies the API (lib/server/api-proxy.ts).
const API_BASE = "";

export default function ChangePasswordPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const tenantCode = typeof params.code === "string" ? params.code : "";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (newPassword === currentPassword) {
      setError("New password must be different from current password");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, tenantCode }),
        credentials: "include"
      });

      if (res.ok) {
        router.push(`/t/${tenantCode}/dashboard`);
      } else {
        const json = await res.json().catch(() => null);
        setError(json?.errors?.[0]?.message ?? "Unable to change password. Please try again.");
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
              Change password
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {user?.mustChangePassword
                ? "You must change your password before continuing"
                : "Update your password"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pb-8 pt-4">
            {user?.mustChangePassword && (
              <div className="flex gap-2.5 rounded-xl bg-amber-50/80 border border-amber-200/50 px-3.5 py-3 text-xs text-amber-700">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                <span>
                  Your administrator requires you to set a new password before accessing the
                  dashboard.
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="current-password"
                  className="text-xs font-medium text-foreground/70"
                >
                  Current password
                </Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  className="h-11 rounded-xl"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-xs font-medium text-foreground/70">
                  New password
                </Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  className="h-11 rounded-xl"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="confirm-new-password"
                  className="text-xs font-medium text-foreground/70"
                >
                  Confirm new password
                </Label>
                <Input
                  id="confirm-new-password"
                  type="password"
                  autoComplete="new-password"
                  className="h-11 rounded-xl"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <Button
                type="submit"
                variant="teal"
                className="w-full h-11 font-medium text-sm rounded-xl shadow-[0_4px_16px_rgba(34,184,160,0.25)]"
                disabled={loading || !currentPassword || !newPassword || !confirmPassword}
              >
                {loading ? (
                  "Changing password..."
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    Change password
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
