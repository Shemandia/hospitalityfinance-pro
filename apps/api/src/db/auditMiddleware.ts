import { Prisma, PrismaClient } from "./client.js";
import { serializeForAudit } from "./auditSerialization.js";
import { getRequestContext, runWithAuditDisabled } from "./requestContext.js";

const AUDIT_MODELS = new Set([
  "Supplier",
  "Journal",
  "JournalLine",
  "Account",
  "APInvoice",
  "APInvoiceLine",
  "PaymentRun",
  "PaymentRunItem",
  "PaymentRunInvoice",
  "PurchaseOrder",
  "GoodsReceivedNote",
  "ARInvoice",
  "APPayment",
  "APPaymentAllocation"
]);

const AUDIT_ACTIONS = new Set(["create", "update", "delete", "upsert"]);

function resolveResourceId(record: unknown, args: unknown): string {
  if (record && typeof record === "object" && "id" in (record as Record<string, unknown>)) {
    const id = (record as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  if (args && typeof args === "object" && "where" in (args as Record<string, unknown>)) {
    const where = (args as { where?: Record<string, unknown> }).where;
    if (where && typeof where.id === "string") return where.id;
  }
  return "unknown";
}

async function findPreviousState(
  client: PrismaClient,
  params: Prisma.MiddlewareParams
): Promise<unknown> {
  if (!params.model || !params.args || typeof params.args !== "object") return null;
  const delegate = (client as unknown as Record<string, unknown>)[
    params.model.charAt(0).toLowerCase() + params.model.slice(1)
  ] as
    | {
        findFirst?: (input: unknown) => Promise<unknown>;
        findUnique?: (input: unknown) => Promise<unknown>;
      }
    | undefined;
  if (!delegate) return null;
  const argsObject = params.args as { where?: Record<string, unknown> };
  const where = argsObject.where;
  if (!where) return null;
  if ("id" in where && delegate.findUnique) {
    return runWithAuditDisabled(() => delegate.findUnique!({ where }));
  }
  if (delegate.findFirst) {
    return runWithAuditDisabled(() => delegate.findFirst!({ where }));
  }
  return null;
}

/**
 * Register audit middleware on a PrismaClient instance.
 * Captures before/after state for all financial mutations.
 */
export function registerAuditMiddleware(
  client: PrismaClient,
  getEntityId: () => string | null
): void {
  client.$use(async (params, next) => {
    const context = getRequestContext();
    const entityId = getEntityId() ?? context.entityId;
    const modelName = params.model;
    if (
      context.disableAudit ||
      !modelName ||
      modelName === "AuditEvent" ||
      !AUDIT_MODELS.has(modelName) ||
      !AUDIT_ACTIONS.has(params.action) ||
      !entityId
    ) {
      return next(params);
    }
    const beforeState = await findPreviousState(client, params);
    const result = await next(params);
    // Fire-and-forget: audit must never block the primary operation.
    // The audit_events table has FORCE ROW LEVEL SECURITY, and this
    // client.auditEvent.create() runs on a pooled connection that may
    // lack the app.current_entity_id session variable, causing RLS
    // policy violations.  We set it explicitly in a raw transaction.
    runWithAuditDisabled(async () => {
      try {
        await client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_entity_id', ${entityId}, true)`;
          await tx.auditEvent.create({
            data: {
              entityId,
              userId: context.userId,
              eventType: params.action.toUpperCase(),
              resourceType: modelName.toLowerCase(),
              resourceId: resolveResourceId(result, params.args),
              beforeState: serializeForAudit(beforeState) as Prisma.InputJsonValue,
              afterState: serializeForAudit(result) as Prisma.InputJsonValue,
              ipAddress: context.ipAddress,
              userAgent: context.userAgent
            }
          });
        });
      } catch (err) {
        // Log audit failures but don't break business operations
        console.error(
          `[Audit] Failed to write audit event for ${modelName}.${params.action}:`,
          err
        );
      }
    }).catch((err) => {
      console.error(`[Audit] Unhandled rejection in audit middleware:`, err);
    });
    return result;
  });
}
