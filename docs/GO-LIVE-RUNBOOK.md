# HospitalityFinance Pro Go-Live Runbook

**Version:** 2.0
**Last Updated:** 2026-11-23
**Owner:** Infrastructure / DevOps Lead

This runbook targets direct server deployment. Docker, ECS, and ECR are not part of the target production path. Docker files may remain in the repository as optional legacy artifacts, but go-live must use Node.js, pnpm, PostgreSQL, Redis, PM2, and a reverse proxy with HTTPS.

## Pre-Requisites

Before starting the cutover, confirm:

- [ ] Linux server or VM provisioned with SSH access and a non-root deploy user
- [ ] Node.js 22 LTS and pnpm 9.12.x installed
- [ ] PM2 installed for process supervision
- [ ] PostgreSQL 16+ installed locally, on a separate database server, or as a managed service
- [ ] Redis 7+ installed locally, on WSL/Linux, on a separate Redis server, or as a managed service
- [ ] API and web DNS records prepared
- [ ] Reverse proxy configured for HTTPS termination
- [ ] TLS certificates issued and renewable
- [ ] Production API and web environment files prepared
- [ ] Storage backend configured outside public web roots, preferably S3-compatible storage for production
- [ ] `BACKUP_DIR` set, copied off the server daily; a restore drill (section 3) passed for the registry and every tenant database
- [ ] UAT sign-off obtained from the finance controller
- [ ] Rollback plan reviewed and approved by stakeholders

## Timeline

| Step                               | Duration | Responsible       | Start   |
| ---------------------------------- | -------- | ----------------- | ------- |
| 1. Maintenance window announcement | -        | Project Manager   | T-24h   |
| 2. Final UAT verification          | 30 min   | QA Lead           | T-2h    |
| 3. Install and verify services     | 20 min   | DevOps            | T-90min |
| 4. Configure environment files     | 15 min   | DevOps            | T-70min |
| 5. Database backups and migrations | 30 min   | DBA / DevOps      | T-55min |
| 6. Build API and web               | 15 min   | DevOps            | T-25min |
| 7. Start PM2 processes             | 10 min   | DevOps            | T-10min |
| 8. Smoke tests and access checks   | 25 min   | QA Lead + Finance | T       |
| 9. DNS / reverse proxy activation  | 10 min   | DevOps            | T+25min |
| 10. Go / No-Go decision            | 5 min    | Project Manager   | T+35min |
| 11. Monitoring watch               | 60 min   | DevOps            | T+40min |

## Go-Live Sequence

### 1. Install and Verify Services

Install Node.js, pnpm, PostgreSQL, Redis and PM2 directly on the server or use managed PostgreSQL/Redis services.

```bash
node --version
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm --version
pnpm add -g pm2
pm2 --version

psql "$REGISTRY_DATABASE_URL" -c "SELECT 1;"
redis-cli -u "$REDIS_URL" ping

```

Redis is required in production for native auth sessions, refresh-token revocation, BullMQ jobs, and cached background work.

Install PgBouncer 1.21.0 or later in transaction mode in front of the tenant databases and set `TENANT_DB_POOLER_HOST` and `TENANT_DB_POOLER_PORT` (`docs/CONNECTION-POOLER.md`, which has the configuration, the authentication function and the sizing). Check it with `psql -h <pooler> -p 6432 -U <a tenant application role> <its database> -c 'SELECT 1'`. Migrations, adoption and provisioning keep connecting directly.

### 2. Configure Environment Files

