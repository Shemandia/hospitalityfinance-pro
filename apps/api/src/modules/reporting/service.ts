import { type InputJsonValue, type PrismaClient } from "@prisma/client";
import { getReportQueue } from "./queue.js";
import type { CreateReportRunInput } from "./types.js";

export class ReportingServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export class ReportingService {
  constructor(private readonly prisma: PrismaClient) {}

  listDefinitions(entityId: string) {
    return this.prisma.reportDefinition.findMany({
      where: { entityId },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }]
    });
  }

  async createRun(entityId: string, input: CreateReportRunInput) {
    const definition = await this.prisma.reportDefinition.findFirst({
      where: { id: input.definitionId, entityId }
    });

    if (!definition) {
      throw new ReportingServiceError(
        "REPORT_DEFINITION_NOT_FOUND",
        "Report definition not found.",
        404
      );
    }

    const run = await this.prisma.reportRun.create({
      data: {
        definitionId: definition.id,
        parameters: input.parameters as InputJsonValue,
        status: "QUEUED"
      }
    });

    const queue = getReportQueue();
    await queue.add("generate-report", { reportRunId: run.id }, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000
      },
      removeOnComplete: 100,
      removeOnFail: 100
    });

    return run;
  }

  async getRun(entityId: string, runId: string) {
    const run = await this.prisma.reportRun.findFirst({
      where: {
        id: runId,
        definition: {
          entityId
        }
      },
      include: {
        definition: true
      }
    });

    if (!run) {
      throw new ReportingServiceError("REPORT_RUN_NOT_FOUND", "Report run not found.", 404);
    }

    return run;
  }
}
