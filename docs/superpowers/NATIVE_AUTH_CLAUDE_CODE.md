# NATIVE AUTH — Claude Code Implementation Guide

> **Sprint:** Auth Replacement
> **Replaces:** Keycloak OIDC + NextAuth
> **Spec:** HFP_Native_Auth_Spec_v1.md

---

## CONTEXT

HFP currently depends on Keycloak for authentication and NextAuth for session management in the Next.js frontend. This causes issues when Keycloak realms aren't provisioned per tenant. We're replacing both with a native auth system: bcrypt passwords, JWT access/refresh tokens, Redis sessions, httpOnly cookies.

**Critical URL change:** Tenant URLs switch from `/{tenant-slug}/...` to `/t/{tenant_code}/...` where `tenant_code` is an 8-char opaque hex string (not the human-readable slug).

---

## TASK 1: Add `tenant_code` Column to Registry Tenants

### 1.1 Migration (registry schema)

```sql
-- Migration: add_tenant_code_to_tenants
ALTER TABLE hfp_registry.tenants
  ADD COLUMN tenant_code VARCHAR(8);

-- Generate codes for existing tenants
UPDATE hfp_registry.tenants
  SET tenant_code = LEFT(MD5(id::text || created_at::text || random()::text), 8)
  WHERE tenant_code IS NULL;

ALTER TABLE hfp_registry.tenants
  ALTER COLUMN tenant_code SET NOT NULL;

CREATE UNIQUE INDEX idx_tenants_tenant_code ON hfp_registry.tenants(tenant_code);
```

### 1.2 Prisma model update (registry schema)

```prisma
model Tenant {
  // ... existing fields ...
  tenantCode  String  @unique @map("tenant_code") @db.VarChar(8)
}
```

### 1.3 Tenant code generation utility

```typescript
import crypto from "crypto";

function generateTenantCode(tenantId: string, createdAt: Date): string {
  const salt = crypto.randomBytes(8).toString("hex");
  const hash = crypto
    .createHash("sha256")
    .update(`${tenantId}:${createdAt.toISOString()}:${salt}`)
    .digest("hex");
  return hash.substring(0, 8);
}
```

Add this to the tenant provisioning wizard — generate `tenant_code` at creation time.

---

## TASK 2: Add Password Columns to Users Table

### 2.1 Migration (tenant schema)

```sql
-- Migration: add_auth_columns_to_users
ALTER TABLE users
  ADD COLUMN password_hash VARCHAR(255),
  ADD COLUMN password_changed_at TIMESTAMPTZ,
  ADD COLUMN failed_login_attempts INTEGER DEFAULT 0,
  ADD COLUMN locked_until TIMESTAMPTZ,
  ADD COLUMN must_change_password BOOLEAN DEFAULT false,
  ADD COLUMN password_reset_token VARCHAR(255),
  ADD COLUMN password_reset_expires TIMESTAMPTZ,
  ADD COLUMN last_login_at TIMESTAMPTZ,
  ADD COLUMN last_login_ip VARCHAR(45);
```

### 2.2 Prisma model update (tenant schema)

```prisma
model User {
  // ... existing fields ...
  passwordHash         String?   @map("password_hash") @db.VarChar(255)
  passwordChangedAt    DateTime? @map("password_changed_at")
  failedLoginAttempts  Int       @default(0) @map("failed_login_attempts")
  lockedUntil          DateTime? @map("locked_until")
  mustChangePassword   Boolean   @default(false) @map("must_change_password")
  passwordResetToken   String?   @map("password_reset_token") @db.VarChar(255)
  passwordResetExpires DateTime? @map("password_reset_expires")
  lastLoginAt          DateTime? @map("last_login_at")
  lastLoginIp          String?   @map("last_login_ip") @db.VarChar(45)
}
```

### 2.3 Seed default passwords for existing users

```typescript
import bcrypt from "bcrypt";

const DEFAULT_PASSWORD = "ChangeMe123!";
const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

// Update all users without passwords
await prisma.user.updateMany({
  where: { passwordHash: null },
  data: {
    passwordHash: hash,
    mustChangePassword: true
  }
});
```

---

## TASK 3: Install Dependencies

