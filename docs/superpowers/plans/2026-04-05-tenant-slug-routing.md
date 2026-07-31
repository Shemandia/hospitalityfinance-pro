# Tenant-Slug URL Routing + Gap Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from session-only tenant context to Oracle OPERA Cloud-style URL routing (`/{tenant-slug}/login`, `/{tenant-slug}/dashboard`, etc.) and fix all 5 identified gaps in the tenant onboarding-to-dashboard chain.

**Architecture:** Next.js `[tenant]` dynamic route segment replaces the current `(auth)`, `(setup)`, and `(dashboard)` route groups. Middleware validates the tenant slug against the registry API. All internal links and redirects are prefixed with the tenant slug extracted from URL params. Backend gets `countryCode` on Tenant model for pre-fill. Setup completion validates data existence.

**Tech Stack:** Next.js 14 App Router, NextAuth.js, Fastify, Prisma, PostgreSQL, Zod

---

## File Structure

### New files:

- `apps/web/app/[tenant]/login/page.tsx` — Tenant-specific login page (replaces `(auth)/login`)
- `apps/web/app/[tenant]/(setup)/layout.tsx` — Setup layout (moved from `(setup)/layout.tsx`)
- `apps/web/app/[tenant]/(setup)/setup/page.tsx` — Setup wizard (moved from `(setup)/setup`)
- `apps/web/app/[tenant]/(dashboard)/layout.tsx` — Dashboard layout (moved from `(dashboard)/layout.tsx`)
- `apps/web/app/[tenant]/(dashboard)/page.tsx` — Root redirect (moved)
- `apps/web/app/[tenant]/(dashboard)/dashboard/page.tsx` — Dashboard (moved)
- All other `(dashboard)/*` routes move under `[tenant]/(dashboard)/`
- `apps/web/hooks/use-tenant-slug.ts` — Hook to extract tenant slug from URL params
- `apps/web/app/api/tenants/[slug]/route.ts` — API route to validate a single tenant slug

### Modified files:

- `apps/web/middleware.ts` — Tenant slug extraction + validation
- `apps/web/auth.ts` — Remove hardcoded signIn page path
- `apps/web/components/sidebar-nav.tsx` — Prefix all hrefs with tenant slug
- `apps/web/components/setup-guard.tsx` — Improve loading state + tenant-aware redirect
- `apps/web/components/entity-provider.tsx` — Get tenantSlug from URL, not just session
- `apps/web/components/use-api-context.ts` — Get tenantSlug from URL params
- `apps/web/lib/gl-api.ts` — No changes needed (already supports tenantSlug)
- `apps/api/src/db/schema.prisma` — Add `countryCode` to Tenant model
- `apps/api/src/modules/tenant/provisioning-service.ts` — Store countryCode, update activation URL
- `apps/api/src/modules/setup/service.ts` — Return countryCode + maxProperties in tenantInfo
- `apps/api/src/modules/setup/service.ts` — Validate data existence in complete()
- `apps/web/app/(platform)/platform/tenants/onboard/page.tsx` — Update success URL display

### Deleted files:

- `apps/web/app/(auth)/login/page.tsx` — Replaced by `[tenant]/login`
- `apps/web/app/(setup)/layout.tsx` — Moved
- `apps/web/app/(setup)/setup/page.tsx` — Moved
- `apps/web/app/(dashboard)/layout.tsx` — Moved
- `apps/web/app/(dashboard)/page.tsx` — Moved
- All routes under `apps/web/app/(dashboard)/` — Moved under `[tenant]/(dashboard)/`

---

### Task 1: Add countryCode to Tenant model and provisioning (Backend — Gap #2 foundation)

**Files:**

- Modify: `apps/api/src/db/schema.prisma:180-200`
- Modify: `apps/api/src/modules/tenant/provisioning-service.ts:74-83`

- [ ] **Step 1: Add countryCode field to Tenant model in schema.prisma**

In `apps/api/src/db/schema.prisma`, add `countryCode` to the Tenant model after `adminEmail`:

