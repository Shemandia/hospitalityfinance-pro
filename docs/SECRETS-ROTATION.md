# Secrets Rotation Runbook (NS4 — CRITICAL-ASSESSMENT-2026-06-11)

Treat every value currently in `apps/api/.env` and the root `.env` as compromised
(they sat in plaintext on developer disks). Git history is clean — neither file
was ever committed (`git log --all` over both paths is empty) — so rotation, not
history rewriting, is what is required.

## 1. AWS SES access key (`apps/api/.env`: `AWS_SES_ACCESS_KEY_ID` / `AWS_SES_SECRET_ACCESS_KEY`)

1. AWS Console → IAM → Users → the SES sending user → Security credentials.
2. Create a new access key. Update `apps/api/.env` (or the secrets manager) with it.
3. Deploy/restart the API, send a test email (password-reset flow).
4. Deactivate the old key, verify nothing breaks for 24h, then delete it.
5. Check CloudTrail for unexpected use of the old key before deletion.

## 2. JWT signing secret (`JWT_SECRET` — set in BOTH `apps/api/.env` and root `.env`)

1. Generate: `openssl rand -hex 64` (or `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`).
2. Replace `JWT_SECRET` in both files — they MUST match (the API service and auth plugin read the same variable).
3. Restart the API. **All existing access tokens become invalid immediately and
   every user must log in again** — schedule accordingly. Redis-backed sessions
   survive; only the JWTs are invalidated.

## 3. Platform API key (`PLATFORM_API_KEY`)

1. Generate a new value (same command as above).
2. Update `apps/api/.env` and every platform-level client that sends it.

## 4. Keycloak admin password (root `.env`)

1. Rotate via the Keycloak admin console — or disable the account entirely if
   Keycloak is no longer in the auth path (native auth has replaced it).

## 5. Get secrets off disk (target state)

- Move runtime secrets to a secrets manager (AWS Secrets Manager / SSM Parameter
  Store / Doppler) and inject as environment variables at deploy time.
- `.env` files remain for local development only, with placeholder values;
  `apps/api/.env.example` is the documented template.

## Related: TML sandbox env flag

`TML_ALLOW_INSECURE_SANDBOX=true` permits the insecure Node `vm` fallback for TML
user functions on development machines where `isolated-vm` cannot compile
(requires VS2022 build tools on Node 24 / Windows). It is ignored in production —
production fails closed without `isolated-vm`. Never set this flag in any
deployed environment.

## Status

- [ ] SES key rotated
- [ ] JWT_SECRET rotated
- [ ] PLATFORM_API_KEY rotated
- [ ] Keycloak admin password rotated/disabled
- [ ] Secrets manager adopted