```bash
# API
cd apps/api
npm install bcrypt jsonwebtoken @fastify/cookie @fastify/rate-limit
npm install -D @types/bcrypt @types/jsonwebtoken

# Web — remove NextAuth
cd apps/web
npm uninstall next-auth @auth/core
```

**Note:** Check if `@fastify/cookie` is already installed. Check if `@fastify/rate-limit` is already installed. Only install what's missing.

---

## TASK 4: Auth Service (`apps/api/src/services/auth.service.ts`)

Create the core auth service:

```typescript
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const ACCESS_EXPIRY = parseInt(process.env.JWT_ACCESS_EXPIRY || "900"); // 15 min
const REFRESH_EXPIRY = parseInt(process.env.JWT_REFRESH_EXPIRY || "604800"); // 7 days
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || "12");
const MAX_FAILED = parseInt(process.env.MAX_FAILED_ATTEMPTS || "5");
const LOCKOUT_MIN = parseInt(process.env.LOCKOUT_DURATION_MINUTES || "15");

export class AuthService {
  constructor(
    private redis: Redis,
    private registryPrisma: PrismaClient
  ) {}

  async login(
    email: string,
    password: string,
    tenantCode: string,
    meta: { ip: string; userAgent: string }
  ) {
    // 1. Resolve tenant
    const tenant = await this.registryPrisma.tenant.findUnique({
      where: { tenantCode }
    });
    if (!tenant) throw new UnauthorizedError("Invalid credentials");

    // 2. Get tenant prisma client
    const tenantPrisma = await getTenantPrisma(tenant.databaseName);

    // 3. Find user
    const user = await tenantPrisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } }
        }
      }
    });
    if (!user || !user.passwordHash) throw new UnauthorizedError("Invalid credentials");

    // 4. Check lock
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMin = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedError(`Account locked. Try again in ${remainingMin} minutes.`);
    }

    // 5. Verify password
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1;
      const updateData: any = { failedLoginAttempts: attempts };
      if (attempts >= MAX_FAILED) {
        updateData.lockedUntil = new Date(Date.now() + LOCKOUT_MIN * 60000);
      }
      await tenantPrisma.user.update({ where: { id: user.id }, data: updateData });
      throw new UnauthorizedError("Invalid credentials");
    }

    // 6. Reset failed attempts + update last login
    await tenantPrisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: meta.ip
      }
    });

    // 7. Build roles & permissions
    const roles = user.userRoles.map((ur) => ur.role.code);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code))
      )
    ];

    // 8. Generate session + tokens
    const sessionId = crypto.randomUUID();

    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        tenantId: tenant.id,
        tenantCode: tenant.tenantCode,
        entityId: user.entityId,
        roles,
        permissions,
        type: "access"
      },
      JWT_SECRET,
      { expiresIn: ACCESS_EXPIRY, algorithm: "HS256" }
    );

    const refreshToken = crypto.randomBytes(48).toString("hex");
    const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");

    // 9. Store in Redis
    await this.redis.setex(
      `session:${tenant.id}:${user.id}:${sessionId}`,
      REFRESH_EXPIRY,
      JSON.stringify({
        userId: user.id,
        tenantId: tenant.id,
        tenantCode: tenant.tenantCode,
        email: user.email,
        roles,
        deviceInfo: meta.userAgent,
        ipAddress: meta.ip,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString()
      })
    );

    await this.redis.setex(
      `refresh:${refreshTokenHash}`,
      REFRESH_EXPIRY,
      JSON.stringify({
        userId: user.id,
        tenantId: tenant.id,
        sessionId,
        issuedAt: new Date().toISOString()
      })
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_EXPIRY,
      mustChangePassword: user.mustChangePassword,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles
      }
    };
  }

  async refresh(refreshToken: string) {
    const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const stored = await this.redis.get(`refresh:${tokenHash}`);

    if (!stored) {
      // Potential token theft — could invalidate all user sessions here
      throw new UnauthorizedError("Invalid refresh token");
    }

    const { userId, tenantId, sessionId } = JSON.parse(stored);

    // Delete old refresh token
    await this.redis.del(`refresh:${tokenHash}`);

    // Verify session still exists
    const sessionKey = `session:${tenantId}:${userId}:${sessionId}`;
    const session = await this.redis.get(sessionKey);
    if (!session) throw new UnauthorizedError("Session expired");

    // Load tenant and user for fresh claims
    const tenant = await this.registryPrisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new UnauthorizedError("Invalid tenant");

    const tenantPrisma = await getTenantPrisma(tenant.databaseName);
    const user = await tenantPrisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } }
        }
      }
    });
    if (!user) throw new UnauthorizedError("User not found");

    const roles = user.userRoles.map((ur) => ur.role.code);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code))
      )
    ];

    // Generate new tokens
    const newAccessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        tenantId: tenant.id,
        tenantCode: tenant.tenantCode,
        entityId: user.entityId,
        roles,
        permissions,
        type: "access"
      },
      JWT_SECRET,
      { expiresIn: ACCESS_EXPIRY, algorithm: "HS256" }
    );

    const newRefreshToken = crypto.randomBytes(48).toString("hex");
    const newRefreshHash = crypto.createHash("sha256").update(newRefreshToken).digest("hex");

    await this.redis.setex(
      `refresh:${newRefreshHash}`,
      REFRESH_EXPIRY,
      JSON.stringify({ userId, tenantId, sessionId, issuedAt: new Date().toISOString() })
    );

    // Update session activity
    const sessionData = JSON.parse(session);
    sessionData.lastActiveAt = new Date().toISOString();
    await this.redis.setex(sessionKey, REFRESH_EXPIRY, JSON.stringify(sessionData));

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: ACCESS_EXPIRY
    };
  }

  async logout(userId: string, tenantId: string, refreshToken?: string) {
    if (refreshToken) {
      const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
      const stored = await this.redis.get(`refresh:${tokenHash}`);
      if (stored) {
        const { sessionId } = JSON.parse(stored);
        await this.redis.del(`refresh:${tokenHash}`);
        await this.redis.del(`session:${tenantId}:${userId}:${sessionId}`);
      }
    }
  }

  async logoutAll(userId: string, tenantId: string) {
    const sessionKeys = await this.redis.keys(`session:${tenantId}:${userId}:*`);
    if (sessionKeys.length > 0) {
      await this.redis.del(...sessionKeys);
    }
    // Also clear all refresh tokens for this user — requires scanning
    // In production, maintain a user->refreshTokens index
  }

  async changePassword(
    userId: string,
    tenantDbName: string,
    currentPassword: string,
    newPassword: string
  ) {
    const tenantPrisma = await getTenantPrisma(tenantDbName);
    const user = await tenantPrisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new Error("User not found");

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedError("Current password is incorrect");

    // Validate new password policy
    validatePasswordPolicy(newPassword);

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await tenantPrisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: hash,
        passwordChangedAt: new Date(),
        mustChangePassword: false
      }
    });
  }
}

function validatePasswordPolicy(password: string) {
  if (password.length < 8) throw new ValidationError("Password must be at least 8 characters");
  if (!/[A-Z]/.test(password))
    throw new ValidationError("Password must contain an uppercase letter");
  if (!/[a-z]/.test(password))
    throw new ValidationError("Password must contain a lowercase letter");
  if (!/[0-9]/.test(password)) throw new ValidationError("Password must contain a digit");
}
```

