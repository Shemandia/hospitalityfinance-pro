/**
 * Transfer Desk — System profile seed data
 *
 * Creates pre-built formats (FSD), transformations (TML), and profiles
 * for Opera PMS, Sky Jana MMS, Simphony POS, and Bank Statement (MT940).
 *
 * All records are created with isSystem=true and are idempotent (safe to re-run).
 * Uses findFirst+create/update pattern since Prisma doesn't support null in
 * composite unique constraints for upsert on these models.
 */

import type { PrismaClient } from "./client.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Idempotent upsert-by-name for TransferFormat */
async function upsertFormat(
  prisma: PrismaClient,
  data: {
    name: string;
    description?: string;
    formatType: "FLAT_FILE" | "XML" | "JSON" | "EXCEL" | "FIXED_WIDTH";
    fsdXml: object;
  }
) {
  const existing = await (prisma as any).transferFormat.findFirst({
    where: { name: data.name }
  });
  if (existing) {
    return (prisma as any).transferFormat.update({
      where: { id: existing.id },
      data: {
        description: data.description,
        formatType: data.formatType,
        fsdXml: data.fsdXml,
        isSystem: true
      }
    });
  }
  return (prisma as any).transferFormat.create({
    data: {
      name: data.name,
      description: data.description,
      formatType: data.formatType,
      fsdXml: data.fsdXml,
      isSystem: true
    }
  });
}

/** Idempotent upsert-by-name for TransferTransformation */
async function upsertTransformation(
  prisma: PrismaClient,
  data: {
    name: string;
    description?: string;
    rulesJson: object;
  }
) {
  const existing = await (prisma as any).transferTransformation.findFirst({
    where: { name: data.name }
  });
  if (existing) {
    return (prisma as any).transferTransformation.update({
      where: { id: existing.id },
      data: {
        description: data.description,
        rulesJson: data.rulesJson,
        isSystem: true
      }
    });
  }
  return (prisma as any).transferTransformation.create({
    data: {
      name: data.name,
      description: data.description,
      rulesJson: data.rulesJson,
      isSystem: true
    }
  });
}

/** Idempotent upsert-by-name for TransferProfile */
async function upsertProfile(
  prisma: PrismaClient,
  data: {
    name: string;
    description?: string;
    profileType: "IMPORT" | "EXPORT" | "PROCESS" | "TRANSFER";
    sourceComponent?: string;
    targetComponent?: string;
    sourceFormatId?: string;
    targetFormatId?: string;
    transformationId?: string;
    sourceParams?: object;
    targetParams?: object;
  }
) {
  const existing = await (prisma as any).transferProfile.findFirst({
    where: { name: data.name }
  });
  if (existing) {
    return (prisma as any).transferProfile.update({
      where: { id: existing.id },
      data: {
        ...data,
        isSystem: true,
        isValid: true,
        isActive: true
      }
    });
  }
  return (prisma as any).transferProfile.create({
    data: {
      ...data,
      isSystem: true,
      isValid: true,
      isActive: true
    }
  });
}

// ── Main seed function ───────────────────────────────────────────────────────

export async function seedTransferDeskSystemData(prisma: PrismaClient): Promise<void> {
  // Commit 2 will populate Opera PMS profiles
  // Commit 3 will populate Sky Jana profiles
  // Commit 4 will populate Simphony POS + Bank Statement profiles

  console.log("Transfer Desk system seed: scaffold ready (no profiles yet).");
}
