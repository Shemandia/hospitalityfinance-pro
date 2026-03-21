# Multi-Tenancy Strategy (Hospitality)

## Decision

Use the current `Entity` model as the canonical tenant model:

- `Entity.type = GROUP` represents a chain/group tenant.
- `Entity.type = PROPERTY` represents a property under a chain.

This preserves the existing API and accounting implementation while matching the hospitality requirement for chain + property isolation.

## Why this is the best fit now

- The backend is already implemented against `entityId` scoping and tested.
- `Entity` hierarchy supports chain-to-property structure without duplicating tenant models.
- Replacing it with a separate `chain_id/property_id` schema would require a full rewrite of modules already completed (GL, AP, reporting, audit).

## Tenant Isolation Rules

- Every authenticated request must provide a target `entityId` (header `X-Entity-ID` unless token has a single entity).
- Token entity claims are treated as access roots.
- Access is allowed when requested entity is either:
  - directly claimed in token, or
  - a descendant of a claimed parent entity (chain to property).
- Cross-chain access is denied.

## Alignment with Hospitality docs

- Docs requirement "multi-property under chain" is satisfied via hierarchy.
- Docs requirement "property-based access" is satisfied by per-entity checks and claim lineage validation.
- Current implementation uses application-enforced scoping (Prisma extension) instead of DB-native RLS.

## Next hardening step (recommended)

Database-native RLS bootstrap is now available:

- SQL policy file: `apps/api/src/db/sql/entity-rls.sql`
- Setup command: `pnpm --filter @hfp/api db:setup:rls`

Current runtime alignment:

- Critical GL/AP transaction paths set `app.current_entity_id` at transaction start.
- Application entity-scoping remains active and should stay enabled.

Further hardening:

- Move all tenant-bound reads/writes to transaction-scoped execution with session context set before queries.
- Use a non-owner DB role for application traffic and optionally enable `FORCE ROW LEVEL SECURITY` on tenant tables after validating all paths.
