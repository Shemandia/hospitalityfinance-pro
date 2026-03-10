import type { PrismaClient } from "@prisma/client";
import { publishEvent } from "../../shared/rabbitmq.js";
import type { PeriodListQuery, PeriodCreateInput } from "./types.js";

export class PeriodServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export class PeriodService {
  constructor(private readonly prisma: PrismaClient) {}

  async createPeriod(entityId: string, input: PeriodCreateInput) {
    const existing = await this.prisma.period.findUnique({
      where: { entityId_year_month: { entityId, year: input.year, month: input.month } }
    });

    if (existing) {
      throw new PeriodServiceError(
        "PERIOD_DUPLICATE",
        `A period for ${input.year}-${String(input.month).padStart(2, "0")} already exists.`,
        409
      );
    }

    return this.prisma.period.create({
      data: {
        entityId,
        year: input.year,
        month: input.month,
        name: input.name,
        status: "OPEN",
        openedAt: new Date()
      }
    });
  }

  listPeriods(entityId: string, query: PeriodListQuery) {
    return this.prisma.period.findMany({
      where: {
        entityId,
        year: query.year,
        status: query.status
      },
      orderBy: [{ year: "desc" }, { month: "desc" }]
    });
  }

  async closePeriod(entityId: string, periodId: string, closedBy: string) {
    const period = await this.prisma.period.findFirst({
      where: { id: periodId, entityId }
    });

    if (!period) {
      throw new PeriodServiceError("PERIOD_NOT_FOUND", "Period not found.", 404);
    }

    if (period.status !== "OPEN") {
      throw new PeriodServiceError(
        "PERIOD_NOT_OPEN",
        "Only OPEN periods can be closed.",
        409
      );
    }

    const updated = await this.prisma.period.update({
      where: { id: periodId },
      data: {
        status: "CLOSED",
        closedAt: new Date()
      }
    });

    await publishEvent("period.closed", {
      entityId,
      periodId,
      closedBy,
      closedAt: updated.closedAt?.toISOString() ?? null
    });

    return updated;
  }

  async lockPeriod(entityId: string, periodId: string) {
    const period = await this.prisma.period.findFirst({
      where: { id: periodId, entityId }
    });

    if (!period) {
      throw new PeriodServiceError("PERIOD_NOT_FOUND", "Period not found.", 404);
    }

    if (period.status !== "CLOSED") {
      throw new PeriodServiceError(
        "PERIOD_NOT_CLOSED",
        "Only CLOSED periods can be locked.",
        409
      );
    }

    return this.prisma.period.update({
      where: { id: periodId },
      data: { status: "LOCKED" }
    });
  }

  async reopenPeriod(entityId: string, periodId: string, userRoles: string[]) {
    const period = await this.prisma.period.findFirst({
      where: { id: periodId, entityId }
    });

    if (!period) {
      throw new PeriodServiceError("PERIOD_NOT_FOUND", "Period not found.", 404);
    }

    if (period.status !== "LOCKED") {
      throw new PeriodServiceError(
        "PERIOD_NOT_LOCKED",
        "Only LOCKED periods can be reopened.",
        409
      );
    }

    const isSuperAdmin = userRoles.includes("SUPERADMIN");
    if (!isSuperAdmin) {
      throw new PeriodServiceError(
        "PERIOD_REOPEN_FORBIDDEN",
        "Only SUPERADMIN can reopen locked periods.",
        403
      );
    }

    const openPeriodCount = await this.prisma.period.count({
      where: {
        entityId,
        status: "OPEN",
        id: { not: periodId }
      }
    });

    if (openPeriodCount > 0) {
      throw new PeriodServiceError(
        "PERIOD_OPEN_EXISTS",
        "Another OPEN period already exists for this entity.",
        409
      );
    }

    return this.prisma.period.update({
      where: { id: periodId },
      data: {
        status: "OPEN",
        openedAt: new Date(),
        closedAt: null
      }
    });
  }
}
