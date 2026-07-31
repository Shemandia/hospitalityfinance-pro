# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Copy workspace root files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/ packages/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/api/ apps/api/

# Generate Prisma clients
RUN pnpm --filter @hfp/api db:generate

# Build TypeScript
RUN pnpm --filter @hfp/api build

# Prune dev dependencies
RUN pnpm prune --prod

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN apk add --no-cache tini

ENV NODE_ENV=production
WORKDIR /app

# Copy built output and production dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/src/db/generated ./apps/api/src/db/generated
COPY --from=builder /app/apps/api/src/db/migrations ./apps/api/src/db/migrations
COPY --from=builder /app/apps/api/src/db/schema-registry.prisma ./apps/api/src/db/
COPY --from=builder /app/apps/api/src/db/schema-tenant.prisma ./apps/api/src/db/
COPY --from=builder /app/packages ./packages

# Non-root user for security
RUN addgroup -g 1001 -S hfp && adduser -S hfp -u 1001 -G hfp
USER hfp

EXPOSE 4500

ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/api/dist/index.js"]
