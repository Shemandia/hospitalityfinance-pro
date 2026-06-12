# Running HospitalityFinance without Docker

The **application** (API + web) does not need Docker — `pnpm dev` runs both natively.
Docker only provided four backing services, and you only need two of them:

| Service      | Needed for a dev run?                                   | How to provide it without Docker                 |
| ------------ | ------------------------------------------------------- | ------------------------------------------------ |
| **Postgres** | **Required** (the database)                             | Native install or free cloud                     |
| **Redis**    | **Required** (native-auth sessions + BullMQ job queues) | Memurai (Windows) / cloud                        |
| **RabbitMQ** | Optional (event bus only)                               | Leave `RABBITMQ_URL` unset — it disables cleanly |
| **Keycloak** | Not used (native auth replaced it)                      | Nothing — removed                                |

Pick **Path A (free cloud, zero installs)** or **Path B (native Windows installs)**. Both end at the same `.env` + `pnpm dev`.

---

## Path A — Free cloud services (fastest, no local installs)

Good when Docker won't run and you don't want to install database software locally.

1. **Postgres** — create a free project at [Neon](https://neon.tech) or [Supabase](https://supabase.com). You need **two databases** on the same server: `hfp_db` and `hfp_registry`. In Neon, create the project (gives you `hfp_db`), then run `CREATE DATABASE hfp_registry;` from the SQL editor (or create a second database). Copy the two connection strings.
2. **Redis** — create a free database at [Upstash](https://upstash.com) (serverless Redis). Copy the `redis://` (or `rediss://` for TLS) URL.
3. **RabbitMQ** — skip it. Leave `RABBITMQ_URL` unset.

Then fill in `apps/api/.env` (see [Env file](#env-file) below) with those URLs and go to [Run](#run).

---

## Path B — Native installs on Windows 11

### 1. Postgres

- Download the **EnterpriseDB Postgres 16 installer** for Windows: <https://www.postgresql.org/download/windows/> and install it. Remember the `postgres` superuser password you set.
- Create the role + two databases (open "SQL Shell (psql)" from the Start menu, or pgAdmin):
  ```sql
  CREATE ROLE hfp WITH LOGIN PASSWORD 'choose-a-password';
  CREATE DATABASE hfp_db OWNER hfp;
  CREATE DATABASE hfp_registry OWNER hfp;
  ```

### 2. Redis (Memurai — native Windows, Redis-compatible)

Redis has no official Windows build. Use **Memurai** (free Developer edition), which speaks the Redis protocol natively:

- Download and install from <https://www.memurai.com/get-memurai>. It installs as a Windows service listening on `localhost:6379`.
- (Alternatives: run Redis inside **WSL2** with `sudo apt install redis-server`, or use Upstash from Path A.)

### 3. RabbitMQ

Skip it for development — leave `RABBITMQ_URL` unset. (If you ever need the event bus: install Erlang/OTP, then the RabbitMQ Windows installer from <https://www.rabbitmq.com/install-windows.html>, and set `RABBITMQ_URL=amqp://guest:guest@localhost:5672`.)

---

## Env file

Create/edit `apps/api/.env` (copy from `apps/api/.env.example`). Minimum to run:

```dotenv
NODE_ENV=development
PORT=4000

# Postgres — two databases on the same server
DATABASE_URL=postgresql://hfp:your-password@localhost:5432/hfp_db
REGISTRY_DATABASE_URL=postgresql://hfp:your-password@localhost:5432/hfp_registry
# (Path A: paste your Neon/Supabase URLs instead, one per database)

# Redis — local Memurai, or your Upstash URL
REDIS_URL=redis://localhost:6379
# Upstash example: REDIS_URL=rediss://default:TOKEN@your-host.upstash.io:6379

# RabbitMQ — OMITTED on purpose; the event bus disables cleanly when unset.
# RABBITMQ_URL=

# Auth — generate a real secret:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=paste-a-64+-char-random-hex-string

# Optional: dev auth bypass for quick local testing
ENABLE_DEV_AUTH=true
```

The web app reads `apps/web/.env` — set `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000` (match the API `PORT`).

> See `docs/ENV-VARIABLES.md` for the full list. Only the DB + Redis + JWT vars above are required to boot.

---

## Run

From the repo root (`hospitalityfinance-pro/`):

```powershell
pnpm install

# 1. Generate Prisma clients
pnpm --filter @hfp/api run db:generate

# 2. Create the schema in both databases (no Docker, no shadow DB needed):
pnpm --filter @hfp/api run db:push:registry
pnpm --filter @hfp/api run db:push:tenant
#    (db:push applies the schema directly — simplest for local dev.
#     Use db:migrate:deploy:* instead if you have migration files to apply.)

# 3. (Optional) seed demo data
pnpm --filter @hfp/api run db:seed

# 4. Start API + web
pnpm dev
```

API → http://localhost:4000, web → http://localhost:3000 (Next dev default).

### Background workers (optional)

The async workers (transfer-desk processing, dunning, scheduled reports) run on BullMQ over **Redis** — they do **not** need RabbitMQ. Start them only if you're exercising those features:

```powershell
pnpm --filter @hfp/api run workers
```

Without RabbitMQ, `publishEvent` is a quiet no-op (logged once at startup); nothing crashes.

---

## What this removes

- **Docker / docker-compose** — not required to develop or run the app.
- **Keycloak** — deleted; native auth (bcrypt + JWT + Redis sessions) replaces it.
- **RabbitMQ** — optional; unset `RABBITMQ_URL` and the event bus disables cleanly.

The only hard external services are **Postgres** and **Redis**, both available natively on Windows (EnterpriseDB + Memurai) or via free cloud tiers (Neon/Supabase + Upstash).
