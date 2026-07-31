import { Prisma, type PrismaClient } from "../../db/client.js";
import type { AuditQuery } from "./types.js";

import { ServiceError } from "../../shared/service-error.js";

export class AuditServiceError extends ServiceError {}

export interface CreateAuditEventInput {
  entityId: string;
  userId?: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async getEvents(entityId: string, query: AuditQuery) {
    const events = await this.prisma.auditEvent.findMany({
      where: {
        entityId,
        resourceType: query.resource_type,
        resourceId: query.resource_id
      },
      orderBy: [{ createdAt: "desc" }],
      take: query.limit
    });

    return events;
  }

  /**
   * Create a synchronous audit event for batch financial processes.
   * Unlike RabbitMQ events, this writes directly to the audit table
   * within the current transaction scope for guaranteed persistence.
   */
  async createEvent(input: CreateAuditEventInput) {
    return this.prisma.auditEvent.create({
      data: {
        entityId: input.entityId,
        userId: input.userId ?? null,
        eventType: input.eventType,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        beforeState: (input.beforeState as Prisma.InputJsonValue) ?? undefined,
        afterState: (input.afterState as Prisma.InputJsonValue) ?? undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null
      }
    });
  }

  /**
   * Create an audit event using a transaction client (for batch processes
   * that need the audit record committed atomically with the financial data).
   */
  static async createEventInTx(tx: PrismaClient, input: CreateAuditEventInput) {
    return (tx as any).auditEvent.create({
      data: {
        entityId: input.entityId,
        userId: input.userId ?? null,
        eventType: input.eventType,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        beforeState: (input.beforeState as Prisma.InputJsonValue) ?? undefined,
        afterState: (input.afterState as Prisma.InputJsonValue) ?? undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null
      }
    });
  }
}
