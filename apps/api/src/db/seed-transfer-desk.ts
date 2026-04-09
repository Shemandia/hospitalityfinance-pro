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

// ══════════════════════════════════════════════════════════════════════════════
// FSD Schemas — Opera PMS (pipe-delimited, ÷1000 implied decimals)
// ══════════════════════════════════════════════════════════════════════════════

/** Common Opera PMS FSD base: pipe-delimited, skip 1 header line */
function operaFsdBase(recordName: string, fields: object[]) {
  return {
    version: "1.0",
    classification: "DELIMITED",
    fieldSep: "|",
    recordSep: "\r\n",
    initialLinesToIgnore: 1,
    encoding: "UTF-8",
    record: { name: recordName, fields }
  };
}

const OPERA_EZZRV_FSD = operaFsdBase("EZZRV_Revenue", [
  { name: "businessDate", type: "date", required: true, maxLength: 10 },
  { name: "revenueCenter", type: "string", required: true, maxLength: 20 },
  { name: "accountCode", type: "string", required: true, maxLength: 20 },
  { name: "debit", type: "integer", required: true, maxLength: 15 },
  { name: "credit", type: "integer", required: true, maxLength: 15 },
  { name: "currencyCode", type: "string", required: true, maxLength: 3 },
  { name: "reference", type: "string", required: false, maxLength: 50 },
  { name: "description", type: "string", required: false, maxLength: 100 }
]);

const OPERA_EZZCL_FSD = operaFsdBase("EZZCL_CityLedger", [
  { name: "businessDate", type: "date", required: true, maxLength: 10 },
  { name: "guestName", type: "string", required: true, maxLength: 80 },
  { name: "folioNumber", type: "string", required: true, maxLength: 20 },
  { name: "accountCode", type: "string", required: true, maxLength: 20 },
  { name: "debit", type: "integer", required: true, maxLength: 15 },
  { name: "credit", type: "integer", required: true, maxLength: 15 },
  { name: "currencyCode", type: "string", required: true, maxLength: 3 },
  { name: "reference", type: "string", required: false, maxLength: 50 },
  { name: "description", type: "string", required: false, maxLength: 100 }
]);

const OPERA_EZZMS_FSD = operaFsdBase("EZZMS_Miscellaneous", [
  { name: "businessDate", type: "date", required: true, maxLength: 10 },
  { name: "transactionType", type: "string", required: true, maxLength: 20 },
  { name: "accountCode", type: "string", required: true, maxLength: 20 },
  { name: "debit", type: "integer", required: true, maxLength: 15 },
  { name: "credit", type: "integer", required: true, maxLength: 15 },
  { name: "currencyCode", type: "string", required: true, maxLength: 3 },
  { name: "reference", type: "string", required: false, maxLength: 50 },
  { name: "description", type: "string", required: false, maxLength: 100 }
]);

const OPERA_EZZDS_FSD = operaFsdBase("EZZDS_Deposits", [
  { name: "businessDate", type: "date", required: true, maxLength: 10 },
  { name: "guestName", type: "string", required: false, maxLength: 80 },
  { name: "reservationId", type: "string", required: true, maxLength: 20 },
  { name: "accountCode", type: "string", required: true, maxLength: 20 },
  { name: "debit", type: "integer", required: true, maxLength: 15 },
  { name: "credit", type: "integer", required: true, maxLength: 15 },
  { name: "currencyCode", type: "string", required: true, maxLength: 3 },
  { name: "reference", type: "string", required: false, maxLength: 50 },
  { name: "description", type: "string", required: false, maxLength: 100 }
]);

// ══════════════════════════════════════════════════════════════════════════════
// TML Transformations — Opera PMS (÷1000 on debit/credit)
// ══════════════════════════════════════════════════════════════════════════════

/** Shared Opera ÷1000 transformation: map fields + divide amounts by 1000 */
function operaTmlRules(extraMaps: Array<{ target: string; path: string }>) {
  return {
    rules: [
      { type: "map", target: "accountCode", sources: [{ path: "accountCode" }] },
      {
        type: "transform",
        target: "debit",
        function: {
          name: "divideBy1000",
          params: [{ value: "debit", fromSource: true, type: "number" }]
        }
      },
      {
        type: "transform",
        target: "credit",
        function: {
          name: "divideBy1000",
          params: [{ value: "credit", fromSource: true, type: "number" }]
        }
      },
      { type: "map", target: "currency", sources: [{ path: "currencyCode" }] },
      { type: "map", target: "description", sources: [{ path: "description" }] },
      { type: "map", target: "reference", sources: [{ path: "reference" }] },
      ...extraMaps.map((m) => ({
        type: "map" as const,
        target: m.target,
        sources: [{ path: m.path }]
      }))
    ]
  };
}

const OPERA_EZZRV_TML = operaTmlRules([{ target: "dimension1", path: "revenueCenter" }]);

const OPERA_EZZCL_TML = operaTmlRules([
  { target: "dimension1", path: "guestName" },
  { target: "dimension2", path: "folioNumber" }
]);

const OPERA_EZZMS_TML = operaTmlRules([{ target: "dimension1", path: "transactionType" }]);

