# HospitalityFinancePro — Native Authentication System

> **Version:** 1.0 · **Date:** April 2026 · **Status:** Draft
> **Replaces:** Keycloak OIDC integration
> **Stack:** Node.js/Fastify API, Next.js 15, PostgreSQL, Redis

---

## 1. Introduction

This specification defines a native authentication system for HFP, replacing the current Keycloak OIDC dependency. All authentication is handled internally by the HFP API using bcrypt password hashing, JWT access/refresh token pairs, and Redis-backed session management.

### 1.1 Why Replace Keycloak

- Eliminates external dependency — no need to provision Keycloak realms per tenant
- Simplifies deployment (one less container to manage)
- Full control over the auth flow, password policies, and session management
- Removes the failure point seen when Keycloak realms are not provisioned
- Better suited for a SaaS product where tenant onboarding must be self-service

### 1.2 Key Design Decisions

- **Tenant code in URL** — 8-character opaque hash (not slug name) for security: `/t/{tenant_code}/login`
- **No NextAuth** — replaced with custom Next.js middleware and API-issued JWTs
- **JWT + Refresh Token** — short-lived access tokens (15 min), longer refresh tokens (7 days) with rotation
- **Redis sessions** — server-side session store for token revocation and concurrent session management
- **bcrypt** — industry standard password hashing with configurable salt rounds

---

## 2. Tenant Code System

### 2.1 Tenant Code Generation

Each tenant gets an 8-character opaque code generated at provisioning time. This code is used in URLs instead of the tenant slug.

```
Slug:         essque-hotels
Tenant Code:  a3f8b2c1
Login URL:    /t/a3f8b2c1/login
Dashboard:    /t/a3f8b2c1/dashboard
```

Generation method: first 8 characters of a SHA-256 hash of `{tenant_id}:{created_at}:{random_salt}`, lowercased hex. Collision-checked at insert time.

### 2.2 Schema Change — tenants table

```sql
ALTER TABLE hfp_registry.tenants
  ADD COLUMN tenant_code VARCHAR(8) UNIQUE NOT NULL;

CREATE UNIQUE INDEX idx_tenants_tenant_code ON hfp_registry.tenants(tenant_code);
```

### 2.3 Tenant Lookup

The API resolves tenant context from the tenant code in the URL path or the `X-Tenant-Code` header:

```typescript
// URL: /t/a3f8b2c1/api/...
// Header: X-Tenant-Code: a3f8b2c1
const tenant = await registry.tenants.findUnique({
  where: { tenantCode: req.params.tenantCode }
});
```

### 2.4 Landing Page

