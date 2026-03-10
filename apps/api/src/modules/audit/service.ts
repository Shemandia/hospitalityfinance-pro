import type { PrismaClient } from "@prisma/client";
import type { AuditQuery } from "./types.js";

export class AuditServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
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
}