---

## TASK 5: Auth Routes (`apps/api/src/routes/auth.ts`)

Register these routes on the Fastify instance. All `/auth/*` routes are public (no auth hook). Set cookies on response.

```typescript
// Route: POST /auth/login
{
  method: 'POST',
  url: '/auth/login',
  schema: {
    body: {
      type: 'object',
      required: ['email', 'password', 'tenantCode'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 1 },
        tenantCode: { type: 'string', minLength: 8, maxLength: 8 },
      },
    },
  },
  handler: async (request, reply) => {
    const { email, password, tenantCode } = request.body;
    const result = await authService.login(email, password, tenantCode, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] || 'unknown',
    });

    const isSecure = process.env.COOKIE_SECURE === 'true';

    reply
      .setCookie('hfp_access_token', result.accessToken, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'strict',
        path: '/',
        maxAge: result.expiresIn,
      })
      .setCookie('hfp_refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'strict',
        path: '/auth/refresh',
        maxAge: 604800, // 7 days
      })
      .send(result);
  },
}

// Route: POST /auth/refresh
// Route: POST /auth/logout
// Route: POST /auth/change-password
// Route: GET  /auth/me
// Route: GET  /auth/tenant/:tenantCode (validate tenant exists — public)
// Route: POST /auth/forgot-password
// Route: POST /auth/reset-password
```

