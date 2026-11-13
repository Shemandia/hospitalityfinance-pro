# Environment Variables Reference

## API (`apps/api/.env`)

### Required

| Variable       | Description                            | Example                                     |
| -------------- | -------------------------------------- | ------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string           | `postgresql://user:pass@localhost:5432/hfp` |
| `NODE_ENV`     | Environment mode                       | `development` / `production`                |
| `PORT`         | API server port                        | `4000`                                      |
| `APP_BASE_URL` | Frontend base URL for emails and links | `https://app.example.com`                   |

### Authentication (Native JWT)

| Variable                   | Description                                                                                        | Example                    |
| -------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------- |
| `JWT_SECRET`               | HS256 signing secret, 32+ random bytes                                                             | `openssl-random-hex-value` |
| `JWT_ACCESS_EXPIRY`        | Access token lifetime in seconds                                                                   | `900`                      |
| `JWT_REFRESH_EXPIRY`       | Refresh token/session lifetime in seconds                                                          | `604800`                   |
| `BCRYPT_SALT_ROUNDS`       | Password hashing cost                                                                              | `12`                       |
| `MAX_FAILED_ATTEMPTS`      | Failed login attempts before lockout                                                               | `5`                        |
| `LOCKOUT_DURATION_MINUTES` | Account lockout duration                                                                           | `15`                       |
| `COOKIE_SECURE`            | Require HTTPS cookies in production                                                                | `true`                     |
| `COOKIE_DOMAIN`            | Leave unset: cookies belong to the web app's origin (same-origin proxy)                            |                            |
| `TRUST_PROXY`              | Addresses whose `X-Forwarded-*` headers the API believes: the web app's server. Default `loopback` | `loopback` / `10.0.0.5`    |

### Redis (BullMQ queues)

| Variable                   | Description                                                                  | Example                  |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------ |
| `REDIS_URL`                | Full Redis URL (preferred)                                                   | `redis://localhost:6379` |
| `ACCESS_CACHE_TTL_SECONDS` | Lifetime of a cached access result (backstop; changes invalidate explicitly) | `300`                    |
| `REDIS_HOST`               | Redis hostname (if not using URL)                                            | `127.0.0.1`              |
| `REDIS_PORT`               | Redis port                                                                   | `6379`                   |
| `REDIS_PASSWORD`           | Redis password                                                               | `secret`                 |

### Oracle OHIP (Opera Cloud / Simphony POS)

| Variable             | Description              | Example                           |
| -------------------- | ------------------------ | --------------------------------- |
| `OHIP_CLIENT_ID`     | OHIP OAuth client ID     | `abc123`                          |
| `OHIP_CLIENT_SECRET` | OHIP OAuth client secret | `secret`                          |
| `OHIP_ENTERPRISE_ID` | OHIP enterprise/hotel ID | `HOTEL001`                        |
| `OHIP_HOSTNAME`      | OHIP API base URL        | `https://ohipapi.oraclecloud.com` |

### Email (Resend)

| Variable            | Description               | Example             |
| ------------------- | ------------------------- | ------------------- |
| `RESEND_API_KEY`    | Resend API key (optional) | `re_abc123`         |
| `RESEND_FROM_EMAIL` | Sender email address      | `noreply@hotel.com` |

### File Storage

| Variable                | Description                                                                      | Example        |
| ----------------------- | -------------------------------------------------------------------------------- | -------------- |
| `STORAGE_BACKEND`       | Storage backend for Transfer Desk/payment files                                  | `local` / `s3` |
| `TD_LOCAL_UPLOADS_PATH` | Local private storage root; never use web public roots such as `apps/web/public` | `./uploads`    |
| `TD_S3_BUCKET`          | S3 bucket for Transfer Desk/payment files                                        | `hfp-files`    |
| `AWS_S3_BUCKET`         | S3 bucket for reports (optional)                                                 | `hfp-reports`  |
| `AWS_REGION`            | AWS region                                                                       | `eu-west-1`    |