const OPERA_EZZDS_TML = operaTmlRules([
  { target: "dimension1", path: "guestName" },
  { target: "dimension2", path: "reservationId" }
]);

// ══════════════════════════════════════════════════════════════════════════════
// Seed: Opera PMS
// ══════════════════════════════════════════════════════════════════════════════

async function seedOperaProfiles(prisma: PrismaClient): Promise<void> {
  // ── Formats ──
  const fmtEzzrv = await upsertFormat(prisma, {
    name: "Opera EZZRV (Revenue)",
    description: "Oracle Opera Cloud night-audit revenue file (pipe-delimited, ÷1000)",
    formatType: "FLAT_FILE",
    fsdXml: OPERA_EZZRV_FSD
  });
  const fmtEzzcl = await upsertFormat(prisma, {
    name: "Opera EZZCL (City Ledger)",
    description: "Oracle Opera Cloud city-ledger / AR transactions (pipe-delimited, ÷1000)",
    formatType: "FLAT_FILE",
    fsdXml: OPERA_EZZCL_FSD
  });
  const fmtEzzms = await upsertFormat(prisma, {
    name: "Opera EZZMS (Miscellaneous)",
    description: "Oracle Opera Cloud miscellaneous charges and adjustments (pipe-delimited, ÷1000)",
    formatType: "FLAT_FILE",
    fsdXml: OPERA_EZZMS_FSD
  });
  const fmtEzzds = await upsertFormat(prisma, {
    name: "Opera EZZDS (Deposits)",
    description: "Oracle Opera Cloud guest deposit transactions (pipe-delimited, ÷1000)",
    formatType: "FLAT_FILE",
    fsdXml: OPERA_EZZDS_FSD
  });

  // ── Transformations ──
  const tmlEzzrv = await upsertTransformation(prisma, {
    name: "Opera EZZRV → GL Journal",
    description: "Maps Opera revenue fields to GL journal lines with ÷1000 amount conversion",
    rulesJson: OPERA_EZZRV_TML
  });
  const tmlEzzcl = await upsertTransformation(prisma, {
    name: "Opera EZZCL → GL Journal",
    description: "Maps Opera city-ledger fields to GL journal lines with ÷1000 amount conversion",
    rulesJson: OPERA_EZZCL_TML
  });
  const tmlEzzms = await upsertTransformation(prisma, {
    name: "Opera EZZMS → GL Journal",
    description: "Maps Opera miscellaneous fields to GL journal lines with ÷1000 amount conversion",
    rulesJson: OPERA_EZZMS_TML
  });
  const tmlEzzds = await upsertTransformation(prisma, {
    name: "Opera EZZDS → GL Journal",
    description: "Maps Opera deposit fields to GL journal lines with ÷1000 amount conversion",
    rulesJson: OPERA_EZZDS_TML
  });

  // ── Profiles ──
  const operaTargetParams = {
    fieldMap: { accountCode: "accountId" },
    groupBy: "businessDate",
    defaultDescription: "Opera PMS night-audit import"
  };

  await upsertProfile(prisma, {
    name: "Opera PMS Revenue",
    description: "Daily night-audit revenue posting from Opera Cloud (EZZRV file)",
    profileType: "IMPORT",
    sourceComponent: "OPERA_CLOUD",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: fmtEzzrv.id,
    transformationId: tmlEzzrv.id,
    targetParams: operaTargetParams
  });

  await upsertProfile(prisma, {
    name: "Opera PMS City Ledger",
    description: "City-ledger / AR transactions from Opera Cloud (EZZCL file)",
    profileType: "IMPORT",
    sourceComponent: "OPERA_CLOUD",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: fmtEzzcl.id,
    transformationId: tmlEzzcl.id,
    targetParams: {
      ...operaTargetParams,
      defaultDescription: "Opera city-ledger import"
    }
  });

  await upsertProfile(prisma, {
    name: "Opera PMS Miscellaneous",
    description: "Miscellaneous charges and adjustments from Opera Cloud (EZZMS file)",
    profileType: "IMPORT",
    sourceComponent: "OPERA_CLOUD",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: fmtEzzms.id,
    transformationId: tmlEzzms.id,
    targetParams: {
      ...operaTargetParams,
      defaultDescription: "Opera miscellaneous import"
    }
  });

  await upsertProfile(prisma, {
    name: "Opera PMS Deposits",
    description: "Guest deposit transactions from Opera Cloud (EZZDS file)",
    profileType: "IMPORT",
    sourceComponent: "OPERA_CLOUD",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: fmtEzzds.id,
    transformationId: tmlEzzds.id,
    targetParams: {
      ...operaTargetParams,
      defaultDescription: "Opera deposits import"
    }
  });

  console.log("Seeded 4 Opera PMS system profiles (EZZRV, EZZCL, EZZMS, EZZDS).");
}

// ── Main seed function ───────────────────────────────────────────────────────

export async function seedTransferDeskSystemData(prisma: PrismaClient): Promise<void> {
  await seedOperaProfiles(prisma);

  // Commit 3 will add: await seedJanaProfiles(prisma);
  // Commit 4 will add: await seedSimphonyProfiles(prisma);
  // Commit 4 will add: await seedBankStatementProfiles(prisma);
}