`GET /` renders a simple page where the user enters their tenant code (or it's bookmarked). Options:

- **Option A — Code entry form:** Single input field "Enter your organisation code" → redirects to `/t/{code}/login`
- **Option B — Direct bookmark:** Users bookmark `/t/a3f8b2c1/login` directly, bypassing the landing page entirely

Both should be supported. The landing page validates the code exists before redirecting.

---

## 3. User & Credential Model

### 3.1 Schema — users table (tenant schema)

The existing users table needs password-related columns:

```sql
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

### 3.2 Password Hashing

```typescript
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
```

### 3.3 Password Policy

| Rule                 | Value                  |
| -------------------- | ---------------------- |
| Minimum length       | 8 characters           |
| Require uppercase    | At least 1             |
| Require lowercase    | At least 1             |
| Require digit        | At least 1             |
| Require special char | Optional (recommended) |
| Max failed attempts  | 5 (then lock 15 min)   |
| Password history     | Last 3 (no reuse)      |
| Session timeout      | 30 min inactivity      |

---

## 4. Authentication Flow

### 4.1 Login Flow

```
User                    Next.js                   API                      Redis
 |                        |                        |                        |
 |-- GET /t/{code}/login ->|                        |                        |
 |<- Login form ----------|                        |                        |
 |                        |                        |                        |
 |-- POST email+password ->|                        |                        |
 |                        |-- POST /auth/login ---->|                        |
 |                        |   {email, password,     |                        |
 |                        |    tenantCode}          |                        |
 |                        |                        |-- Resolve tenant ------>|
 |                        |                        |-- Verify password ----->|
 |                        |                        |-- Generate JWT -------->|
 |                        |                        |-- Store session ------->|
 |                        |<- {accessToken,        |                        |
 |                        |    refreshToken,        |                        |
 |                        |    expiresIn} ----------|                        |
 |                        |                        |                        |
 |                        |-- Set httpOnly cookies ->|                        |
 |<- Redirect /t/{code}/dashboard                  |                        |
```

### 4.2 Token Structure

**Access Token (JWT, 15 min):**

```json
{
  "sub": "user-uuid",
  "email": "admin@essquehotels.com",
  "tenantId": "tenant-uuid",
  "tenantCode": "a3f8b2c1",
  "entityId": "entity-uuid",
  "roles": ["ADMIN"],
  "permissions": ["gl:read", "gl:write", "transfer-desk:execute"],
  "type": "access",
  "iat": 1714000000,
  "exp": 1714000900
}
```

**Refresh Token (opaque, 7 days):**

```
Stored in Redis as:
  Key:   refresh:{token-hash}
  Value: { userId, tenantId, deviceId, issuedAt, expiresAt }
  TTL:   7 days
```

### 4.3 Token Storage (Client Side)

| Token         | Storage         | HttpOnly | Secure | SameSite |
| ------------- | --------------- | -------- | ------ | -------- |
| Access Token  | httpOnly cookie | Yes      | Yes\*  | Strict   |
| Refresh Token | httpOnly cookie | Yes      | Yes\*  | Strict   |

\*Secure=false in development (localhost)

Tokens are **never** stored in localStorage or sessionStorage.

### 4.4 Token Refresh Flow

```
Client                  API                         Redis
 |                       |                            |
 |-- Request with        |                            |
 |   expired access ---->|                            |
 |<- 401 Unauthorized ---|                            |
 |                       |                            |
 |-- POST /auth/refresh  |                            |
 |   {refreshToken} ---->|                            |
 |                       |-- Validate refresh token -->|
 |                       |-- Rotate: delete old,       |
 |                       |   create new refresh ------->|
 |                       |-- Generate new access JWT -->|
 |<- {newAccessToken,    |                            |
 |    newRefreshToken} --|                            |
```

**Refresh token rotation:** Each refresh issues a new refresh token and invalidates the old one. If a revoked refresh token is used, ALL sessions for that user are invalidated (potential token theft detected).

### 4.5 Logout

```
POST /auth/logout
- Delete refresh token from Redis
- Clear httpOnly cookies
- Optionally: invalidate all sessions (logout everywhere)
```

---

## 5. API Endpoints

### 5.1 Public Endpoints (no auth required)

| Method | Path                       | Description                        |
| ------ | -------------------------- | ---------------------------------- |
| POST   | `/auth/login`              | Authenticate with email + password |
| POST   | `/auth/refresh`            | Refresh access token               |
| POST   | `/auth/forgot-password`    | Request password reset email       |
| POST   | `/auth/reset-password`     | Reset password with token          |
| GET    | `/auth/tenant/:tenantCode` | Validate tenant code exists        |

### 5.2 Protected Endpoints (auth required)

| Method | Path                    | Description              |
| ------ | ----------------------- | ------------------------ |
| POST   | `/auth/logout`          | Logout current session   |
| POST   | `/auth/logout-all`      | Logout all sessions      |
| POST   | `/auth/change-password` | Change own password      |
| GET    | `/auth/me`              | Get current user profile |
| GET    | `/auth/sessions`        | List active sessions     |
| DELETE | `/auth/sessions/:id`    | Revoke specific session  |

### 5.3 Admin Endpoints (ADMIN role required)

| Method | Path                              | Description                   |
| ------ | --------------------------------- | ----------------------------- |
| POST   | `/admin/users/:id/reset-password` | Force password reset for user |
| POST   | `/admin/users/:id/lock`           | Lock user account             |
| POST   | `/admin/users/:id/unlock`         | Unlock user account           |
| GET    | `/admin/users/:id/sessions`       | View user's active sessions   |
| DELETE | `/admin/users/:id/sessions`       | Revoke all user sessions      |

---

## 6. API Auth Plugin — Replacement

Replace the current Keycloak-based auth plugin (`plugins/auth.ts`) with JWT verification.

### 6.1 Request Authentication

```typescript
// plugins/auth.ts
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET; // 256-bit random string
const JWT_ALGORITHM = "HS256";

fastify.decorateRequest("user", null);
fastify.decorateRequest("tenantId", null);

fastify.addHook("onRequest", async (request, reply) => {
  // Skip public routes
  if (isPublicRoute(request.url)) return;

  // Extract token from httpOnly cookie or Authorization header
  const token =
    request.cookies?.hfp_access_token || request.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return reply.code(401).send({ error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM]
    });

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
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
});
```

### 6.2 Role & Permission Checks

```typescript
// Decorator for route-level auth
function requireRole(...roles: string[]) {
  return async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "Not authenticated" });
    if (!roles.some((r) => request.user.roles.includes(r))) {
      return reply.code(403).send({ error: "Insufficient permissions" });
    }
  };
}

