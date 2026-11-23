# Connection pooler for tenant databases

Status: designed and tested in CI (WP-2, ARC-04, roadmap Stage 1 item 6). **Not installed on the development server**: PostgreSQL there also hosts live systems, and a pooler is installed only with the owner's go-ahead (roadmap section 5, rule 7). Without `TENANT_DB_POOLER_HOST` the application connects directly, as before.

## Why

Before this change every API and worker process kept one Prisma client per tenant, up to 50, each with Prisma's default pool of `2 × CPUs + 1` connections. On an 8-core host that is up to 850 connections per process, against a server limit of a few hundred. Eviction also disconnected a client that could be in the middle of a request.

Now:

- requests and jobs reach tenant databases through **PgBouncer in transaction mode**, which lends a server connection to a client for one transaction at a time;
- each tenant client opens at most **`TENANT_CONNECTION_LIMIT`** connections (default 3);
- a client is closed only when **no query or transaction is running on it**.

## Topology

```
API and worker processes                      PostgreSQL server
 tenant clients (≤ TENANT_POOL_MAX,     ──►  PgBouncer  ──►  tenant databases
  ≤ TENANT_CONNECTION_LIMIT each)            transaction     (application role)
                                             mode
 registry client, migrations, adoption,  ─────────────────►  registry, tenant
 provisioning, db:* commands, seeds           direct          databases (owner)
```

One pooler per database server. `TENANT_DB_POOLER_HOST` applies to every tenant, so all tenant databases are assumed to be on the server behind that pooler (true today). Tenants on several servers will need a map from server to pooler; that is a later change.

## What goes through the pooler and what does not

| Connection                                                                         | Route  | Why                                                                                                          |
| ---------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| Requests and jobs, as the tenant's application role (`tenantPool.getTenantClient`) | Pooler | The many connections; transaction-scoped work only.                                                          |
| Migrations (`prisma migrate deploy`, `db:migrate:tenants`)                         | Direct | Prisma's schema engine does not support PgBouncer; the runner holds a session advisory lock on the registry. |
| Adoption, provisioning, `db:reseal-secrets`, `db:reset-tenant-passwords`           | Direct | Owner and platform roles, DDL and role changes.                                                              |
| Seeds and `db:setup:*`                                                             | Direct | They set `app.bypass_rls` for the session as the owner.                                                      |
| Registry client                                                                    | Direct | One client per process, a handful of connections; the migration runner's lock is a session lock.             |

The direct routes use the connection strings from `tenant-location.ts` (`appConnectionUrl`, `ownerConnectionUrl`); only `runtimeConnectionUrl`, called by the tenant pool, rewrites the host to the pooler.

## Rules for code on the pooled route

Transaction mode gives a client a server connection for one transaction; the next transaction may run on another connection that served another tenant role's client a moment before. So, on the pooled route:

- **Allowed:** `set_config(name, value, true)` and `SET LOCAL` inside a transaction (how the entity for row-level security is set, `rlsMiddleware.ts`, `tenantContext.ts`); `app_begin_rls_bypass()`, whose grant row is tied to the transaction (SEC-11); transaction advisory locks (`pg_advisory_xact_lock`).
- **Not allowed:** session `SET` or `set_config(..., false)`; session advisory locks; `LISTEN`/`NOTIFY`; temporary tables used across transactions; `PREPARE` in SQL; anything that expects the same server connection twice.

The pooler test proves the first list holds and that nothing leaks between transactions sharing a server connection.

## Prisma settings

Prisma 5.22 (`apps/api/package.json`). Prisma's PgBouncer guidance: with PgBouncer **1.21.0 or later**, set `max_prepared_statements` above zero in PgBouncer and do **not** add `pgbouncer=true` to the connection string; below 1.21.0, `pgbouncer=true` is needed. The pages read for this (prisma.io, November 2026) are written for Prisma 7, so the CI test is the confirmation for 5.22: it runs PgBouncer 1.22 with `max_prepared_statements = 200` and no `pgbouncer=true`, with interactive transactions and repeated parameterised queries across clients. **PgBouncer 1.21.0 or later is therefore a requirement.**

`connection_limit` is set by the application on every tenant client (`runtimeConnectionUrl`); a value already in a stored connection string is replaced. Prisma's `pool_timeout` stays at its default (10 seconds): a request that cannot get one of its client's connections within that time fails rather than queueing indefinitely.

## Application settings