Create production environment files from the examples and set secrets manually.

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
chmod 600 apps/api/.env apps/web/.env.local
```

Minimum production API settings:

```bash
NODE_ENV=production
PORT=4000
REGISTRY_DATABASE_URL=postgresql://...
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=<strong-random-secret>
COOKIE_SECURE=true
TRUST_PROXY=loopback
APP_BASE_URL=https://app.hospitalityfinancepro.com
STORAGE_BACKEND=s3
AWS_REGION=<region>
TD_S3_BUCKET=<secure-transfer-desk-bucket>
AWS_S3_BUCKET=<secure-report-bucket>
```

### 3. Backups and restore

Every tenant database and the registry are backed up separately (WP-2 item 9, OPS-07). Each backup is a `pg_dump` custom-format file with a manifest beside it (`.dump.json`): the exact row count of every table at the moment of the dump, the file's size and SHA-256, the schema version. Each backup is also a row in the registry table `database_backups`. Code: `apps/api/src/db/backup.ts`, `apps/api/src/db/tenant-backup.ts`.

**What the server needs**

- `BACKUP_DIR`: a folder on a different disk from the database (the workers refuse to start in production without it). Folders are created 0700 and files 0600, owned by the deploy user. The dumps hold all of a tenant's financial data and its users' password hashes; treat the folder like the database.
- `pg_dump` and `pg_restore` of the database server's major version or newer (`postgresql-client-<n>`; `PG_BIN_DIR` if they are not on the PATH). The workers image installs version 18 (`--build-arg PG_CLIENT_MAJOR`).
- A copy of `BACKUP_DIR` off the server, at least daily (object storage or another host). The application does not do this; a backup that lives only next to the database is lost with the server.
- For managed PostgreSQL or a self-run cluster: point-in-time recovery (WAL archiving) at the cluster level as well. The per-tenant dumps restore one tenant to the time of its last dump; point-in-time recovery covers the hours in between, for the whole cluster.

**Schedule.** The backup worker (run by the worker supervisor, so by PM2's `hfp-workers`) backs up every provisioned tenant and then the registry on `BACKUP_SCHEDULE` (default `30 2 * * *`, UTC). After a run in which every database succeeded it deletes backups older than `BACKUP_RETENTION_DAYS`, never the newest successful backup of a database; with the setting unset nothing is deleted. A database that could not be backed up is a `FAILED` row with the reason, and fails the job (logged by `backup-worker`). A tenant built before WP-2 always fails: adopt it first (`db:adopt`).

**By hand** (before go-live, before a migration or a data import):

```bash
pnpm --filter @hfp/api db:backup                       # every tenant, then the registry
pnpm --filter @hfp/api db:backup --tenant <slug> --no-registry
```

Exit code 1 means at least one database was not backed up; the output names it.

**Check the backups** after the first scheduled run and then daily:

```sql
-- in the registry database: the last backup of each database, and anything that failed
SELECT DISTINCT ON (label) label, status, started_at, size_bytes, error
  FROM database_backups ORDER BY label, started_at DESC;