```prisma
model Tenant {
  id                 String             @id @default(uuid())
  slug               String             @unique @db.VarChar(50)
  name               String
  databaseUrl        String             @map("database_url")
  domain             String?            @unique
  adminEmail         String             @map("admin_email")
  countryCode        String             @default("") @map("country_code") @db.VarChar(2)
  plan               String             @default("standard")
  maxProperties      Int                @default(10) @map("max_properties")
  isActive           Boolean            @default(true) @map("is_active")
  provisionedAt      DateTime?          @map("provisioned_at")
  createdAt          DateTime           @default(now()) @map("created_at")
  updatedAt          DateTime           @updatedAt @map("updated_at")
  provisioningStatus ProvisioningStatus @default(PENDING) @map("provisioning_status")

  entitlement       TenantEntitlement?
  provisioningSteps TenantProvisioningStep[]

  @@map("tenants")
}
```

- [ ] **Step 2: Store countryCode during provisioning**

In `apps/api/src/modules/tenant/provisioning-service.ts`, update the tenant creation inside `$transaction` (around line 74-83) to include `countryCode`:

```typescript
const t = await tx.tenant.create({
  data: {
    name: tenant.name,
    slug: tenant.slug,
    databaseUrl: tenantDbUrl,
    domain: tenant.domain ?? null,
    adminEmail: tenant.adminEmail,
    countryCode: tenant.countryCode,
    provisioningStatus: "PROVISIONING"
  }
});
```

- [ ] **Step 3: Update activation URL in provisioning email**

In `apps/api/src/modules/tenant/provisioning-service.ts`, update the activation URL (around line 235-236) and the final SSE event (around line 266):

```typescript
// In the sending_email step:
const appUrl = process.env.APP_BASE_URL ?? "http://localhost:3001";
const activationUrl = `${appUrl}/${tenant.slug}/login`;

// In the final SSE event:
sse("complete", {
  tenantId: tenantRecord.id,
  slug: tenant.slug,
  url: `${process.env.APP_BASE_URL ?? "http://localhost:3001"}/${tenant.slug}/login`
});
```

- [ ] **Step 4: Run Prisma db push to apply schema change**