| Setting                   | Default             | Meaning                                                                                         |
| ------------------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| `TENANT_DB_POOLER_HOST`   | unset (direct)      | The pooler requests and jobs use.                                                               |
| `TENANT_DB_POOLER_PORT`   | the database's port | The pooler's port (PgBouncer's usual one is 6432).                                              |
| `TENANT_CONNECTION_LIMIT` | 3                   | Most connections each tenant client opens, per process.                                         |
| `TENANT_POOL_MAX`         | 50                  | Most tenant clients kept open per process; above it, idle clients are closed, least used first. |

## Closing clients safely

`tenantPool.ts` counts the queries and transactions running on each client (a Prisma query extension for every model operation and raw query, and a wrapper around `$transaction`).

- To make room for a new tenant, the least recently used client **with nothing running** is closed. If every client is busy, the pool grows past `TENANT_POOL_MAX` for a while and logs a warning, rather than cutting off work.
- `evictTenant` (deactivation, password reset) removes the client at once, so new work gets a fresh one, and closes the old one when its running work ends (waiting up to 30 seconds).
- `getTenantClient` returns a handle that finds the tenant's live client on every use, so a job that holds it across a pause carries on after an eviction.

Known limit: a model delegate taken from a handle and kept (`const accounts = db.account`) is bound to the client of that moment; used after an eviction, Prisma reconnects that client outside the pool until its idle connections expire. Code takes delegates at the call site, which avoids this.

## PgBouncer configuration for production

```ini
[databases]
* = host=<database server> port=5432

[pgbouncer]
listen_addr = <private address>
listen_port = 6432
pool_mode = transaction
max_prepared_statements = 200
default_pool_size = 5          ; per tenant database and role
max_db_connections = 10        ; per tenant database, all roles
max_client_conn = 2000
reserve_pool_size = 2
query_wait_timeout = 30
server_idle_timeout = 300
auth_type = scram-sha-256
auth_user = hfp_pooler_auth
auth_dbname = hfp_registry
auth_query = SELECT usename, passwd FROM pooler.user_secret($1)
client_tls_sslmode = require   ; and server_tls_sslmode when the server is remote
ignore_startup_parameters = extra_float_digits,options
```

- **Authentication.** Tenant roles are created by provisioning, so PgBouncer looks them up (`auth_query`) instead of a file. In production the lookup role is not a superuser: `hfp_pooler_auth` may only execute a `SECURITY DEFINER` function `pooler.user_secret(name)` in the registry database that returns the SCRAM secret of `hfp_%_app` roles and nothing else. Owner and platform roles cannot log in through the pooler. (CI uses the `postgres` superuser for the lookup, which is acceptable only there.) Creating that function is a change to the registry database and is done with the owner when the pooler is installed.
- **Sizing.** Server connections: active tenants × `default_pool_size` must stay under PostgreSQL's `max_connections` minus the direct routes (registry clients, migrations, maintenance) and a reserve. Client connections: processes × `TENANT_POOL_MAX` × `TENANT_CONNECTION_LIMIT` must stay under `max_client_conn`. Example: 4 processes × 50 tenants × 3 = 600 client connections; 50 tenants × 5 = 250 server connections at most, usually far fewer, since idle tenants hold none after `server_idle_timeout`.
- **Monitoring.** `SHOW POOLS` and `SHOW STATS` on the PgBouncer admin console: `cl_waiting` above zero for long, or `maxwait` rising, means a pool is too small.

## Tests

- `apps/api/tests/tenant-runtime-url.test.ts` (unit): the pooled connection string keeps database, role and password, and sets the limit.
- `apps/api/tests/integration/tenant-pool.test.ts` (any PostgreSQL): the connection limit holds; a busy client is never closed to make room; `evictTenant` waits for running work; a handle survives an eviction.
- `apps/api/tests/integration/pooler.test.ts` (CI starts PgBouncer 1.22 in transaction mode, pool size 2): clients share the pooler's connections; the selected entity never leaks between transactions; the SEC-11 bypass holds for its own transaction only; interactive transactions and repeated parameterised queries work without `pgbouncer=true`. Skipped locally, since no pooler is installed on the development server; required in CI.

## Installing it (when the owner decides)

1. Install PgBouncer 1.21.0 or later on the database host or next to the API.
2. Create `hfp_pooler_auth` and `pooler.user_secret` in the registry database (owner approval: database change).
3. Configure as above; check `psql -h <pooler> -p 6432 -U <a tenant app role> <its database>`.
4. Set `TENANT_DB_POOLER_HOST` and `TENANT_DB_POOLER_PORT` for the API and workers; restart them.
5. Watch `SHOW POOLS` during the first day.

Rolling back is unsetting `TENANT_DB_POOLER_HOST` and restarting.