function requirePermission(...permissions: string[]) {
  return async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "Not authenticated" });
    if (!permissions.every((p) => request.user.permissions.includes(p))) {
      return reply.code(403).send({ error: "Missing required permissions" });
    }
  };
}
```

---

## 7. Next.js Middleware — Replacement

Replace NextAuth with custom middleware that checks the httpOnly cookie and handles redirects.

### 7.1 Middleware Logic

```typescript
// middleware.ts
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/", "/t/[code]/login", "/t/[code]/forgot-password"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (isPublicPath(pathname)) return NextResponse.next();

  // Check for access token cookie
  const accessToken = request.cookies.get("hfp_access_token");
  if (!accessToken) {
    // Extract tenant code from path
    const tenantCode = extractTenantCode(pathname);
    if (tenantCode) {
      return NextResponse.redirect(new URL(`/t/${tenantCode}/login`, request.url));
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Verify token is not expired (basic check — full verification happens API-side)
  try {
    const payload = decodeJwtPayload(accessToken.value);
    if (payload.exp * 1000 < Date.now()) {
      // Token expired — try refresh on client side
      // Set a flag for the client to trigger refresh
      const response = NextResponse.next();
      response.headers.set("X-Token-Expired", "true");
      return response;
    }
  } catch {
    const tenantCode = extractTenantCode(pathname);
    return NextResponse.redirect(new URL(`/t/${tenantCode}/login`, request.url));
  }

  return NextResponse.next();
}

function extractTenantCode(path: string): string | null {
  const match = path.match(/^\/t\/([a-z0-9]{8})\//);
  return match ? match[1] : null;
}

function decodeJwtPayload(token: string): any {
  const parts = token.split(".");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString());
}
```

### 7.2 URL Structure

```
/                           → Landing page (enter tenant code)
/t/{code}/login             → Login page
/t/{code}/forgot-password   → Forgot password
/t/{code}/reset-password    → Reset password (with token)
/t/{code}/dashboard         → Main dashboard (protected)
/t/{code}/financials/...    → Financials module (protected)
/t/{code}/transfer-desk/... → Transfer Desk (protected)
/t/{code}/admin/...         → Admin pages (protected, ADMIN role)
```

---

## 8. Redis Session Schema

### 8.1 Session Storage

```
Key:    session:{tenantId}:{userId}:{sessionId}
Value:  {
          userId: string,
          tenantId: string,
          tenantCode: string,
          email: string,
          roles: string[],
          deviceInfo: string,
          ipAddress: string,
          createdAt: ISO8601,
          lastActiveAt: ISO8601,
          expiresAt: ISO8601
        }
TTL:    7 days (matches refresh token lifetime)
```

### 8.2 Refresh Token Storage

```
Key:    refresh:{tokenHash}
Value:  {
          userId: string,
          tenantId: string,
          sessionId: string,
          issuedAt: ISO8601,
          expiresAt: ISO8601
        }
TTL:    7 days
```

### 8.3 Session Operations

```typescript
// List active sessions for a user
const keys = await redis.keys(`session:${tenantId}:${userId}:*`);

// Revoke all sessions (logout everywhere)
const keys = await redis.keys(`session:${tenantId}:${userId}:*`);
await redis.del(...keys);

// Revoke specific session
await redis.del(`session:${tenantId}:${userId}:${sessionId}`);
```

---

## 9. Login Endpoint Implementation

### 9.1 POST /auth/login

```typescript
interface LoginRequest {
  email: string;
  password: string;
  tenantCode: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    roles: string[];
  };
}