---

## TASK 6: Replace Auth Plugin (`apps/api/src/plugins/auth.ts`)

Replace the current Keycloak/dev-auth logic with JWT verification:

```typescript
fastify.addHook("onRequest", async (request, reply) => {
  // Skip auth routes
  if (request.url.startsWith("/auth/")) return;
  if (request.url === "/health") return;

  // Get token from cookie or Authorization header
  const token =
    request.cookies?.hfp_access_token || request.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return reply.code(401).send({ error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    request.user = {
      id: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      tenantCode: payload.tenantCode,
      entityId: payload.entityId,
      roles: payload.roles,
      permissions: payload.permissions
    };
    request.tenantId = payload.tenantId;
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return reply.code(401).send({ error: "Token expired", code: "TOKEN_EXPIRED" });
    }
    return reply.code(401).send({ error: "Invalid token" });
  }
});
```

---

## TASK 7: Next.js Frontend Changes

### 7.1 Remove NextAuth

- Delete `apps/web/auth.ts` (or `[...nextauth]` route)
- Remove all `import { ... } from 'next-auth'` references
- Remove `SessionProvider` from layout/providers

### 7.2 New Middleware (`apps/web/middleware.ts`)

Replace the existing middleware with tenant-code-based routing:

```typescript
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/", "/t/[^/]+/login", "/t/[^/]+/forgot-password", "/t/[^/]+/reset-password"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static files, API routes, etc.
  if (pathname.startsWith("/_next") || pathname.startsWith("/api") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // Allow public paths
  if (isPublicPath(pathname)) return NextResponse.next();

  // Check for access token cookie
  const accessToken = request.cookies.get("hfp_access_token");
  if (!accessToken) {
    const tenantCode = extractTenantCode(pathname);
    if (tenantCode) {
      return NextResponse.redirect(new URL(`/t/${tenantCode}/login`, request.url));
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

function isPublicPath(path: string): boolean {
  return path === "/" || /^\/t\/[a-z0-9]{8}\/(login|forgot-password|reset-password)$/.test(path);
}

function extractTenantCode(path: string): string | null {
  const match = path.match(/^\/t\/([a-z0-9]{8})/);
  return match ? match[1] : null;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
```

### 7.3 Landing Page (`apps/web/app/page.tsx`)

Simple tenant code entry form:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LandingPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = code.trim().toLowerCase();
    if (trimmed.length !== 8) {
      setError("Please enter a valid 8-character organisation code");
      return;
    }
    // Validate tenant exists
    const res = await fetch(`/api/proxy/auth/tenant/${trimmed}`);
    if (res.ok) {
      router.push(`/t/${trimmed}/login`);
    } else {
      setError("Organisation not found");
    }
  };

  return (
    <div>
      <h1>HospitalityFinancePro</h1>
      <form onSubmit={handleSubmit}>
        <label>Enter your organisation code</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={8}
          placeholder="e.g. a3f8b2c1"
        />
        {error && <p className="error">{error}</p>}
        <button type="submit">Continue</button>
      </form>
    </div>
  );
}
```

### 7.4 Login Page (`apps/web/app/t/[code]/login/page.tsx`)

```tsx
"use client";
import { useState } from "react";
import { useRouter, useParams } from "next/navigation";