Run: `cd apps/api && npx prisma db push --schema src/db/schema.prisma`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.prisma apps/api/src/modules/tenant/provisioning-service.ts
git commit -m "feat: add countryCode to Tenant model and update activation URL to /{slug}/login"
```

---

### Task 2: Enrich setup service pre-fill + validate data on completion (Backend — Gap #2 + #3)

**Files:**

- Modify: `apps/api/src/modules/setup/service.ts`

- [ ] **Step 1: Update getProgress() to return countryCode and maxProperties**

Replace the `getProgress` method in `apps/api/src/modules/setup/service.ts`:

```typescript
async getProgress(tenantId: string) {
  let progress = await (prisma as any).tenantSetupProgress.findFirst({
    where: { tenantId }
  });
  if (!progress) {
    progress = await (prisma as any).tenantSetupProgress.create({
      data: {
        tenantId,
        currentStep: 1,
        isCompleted: false,
        stepData: {},
        completedSteps: []
      }
    });
  }

  // Fetch tenant info from registry for pre-filling step 1
  const tenant = await registryPrisma.tenant.findFirst({
    where: { slug: tenantId },
    select: { name: true, adminEmail: true, countryCode: true, maxProperties: true }
  });

  return {
    ...progress,
    tenantInfo: tenant
      ? {
          name: tenant.name,
          adminEmail: tenant.adminEmail,
          countryCode: tenant.countryCode,
          maxProperties: tenant.maxProperties
        }
      : null
  };
}
```

- [ ] **Step 2: Add data validation to complete() method**

Replace the `complete` method to validate that entities, departments, accounts, and periods exist:

```typescript
async complete(tenantId: string) {
  const progress = await this.getProgress(tenantId);
  const completed = progress.completedSteps as number[];
  const allDone = [1, 2, 3, 4, 5, 6].every((s) => completed.includes(s));
  if (!allDone) {
    throw new Error("All 6 steps must be completed before finishing setup.");
  }

  // Validate that essential data was created
  const entityCount = await (prisma as any).entity.count();
  if (entityCount === 0) {
    throw new Error("At least one entity (property) must exist before completing setup.");
  }

  const periodCount = await (prisma as any).period.count();
  if (periodCount === 0) {
    throw new Error("At least one fiscal period must exist before completing setup.");
  }

  const accountCount = await (prisma as any).account.count();
  if (accountCount === 0) {
    throw new Error("A chart of accounts must be imported before completing setup.");
  }

  await (prisma as any).tenantSetupProgress.update({
    where: { id: progress.id },
    data: { isCompleted: true, completedAt: new Date() }
  });

  return { completed: true };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/setup/service.ts
git commit -m "feat: enrich setup pre-fill with countryCode/maxProperties, validate data on completion"
```

---

### Task 3: Create tenant validation API route and useTenantSlug hook (Frontend foundation)

**Files:**

- Create: `apps/web/app/api/tenants/[slug]/route.ts`
- Create: `apps/web/hooks/use-tenant-slug.ts`

- [ ] **Step 1: Create single-tenant validation API route**

Create `apps/web/app/api/tenants/[slug]/route.ts`:

```typescript
import { NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const PLATFORM_KEY = process.env.HFP_PLATFORM_KEY;

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (!PLATFORM_KEY) {
    return NextResponse.json({ data: null, error: "Platform key not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${API_BASE}/api/v1/platform/tenants/${slug}`, {
      headers: { "X-Platform-Key": PLATFORM_KEY },
      next: { revalidate: 60 }
    });

    if (!res.ok) {
      return NextResponse.json({ data: null, error: "Tenant not found" }, { status: 404 });
    }

    const json = await res.json();
    const t = json.data;
    return NextResponse.json({
      data: { id: t.id, slug: t.slug, name: t.name }
    });
  } catch {
    return NextResponse.json({ data: null, error: "Service unavailable" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Create useTenantSlug hook**

Create `apps/web/hooks/use-tenant-slug.ts`:

```typescript
"use client";

import { useParams } from "next/navigation";

/**
 * Extracts the tenant slug from the [tenant] URL segment.
 * Returns the slug string, or null if not in a tenant route.
 */
export function useTenantSlug(): string | null {
  const params = useParams();
  const tenant = params?.tenant;
  if (typeof tenant === "string") return tenant;
  return null;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/tenants/\[slug\]/route.ts apps/web/hooks/use-tenant-slug.ts
git commit -m "feat: add tenant slug validation API route and useTenantSlug hook"
```

---

### Task 4: Move route structure to [tenant] dynamic segment

**Files:**

- Move all routes from `(auth)/`, `(setup)/`, `(dashboard)/` into `[tenant]/`
- Create: `apps/web/app/[tenant]/login/page.tsx`
- Create: `apps/web/app/page.tsx` (root redirect)

This is the largest task — it involves moving ~30 page files. The page content stays identical; only the directory structure changes.

- [ ] **Step 1: Create the [tenant] directory structure**

```bash
cd apps/web/app

# Create directory structure
mkdir -p "[tenant]/login"
mkdir -p "[tenant]/(setup)/setup"
mkdir -p "[tenant]/(dashboard)/dashboard/ap"
mkdir -p "[tenant]/(dashboard)/dashboard/ar"
mkdir -p "[tenant]/(dashboard)/dashboard/cfo"
mkdir -p "[tenant]/(dashboard)/dashboard/controller"
mkdir -p "[tenant]/(dashboard)/dashboard/cost-controller"
mkdir -p "[tenant]/(dashboard)/dashboard/directors"
mkdir -p "[tenant]/(dashboard)/dashboard/gm"
mkdir -p "[tenant]/(dashboard)/dashboard/night-audit"
mkdir -p "[tenant]/(dashboard)/ap/payment-runs/[id]"
mkdir -p "[tenant]/(dashboard)/ap/suppliers/[id]"
mkdir -p "[tenant]/(dashboard)/ar/ageing"
mkdir -p "[tenant]/(dashboard)/approval/journals/[id]"
mkdir -p "[tenant]/(dashboard)/audit"
mkdir -p "[tenant]/(dashboard)/bank/reconciliation"
mkdir -p "[tenant]/(dashboard)/budget/variance"
mkdir -p "[tenant]/(dashboard)/consolidation"
mkdir -p "[tenant]/(dashboard)/fx"
mkdir -p "[tenant]/(dashboard)/gl/accounts/[id]"
mkdir -p "[tenant]/(dashboard)/gl/accounts/import"
mkdir -p "[tenant]/(dashboard)/gl/journals/[id]"
mkdir -p "[tenant]/(dashboard)/gl/journals/new"
mkdir -p "[tenant]/(dashboard)/gl/trial-balance"
mkdir -p "[tenant]/(dashboard)/periods"
mkdir -p "[tenant]/(dashboard)/reports/balance-sheet"
mkdir -p "[tenant]/(dashboard)/reports/builder"
mkdir -p "[tenant]/(dashboard)/reports/cashflow"
mkdir -p "[tenant]/(dashboard)/reports/usali-pl"
mkdir -p "[tenant]/(dashboard)/settings/account-types"
mkdir -p "[tenant]/(dashboard)/settings/approval-rules"
mkdir -p "[tenant]/(dashboard)/settings/integrations/saf-import"
mkdir -p "[tenant]/(dashboard)/settings/integrations/transfer-desk"
mkdir -p "[tenant]/(dashboard)/settings/journal-types"
mkdir -p "[tenant]/(dashboard)/settings/profile"
mkdir -p "[tenant]/(dashboard)/settings/properties"
mkdir -p "[tenant]/(dashboard)/settings/roles"
mkdir -p "[tenant]/(dashboard)/settings/user-assignments"
mkdir -p "[tenant]/(dashboard)/settings/users"
```

- [ ] **Step 2: Copy all dashboard page files to new location**

Copy every `page.tsx` from `(dashboard)/` into `[tenant]/(dashboard)/`, preserving paths. Use a script:

```bash
cd apps/web/app
# Copy all pages recursively
find "(dashboard)" -name "page.tsx" -o -name "error.tsx" -o -name "not-found.tsx" | while read f; do
  dest="[tenant]/${f}"
  destdir=$(dirname "$dest")
  mkdir -p "$destdir"
  cp "$f" "$dest"
done
```

- [ ] **Step 3: Copy setup page and layout**

```bash
cp "(setup)/layout.tsx" "[tenant]/(setup)/layout.tsx"
cp "(setup)/setup/page.tsx" "[tenant]/(setup)/setup/page.tsx"
```

- [ ] **Step 4: Delete old route groups**

```bash
rm -rf "(auth)"
rm -rf "(setup)"
rm -rf "(dashboard)"
```

- [ ] **Step 5: Create root page.tsx redirect**

Create `apps/web/app/page.tsx` — a simple page that redirects to login since we need a tenant slug:

```typescript
import { redirect } from "next/navigation";

export default function RootPage() {
  // Without a tenant slug, we can't determine where to go.
  // In production, this would show a landing page or 404.
  // For development, redirect to the platform admin.
  redirect("/platform/tenants");
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move all routes under [tenant] dynamic segment (OPERA Cloud-style URLs)"
```

---

### Task 5: Create tenant-aware login page (Gap #1)

**Files:**

- Create: `apps/web/app/[tenant]/login/page.tsx`

- [ ] **Step 1: Write the new login page**

This page reads `tenant` from URL params, validates the slug, and shows the login form for that specific tenant. No dropdown needed.

Create `apps/web/app/[tenant]/login/page.tsx`:

```typescript
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

const isDev = process.env.NODE_ENV !== "production";

type TenantInfo = {
  id: string;
  slug: string;
  name: string;
};

const schema = z.object({
  email: isDev ? z.string().min(1, "Email required") : z.string().email("Valid email required")
});

export default function TenantLoginPage() {
  const params = useParams();
  const tenantSlug = typeof params.tenant === "string" ? params.tenant : "";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [tenantLoading, setTenantLoading] = useState(true);
  const [tenantNotFound, setTenantNotFound] = useState(false);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: isDev ? "admin@hfp.local" : "" }
  });

  // Validate tenant slug against registry
  useEffect(() => {
    if (!tenantSlug) {
      setTenantNotFound(true);
      setTenantLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/tenants/${tenantSlug}`);
        if (res.ok) {
          const data = await res.json();
          if (data.data) {
            setTenantInfo(data.data);
          } else {
            setTenantNotFound(true);
          }
        } else {
          setTenantNotFound(true);
        }
      } catch {
        setTenantNotFound(true);
      } finally {
        setTenantLoading(false);
      }
    })();
  }, [tenantSlug]);

  async function handleDevLogin(values: z.infer<typeof schema>) {
    setLoading(true);
    setError("");
    const result = await signIn("credentials", {
      email: values.email,
      tenantSlug,
      redirect: true,
      callbackUrl: `/${tenantSlug}/dashboard`
    });
    if (result?.error) {
      setError(result.error);
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

  if (tenantNotFound) {
    return (
      <main className="min-h-screen grid place-items-center p-6 bg-[#0a1221]">
        <Card className="w-full max-w-md glass-card border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
          <CardContent className="p-8 text-center">
            <div className="h-14 w-14 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="h-7 w-7 text-red-400" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">Tenant Not Found</h2>
            <p className="text-sm text-white/50">
              The workspace <span className="font-mono text-white/70">{tenantSlug}</span> does not
              exist or is not active. Please check the URL and try again.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

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
              Sign in to <span className="font-medium text-foreground/80">{tenantInfo?.name}</span>
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

            {isDev ? (
              <form onSubmit={form.handleSubmit(handleDevLogin)} className="space-y-4">
                {/* Tenant badge */}
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50/80 border border-emerald-200/50 px-3.5 py-2.5">
                  <Building2 className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-medium text-emerald-800">
                    {tenantInfo?.name}
                  </span>
                  <span className="ml-auto text-xs font-mono text-emerald-600/60">
                    {tenantSlug}
                  </span>
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
                    <p className="text-xs text-destructive">
                      {form.formState.errors.email.message}
                    </p>
                  )}
                </div>

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
            ) : (
              <Button
                variant="teal"
                className="w-full h-11 rounded-xl shadow-[0_4px_16px_rgba(34,184,160,0.25)]"
                asChild
              >
                <a href={`/api/auth/signin/keycloak?callbackUrl=/${tenantSlug}/dashboard`}>
                  <Lock className="h-3.5 w-3.5" />
                  Continue with Keycloak
                </a>
              </Button>
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/\[tenant\]/login/page.tsx
git commit -m "feat: tenant-aware login page reads slug from URL path (Gap #1)"
```

---

### Task 6: Update middleware for [tenant] routing

**Files:**

- Modify: `apps/web/middleware.ts`
- Modify: `apps/web/auth.ts`

- [ ] **Step 1: Rewrite middleware.ts**

Replace `apps/web/middleware.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "./auth";

/** Paths that do NOT require a [tenant] prefix */
const GLOBAL_PATHS = ["/platform", "/api"];

/** Tenant slug regex — must match the provisioning validation */
const TENANT_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export default auth((request) => {
  const { pathname, origin } = request.nextUrl;

  // Let asset, auth API, and global routes pass through
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/tenants")
  ) {
    return NextResponse.next();
  }

  // Platform admin routes — no tenant prefix
  if (pathname.startsWith("/platform")) {
    return NextResponse.next();
  }

  // Root page
  if (pathname === "/") {
    return NextResponse.next();
  }

  // Extract tenant slug from first path segment: /essque-hotels/dashboard -> essque-hotels
  const segments = pathname.split("/").filter(Boolean);
  const tenantSlug = segments[0];

  // If first segment doesn't look like a tenant slug, pass through (will 404 naturally)
  if (!tenantSlug || !TENANT_SLUG_RE.test(tenantSlug)) {
    return NextResponse.next();
  }

  // Determine the sub-path after the tenant slug
  const subPath = "/" + segments.slice(1).join("/");
  const isLoginPage = subPath === "/login";

  // Unauthenticated users can only access the login page
  if (!request.auth && !isLoginPage) {
    const loginUrl = new URL(`/${tenantSlug}/login`, origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated users on login page -> redirect to dashboard
  if (request.auth && isLoginPage) {
    return NextResponse.redirect(new URL(`/${tenantSlug}/dashboard`, origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"]
};
```

- [ ] **Step 2: Update auth.ts pages config**

In `apps/web/auth.ts`, remove the hardcoded `pages.signIn` since login is now dynamic per tenant. We'll handle the redirect in middleware instead:

```typescript
// Remove or comment out the pages config:
// pages: {
//   signIn: "/login"
// }
```

Change line 105-107 from:

```typescript
pages: {
  signIn: "/login";
}
```

to:

```typescript
pages: {
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/middleware.ts apps/web/auth.ts
git commit -m "feat: update middleware for [tenant] URL routing with auth guards"
```

---

### Task 7: Update sidebar-nav to use tenant-prefixed URLs

**Files:**

- Modify: `apps/web/components/sidebar-nav.tsx`

- [ ] **Step 1: Add useTenantSlug to sidebar-nav and prefix all hrefs**

In `apps/web/components/sidebar-nav.tsx`, import the hook and prefix all nav items:

Add import at top:

```typescript
import { useTenantSlug } from "../hooks/use-tenant-slug";
```

Inside the `SidebarNav` component, add the hook and create prefixed nav items:

```typescript
export function SidebarNav() {
  const pathname = usePathname();
  const tenantSlug = useTenantSlug();
  const prefix = tenantSlug ? `/${tenantSlug}` : "";

  // Prefix all nav hrefs with tenant slug
  const prefixedNavGroups = navGroups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      href: `${prefix}${item.href}`
    }))
  }));
```

Then replace all references to `navGroups` in the JSX with `prefixedNavGroups`. The `isActive` function already uses `pathname` which will include the tenant prefix, so it should work correctly.

Update the `initialOpen` function and `isActive` to use `prefixedNavGroups`:

```typescript
const initialOpen = () => {
  const set = new Set<string>();
  for (const group of prefixedNavGroups) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        set.add(group.label);
        break;
      }
    }
  }
  set.add("Dashboards");
  return set;
};
```

And in the JSX, change `navGroups.map` to `prefixedNavGroups.map`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/sidebar-nav.tsx
git commit -m "feat: prefix sidebar nav links with tenant slug from URL"
```

---

### Task 8: Update SetupGuard with proper loading state and tenant-aware redirect (Gap #4)

**Files:**

- Modify: `apps/web/components/setup-guard.tsx`

- [ ] **Step 1: Rewrite setup-guard.tsx**

Replace `apps/web/components/setup-guard.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useTenantSlug } from "../hooks/use-tenant-slug";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function SetupGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const tenantSlug = useTenantSlug();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || !session) return;

    const token = (session as any).accessToken ?? "";
    // Prefer tenant slug from URL, fall back to session
    const slug = tenantSlug ?? (session as any).user?.tenantSlug ?? "";

    // Skip check if no tenant context (e.g., platform admin)
    if (!slug) {
      setChecked(true);
      return;
    }

    fetch(`${API_BASE}/api/v1/setup/progress`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Tenant-Slug": slug
      }
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.data && !json.data.isCompleted) {
          router.replace(`/${slug}/setup?step=${json.data.currentStep}`);
        } else {
          setChecked(true);
        }
      })
      .catch(() => {
        // If check fails, allow access (don't block on network errors)
        setChecked(true);
      });
  }, [session, status, router, tenantSlug]);

  if (!checked) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          <p className="text-sm font-medium text-slate-400">Checking setup status...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/setup-guard.tsx
git commit -m "feat: improve SetupGuard with branded spinner and tenant-aware redirect (Gap #4)"
```

---

### Task 9: Update entity-provider and useApiContext with URL-based tenant slug (Gap #5)

**Files:**

- Modify: `apps/web/components/entity-provider.tsx`
- Modify: `apps/web/components/use-api-context.ts`

- [ ] **Step 1: Update entity-provider.tsx to prefer URL-based tenant slug**

In `apps/web/components/entity-provider.tsx`, add the import:

```typescript
import { useTenantSlug } from "../hooks/use-tenant-slug";
```

Inside `EntityProvider`, replace the `tenantSlug` line:

```typescript
// Replace:
const tenantSlug = session?.user?.tenantSlug;

// With:
const urlTenantSlug = useTenantSlug();
const tenantSlug = urlTenantSlug ?? session?.user?.tenantSlug;
```

- [ ] **Step 2: Update use-api-context.ts to prefer URL-based tenant slug**

Replace `apps/web/components/use-api-context.ts`:

```typescript
"use client";

import { useSession } from "next-auth/react";
import type { ApiContext } from "../lib/gl-api";
import { useEntity } from "./entity-provider";
import { useTenantSlug } from "../hooks/use-tenant-slug";

export function useApiContext(): ApiContext | null {
  const { data: session } = useSession();
  const { entityId } = useEntity();
  const accessToken = session?.accessToken;
  const urlTenantSlug = useTenantSlug();
  const tenantSlug = urlTenantSlug ?? session?.user?.tenantSlug;

  if (!accessToken || !entityId) {
    return null;
  }

  return { accessToken, entityId, tenantSlug };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/entity-provider.tsx apps/web/components/use-api-context.ts
git commit -m "feat: extract tenant slug from URL in entity-provider and useApiContext (Gap #5)"
```

---

### Task 10: Update setup wizard with tenant-aware redirects and full pre-fill (Gap #2)

**Files:**

- Modify: `apps/web/app/[tenant]/(setup)/setup/page.tsx`

- [ ] **Step 1: Update setup page for tenant-aware routing and pre-fill**

In `apps/web/app/[tenant]/(setup)/setup/page.tsx`, make these changes:

1. Add import for `useParams`:

```typescript
import { useRouter, useParams } from "next/navigation";
```

2. Inside the component, extract tenant slug from params:

```typescript
const params = useParams();
const tenantSlug = typeof params.tenant === "string" ? params.tenant : "";
```

3. Update the `apiHeaders` callback to use URL-based tenant slug:

```typescript
const apiHeaders = useCallback((): HeadersInit => {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`
  };
  if (tenantSlug) headers["X-Tenant-Slug"] = tenantSlug;
  return headers;
}, [accessToken, tenantSlug]);
```

4. Update the redirect when setup is already completed (around line 198):

```typescript
// Replace: router.replace("/dashboard");
router.replace(`/${tenantSlug}/dashboard`);
```

5. Update the redirect on setup completion (around line 312):

```typescript
// Replace: router.replace("/dashboard");
router.replace(`/${tenantSlug}/dashboard`);
```

6. Update the redirect when unauthenticated (around line 404):

```typescript
// Replace: router.replace("/login");
router.replace(`/${tenantSlug}/login`);
```

7. Expand the pre-fill section (around line 216-219) to include countryCode and maxProperties:

```typescript
} else if (tenantInfo) {
  // Pre-fill from provisioning data
  setCorporateName(tenantInfo.name ?? "");
  if (tenantInfo.countryCode) setCorporateCountry(tenantInfo.countryCode);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/\[tenant\]/\(setup\)/setup/page.tsx
git commit -m "feat: update setup wizard with tenant-aware redirects and full pre-fill (Gap #2)"
```

---

### Task 11: Update dashboard layout with tenant-aware signOut redirect

**Files:**

- Modify: `apps/web/app/[tenant]/(dashboard)/layout.tsx`

- [ ] **Step 1: Update sign-out redirect in dashboard layout**

The dashboard layout is a server component. The `signOut` action uses `redirectTo: "/login"`. This needs to include the tenant slug. Since this is a server component and we can extract the tenant from the route params:

In `apps/web/app/[tenant]/(dashboard)/layout.tsx`, update the component signature to accept params:

```typescript
export default async function DashboardLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const session = await auth();
```

Then update the signOut action:

```typescript
<form
  action={async () => {
    "use server";
    await signOut({ redirectTo: `/${tenant}/login` });
  }}
>
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/\[tenant\]/\(dashboard\)/layout.tsx
git commit -m "feat: update dashboard layout signOut to redirect to tenant login"
```

---

### Task 12: Update [tenant]/(dashboard)/page.tsx root redirect

**Files:**

- Modify: `apps/web/app/[tenant]/(dashboard)/page.tsx`

- [ ] **Step 1: Update root page redirect to include tenant slug**

Replace `apps/web/app/[tenant]/(dashboard)/page.tsx`:

```typescript
import { redirect } from "next/navigation";

export default async function TenantRootPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  redirect(`/${tenant}/dashboard`);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/\[tenant\]/\(dashboard\)/page.tsx
git commit -m "feat: update tenant root redirect to /{tenant}/dashboard"
```

---

### Task 13: Update platform onboard page to show new URL format

**Files:**

- Modify: `apps/web/app/(platform)/platform/tenants/onboard/page.tsx`

- [ ] **Step 1: The provisioning SSE already returns the URL from the backend**

The `provisionResult.url` is set from the SSE response. Since we updated the backend in Task 1 to emit `/${tenant.slug}/login`, this should automatically show the correct URL. No frontend change needed here — verify the backend change is correct.

Verify that the SSE handler in the onboard page reads the URL from the `complete` event and displays it via `provisionResult.url`. This is already the case (lines 705-711 in the original file).

- [ ] **Step 2: Commit (if any changes were needed)**

No commit needed — the backend change in Task 1 handles this.

---

### Task 14: Fix relative import paths in moved files

**Files:**

- All moved files under `apps/web/app/[tenant]/`

- [ ] **Step 1: Fix import paths in moved page files**

Files moved from `(dashboard)/` to `[tenant]/(dashboard)/` are one level deeper. Relative imports need updating. For example, in `(dashboard)/layout.tsx` the import was:

```typescript
import { SetupGuard } from "../../components/setup-guard";
```

In `[tenant]/(dashboard)/layout.tsx` it needs to be:

```typescript
import { SetupGuard } from "../../../components/setup-guard";
```

Apply this pattern to ALL moved files. The `[tenant]` directory adds one extra `../` level. Run a search to find all relative imports:

```bash
cd apps/web/app/\[tenant\]
grep -r "from \"\.\./" --include="*.tsx" --include="*.ts" -l
```

For each file, add one more `../` to the import path. For example:

- `../../components/` becomes `../../../components/`
- `../../lib/` becomes `../../../lib/`
- `../../auth` becomes `../../../auth`

The setup page (moved from `(setup)/setup/page.tsx` to `[tenant]/(setup)/setup/page.tsx`) similarly needs path adjustments:

- `../../../components/` becomes `../../../../components/`
- `../../../lib/` becomes `../../../../lib/`

- [ ] **Step 2: Verify the app builds**

Run: `cd apps/web && npx next build`

Fix any remaining import path errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix: update relative import paths for [tenant] route structure"
```

---

### Task 15: Verify the complete flow end-to-end

- [ ] **Step 1: Start the dev servers**

```bash
cd apps/api && npm run dev &
cd apps/web && npm run dev &
```

- [ ] **Step 2: Test provisioning creates the correct URL**

Provision a test tenant. Verify the activation email / SSE response shows `http://localhost:3001/essque-hotels/login` (not `?tenant=` format).

- [ ] **Step 3: Test login page at /{slug}/login**

Navigate to `http://localhost:3001/essque-hotels/login`. Verify:

- Tenant name is displayed (no dropdown)
- Tenant slug is shown in a badge
- Login works and redirects to `/essque-hotels/dashboard`

- [ ] **Step 4: Test invalid tenant slug**

Navigate to `http://localhost:3001/nonexistent-tenant/login`. Verify the "Tenant Not Found" error page.

- [ ] **Step 5: Test setup redirect**

For a fresh tenant (setup incomplete), verify that accessing `/essque-hotels/dashboard` redirects to `/essque-hotels/setup?step=1`.

- [ ] **Step 6: Test setup pre-fill**

Verify step 1 pre-fills corporate name and country code from provisioning data.

- [ ] **Step 7: Test setup completion validation**

Try completing setup without creating entities. Verify error message: "At least one entity (property) must exist..."

- [ ] **Step 8: Test sidebar navigation**

After setup, verify all sidebar links use `/{tenant}/...` prefix.

- [ ] **Step 9: Test sign out**

Sign out and verify redirect to `/{tenant}/login`.

- [ ] **Step 10: Final commit**

```bash
git add -A
git commit -m "verified: end-to-end tenant slug URL routing working"
```
