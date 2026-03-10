"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Building2, AlertTriangle } from "lucide-react";

const isDev = process.env.NODE_ENV !== "production";

const schema = z.object({
  email: z.string().email("Valid email required"),
  entityId: z.string().optional(),
});

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "admin@localhost", entityId: "00000000-0000-0000-0000-000000000002" },
  });

  async function handleDevLogin(values: z.infer<typeof schema>) {
    setLoading(true);
    setError("");
    const result = await signIn("credentials", {
      email: values.email,
      entityId: values.entityId ?? "",
      redirect: true,
      callbackUrl: "/",
    });
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-surface">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand mark */}
        <div className="flex items-center gap-2.5 justify-center">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-primary leading-tight">HospitalityFinance</p>
            <p className="text-xs text-muted-foreground leading-tight">Pro — Finance Platform</p>
          </div>
        </div>

        <Card className="shadow-xl">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>Access your hospitality finance workspace</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isDev && (
              <div className="flex gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Dev mode — any email works, Keycloak not required.</span>
              </div>
            )}

            {isDev ? (
              <form onSubmit={form.handleSubmit(handleDevLogin)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
                  {form.formState.errors.email && (
                    <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="entityId">Entity ID <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input id="entityId" placeholder="Leave blank to set later" {...form.register("entityId")} />
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <Button type="submit" variant="teal" className="w-full" disabled={loading}>
                  {loading ? "Signing in…" : "Sign In"}
                </Button>
              </form>
            ) : (
              <Button variant="teal" className="w-full" asChild>
                <a href="/api/auth/signin/keycloak?callbackUrl=/">Continue with Keycloak</a>
              </Button>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} HospitalityFinance Pro
        </p>
      </div>
    </main>
  );
}
