# Environment Variables Reference

## API (`apps/api/.env`)

Every setting the API, its workers and its scripts read is declared once, in
`apps/api/src/config.ts`; no other file reads `process.env`. The API and the
workers check their required settings at startup and exit naming every one
that is missing or invalid. An empty value counts as unset. `apps/api/.env` is
read by the config module and never overrides a variable already set in the
environment.

"Required by" names the processes that will not start without the setting:
`api` (the API server) and `workers` (the worker supervisor). Scripts ask for
what they need when they run: `dev:setup` and `db:seed` need `DATABASE_URL`
and `SEED_USER_PASSWORD`, the database setup scripts need `DATABASE_URL`.

<!-- api-config:start (generated from apps/api/src/config.ts; run pnpm --filter @hfp/api docs:env) -->

### Runtime

| Variable       | Required by  | Default       | Description                                                                                     |
| -------------- | ------------ | ------------- | ----------------------------------------------------------------------------------------------- |
| `NODE_ENV`     |              | `development` | development, test or production. Production enforces the production requirements.               |
| `PORT`         |              | `4000`        | Port the API listens on.                                                                        |
| `LOG_LEVEL`    |              | `info`        | Log level.                                                                                      |
| `TRUST_PROXY`  |              | `loopback`    | Addresses whose X-Forwarded-\* headers are believed (Fastify trustProxy): the web app's server. |
| `APP_BASE_URL` | api, workers |               | The address users open in the browser, for links in e-mails.                                    |
| `APP_VERSION`  |              |               | Version reported by /health and /version.                                                       |
| `BUILD_DATE`   |              |               | Build date reported by /version.                                                                |

### Databases

