import { Prisma } from "@prisma/client";

const MODELS_WITH_ENTITY_ID = new Set([
  "EntityUser",
  "UserRole",
  "Period",
  "Account",
  "Journal",
  "JournalType",
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
  "ConsolidationRunEntity"
]);

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

  if (
    [
      "findMany",
      "findFirst",
      "findUnique",
      "count",
      "aggregate",
      "updateMany",
      "deleteMany",
      "update",
      "delete",
      "upsert"
    ].includes(operation)
  ) {
    scoped.where = mergeEntityWhere(scoped.where as Record<string, unknown> | undefined, entityId);
  }

  if (operation === "create") {
    const data = (scoped.data ?? {}) as Record<string, unknown>;
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
            if (!model || !MODELS_WITH_ENTITY_ID.has(model)) {
              return query(args);
            }

            const entityId = getEntityId();
            if (!entityId) {
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

            const scopedArgs = applyEntityScope(
              operation,
              args as Record<string, unknown>,
              entityId
            );

            return query(scopedArgs as never);
          }
        }
      }
    })
  );
}
