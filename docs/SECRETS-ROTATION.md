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

## PLATFORM_ENCRYPTION_KEY

### What it protects

Each tenant provisioned since WP-2 has two PostgreSQL roles, an owner and an
application role. Their passwords are stored in the registry (`tenants.owner_password_enc`,
`tenants.app_password_enc`) sealed with this key: AES-256-GCM,
`apps/api/src/shared/secret-box.ts`. A sealed value names the key that sealed
it (`v1.<key id>.…`, the key id being the first 8 hex characters of the key's
SHA-256). The API and the workers refuse to start without the key; they open
the passwords in memory only.

The key protects nothing else. Tenant data is not encrypted with it.

### Generating and storing it

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- Put it where the API and the workers read their settings (`apps/api/.env`,
  the PM2 environment, or the container environment), readable only by the
  service user (`chmod 600`).
- Never in the database, the repository or a ticket.

### Backing it up

- Keep a copy in the organisation's secret store (password manager vault or
  cloud secret manager), labelled with its key id and the date it became
  current. To see the id of a key:
  `node -e "const c=require('crypto');console.log(c.createHash('sha256').update(Buffer.from(process.argv[1],'base64')).digest('hex').slice(0,8))" "<key>"`
- Keep it **separate from database backups.** A registry backup is harmless
  without the key; the two together give access to every tenant database.
- Keep every retired key for as long as registry backups sealed with it are
  retained: restoring such a backup needs the key that sealed it (or a
  password reset, below).

### Rotating it

No downtime; the passwords themselves do not change.

1. Generate a new key and store it in the secret store.
2. Configure every API and worker process with
   `PLATFORM_ENCRYPTION_KEY=<new>` and `PLATFORM_ENCRYPTION_KEY_PREVIOUS=<old>`,
   and restart them. They now open values sealed with either key and seal new
   values with the new one.
3. Re-seal every stored password with the new key:
   `pnpm --filter @hfp/api db:reseal-secrets`
   (prints each tenant with the key id it moved from; safe to repeat; exits 1
   if any tenant failed).
4. Remove `PLATFORM_ENCRYPTION_KEY_PREVIOUS` and restart.
5. Keep the old key in the secret store, marked retired, while backups sealed
   with it exist.

### Rotating the database passwords themselves

`pnpm --filter @hfp/api db:reset-tenant-passwords [--tenant <slug>]...` gives
each tenant's two roles new random passwords (set as SCRAM verifiers by the
registry's role, which administers them) and seals them with the current key.
Open connections keep working; new connections use the new passwords once the
services' registry cache refreshes, within a minute, or after a restart.

### If the key is lost

Lost means: no process has it and no copy exists.

- **Effect.** The sealed passwords cannot be opened, so the API and the
  workers cannot reach any tenant provisioned since WP-2: those tenants fail
  until it is fixed (each is logged as "Tenant database location unusable";
  the others keep working). **No tenant data is lost**: the databases and
  their contents are untouched, and tenants built before WP-2 are not affected.
- **Recovery**, in minutes:
  1. Generate a new key, store it, set it as `PLATFORM_ENCRYPTION_KEY`
     (no `_PREVIOUS`).
  2. `pnpm --filter @hfp/api db:reset-tenant-passwords`: new passwords for
     every tenant's roles, sealed with the new key. This needs the registry's
     role (the one that created the tenant roles), not the old key.
  3. Restart the API and the workers.
- Registry backups taken before the loss hold passwords sealed with the lost
  key; after restoring one, run step 2 again.

### If the key leaks

Treat the tenant database passwords as known: rotate the key (above), then
run `db:reset-tenant-passwords` so the leaked key opens nothing that is still
valid.