| Variable                | Required by                              | Default | Description                                                                                                          |
| ----------------------- | ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          |                                          |         | A tenant database, for setup scripts and the seed; the registry fallback outside production. Never a default tenant. |
| `REGISTRY_DATABASE_URL` | api in production, workers in production |         | The tenant registry database. Required in production.                                                                |
| `TENANT_POOL_MAX`       |                                          | `50`    | Most tenant database clients kept open at once.                                                                      |
| `TENANT_DB_HOST`        |                                          |         | Provisioning: host for new tenant databases (default: the registry's).                                               |
| `TENANT_DB_PORT`        |                                          |         | Provisioning: port for new tenant databases (default: the registry's).                                               |
| `TENANT_DB_USER`        |                                          |         | Provisioning: role that owns new tenant databases (default: the registry's).                                         |
| `TENANT_DB_PASSWORD`    |                                          |         | Provisioning: that role's password (default: the registry's).                                                        |

### Redis

| Variable                   | Required by  | Default | Description                                                                                |
| -------------------------- | ------------ | ------- | ------------------------------------------------------------------------------------------ |
| `REDIS_URL`                | api, workers |         | Redis, for sessions, the access cache and job queues. Required by the API and the workers. |
| `ACCESS_CACHE_TTL_SECONDS` |              | `300`   | Backstop lifetime of a cached access result; changes invalidate it at once.                |

### Sign-in and sessions

| Variable                   | Required by | Default  | Description                                                         |
| -------------------------- | ----------- | -------- | ------------------------------------------------------------------- |
| `JWT_SECRET`               | api         |          | Signs session tokens. Required by the API.                          |
| `JWT_ACCESS_EXPIRY`        |             | `900`    | Access token lifetime, seconds.                                     |
| `JWT_REFRESH_EXPIRY`       |             | `604800` | Refresh token lifetime, seconds.                                    |
| `BCRYPT_SALT_ROUNDS`       |             | `12`     | bcrypt cost for password hashes.                                    |
| `MAX_FAILED_ATTEMPTS`      |             | `5`      | Failed sign-ins before the account locks.                           |
| `LOCKOUT_DURATION_MINUTES` |             | `15`     | How long a locked account stays locked.                             |
| `COOKIE_SECURE`            |             | `false`  | Mark session cookies Secure. Always on in production.               |
| `COOKIE_DOMAIN`            |             |          | Domain attribute for session cookies; normally unset.               |
| `PLATFORM_API_KEY`         | api         |          | Key the platform admin uses for tenant routes. Required by the API. |

### Files

| Variable                | Required by | Default     | Description                                                                                                               |
| ----------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `UPLOAD_MAX_MB`         |             | `10`        | Largest request body the API accepts, in MB; file imports arrive this way. Per-tenant limits come with the plans in WP-2. |
| `STORAGE_BACKEND`       |             | `local`     | Where Transfer Desk files live.                                                                                           |
| `TD_LOCAL_UPLOADS_PATH` |             | `./uploads` | Local storage path; keep it outside any public web root.                                                                  |
| `TD_S3_BUCKET`          |             |             | S3 bucket for Transfer Desk files.                                                                                        |
| `AWS_REGION`            |             |             | AWS region for S3.                                                                                                        |
| `AWS_S3_BUCKET`         |             |             | S3 bucket for generated reports.                                                                                          |

### E-mail

| Variable                    | Required by | Default                         | Description                                          |
| --------------------------- | ----------- | ------------------------------- | ---------------------------------------------------- |
| `RESEND_API_KEY`            |             |                                 | Resend API key; e-mail goes through Resend when set. |
| `RESEND_FROM_EMAIL`         |             |                                 | Sender address for Resend.                           |
| `RESEND_API_URL`            |             | `https://api.resend.com/emails` | Resend's send endpoint.                              |
| `AWS_SES_REGION`            |             |                                 | SES region; e-mail goes through SES when set.        |
| `AWS_SES_ACCESS_KEY_ID`     |             |                                 | SES access key.                                      |
| `AWS_SES_SECRET_ACCESS_KEY` |             |                                 | SES secret key.                                      |
| `SES_FROM_EMAIL`            |             |                                 | Sender address for SES.                              |

### Exchange rates

| Variable                | Required by | Default                                                         | Description                                                                                                         |
| ----------------------- | ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ECB_RATES_URL`         |             | `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` | Daily reference-rate feed.                                                                                          |
| `FX_FALLBACK_RATES_URL` |             | `https://open.er-api.com/v6/latest/USD`                         | USD-based rates for currencies the ECB feed does not publish; JSON with a rates object, as open.er-api.com returns. |

### Connectors (move to per-tenant connections in WP-5)

| Variable                      | Required by | Default                           | Description                |
| ----------------------------- | ----------- | --------------------------------- | -------------------------- |
| `OHIP_HOSTNAME`               |             | `https://ohipapi.oraclecloud.com` | Opera Cloud (OHIP) API.    |
| `OHIP_CLIENT_ID`              |             |                                   | Opera Cloud client id.     |
| `OHIP_CLIENT_SECRET`          |             |                                   | Opera Cloud client secret. |
| `OHIP_ENTERPRISE_ID`          |             |                                   | Opera Cloud enterprise id. |
| `MEWS_HOSTNAME`               |             | `https://api.mews.com`            | Mews API.                  |
| `MEWS_CLIENT_TOKEN`           |             |                                   | Mews client token.         |
| `MEWS_ACCESS_TOKEN`           |             |                                   | Mews access token.         |
| `SKY_JANA_SFTP_HOST`          |             |                                   | Sky Jana SFTP host.        |
| `SKY_JANA_SFTP_PORT`          |             | `22`                              | Sky Jana SFTP port.        |
| `SKY_JANA_SFTP_USER`          |             |                                   | Sky Jana SFTP user.        |
| `SKY_JANA_SFTP_PASSWORD`      |             |                                   | Sky Jana SFTP password.    |
| `SKY_JANA_SFTP_PRIVATE_KEY`   |             |                                   | Sky Jana SFTP private key. |
| `SKY_JANA_SFTP_INBOUND_PATH`  |             | `/inbound`                        | Sky Jana inbound folder.   |
| `SKY_JANA_SFTP_OUTBOUND_PATH` |             | `/outbound`                       | Sky Jana outbound folder.  |

### Lists

| Variable            | Required by | Default | Description                                                                 |
| ------------------- | ----------- | ------- | --------------------------------------------------------------------------- |
| `PAGE_SIZE_DEFAULT` |             | `100`   | Rows in a page of a list when the request names no page size.               |
| `PAGE_SIZE_MAX`     |             | `500`   | Most rows in a page of a list; a larger requested page size gets this many. |

### Workers

| Variable                       | Required by | Default | Description                                                                                    |
| ------------------------------ | ----------- | ------- | ---------------------------------------------------------------------------------------------- |
| `IMPORT_CONCURRENCY`           |             | `1`     | Transfer Desk imports each tenant runs at once. Per-tenant values come with the plans in WP-2. |
| `WORKER_MAX_CLEAN_EXITS`       |             | `3`     | Clean exits in a row after which the supervisor gives up on a worker.                          |
| `TRANSFER_DESK_TENANT_POLL_MS` |             | `60000` | How often the Transfer Desk process checks for added or deactivated tenants.                   |

### Development

| Variable                     | Required by | Default | Description                                                              |
| ---------------------------- | ----------- | ------- | ------------------------------------------------------------------------ |
| `SEED_USER_PASSWORD`         |             |         | The demo users' password (pnpm dev:setup, db:seed).                      |
| `TML_ALLOW_INSECURE_SANDBOX` |             | `false` | Tests only: run TML without the isolated sandbox. Ignored in production. |

<!-- api-config:end -->

### Notes

- `DATABASE_URL` is used by the setup scripts and the seed, and as the registry
  fallback outside production. It is not a default tenant: a query with no
  tenant bound fails (AUT-05).
- `dev:setup` also needs `REGISTRY_DATABASE_URL` (a different database) and
  `APP_BASE_URL`. Neither it nor `db:seed` runs with `NODE_ENV=production`.
- The API starts no background workers; it only enqueues. The worker process
  runs them all, Transfer Desk included (OPS-10).
- Payment run bank files are stored as StorageBackend object keys, not
  filesystem paths. Legacy payment runs whose `bank_file_path` contains a raw
  local path must be regenerated or migrated to the namespaced storage-key
  format; raw path downloads are intentionally rejected.

### Tests

These are read by the test suites only, not by the application.

| Variable                     | Description                                                            | Example                                                  |
| ---------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `TEST_DATABASE_URL`          | Tenant database for integration tests; required by `test:integration`  | `postgresql://hfp:pass@localhost:5432/hfp_test`          |
| `TEST_SECOND_DATABASE_URL`   | A second tenant database, for the two-tenant isolation tests; required | `postgresql://hfp:pass@localhost:5432/hfp_test_b`        |
| `TEST_REGISTRY_DATABASE_URL` | A registry database, for the worker entry-point tests; required        | `postgresql://hfp:pass@localhost:5432/hfp_registry_test` |

---

## Web (`apps/web/.env.local`)

Every setting the web server reads is declared in `apps/web/lib/server/config.ts`; no other web file reads `process.env` (Next.js's own `NODE_ENV` and `NEXT_RUNTIME` aside). The server checks its settings when it starts (`instrumentation.ts`) and exits naming every one that is missing or invalid. None of them reaches the browser, and one build runs in any environment.

| Variable                       | Required | Default | Description                                                                                                     |
| ------------------------------ | -------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `PORT`                         |          | `3001`  | Port for `pnpm dev` and `pnpm start` (`scripts/next.mjs`). The standalone server in Docker reads it too.        |
| `API_INTERNAL_URL`             | yes      |         | The API as the web server reaches it, e.g. `http://127.0.0.1:4500`. Never sent to the browser.                  |
| `HFP_PLATFORM_KEY`             |          |         | Platform machine key for the `/platform` pages; must equal the API's `PLATFORM_API_KEY`.                        |
| `PLATFORM_ADMIN_USERNAME`      |          |         | Platform operator user name. Set together with the hash, or neither.                                            |
| `PLATFORM_ADMIN_PASSWORD_HASH` |          |         | Platform operator password as `scrypt:<salt-hex>:<hash-hex>`; `apps/web/.env.example` shows how to generate it. |

The browser calls `/api/v1/*` and `/auth/*` on the web app itself, which proxies them to `API_INTERNAL_URL` (`lib/server/api-proxy.ts`). There is no browser-visible API address, no allowed-origin list and no CORS. `NEXT_PUBLIC_API_BASE_URL`, `API_BASE_URL` and `NEXT_PUBLIC_APP_URL` are no longer read.

------------------ | ------------------------------------------------------------------------------------------------ | ----------------------- |
| `API_INTERNAL_URL` | The API as the web server reaches it; read at request time. Required. Never sent to the browser. | `http://127.0.0.1:4500` |

The browser calls `/api/v1/*` and `/auth/*` on the web app itself, which proxies them to `API_INTERNAL_URL` (`lib/server/api-proxy.ts`). There is no browser-visible API address, no allowed-origin list and no CORS. `NEXT_PUBLIC_API_BASE_URL`, `API_BASE_URL` and `NEXT_PUBLIC_APP_URL` are no longer read.

---

## Non-Docker Deployment

Use `docs/NON-DOCKER-SETUP.md` for direct Node.js, PostgreSQL, Redis and PM2 deployment. Docker is optional and not required for development or production.

---

## Signing in during development

There is no development token. Sign in with a real user at `/t/<tenant code>/login`; `pnpm dev:setup` builds the databases, creates the demo users with the password in `SEED_USER_PASSWORD` and gives them their roles, then prints the sign-in address. `ENABLE_DEV_AUTH` is no longer read.