export default function LoginPage() {
  const { code } = useParams();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/proxy/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, tenantCode: code }),
      credentials: "include" // Important for cookies
    });

    const data = await res.json();
    setLoading(false);

    if (res.ok) {
      if (data.mustChangePassword) {
        router.push(`/t/${code}/change-password`);
      } else {
        router.push(`/t/${code}/dashboard`);
      }
    } else {
      setError(data.error || "Login failed");
    }
  };

  return (
    <div>
      <h1>Sign In</h1>
      <form onSubmit={handleLogin}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
```

### 7.5 Update All Tenant Routes

All existing routes under `/{tenant-slug}/...` must be moved to `/t/{code}/...`:

```
OLD: /essque-hotels/dashboard     → NEW: /t/a3f8b2c1/dashboard
OLD: /essque-hotels/financials    → NEW: /t/a3f8b2c1/financials
OLD: /essque-hotels/transfer-desk → NEW: /t/a3f8b2c1/transfer-desk
OLD: /essque-hotels/admin         → NEW: /t/a3f8b2c1/admin
```

In Next.js App Router this means renaming `app/[tenant]/...` to `app/t/[code]/...`.

---

## TASK 8: Environment Variables

Add to `apps/api/.env`:

```env
# Native Auth
JWT_SECRET=your-256-bit-random-hex-string-here
JWT_ACCESS_EXPIRY=900
JWT_REFRESH_EXPIRY=604800
BCRYPT_SALT_ROUNDS=12
MAX_FAILED_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=15
COOKIE_DOMAIN=localhost
COOKIE_SECURE=false
```

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## TASK 9: Rate Limiting

Register `@fastify/rate-limit` on auth routes:

```typescript
await fastify.register(import("@fastify/rate-limit"), {
  global: false // Don't apply globally
});

// Apply to login route
fastify.post("/auth/login", {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: "15 minutes"
    }
  },
  handler: loginHandler
});
```

---

## TASK 10: Tests

### 10.1 Auth Service Tests

```typescript
describe("AuthService", () => {
  it("should login with valid credentials");
  it("should reject invalid password");
  it("should reject invalid tenant code");
  it("should lock account after 5 failed attempts");
  it("should unlock account after lockout expires");
  it("should refresh access token with valid refresh token");
  it("should reject reuse of revoked refresh token");
  it("should logout and invalidate session");
  it("should logout all sessions");
  it("should enforce password policy on change");
  it("should force password change when mustChangePassword is true");
});
```

### 10.2 Auth Plugin Tests

```typescript
describe("Auth Plugin", () => {
  it("should allow access with valid JWT");
  it("should reject expired JWT with TOKEN_EXPIRED code");
  it("should reject invalid JWT");
  it("should skip auth on /auth/* routes");
  it("should skip auth on /health");
  it("should extract user and tenantId from JWT");
});
```

---

## IMPLEMENTATION ORDER

1. **Task 3** — Install dependencies (bcrypt, jsonwebtoken, @fastify/cookie)
2. **Task 1** — Migration: `tenant_code` on tenants table
3. **Task 2** — Migration: password columns on users table
4. **Task 8** — Environment variables
5. **Task 4** — Auth service
6. **Task 5** — Auth routes
7. **Task 6** — Replace auth plugin (API side)
8. **Task 7** — Next.js: remove NextAuth, new middleware, landing page, login page, route rename
9. **Task 9** — Rate limiting
10. **Task 10** — Tests

---

## KEY RULES

- **Cookies, not localStorage** — tokens stored in httpOnly cookies only
- **JWT_SECRET must be strong** — 256-bit minimum, never commit to repo
- **Refresh token rotation** — every refresh invalidates the old token
- **Password hash only** — never log or return plaintext passwords
- **Always lowercase email** — normalise on input
- **Tenant code = 8 chars, lowercase hex** — validated by regex `^[a-z0-9]{8}$`
- **No Keycloak references should remain** — clean removal of all OIDC config
- **Rate limit login endpoint** — prevent brute force
- **CRLF in tenant code URL** — ensure middleware regex handles edge cases

---

## EXPECTED OUTCOMES

1. `GET /` shows tenant code entry page
2. Valid code → redirects to `/t/{code}/login`
3. Login with email + password → sets httpOnly cookies → redirects to `/t/{code}/dashboard`
4. All protected routes require valid JWT cookie
5. Token refresh works transparently
6. Logout clears cookies and Redis session
7. Account locks after 5 failed attempts
8. Password change enforced when `mustChangePassword = true`
9. No Keycloak dependency remains
10. All existing functionality works under new `/t/{code}/...` URL structure
