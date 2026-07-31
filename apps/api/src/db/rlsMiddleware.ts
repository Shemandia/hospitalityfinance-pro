/**
 * RLS Context Middleware
 *
 * Automatically wraps every Prisma write operation on entity-scoped models
 * in a short-lived interactive transaction that first sets the PostgreSQL
 * session variable `app.current_entity_id`.  This ensures the database-level
 * RLS policies (WITH CHECK) are satisfied for INSERT / UPDATE / DELETE.
 *
 * Read operations are also wrapped so the USING clause can filter rows.
 *
 * The middleware is a no-op when:
 *  - The model is not entity-scoped
 *  - No entityId is available in the request context
 *  - We are already inside a scope that set RLS context (_rlsDepth > 0)
 */

import { PrismaClient } from "./client.js";
import { getRequestContext } from "./requestContext.js";

/** Models that carry an `entity_id` column and are protected by RLS policies. */
export const RLS_MODELS = new Set([
  // The Entity table itself has FORCE RLS with a policy of
  //   id = app_current_entity_id() OR parent_id = app_current_entity_id()
  // so any prisma.entity.* call needs the context set, otherwise it
  // returns zero rows and findUniqueOrThrow throws "No Entity found".
  "Entity",
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
  "ReportDefinition",
  "Supplier",
  "APInvoice",
  "ARInvoice",
  "APPayment",
  "PurchaseOrder",
  "GoodsReceivedNote",
  "PaymentRun",
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
  "TaxCode",
  "AccountTypeDefinition"
  // NOTE: AuditEvent is intentionally excluded — audit writes are handled
  // separately by the audit middleware which runs inside the RLS-wrapped
  // transaction and inherits its connection context.
]);

/** All Prisma operations that touch the database. */
const ALL_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy"
]);

export function registerRLSMiddleware(
  client: PrismaClient,
  getEntityId: () => string | null
): void {
  client.$use(async (params, next) => {
    const context = getRequestContext();

    // Already inside an RLS-wrapped scope — pass through
    if (context._rlsDepth > 0) {
      return next(params);
    }

    const model = params.model;
    if (!model || !RLS_MODELS.has(model) || !ALL_OPS.has(params.action)) {
      return next(params);
    }

    const entityId = getEntityId();
    if (!entityId) {
      return next(params);
    }

    // Wrap in a mini-transaction: SET LOCAL + re-execute operation on tx
    context._rlsDepth++;
    try {
      return await (client as any).$transaction(
        async (tx: any) => {
          await tx.$executeRaw`SELECT set_config('app.current_entity_id', ${entityId}, true)`;
          const delegate = model.charAt(0).toLowerCase() + model.slice(1);
          return tx[delegate][params.action](params.args);
        },
        { timeout: 30000 }
      );
    } finally {
      context._rlsDepth = Math.max(0, context._rlsDepth - 1);
    }
  });
}