async function login(req: LoginRequest): Promise<LoginResponse> {
  // 1. Resolve tenant from code
  const tenant = await findTenantByCode(req.tenantCode);
  if (!tenant) throw new UnauthorizedError("Invalid tenant");

  // 2. Find user in tenant database
  const user = await findUserByEmail(tenant.databaseName, req.email);
  if (!user) throw new UnauthorizedError("Invalid credentials");

  // 3. Check account lock
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new UnauthorizedError("Account locked. Try again later.");
  }

  // 4. Verify password
  const valid = await verifyPassword(req.password, user.passwordHash);
  if (!valid) {
    await incrementFailedAttempts(user);
    throw new UnauthorizedError("Invalid credentials");
  }

  // 5. Reset failed attempts
  await resetFailedAttempts(user);

  // 6. Load roles and permissions
  const { roles, permissions } = await loadUserRolesAndPermissions(user);

  // 7. Generate session
  const sessionId = generateSessionId();

  // 8. Generate tokens
  const accessToken = generateAccessToken({
    sub: user.id,
    email: user.email,
    tenantId: tenant.id,
    tenantCode: tenant.tenantCode,
    entityId: user.entityId,
    roles,
    permissions
  });

  const refreshToken = generateRefreshToken();

  // 9. Store session and refresh token in Redis
  await storeSession(tenant.id, user.id, sessionId, {
    email: user.email,
    roles,
    deviceInfo: req.headers["user-agent"],
    ipAddress: req.ip
  });

  await storeRefreshToken(refreshToken, {
    userId: user.id,
    tenantId: tenant.id,
    sessionId
  });

  // 10. Update last login
  await updateLastLogin(user.id, req.ip);

  return {
    accessToken,
    refreshToken,
    expiresIn: 900, // 15 minutes
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles
    }
  };
}
```

---

## 10. Security Considerations

### 10.1 Token Security

- JWT secret: minimum 256-bit random string, stored in environment variable only
- Access tokens: short-lived (15 min), contains minimal claims
- Refresh tokens: opaque random strings, stored as SHA-256 hash in Redis
- Refresh token rotation: old token invalidated on each refresh
- Token theft detection: reuse of revoked refresh token invalidates ALL user sessions

### 10.2 Cookie Security

- `httpOnly: true` — prevents JavaScript access (XSS protection)
- `secure: true` — HTTPS only (except localhost development)
- `sameSite: 'strict'` — CSRF protection
- `path: '/'` — available across all routes
- `domain` — scoped to the HFP domain

### 10.3 Rate Limiting

| Endpoint                   | Limit                       |
| -------------------------- | --------------------------- |
| POST /auth/login           | 10 attempts / 15 min per IP |
| POST /auth/refresh         | 30 / 15 min per user        |
| POST /auth/forgot-password | 3 / hour per email          |

### 10.4 Account Lockout

After 5 consecutive failed login attempts, the account is locked for 15 minutes. The lockout is per-user, not per-IP, to prevent credential stuffing while allowing legitimate users on shared networks.

### 10.5 Environment Variables

```env
# JWT
JWT_SECRET=<256-bit-random-hex>
JWT_ACCESS_EXPIRY=900          # 15 minutes in seconds
JWT_REFRESH_EXPIRY=604800      # 7 days in seconds

# Cookies
COOKIE_DOMAIN=localhost        # Production: .hfp.cloud
COOKIE_SECURE=false            # Production: true

# Password
BCRYPT_SALT_ROUNDS=12
MAX_FAILED_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=15

# Session
SESSION_INACTIVITY_TIMEOUT=1800  # 30 minutes
```

---

## 11. Migration from Keycloak

### 11.1 What to Remove

- `@next-auth` packages from `apps/web`
- NextAuth configuration (`auth.ts`, `[...nextauth]` route)
- Keycloak environment variables (`KEYCLOAK_*`)
- Keycloak realm provisioning logic
- `plugins/auth.ts` Keycloak token verification
- Docker: Keycloak container from `docker-compose.yml` (optional — can keep for gradual migration)

### 11.2 What to Add

- `bcrypt` package to `apps/api`
- `jsonwebtoken` package to `apps/api`
- `@fastify/cookie` plugin (if not already installed)
- Auth routes (`routes/auth.ts`)
- Auth service (`services/auth.service.ts`)
- Custom middleware (`middleware.ts`) in `apps/web`
- Login page component (`/t/[code]/login`)
- Landing page component (`/`)

### 11.3 Existing User Migration

For users that exist in Keycloak but not in HFP's database with passwords:

1. Admin sets a temporary password via `/admin/users/:id/reset-password`
2. User logs in with temporary password
3. System forces password change (`must_change_password = true`)

---

## 12. Password Reset Flow

### 12.1 Forgot Password

```
POST /auth/forgot-password
Body: { email, tenantCode }

1. Find user by email in tenant
2. Generate reset token (64-char random hex)
3. Store token hash + expiry (1 hour) on user record
4. Send email with link: /t/{code}/reset-password?token={token}
5. Always return 200 (don't reveal if email exists)
```

### 12.2 Reset Password

```
POST /auth/reset-password
Body: { token, newPassword, tenantCode }

1. Find user by reset token hash (not expired)
2. Validate new password against policy
3. Hash and store new password
4. Clear reset token
5. Invalidate all existing sessions (force re-login)
6. Return success
```

---

_End of specification._
