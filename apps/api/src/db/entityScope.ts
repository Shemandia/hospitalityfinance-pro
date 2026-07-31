import { Prisma } from "./client.js";

export const MODELS_WITH_ENTITY_ID = new Set([
  "EntityUser",
  "UserRole",
  "Period",
  "Account",
  "JournalType",
  "Journal",
  "RecurringJournal",
  "AccountPeriodBalance",
  "ApprovalRule",
  "JournalApproval",
  "AuditEvent",
  "ReportDefinition",
  "Supplier",
  "APInvoice",
  "ARInvoice",
  "APPayment",
  "PurchaseOrder",
  "GoodsReceivedNote",
  "PaymentRun",
  // Previously missing — cross-tenant leak risk:
  "Customer",
  "ARReceipt",
  "BankStatement",
  "InterfaceDefinition",
  "ConnectorMapping",
  "ImportLog",
  "PMSStatistic",
  "BudgetDefinition",
  "ConsolidationRunEntity",
  "TransferJournalRange",
  "LedgerSetup",
  "ProcessLock",
  "PeriodCloseStatus",
  "AnalysisDimension",
  "AllocationDefinition",
  "AssetCategory",
  "FixedAsset",
  "DepreciationTable",
  "AuthorizationStage",
  "AuthorizationTeam",
  "AuthorizationDelegation",
  "RejectionCode",
  "AuthorizationSet",
  "JournalAuthorization",
  "PaymentProfile",
  "RevaluationProfile",
  "YearEndConfig",
  "IntercompanyAccountPair",
  "BankAccount",
  "TaxCode"
]);

export const MODELS_WITH_NULLABLE_ENTITY_ID = new Set(["AccountTypeDefinition"]);
export const MODELS_WITH_SERVICE_SCOPED_ENTITY_ID = new Set(["LoginAudit"]);

type Args = Record<string, unknown> | undefined;

function mergeEntityWhere(
  existingWhere: Record<string, unknown> | undefined,
  entityId: string
): Record<string, unknown> {
  if (!existingWhere) {
    return { entityId };
  }

  return {
    AND: [{ entityId }, existingWhere]
  };
}

export function applyEntityScope(
  operation: string,
  args: Args,
  entityId: string
): Record<string, unknown> {
  const scoped = { ...(args ?? {}) } as Record<string, unknown>;

  // Only filter multi-record operations that support AND/OR in where.
  // Single-record operations (findUnique, update, delete, upsert) use unique keys
  // and are already protected by PostgreSQL RLS — adding entityId to their where
  // breaks Prisma's unique constraint resolution.
  if (
    ["findMany", "findFirst", "count", "aggregate", "updateMany", "deleteMany"].includes(operation)
  ) {
    scoped.where = mergeEntityWhere(scoped.where as Record<string, unknown> | undefined, entityId);
  }

  if (operation === "create") {
    const data = (scoped.data ?? {}) as Record<string, unknown>;
    if ("entityId" in data && data.entityId !== entityId) {
      throw new Error(`Entity context mismatch for ${operation}: payload entityId is not allowed.`);
    }
    if (!("entityId" in data)) {
      data.entityId = entityId;
    }
    scoped.data = data;
  }

  if (operation === "createMany") {
    const createManyData = scoped.data;
    if (Array.isArray(createManyData)) {
      scoped.data = createManyData.map((row) => {
        const record =
          typeof row === "object" && row !== null ? ({ ...row } as Record<string, unknown>) : {};
        if ("entityId" in record && record.entityId !== entityId) {
          throw new Error(
            `Entity context mismatch for ${operation}: payload entityId is not allowed.`
          );
        }
        if (!("entityId" in record)) {
          record.entityId = entityId;
        }
        return record;
      });
    }
  }

  return scoped;
}

export function applyNullableEntityScope(
  operation: string,
  args: Args,
  entityId: string
): Record<string, unknown> {
  const scoped = { ...(args ?? {}) } as Record<string, unknown>;
  const visibleEntityScope = { OR: [{ entityId: null }, { entityId }] };

  if (
    ["findMany", "findFirst", "count", "aggregate", "groupBy", "updateMany", "deleteMany"].includes(
      operation
    )
  ) {
    scoped.where = scoped.where
      ? { AND: [visibleEntityScope, scoped.where as Record<string, unknown>] }
      : visibleEntityScope;
  }

  if (operation === "create") {
    const data = (scoped.data ?? {}) as Record<string, unknown>;
    if ("entityId" in data && data.entityId !== entityId) {
      throw new Error(`Entity context mismatch for ${operation}: payload entityId is not allowed.`);
    }
    if (!("entityId" in data)) {
      data.entityId = entityId;
    }
    scoped.data = data;
  }

  if (operation === "createMany") {
    const createManyData = scoped.data;
    if (Array.isArray(createManyData)) {
      scoped.data = createManyData.map((row) => {
        const record =
          typeof row === "object" && row !== null ? ({ ...row } as Record<string, unknown>) : {};
        if ("entityId" in record && record.entityId !== entityId) {
          throw new Error(
            `Entity context mismatch for ${operation}: payload entityId is not allowed.`
          );
        }
        if (!("entityId" in record)) {
          record.entityId = entityId;
        }
        return record;
      });
    }
  }

  return scoped;
}

export function createEntityScopeExtension(getEntityId: () => string | null) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (
              !model ||
              (!MODELS_WITH_ENTITY_ID.has(model) &&
                !MODELS_WITH_NULLABLE_ENTITY_ID.has(model) &&
                !MODELS_WITH_SERVICE_SCOPED_ENTITY_ID.has(model))
            ) {
              return query(args);
            }

            const entityId = getEntityId();
            if (!entityId) {
              if (MODELS_WITH_SERVICE_SCOPED_ENTITY_ID.has(model)) {
                return query(args);
              }
              // For mutations on entity-scoped models, require entity context
              const mutationOps = new Set([
                "create",
                "createMany",
                "update",
                "updateMany",
                "delete",
                "deleteMany",
                "upsert"
              ]);
              if (mutationOps.has(operation)) {
                throw new Error(
                  `Entity context required for ${operation} on ${model}. Ensure X-Entity-ID header is set.`
                );
              }
              return query(args);
            }

            const scopedArgs = MODELS_WITH_NULLABLE_ENTITY_ID.has(model)
              ? applyNullableEntityScope(operation, args as Record<string, unknown>, entityId)
              : applyEntityScope(operation, args as Record<string, unknown>, entityId);

            return query(scopedArgs as never);
          }
        }
      }
    })
  );
}