```

**Restore drill** (before go-live, then monthly, and after every PostgreSQL major upgrade). It restores a backup into a new database beside the live one, as the tenant's owner role, compares every table's row count with the manifest, and drops the copy. It never writes to a live database.

```bash
pnpm --filter @hfp/api db:restore "$BACKUP_DIR/tenants/<slug>/<slug>-<time>.dump.json"
pnpm --filter @hfp/api db:restore "$BACKUP_DIR/registry/registry-<time>.dump.json"
```

Pass: `Row counts match: <n> tables, <m> rows.` and exit code 0. A damaged file (size or checksum not the manifest's) is refused before anything is created; any table that differs is listed and the exit code is 1. Record each drill (date, backup, result) in the go-live log.

**Recovering one tenant** (its database is lost or damaged). Needs the owner's and finance's sign-off: anything posted after the backup is lost unless it is re-entered.

1. Stop the API and the workers (`pm2 stop hfp-api hfp-workers`), or at least take the tenant out of service.
2. Restore the chosen backup beside the live database and keep it:
   `pnpm --filter @hfp/api db:restore <manifest> --into hfp_<slug>_restored --keep` (slug with `_` for `-`). It must report matching row counts.
3. As the platform role, swap the databases. Renaming needs the owner's rights and CREATEDB together, which only the platform role holding the owner role can have; take the owner's rights for the swap and give them back at once (`hfp_<code>` from the registry's `owner_role`):

   ```sql
   GRANT "hfp_<code>_owner" TO CURRENT_USER WITH INHERIT TRUE, SET TRUE;
   ALTER DATABASE "hfp_<slug>" RENAME TO "hfp_<slug>_damaged_<yyyymmdd>";
   ALTER DATABASE "hfp_<slug>_restored" RENAME TO "hfp_<slug>";
   SET ROLE "hfp_<code>_owner";
   REVOKE ALL ON DATABASE "hfp_<slug>" FROM PUBLIC;
   GRANT CONNECT, TEMPORARY ON DATABASE "hfp_<slug>" TO "hfp_<code>_app";
   RESET ROLE;
   GRANT "hfp_<code>_owner" TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
   ```

4. If the backup's schema version (in the manifest) is older than the release, run `pnpm --filter @hfp/api db:migrate:tenants --tenant <slug>`; it also re-grants the application role.
5. Start the API and the workers; sign in as a user of the tenant and check the trial balance against the last figures finance reported.
6. Keep `hfp_<slug>_damaged_<yyyymmdd>` until finance confirms, then drop it.

**Recovering the registry** works the same way with the registry backup, restored as the registry's role (`db:restore <registry manifest> --into hfp_registry_restored --keep`), then swapping the registry database names while everything is stopped.

### 4. Run Registry Migrations

Run registry migrations against `REGISTRY_DATABASE_URL`.

```bash
pnpm install --frozen-lockfile
pnpm --filter @hfp/api run db:generate
pnpm --filter @hfp/api run db:migrate:deploy:registry
```

Verify registry connectivity:

```bash
psql "$REGISTRY_DATABASE_URL" -c "SELECT 1;"
```

### 5. Run Tenant Migrations and Setup

Each release migrates the registry first, then every tenant database:

```bash
pnpm --filter @hfp/api run db:migrate:deploy:registry
pnpm --filter @hfp/api run db:migrate:tenants --dry-run   # what would change
pnpm --filter @hfp/api run db:migrate:tenants
```

`db:migrate:tenants` walks every provisioned tenant in the registry, oldest
first, and applies its pending migrations as that tenant's owner role, then
re-grants the application role and records the new schema version. Each
attempt is recorded in the registry table `tenant_migration_runs`. It stops at
the first failure and exits 1 (`--keep-going` carries on past failures); fix
the cause, then `--resume` continues the same run. Only one run at a time.
A tenant behind the running release answers 503 ("being updated") and its
jobs are postponed, so switch traffic to a new release only after this
command has succeeded; other tenants are not affected by one that fails.

Tenants are created by provisioning, which applies the migrations itself. A
tenant database built before WP-2 has no migration history: the runner skips
it, and it must be adopted (`db:adopt registry`, then `db:adopt tenant <slug>`) before it can be migrated. Afterwards `db:check-secrets` must report no readable secrets in the registry (docs/SECRETS-ROTATION.md).

Do not run `db:seed` here: it creates a demo tenant and demo users, and refuses
to run with `NODE_ENV=production`. A production tenant gets its roles and
permissions, and its first administrator, from tenant provisioning.

### 6. Build API and Web

```bash
pnpm --filter @hfp/api run build
pnpm --filter @hfp/web run build
```

Confirm the API output exists:

```bash
test -f apps/api/dist/index.js
test -f apps/api/dist/jobs/worker-supervisor.js
```

### 7. Start PM2 Processes

Start API, web, and workers through the root PM2 ecosystem file.

```bash
pnpm pm2:start
pm2 status
pm2 logs --lines 100
pm2 save
pm2 startup
```

Expected PM2 processes:

- `hfp-api` on `127.0.0.1:4000`
- `hfp-web` on `127.0.0.1:3001`
- `hfp-workers` for background jobs

### 8. Configure Reverse Proxy and HTTPS

Terminate HTTPS at Nginx, Caddy, Apache, IIS ARR, or a cloud load balancer.

Recommended routing:

- `https://api.hospitalityfinancepro.com` -> `127.0.0.1:4000`
- `https://app.hospitalityfinancepro.com` -> `127.0.0.1:3001`

Forward at least these headers:

- `Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto`
- `X-Request-ID` if generated upstream

Keep API and web processes bound to internal interfaces when possible. Public traffic should enter through HTTPS only.

### 9. Verify Health and Readiness

```bash
API_URL=https://api.hospitalityfinancepro.com
APP_URL=https://app.hospitalityfinancepro.com

curl -fsS "$API_URL/health"
curl -fsS "$API_URL/ready"
curl -fsS "$API_URL/api/v1/version"
curl -fsSI "$APP_URL"
```

### 10. Test Login, Refresh, and Logout

```bash
curl -fsS -c /tmp/hfp-cookies.txt -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\",\"tenantCode\":\"$SMOKE_TENANT_CODE\"}"

curl -fsS -b /tmp/hfp-cookies.txt -X POST "$API_URL/auth/refresh"
curl -fsS -b /tmp/hfp-cookies.txt -X POST "$API_URL/auth/logout"
```

Confirm:

- Login sets httpOnly auth cookies
- Refresh succeeds with valid cookies
- Logout revokes the session
- Redis remains reachable during all auth checks

### 11. Verify Tenant and Entity Access

```bash
curl -fsS -b /tmp/hfp-cookies.txt "$API_URL/api/v1/entities"

curl -fsS -b /tmp/hfp-cookies.txt \
  -H "X-Entity-ID: $SMOKE_ENTITY_ID" \
  "$API_URL/api/v1/gl/accounts"

curl -fsS -b /tmp/hfp-cookies.txt \
  -H "X-Entity-ID: $SMOKE_ENTITY_ID" \
  "$API_URL/api/v1/gl/trial-balance?period_id=$SMOKE_PERIOD_ID"
```