Payment run bank files are stored as StorageBackend object keys, not filesystem
paths. Legacy payment runs whose `bank_file_path` contains a raw local path must
be regenerated or migrated to the namespaced storage-key format; raw path
downloads are intentionally rejected.

### Sky Jana SFTP

| Variable               | Description           | Example           |
| ---------------------- | --------------------- | ----------------- |
| `JANA_SFTP_HOST`       | SFTP server hostname  | `sftp.jana.co.tz` |
| `JANA_SFTP_PORT`       | SFTP port             | `22`              |
| `JANA_SFTP_USERNAME`   | SFTP username         | `hfp`             |
| `JANA_SFTP_PASSWORD`   | SFTP password         | `secret`          |
| `JANA_SFTP_REMOTE_DIR` | Remote directory path | `/exports/`       |

### Application

| Variable       | Description                         | Example                 |
| -------------- | ----------------------------------- | ----------------------- |
| `APP_BASE_URL` | Frontend base URL (for email links) | `https://app.hotel.com` |

### Development setup (`pnpm dev:setup`)

| Variable             | Description                                                                                                                                                                  | Example             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `SEED_USER_PASSWORD` | Password the demo users get when they are created (12+ characters, upper and lower case, a digit). Required by `dev:setup` and `db:seed`; users who have a password keep it. | `Choose-Your-Own-1` |

`dev:setup` also needs `DATABASE_URL`, `REGISTRY_DATABASE_URL` (a different database) and `APP_BASE_URL`. Neither it nor `db:seed` runs with `NODE_ENV=production`.

### Workers (`pnpm workers`, `workers:prod`)

The API starts no background workers; it only enqueues. The worker process runs
them all, Transfer Desk included (OPS-10).

| Variable                       | Description                                                                                                                                 | Example |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `WORKER_MAX_CLEAN_EXITS`       | A worker that exits cleanly this many times in a row is not restarted; the supervisor stops all workers and exits with code 1. Default `3`. | `3`     |
| `TRANSFER_DESK_TENANT_POLL_MS` | How often the Transfer Desk process checks the registry for added or deactivated tenants. Default `60000`.                                  | `60000` |

### Tests

| Variable                     | Description                                                            | Example                                                  |
| ---------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `TEST_DATABASE_URL`          | Tenant database for integration tests; required by `test:integration`  | `postgresql://hfp:pass@localhost:5432/hfp_test`          |
| `TEST_SECOND_DATABASE_URL`   | A second tenant database, for the two-tenant isolation tests; required | `postgresql://hfp:pass@localhost:5432/hfp_test_b`        |
| `TEST_REGISTRY_DATABASE_URL` | A registry database, for the worker entry-point tests; required        | `postgresql://hfp:pass@localhost:5432/hfp_registry_test` |

`DATABASE_URL` is used by the setup scripts and as the registry fallback. It is
not a default tenant: a query with no tenant bound fails (AUT-05).

---

## Web (`apps/web/.env.local`)

| Variable           | Description                                                                                      | Example                 |
| ------------------ | ------------------------------------------------------------------------------------------------ | ----------------------- |
| `API_INTERNAL_URL` | The API as the web server reaches it; read at request time. Required. Never sent to the browser. | `http://127.0.0.1:4500` |

The browser calls `/api/v1/*` and `/auth/*` on the web app itself, which proxies them to `API_INTERNAL_URL` (`lib/server/api-proxy.ts`). There is no browser-visible API address, no allowed-origin list and no CORS. `NEXT_PUBLIC_API_BASE_URL`, `API_BASE_URL` and `NEXT_PUBLIC_APP_URL` are no longer read.

---

## Non-Docker Deployment

Use `docs/NON-DOCKER-SETUP.md` for direct Node.js, PostgreSQL, Redis and PM2 deployment. Docker is optional and not required for development or production.

---

## Signing in during development

There is no development token. Sign in with a real user at `/t/<tenant code>/login`; `pnpm dev:setup` builds the databases, creates the demo users with the password in `SEED_USER_PASSWORD` and gives them their roles, then prints the sign-in address. `ENABLE_DEV_AUTH` is no longer read.
