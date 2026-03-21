# Production Deployment Checklist

## Infrastructure

- [ ] PostgreSQL 16+ (RDS Multi-AZ recommended)
  - Run `prisma migrate deploy --schema apps/api/src/db/schema.prisma`
  - Run `npm run db:seed` for system data (roles, permissions, report definitions)
  - Run `npm run db:setup:rls` for row-level security policies
  - Run `npm run db:setup:audit` for audit immutability triggers
  - Run `npm run db:setup:performance` for indexes

- [ ] Redis 7+ (ElastiCache recommended)
  - Used by: BullMQ (report generation, dunning jobs), KPI cache
  - Set REDIS_URL in API .env

- [ ] Keycloak 24+ (see docs/KEYCLOAK-SETUP.md)
  - Realm, roles, clients, and user attribute mappers configured
  - HTTPS enforced

- [ ] S3 bucket (optional, for report PDF storage)
  - Set AWS_S3_BUCKET and AWS_REGION
  - IAM role with PutObject permission

## Application

- [ ] API (`apps/api`)
  - `pnpm install --frozen-lockfile`
  - `pnpm run build`
  - `node dist/index.js` (or PM2/Docker)
  - Set all env variables per docs/ENV-VARIABLES.md
  - Verify: `GET /health` returns `{ status: "ok" }`

- [ ] Web (`apps/web`)
  - `pnpm install --frozen-lockfile`
  - `pnpm run build`
  - `pnpm start` (Next.js production server)
  - Set NEXTAUTH_SECRET (random 32+ chars)

- [ ] Workers (background processes)
  - `npm run report:worker` — report PDF generation (BullMQ)
  - `npm run dunning:worker` — AR dunning email scheduler (BullMQ)

## Security

- [ ] NODE_ENV=production (disables dev-token bypass)
- [ ] HTTPS on all endpoints (TLS termination at load balancer)
- [ ] CORS origin restricted to frontend domain only
- [ ] Rate limiting enabled on integration endpoints (10 req/min)
- [ ] Row-level security (RLS) active on all 26 tenant tables
- [ ] Audit trail triggers active (immutable insert-only)
- [ ] Keycloak session timeout configured (recommended: 30 min idle, 8 hour max)

## Monitoring

- [ ] Health check endpoint monitored: `GET /health`
- [ ] Application logs forwarded (stdout → CloudWatch/Datadog)
- [ ] Database connection pool monitoring
- [ ] Redis connection monitoring
- [ ] BullMQ queue depth alerts (report-generation, ar-dunning)
- [ ] Error tracking (Sentry recommended)

## Data Migration

- [ ] Chart of Accounts imported (Excel via /gl/accounts/import)
- [ ] Opening balances loaded for each entity/period
- [ ] Suppliers migrated (via /api/v1/integration/inbound/suppliers)
- [ ] Customers migrated (via /api/v1/ar/customers)
- [ ] FX rates loaded (via /api/v1/fx/rates or ECB import)
- [ ] Budget definitions created and lines imported
- [ ] Connector mappings configured (Opera, Simphony, Payroll)
- [ ] Periods opened for current fiscal year

## UAT Sign-off

- [ ] GL: Create, post, approve, reverse journal entry
- [ ] AP: Create invoice, three-way match, payment run, bank file download
- [ ] AR: Create invoice, post, receipt, allocation, ageing report
- [ ] FX: Rate entry, revaluation, multi-currency journal
- [ ] Reports: USALI P&L, Balance Sheet, Cash Flow PDF generation
- [ ] Dashboards: All 8 role views rendering correctly
- [ ] Integration: Opera Cloud import, SAF file import, payroll import
- [ ] RBAC: VIEWER cannot write, CONTROLLER can post, ADMIN can import
- [ ] Entity isolation: Property A cannot see Property B data
- [ ] Period management: Open, close, lock, reopen (SUPERADMIN)