Confirm:

- Missing or wrong entity headers are rejected on entity-scoped financial routes
- The smoke user cannot access an unassigned entity
- The tenant header and tenant cookie context resolve to the expected tenant

### 12. Verify Payment File Storage

Use a controlled payment run in a non-live batch or a finance-approved smoke tenant.

```bash
curl -fsS -b /tmp/hfp-cookies.txt \
  -H "X-Entity-ID: $SMOKE_ENTITY_ID" \
  -OJ "$API_URL/api/v1/ap/payment-runs/$SMOKE_PAYMENT_RUN_ID/download"
```

Confirm:

- Download requires the explicit AP payment/export permission
- The payment run belongs to the requested tenant and entity
- The file is fetched through the configured storage backend
- Local storage, if used, is outside public web roots such as `apps/web/public`
- No generated payment files are committed to source control

### 13. Business Smoke Tests

- [ ] Finance controller creates and posts a test journal
- [ ] AP clerk creates an invoice and runs a payment proposal
- [ ] Period status and close/reopen permissions behave as expected
- [ ] USALI P&L or KPI report loads
- [ ] PDF/report export succeeds only for users with export permission
- [ ] Trial balance agrees with the source validation file

## Go / No-Go Criteria

All items must pass:

- [ ] `/health` returns OK
- [ ] `/ready` returns 200
- [ ] PM2 shows API, web, and workers online
- [ ] Native JWT cookie login, refresh, and logout work
- [ ] Redis is reachable and auth/session features work
- [ ] Tenant and entity access checks reject invalid access
- [ ] Payment file download uses secure storage and correct permissions
- [ ] Report generation/export works for authorized users
- [ ] Web dashboard loads without browser console errors
- [ ] `db:backup` of every database succeeded during the window, and its restore drill reports matching row counts
- [ ] No P1/P2 errors in monitoring

If any critical item fails, execute rollback.

## Rollback Procedure

### Application Rollback

Stop the current PM2 processes and start the previous release directory or previous build artifact.

```bash
pm2 stop hfp-api hfp-web hfp-workers
cd /opt/hfp/releases/previous
pnpm pm2:start
pm2 status
pm2 logs --lines 100
```

If using a release symlink:

```bash
ln -sfn /opt/hfp/releases/previous /opt/hfp/current
cd /opt/hfp/current
pnpm pm2:restart
```

### Database Rollback

Never load a dump into a live database. Restore the backup taken before the cutover (section 3) beside the live database and swap the two, as in "Recovering one tenant" and "Recovering the registry" in section 3. Coordinate with finance before restoring if users may have created valid transactions after cutover.

For managed PostgreSQL, restore from the provider snapshot or point-in-time recovery workflow.

### Communication

- Notify stakeholders that rollback has started
- Record the failure condition and time
- Preserve PM2 logs and reverse proxy logs
- Schedule post-incident review before attempting another cutover

## Post Go-Live Monitoring

### First 4 Hours

- [ ] Monitor PM2 process restarts
- [ ] Monitor API response times and error rates
- [ ] Monitor PostgreSQL CPU, locks, slow queries, and connection counts
- [ ] Monitor Redis memory, latency, evictions, and connectivity
- [ ] Verify workers are processing BullMQ jobs
- [ ] Watch auth login/refresh/logout errors

### Day 1

- [ ] Finance validates journal posting and AP flows
- [ ] Reports and PDF exports are generated by authorized users
- [ ] Payment file storage and download audit records are reviewed
- [ ] Tenant/entity access failures are reviewed for expected denials
- [ ] The first scheduled backup run succeeded for every database (`database_backups`), and its files reached the off-server copy

### Week 1

- [ ] Review slow query log for queries over 1 second
- [ ] Review error rate target below 0.1%
- [ ] Gather finance user feedback
- [ ] Confirm Redis and PostgreSQL capacity are sufficient
- [ ] Address any P3/P4 issues discovered after go-live

## Emergency Contacts

| Role               | Name | Phone | Escalation          |
| ------------------ | ---- | ----- | ------------------- |
| DevOps Lead        | TBD  | TBD   | Primary             |
| DBA                | TBD  | TBD   | Database issues     |
| Backend Lead       | TBD  | TBD   | API issues          |
| Frontend Lead      | TBD  | TBD   | UI issues           |
| Project Manager    | TBD  | TBD   | Go/No-Go decisions  |
| Finance Controller | TBD  | TBD   | Business validation |
