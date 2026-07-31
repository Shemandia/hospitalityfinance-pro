# Production Deployment Checklist

## Infrastructure

- [ ] PostgreSQL 16+ (RDS Multi-AZ recommended)
  - Run `pnpm --filter @hfp/api run db:migrate:deploy:registry`
  - Run `pnpm --filter @hfp/api run db:setup:tenant` for each tenant database
  - Run `pnpm --filter @hfp/api run db:seed` for system data (roles, permissions, report definitions)

- [ ] Redis 7+ (ElastiCache recommended)
  - Used by: native auth sessions/refresh tokens, BullMQ jobs, and KPI cache
  - Set `REDIS_URL` in API `.env`

- [ ] Optional RabbitMQ
  - Used for AMQP event delivery only
  - Set `RABBITMQ_URL` and `RABBITMQ_EVENTS_EXCHANGE` if enabled

- [ ] S3-compatible storage or private local storage
  - Set `STORAGE_BACKEND`, `TD_LOCAL_UPLOADS_PATH`, `TD_S3_BUCKET`, `AWS_S3_BUCKET`, and `AWS_REGION`
  - Local storage must not point inside a public web root

## Application

- [ ] API (`apps/api`)
  - `pnpm install --frozen-lockfile`
  - `pnpm --filter @hfp/api run build`
  - `node dist/index.js` or `pm2 start ecosystem.config.cjs --only hfp-api`
  - Set all env variables per `docs/ENV-VARIABLES.md`
  - Set `JWT_SECRET`, `COOKIE_SECURE=true`, `ALLOWED_ORIGINS`, and `REDIS_URL`
  - Verify: `GET /health` returns `{ status: "ok" }`

- [ ] Web (`apps/web`)
  - `pnpm install --frozen-lockfile`
  - `pnpm --filter @hfp/web run build`
  - `pnpm --filter @hfp/web start` or `pm2 start ecosystem.config.cjs --only hfp-web`
  - Set `NEXT_PUBLIC_API_BASE_URL` to the public API origin

- [ ] Workers
  - `pnpm --filter @hfp/api run workers:prod` or `pm2 start ecosystem.config.cjs --only hfp-workers`
  - Worker supervisor starts report generation, dunning, scheduled reports, and Transfer Desk workers
  - See `docs/NON-DOCKER-SETUP.md` for direct PM2 deployment

## Security

- [ ] `NODE_ENV=production` disables dev-token bypass
- [ ] HTTPS enabled on all public endpoints
- [ ] CORS origin restricted to frontend domain only
- [ ] Native auth cookies are httpOnly, secure, sameSite=strict, and served over HTTPS
- [ ] JWT access/refresh expiries and password lockout policy configured
- [ ] Row-level security policies active on tenant tables
- [ ] Audit trail triggers active

## Monitoring

- [ ] Health check endpoint monitored: `GET /health`
- [ ] Application logs forwarded from PM2/stdout
- [ ] Database connection pool monitoring
- [ ] Redis connection monitoring
- [ ] BullMQ queue depth alerts
- [ ] Error tracking configured

## Data Migration

- [ ] Chart of Accounts imported
- [ ] Opening balances loaded for each entity/period
- [ ] Suppliers migrated
- [ ] Customers migrated
- [ ] FX rates loaded
- [ ] Budget definitions created and lines imported
- [ ] Connector mappings configured
- [ ] Periods opened for current fiscal year

## UAT Sign-off

- [ ] GL: Create, post, approve, reverse journal entry
- [ ] AP: Create invoice, payment run, bank file download
- [ ] AR: Create invoice, post, receipt, allocation, ageing report
- [ ] FX: Rate entry, revaluation, multi-currency journal
- [ ] Reports: USALI P&L, Balance Sheet, Cash Flow PDF generation
- [ ] Dashboards render for expected roles
- [ ] Integration imports run successfully
- [ ] RBAC denies unauthorized writes
- [ ] Entity isolation verified
- [ ] Period management verified
