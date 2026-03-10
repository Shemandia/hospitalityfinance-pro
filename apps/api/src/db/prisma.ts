import {
  Prisma,
  PrismaClient,
  type Prisma as PrismaNamespace
} from "@prisma/client";
import { createEntityScopeExtension } from "./entityScope.js";
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

let fallbackEntityContext: string | null = null;

const baseClient = new PrismaClient();

function getEntityFromContext(): string | null {
  return getRequestContext().entityId ?? fallbackEntityContext;
}

function resolveResourceId(record: unknown, args: unknown): string {
  if (record && typeof record === "object" && "id" in (record as Record<string, unknown>)) {
    const id = (record as Record<string, unknown>).id;
    if (typeof id === "string") {
      return id;
    }
  }

  if (args && typeof args === "object" && "where" in (args as Record<string, unknown>)) {
    const where = (args as { where?: Record<string, unknown> }).where;
    if (where && typeof where.id === "string") {
      return where.id;
    }
  }

  return "unknown";
}

async function findPreviousState(
  client: PrismaClient,
  params: PrismaNamespace.MiddlewareParams
): Promise<unknown> {
  if (!params.model || !params.args || typeof params.args !== "object") {
    return null;
  }

  const delegate = (client as unknown as Record<string, unknown>)[
    params.model.charAt(0).toLowerCase() + params.model.slice(1)
  ] as
    | {
        findFirst?: (input: unknown) => Promise<unknown>;
        findUnique?: (input: unknown) => Promise<unknown>;
      }
    | undefined;

  if (!delegate) {
    return null;
  }

  const argsObject = params.args as { where?: Record<string, unknown> };
  const where = argsObject.where;
  if (!where) {
    return null;
  }

  if ("id" in where && delegate.findUnique) {
    return runWithAuditDisabled(() => delegate.findUnique!({ where }));
  }

  if (delegate.findFirst) {
    return runWithAuditDisabled(() => delegate.findFirst!({ where }));
  }

  return null;
}

baseClient.$use(async (params, next) => {
  const context = getRequestContext();
  const entityId = context.entityId ?? fallbackEntityContext;
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

  const beforeState = await findPreviousState(baseClient, params);
  const result = await next(params);

  await runWithAuditDisabled(async () => {
    await baseClient.auditEvent.create({
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

  return result;
});

export function setEntityContext(entityId: string | null): void {
  fallbackEntityContext = entityId;
}

export const prisma = baseClient.$extends(
  createEntityScopeExtension(() => getEntityFromContext())
);
