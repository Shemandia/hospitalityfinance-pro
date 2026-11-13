# HospitalityFinance Pro Go-Live Runbook

**Version:** 2.0
**Last Updated:** 2026-05-17
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
- [ ] Backup and restore plan tested for registry and tenant databases
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

### 3. Verify Backup Plan

Take backups before migrations or data import. Keep registry and tenant backups separate.

```bash
mkdir -p backups
pg_dump "$REGISTRY_DATABASE_URL" > backups/registry-pre-go-live.sql
pg_dump "$DATABASE_URL" > backups/tenant-primary-pre-go-live.sql
```

For managed PostgreSQL, also create a provider snapshot or point-in-time recovery restore point before proceeding.

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

Tenant migrations currently run one tenant database at a time. An automated "migrate all tenants from registry" command is not implemented yet.

For each tenant database, set `DATABASE_URL` to that tenant database and keep `REGISTRY_DATABASE_URL` pointed at the registry database:

```bash
export REGISTRY_DATABASE_URL="postgresql://hfp:<password>@db.example.com:5432/hfp_registry"

export DATABASE_URL="postgresql://hfp:<password>@db.example.com:5432/hfp_tenant_a"
pnpm --filter @hfp/api run db:setup:tenant

export DATABASE_URL="postgresql://hfp:<password>@db.example.com:5432/hfp_tenant_b"
pnpm --filter @hfp/api run db:setup:tenant
```

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
- [ ] Database backup files or managed snapshots are confirmed
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

Use the pre-go-live PostgreSQL dumps or managed database snapshot. Coordinate with finance before restoring if users may have created valid transactions after cutover.

```bash
pm2 stop hfp-api hfp-workers
psql "$REGISTRY_DATABASE_URL" < backups/registry-pre-go-live.sql
psql "$DATABASE_URL" < backups/tenant-primary-pre-go-live.sql
pm2 start hfp-api hfp-workers
```

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
- [ ] Backup jobs complete successfully

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
