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
    classification:
      | "DELIMITED"
      | "SINGLE_FIXED"
      | "MULTIPLE_FIXED"
      | "OTHER_FLAT"
      | "USER_XML"
      | "SIMPLE_XML";
    fsdXml: object;
  }
) {
  const fsdXmlStr = JSON.stringify(data.fsdXml);
  const existing = await (prisma as any).transferFormat.findFirst({
    where: { name: data.name }
  });
  if (existing) {
    return (prisma as any).transferFormat.update({
      where: { id: existing.id },
      data: {
        description: data.description,
        classification: data.classification,
        fsdXml: fsdXmlStr,
        isSystem: true
      }
    });
  }
  return (prisma as any).transferFormat.create({
    data: {
      name: data.name,
      description: data.description,
      classification: data.classification,
      fsdXml: fsdXmlStr,
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
    profileType: "IMPORT" | "EXPORT" | "PROCESS" | "INTERNAL_TRANSFER" | "EXTERNAL_TRANSFER";
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

// EZZDS and EZZMS are the Opera night-audit *statistics* exports — non-financial
// memo data that posts to STATISTICAL (Z-prefix) accounts only. They share the
// pipe-delimited SAF column layout with EZZRV/EZZCL, but journal type is
// FIDST (daily stats) / FIDMS (market segment stats), the D/C indicator is
// ignored, and the 18-digit ÷1000 amount is stored as a quantity in stat_value
// with debit=0 / credit=0. The Transfer Desk import pipeline routes these to
// the SAF parser (apps/api/src/modules/integration/connectors/saf/*), which
// auto-detects the file type and bypasses the debit/credit balance check.

const OPERA_EZZDS_FSD = operaFsdBase("EZZDS_DailyStatistics", [
  { name: "accountCode", type: "string", required: true, maxLength: 20 },
  { name: "period", type: "string", required: true, maxLength: 7 },
  { name: "businessDate", type: "date", required: true, maxLength: 8 },
  { name: "journalType", type: "string", required: true, maxLength: 5 },
  { name: "statCode", type: "string", required: false, maxLength: 10 },
  { name: "description", type: "string", required: false, maxLength: 100 },
  { name: "amount", type: "integer", required: true, maxLength: 18 },
  { name: "currencyCode", type: "string", required: true, maxLength: 3 },
  { name: "businessUnit", type: "string", required: true, maxLength: 5 }
]);

const OPERA_EZZMS_FSD = operaFsdBase("EZZMS_MarketSegmentStatistics", [
  { name: "accountCode", type: "string", required: true, maxLength: 20 },
  { name: "period", type: "string", required: true, maxLength: 7 },
  { name: "businessDate", type: "date", required: true, maxLength: 8 },
  { name: "journalType", type: "string", required: true, maxLength: 5 },
  { name: "segmentCode", type: "string", required: false, maxLength: 10 },
  { name: "description", type: "string", required: false, maxLength: 100 },
  { name: "amount", type: "integer", required: true, maxLength: 18 },
  { name: "currencyCode", type: "string", required: true, maxLength: 3 },
  { name: "businessUnit", type: "string", required: true, maxLength: 5 }
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

/**
 * Statistics TML — daily stats / market segment stats.
 *
 * Unlike the financial Opera TML (which routes amount to debit/credit), stats
 * lines are memo postings: the ÷1000 amount lands in stat_value and debit/credit
 * are forced to zero. The SAF import service performs the same routing at run
 * time by inspecting the account's type; this transformation exists so the
 * Transfer Desk shows the correct field mapping in the UI and so generic FSD
 * consumers that don't read the account catalogue still produce valid output.
 */
function operaStatsTmlRules(segmentField: { target: string; path: string }) {
  return {
    rules: [
      { type: "map", target: "accountCode", sources: [{ path: "accountCode" }] },
      { type: "literal", target: "debit", value: "0" },
      { type: "literal", target: "credit", value: "0" },
      {
        type: "transform",
        target: "statValue",
        function: {
          name: "divideBy1000",
          params: [{ value: "amount", fromSource: true, type: "number" }]
        }
      },
      { type: "map", target: "currency", sources: [{ path: "currencyCode" }] },
      { type: "map", target: "description", sources: [{ path: "description" }] },
      { type: "map", target: "transactionDate", sources: [{ path: "businessDate" }] },
      { type: "map", target: "period", sources: [{ path: "period" }] },
      { type: "map", target: "journalType", sources: [{ path: "journalType" }] },
      {
        type: "map",
        target: "dimension1",
        sources: [{ path: segmentField.path }]
      }
    ]
  };
}

const OPERA_EZZDS_TML = operaStatsTmlRules({ target: "dimension1", path: "statCode" });
const OPERA_EZZMS_TML = operaStatsTmlRules({ target: "dimension1", path: "segmentCode" });

// ══════════════════════════════════════════════════════════════════════════════
// Seed: Opera PMS
// ══════════════════════════════════════════════════════════════════════════════

async function seedOperaProfiles(prisma: PrismaClient): Promise<void> {
  // ── Formats ──
  const fmtEzzrv = await upsertFormat(prisma, {
    name: "Opera EZZRV (Revenue)",
    description: "Oracle Opera Cloud night-audit revenue file (pipe-delimited, ÷1000)",
    classification: "DELIMITED",
    fsdXml: OPERA_EZZRV_FSD
  });
  const fmtEzzcl = await upsertFormat(prisma, {
    name: "Opera EZZCL (City Ledger)",
    description: "Oracle Opera Cloud city-ledger / AR transactions (pipe-delimited, ÷1000)",
    classification: "DELIMITED",
    fsdXml: OPERA_EZZCL_FSD
  });
  const fmtEzzds = await upsertFormat(prisma, {
    name: "Opera EZZDS (Daily Statistics)",
    description:
      "Oracle Opera Cloud night-audit daily statistics (FIDST, pipe-delimited, ÷1000). Memo postings — statistical accounts only, no GL impact.",
    classification: "DELIMITED",
    fsdXml: OPERA_EZZDS_FSD
  });
  const fmtEzzms = await upsertFormat(prisma, {
    name: "Opera EZZMS (Market Segment Statistics)",
    description:
      "Oracle Opera Cloud night-audit market segment statistics (FIDMS, pipe-delimited, ÷1000). Memo postings — statistical accounts only, no GL impact.",
    classification: "DELIMITED",
    fsdXml: OPERA_EZZMS_FSD
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
  const tmlEzzds = await upsertTransformation(prisma, {
    name: "Opera EZZDS → Statistics Journal",
    description:
      "Maps Opera daily statistics (FIDST) to statistical journal lines: debit=0, credit=0, amount→stat_value (÷1000).",
    rulesJson: OPERA_EZZDS_TML
  });
  const tmlEzzms = await upsertTransformation(prisma, {
    name: "Opera EZZMS → Statistics Journal",
    description:
      "Maps Opera market segment statistics (FIDMS) to statistical journal lines: debit=0, credit=0, amount→stat_value (÷1000).",
    rulesJson: OPERA_EZZMS_TML
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

  const statsTargetParams = {
    fieldMap: { accountCode: "accountId" },
    groupBy: "businessDate",
    targetAccountType: "STATISTICAL",
    balanceCheck: false,
    drCrHandling: "IGNORE",
    amountRule: "DIVIDE_1000"
  };

  await upsertProfile(prisma, {
    name: "Opera PMS Daily Statistics",
    description:
      "Daily non-financial statistics from Opera Cloud (EZZDS file, journal type FIDST). " +
      "Posts to STATISTICAL accounts only; debit/credit balance check is bypassed.",
    profileType: "IMPORT",
    sourceComponent: "OPERA_CLOUD",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: fmtEzzds.id,
    transformationId: tmlEzzds.id,
    targetParams: {
      ...statsTargetParams,
      journalTypeFilter: "FIDST",
      duplicateDetection: ["accountCode", "businessDate", "period"],
      defaultDescription: "Opera daily statistics import"
    }
  });

  await upsertProfile(prisma, {
    name: "Opera PMS Market Segment Statistics",
    description:
      "Market segment statistics from Opera Cloud (EZZMS file, journal type FIDMS). " +
      "Posts to STATISTICAL accounts only; debit/credit balance check is bypassed.",
    profileType: "IMPORT",
    sourceComponent: "OPERA_CLOUD",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: fmtEzzms.id,
    transformationId: tmlEzzms.id,
    targetParams: {
      ...statsTargetParams,
      journalTypeFilter: "FIDMS",
      duplicateDetection: ["accountCode", "businessDate", "period", "segmentCode"],
      defaultDescription: "Opera market segment statistics import"
    }
  });

  console.log(
    "Seeded 4 Opera PMS system profiles (EZZRV, EZZCL financial; EZZDS, EZZMS statistical)."
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FSD Schemas — Sky Jana MMS (semicolon-delimited SAF files)
// ══════════════════════════════════════════════════════════════════════════════

/** Jana SAF: semicolon-delimited, 9 fields, no header line */
const JANA_SAF_FSD = {
  version: "1.0",
  classification: "DELIMITED",
  fieldSep: ";",
  recordSep: "\n",
  encoding: "UTF-8",
  record: {
    name: "voucher",
    fields: [
      { name: "voucherNo", type: "string", required: true, maxLength: 20 },
      { name: "journalType", type: "string", required: true, maxLength: 10 },
      { name: "accountCode", type: "string", required: true, maxLength: 20 },
      { name: "debit", type: "integer", required: true, maxLength: 15 },
      { name: "credit", type: "integer", required: true, maxLength: 15 },
      { name: "description", type: "string", maxLength: 200 },
      { name: "entryDate", type: "date", required: true, maxLength: 10 },
      { name: "supplierCode", type: "string", maxLength: 20 },
      { name: "reference", type: "string", maxLength: 50 }
    ]
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// TML Transformations — Sky Jana MMS
// ══════════════════════════════════════════════════════════════════════════════

/** Jana Purchasing: whole-integer TZS — identity map (no division) */
const JANA_PURCHASING_TML = {
  rules: [
    { type: "map", target: "accountCode", sources: [{ path: "accountCode" }] },
    { type: "map", target: "debit", sources: [{ path: "debit" }] },
    { type: "map", target: "credit", sources: [{ path: "credit" }] },
    { type: "map", target: "description", sources: [{ path: "description" }] },
    { type: "map", target: "reference", sources: [{ path: "reference" }] },
    { type: "map", target: "dimension1", sources: [{ path: "supplierCode" }] },
    { type: "map", target: "dimension2", sources: [{ path: "voucherNo" }] }
  ]
};

/** Jana Internal Movements & Inventory: ÷1000 implied decimals */
const JANA_DIVIDE1000_TML = {
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
    { type: "map", target: "description", sources: [{ path: "description" }] },
    { type: "map", target: "reference", sources: [{ path: "reference" }] },
    { type: "map", target: "dimension1", sources: [{ path: "voucherNo" }] }
  ]
};

// ══════════════════════════════════════════════════════════════════════════════
// Seed: Sky Jana MMS
// ══════════════════════════════════════════════════════════════════════════════

async function seedJanaProfiles(prisma: PrismaClient): Promise<void> {
  // All three Jana profiles share the same SAF FSD schema
  const fmtPurchasing = await upsertFormat(prisma, {
    name: "Jana SAF (Purchasing Vouchers)",
    description:
      "Sky Jana MMS purchasing voucher SAF export (semicolon-delimited, whole-integer TZS)",
    classification: "DELIMITED",
    fsdXml: JANA_SAF_FSD
  });
  const fmtMovements = await upsertFormat(prisma, {
    name: "Jana SAF (Internal Movements)",
    description:
      "Sky Jana MMS inter-store transfer SAF export (semicolon-delimited, ÷1000 implied decimals)",
    classification: "DELIMITED",
    fsdXml: JANA_SAF_FSD
  });
  const fmtInventory = await upsertFormat(prisma, {
    name: "Jana SAF (Inventory Differences)",
    description:
      "Sky Jana MMS inventory difference SAF export (semicolon-delimited, ÷1000 implied decimals)",
    classification: "DELIMITED",
    fsdXml: JANA_SAF_FSD
  });

  // ── Transformations ──
  const tmlPurchasing = await upsertTransformation(prisma, {
    name: "Jana Purchasing → GL Journal",
    description:
      "Maps Jana purchasing voucher fields to GL journal lines (whole-integer, no ÷1000)",
    rulesJson: JANA_PURCHASING_TML
  });
  const tmlMovements = await upsertTransformation(prisma, {
    name: "Jana Internal Movements → GL Journal",
    description: "Maps Jana inter-store transfer fields to GL journal lines with ÷1000 conversion",
    rulesJson: JANA_DIVIDE1000_TML
  });
  const tmlInventory = await upsertTransformation(prisma, {
    name: "Jana Inventory Differences → GL Journal",
    description: "Maps Jana inventory difference fields to GL journal lines with ÷1000 conversion",
    rulesJson: JANA_DIVIDE1000_TML
  });

  // ── Profiles ──
  const janaTargetParams = {
    fieldMap: { accountCode: "accountId", voucherNo: "reference" },
    groupBy: "entryDate",
    functionalCurrency: "TZS"
  };

  await upsertProfile(prisma, {
    name: "Sky Jana Purchasing Vouchers",
    description: "AP invoice headers from Sky Jana procurement (whole-integer TZS)",
    profileType: "IMPORT",
    sourceComponent: "SKY_JANA_MMS",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: fmtPurchasing.id,
    transformationId: tmlPurchasing.id,
    targetParams: {
      ...janaTargetParams,
      defaultDescription: "Jana purchasing voucher import"
    }
  });

  await upsertProfile(prisma, {
    name: "Sky Jana Internal Movements",
    description: "Inter-store transfer journals from Sky Jana (÷1000 implied decimals)",
    profileType: "IMPORT",
    sourceComponent: "SKY_JANA_MMS",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: fmtMovements.id,
    transformationId: tmlMovements.id,
    targetParams: {
      ...janaTargetParams,
      defaultDescription: "Jana internal movement import"
    }
  });

  await upsertProfile(prisma, {
    name: "Sky Jana Inventory Differences",
    description: "Inventory difference adjustments from Sky Jana (÷1000 implied decimals)",
    profileType: "IMPORT",
    sourceComponent: "SKY_JANA_MMS",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: fmtInventory.id,
    transformationId: tmlInventory.id,
    targetParams: {
      ...janaTargetParams,
      defaultDescription: "Jana inventory difference import"
    }
  });

  console.log("Seeded 3 Sky Jana MMS system profiles (Purchasing, Movements, Inventory).");
}

// ══════════════════════════════════════════════════════════════════════════════
// FSD Schema — Simphony POS (semicolon-delimited Report Builder export)
// ══════════════════════════════════════════════════════════════════════════════

const SIMPHONY_POS_FSD = {
  version: "1.0",
  classification: "DELIMITED",
  fieldSep: ";",
  recordSep: "\r\n",
  initialLinesToIgnore: 1,
  encoding: "UTF-8",
  record: {
    name: "SimphonyRevenue",
    fields: [
      { name: "businessDate", type: "date", required: true, maxLength: 10 },
      { name: "revenueCenter", type: "string", required: true, maxLength: 30 },
      { name: "revenueCenterName", type: "string", required: false, maxLength: 60 },
      { name: "accountCode", type: "string", required: true, maxLength: 20 },
      { name: "debit", type: "number", required: true, maxLength: 15 },
      { name: "credit", type: "number", required: true, maxLength: 15 },
      { name: "currencyCode", type: "string", required: true, maxLength: 3 },
      { name: "description", type: "string", required: false, maxLength: 100 },
      { name: "reference", type: "string", required: false, maxLength: 50 }
    ]
  }
};

const SIMPHONY_POS_TML = {
  rules: [
    { type: "map", target: "accountCode", sources: [{ path: "accountCode" }] },
    { type: "map", target: "debit", sources: [{ path: "debit" }] },
    { type: "map", target: "credit", sources: [{ path: "credit" }] },
    { type: "map", target: "currency", sources: [{ path: "currencyCode" }] },
    { type: "map", target: "description", sources: [{ path: "description" }] },
    { type: "map", target: "reference", sources: [{ path: "reference" }] },
    { type: "map", target: "dimension1", sources: [{ path: "revenueCenter" }] },
    { type: "map", target: "dimension2", sources: [{ path: "revenueCenterName" }] }
  ]
};

// ══════════════════════════════════════════════════════════════════════════════
// FSD Schema — Bank Statement (SWIFT MT940)
// ══════════════════════════════════════════════════════════════════════════════

const BANK_MT940_FSD = {
  version: "1.0",
  classification: "DELIMITED",
  fieldSep: ",",
  recordSep: "\r\n",
  initialLinesToIgnore: 1,
  encoding: "UTF-8",
  record: {
    name: "MT940_Transaction",
    fields: [
      { name: "valueDate", type: "date", required: true, maxLength: 10 },
      { name: "entryDate", type: "date", required: false, maxLength: 10 },
      { name: "debitCredit", type: "string", required: true, maxLength: 1 },
      { name: "amount", type: "number", required: true, maxLength: 18 },
      { name: "currencyCode", type: "string", required: true, maxLength: 3 },
      { name: "transactionType", type: "string", required: false, maxLength: 10 },
      { name: "reference", type: "string", required: false, maxLength: 50 },
      { name: "bankReference", type: "string", required: false, maxLength: 50 },
      { name: "description", type: "string", required: false, maxLength: 200 }
    ]
  }
};

const BANK_MT940_TML = {
  rules: [
    { type: "map", target: "reference", sources: [{ path: "reference" }] },
    { type: "map", target: "currency", sources: [{ path: "currencyCode" }] },
    { type: "map", target: "description", sources: [{ path: "description" }] },
    { type: "map", target: "dimension1", sources: [{ path: "transactionType" }] },
    { type: "map", target: "dimension2", sources: [{ path: "bankReference" }] },
    {
      type: "conditional",
      condition: { field: "debitCredit", operator: "==", value: "D" },
      then: [
        { type: "map", target: "debit", sources: [{ path: "amount" }] },
        { type: "set", target: "credit", value: 0 }
      ],
      else: [
        { type: "set", target: "debit", value: 0 },
        { type: "map", target: "credit", sources: [{ path: "amount" }] }
      ]
    }
  ]
};

// ══════════════════════════════════════════════════════════════════════════════
// Seed: Simphony POS
// ══════════════════════════════════════════════════════════════════════════════

async function seedSimphonyProfiles(prisma: PrismaClient): Promise<void> {
  const fmt = await upsertFormat(prisma, {
    name: "Simphony POS Revenue Export",
    description:
      "Oracle Simphony POS Report Builder export (semicolon-delimited, 9-field, real decimals)",
    classification: "DELIMITED",
    fsdXml: SIMPHONY_POS_FSD
  });

  const tml = await upsertTransformation(prisma, {
    name: "Simphony POS → GL Journal",
    description: "Maps Simphony revenue center fields to GL journal lines (no amount conversion)",
    rulesJson: SIMPHONY_POS_TML
  });

  await upsertProfile(prisma, {
    name: "Simphony POS Revenue",
    description: "Daily POS revenue posting from Oracle Simphony Report Builder export",
    profileType: "IMPORT",
    sourceComponent: "SIMPHONY_POS",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: fmt.id,
    transformationId: tml.id,
    targetParams: {
      fieldMap: { accountCode: "accountId" },
      groupBy: "businessDate",
      defaultDescription: "Simphony POS revenue import"
    }
  });

  console.log("Seeded 1 Simphony POS system profile.");
}

// ══════════════════════════════════════════════════════════════════════════════
// Seed: Bank Statement (MT940)
// ══════════════════════════════════════════════════════════════════════════════

async function seedBankStatementProfiles(prisma: PrismaClient): Promise<void> {
  const fmt = await upsertFormat(prisma, {
    name: "Bank Statement MT940",
    description: "SWIFT MT940 bank statement (CSV pre-parsed, comma-delimited)",
    classification: "DELIMITED",
    fsdXml: BANK_MT940_FSD
  });

  const tml = await upsertTransformation(prisma, {
    name: "MT940 → GL Journal",
    description:
      "Maps MT940 bank statement transactions to GL journal lines (D/C conditional split)",
    rulesJson: BANK_MT940_TML
  });

  await upsertProfile(prisma, {
    name: "Bank Statement (MT940)",
    description: "Bank statement import for reconciliation against GL bank accounts",
    profileType: "IMPORT",
    sourceComponent: "SWIFT_MT940",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: fmt.id,
    transformationId: tml.id,
    targetParams: {
      fieldMap: {},
      groupBy: "valueDate",
      defaultDescription: "MT940 bank statement import"
    }
  });

  console.log("Seeded 1 Bank Statement (MT940) system profile.");
}

// ── Main seed function ───────────────────────────────────────────────────────

export async function seedTransferDeskSystemData(prisma: PrismaClient): Promise<void> {
  await seedOperaProfiles(prisma);
  await seedJanaProfiles(prisma);
  await seedSimphonyProfiles(prisma);
  await seedBankStatementProfiles(prisma);
}
