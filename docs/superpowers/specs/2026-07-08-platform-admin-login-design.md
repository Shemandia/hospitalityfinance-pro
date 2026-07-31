# Platform Admin Login — Design

**Date:** 2026-07-08
**Status:** Approved (replace the raw API-key prompt with a username/password login)

## Problem

The platform admin pages (`/platform/tenants`, `/platform/tenants/onboard`) gate access by asking the operator to paste the raw `PLATFORM_API_KEY`. The operator shouldn't need to know or handle the machine credential; they forgot it, and pasting secrets into a browser form is poor hygiene.

## Decision

Single config-defined admin account (no database). Username and a **scrypt password hash** live in the web server's environment; the plaintext password is never stored anywhere. On successful login the server sets the same httpOnly `hfp_platform_key` cookie used today, filled from the server's own `HFP_PLATFORM_KEY` env — the raw key disappears from the UI entirely and every existing proxy route keeps working unchanged.

## Components

1. **`apps/web/lib/platform-auth.ts`** (server-only)
   - `hashPassword(password): string` — returns `scrypt:<saltHex>:<hashHex>` (crypto.scryptSync, 32-byte key, 16-byte random salt).
   - `verifyPlatformCredentials(username, password): boolean` — compares against `PLATFORM_ADMIN_USERNAME` / `PLATFORM_ADMIN_PASSWORD_HASH` env using `timingSafeEqual`. **Fails closed** when either env var is missing or the hash is malformed.

2. **`POST /api/platform/auth`** (existing route, changed contract)
   - Body `{username, password}` (was `{key}`).
   - Success → set httpOnly `hfp_platform_key` cookie from `HFP_PLATFORM_KEY` env (same name, flags, 4-hour maxAge as today).
   - Failure → uniform 401 "Invalid username or password." after a ~500 ms delay (brute-force friction). 503 with a clear message when server env is not configured.
   - `GET` (session check) and `DELETE` (clear cookie) unchanged.

3. **`apps/web/components/platform-login-gate.tsx`** — shared client component with username + password fields, same card styling as the current prompt, title "Platform Sign In". Replaces the two duplicated inline key prompts in the tenants list page and the onboarding wizard.

4. **Environment**
   - `apps/web/.env.local` (gitignored): `PLATFORM_ADMIN_USERNAME`, `PLATFORM_ADMIN_PASSWORD_HASH` (generated for the chosen password). `HFP_PLATFORM_KEY` already present.
   - `apps/web/.env.example`: placeholder entries + one-line note on regenerating the hash with `node -e` one-liner.
   - No credentials of any kind in source or tests (synthetic fixtures only).

## Error handling

- Missing/malformed env → login always rejects with a "platform login is not configured" 503; never falls back to accepting anything.
- Backend unreachable is no longer part of login (no backend round-trip); proxy routes keep their existing 502 handling.

## Testing

- `apps/web/tests/platform-auth.test.ts`: correct credentials pass; wrong password fails; wrong username fails; missing env fails closed; malformed hash fails closed; hashPassword round-trips.
- Existing web suite + typecheck stay green.

## Out of scope (YAGNI)

Multiple admin accounts, password-change UI, logout button, lockout counters, backend changes (`X-Platform-Key` remains the machine-to-machine credential).
