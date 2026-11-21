# Non-Docker Setup and PM2 Deployment

HospitalityFinance can run directly on Node.js, PostgreSQL, Redis and PM2. Docker is not required for local development or production.

## Required Services

- Node.js 22 LTS or newer
- pnpm 9.12.x
- PostgreSQL 16+
- Redis 7+
- PM2 for production process supervision

## Local Development

Install Node and pnpm:

```powershell
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm install
```

Create local databases in PostgreSQL:

```sql
CREATE USER hfp WITH PASSWORD 'password';
CREATE DATABASE hfp_registry OWNER hfp;
CREATE DATABASE hfp_db OWNER hfp;
```

Copy environment files:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
```

Run registry and tenant setup:

```powershell
pnpm --filter @hfp/api run db:generate
pnpm --filter @hfp/api run db:migrate:deploy:registry
pnpm --filter @hfp/api run db:migrate:deploy:tenant
```

For a development machine, `pnpm dev:setup` does all of this and seeds a demo
tenant (see `docs/RUNNING-WITHOUT-DOCKER.md`).

Run the app without Docker:

```powershell
pnpm --filter @hfp/api dev
pnpm --filter @hfp/web dev
pnpm --filter @hfp/api workers
```

API listens on `http://localhost:4000`. Web listens on `http://localhost:3001`.

## Redis Without Docker

Windows options:

- Use WSL Ubuntu: `sudo apt update && sudo apt install redis-server`
- Start Redis in WSL: `sudo service redis-server start`
- Set `REDIS_URL=redis://localhost:6379` if Windows can reach the WSL forwarded port.

Linux options:

```bash
sudo apt update
sudo apt install redis-server
sudo systemctl enable --now redis-server
redis-cli ping
```

Production options:

- Native Redis on the server
- A separate Redis VM
- Managed Redis such as AWS ElastiCache, Azure Cache for Redis, or Redis Cloud

Redis is required for native auth sessions, refresh token revocation, BullMQ jobs, and cached background work.

## Production Build

Install dependencies and build:

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm install --frozen-lockfile
pnpm --filter @hfp/api run db:generate
pnpm build
```

Run production database setup:

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
it, and it must be adopted (`db:adopt registry`, then `db:adopt tenant <slug>`) before it can be migrated.

Do not run `db:seed` in production: it creates demo users and refuses
`NODE_ENV=production`. Tenants get their roles, permissions and first
administrator from provisioning.

## PM2 Production Startup

Install PM2:

```bash
pnpm add -g pm2
```

Start API, web, and workers:

```bash
pnpm pm2:start
pm2 save
pm2 startup
```

Useful commands:

```bash
pnpm pm2:logs
pnpm pm2:restart
pnpm pm2:stop
pm2 status
```

The PM2 ecosystem starts:

- `hfp-api`: `apps/api/dist/index.js` on port `4000`
- `hfp-web`: `pnpm --filter @hfp/web start` on port `3001`
- `hfp-workers`: `apps/api/dist/jobs/worker-supervisor.js`

## Reverse Proxy and HTTPS

Use Nginx, Caddy, IIS ARR, Apache, or a cloud load balancer to terminate HTTPS.

Recommended public routing:

- `https://app.example.com` -> `127.0.0.1:3001` (the web app)

The API is not published: the web app proxies `/api/v1/*` and `/auth/*` to it
on `API_INTERNAL_URL`. Keep its port closed to the outside.

The reverse proxy must **overwrite** `X-Forwarded-For` with the client's
address (Nginx: `proxy_set_header X-Forwarded-For $remote_addr;`), not append
to what the client sent. The web app passes that header on to the API, which
uses it for rate limiting and the audit trail.

Production API environment:

```bash
NODE_ENV=production
COOKIE_SECURE=true
TRUST_PROXY=loopback
APP_BASE_URL=https://app.example.com
```

Forward these headers from the proxy:

- `Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto`
- `X-Request-ID` if generated upstream

## Storage

For local storage, keep `INTEGRATION_UPLOADS_PATH` outside any web public directory. The API rejects paths under known public roots such as `apps/web/public`.

For production, prefer S3-compatible storage:

```bash
STORAGE_BACKEND=s3
AWS_REGION=eu-west-1
INTEGRATION_S3_BUCKET=hfp-integrations
AWS_S3_BUCKET=hfp-reports
```

## Docker Status

Docker files remain in the repository for optional/legacy deployments. They are not required by this setup.
