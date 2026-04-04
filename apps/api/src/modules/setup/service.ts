import { prisma } from "../../db/prisma.js";
import { stepSchemas } from "./types.js";

export class SetupService {
  async getProgress(tenantId: string) {
    let progress = await (prisma as any).tenantSetupProgress.findFirst({
      where: { tenantId }
    });
    if (!progress) {
      progress = await (prisma as any).tenantSetupProgress.create({
        data: {
          tenantId,
          currentStep: 1,
          isCompleted: false,
          stepData: {},
          completedSteps: []
        }
      });
    }
    return progress;
  }

  async saveStep(tenantId: string, step: number, data: unknown, saveOnly: boolean) {
    const schema = stepSchemas[step];
    if (!schema) throw new Error(`Invalid step: ${step}`);
    const validated = schema.parse(data);

    const progress = await this.getProgress(tenantId);
    const stepData = (progress.stepData as Record<string, unknown>) ?? {};
    stepData[String(step)] = validated;

    const completedSteps = [...new Set([...(progress.completedSteps as number[]), step])].sort();
    const nextStep = saveOnly ? progress.currentStep : Math.min(step + 1, 7);

    await (prisma as any).tenantSetupProgress.update({
      where: { id: progress.id },
      data: { stepData, completedSteps, currentStep: nextStep }
    });

    return { step, status: "saved" };
  }

  async complete(tenantId: string) {
    const progress = await this.getProgress(tenantId);
    const completed = progress.completedSteps as number[];
    const allDone = [1, 2, 3, 4, 5, 6].every((s) => completed.includes(s));
    if (!allDone) {
      throw new Error("All 6 steps must be completed before finishing setup.");
    }

    await (prisma as any).tenantSetupProgress.update({
      where: { id: progress.id },
      data: { isCompleted: true, completedAt: new Date() }
    });

    return { completed: true };
  }
}
