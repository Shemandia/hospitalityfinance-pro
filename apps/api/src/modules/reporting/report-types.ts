import { z } from "zod";

// ── FAL — Financial Account Listing ─────────────────────────────────────────

export const falTemplateSchema = z.object({
  writer: z.literal("FAL"),
  accountCodeFrom: z.string().optional(),
  accountCodeTo: z.string().optional(),
  accountTypes: z.array(z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"])).optional(),
  periodIds: z.array(z.string().uuid()).optional(),
  columns: z
    .array(
      z.enum([
        "code",
        "name",
        "type",
        "opening",
        "debit",
        "credit",
        "closing",
        "budget",
        "variance",
        "variancePct"
      ])
    )
    .default(["code", "name", "opening", "debit", "credit", "closing"]),
  showZeroBalances: z.boolean().default(false),
  groupBy: z.enum(["type", "parent", "usaliDepartment", "none"]).default("none"),
  sortBy: z.enum(["code", "name", "closing"]).default("code"),
  sortDirection: z.enum(["ASC", "DESC"]).default("ASC")
});

export type FALTemplate = z.infer<typeof falTemplateSchema>;

// ── FSL — Financial Statement Listing ───────────────────────────────────────

const fslRowSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("HEADING"),
    label: z.string(),
    level: z.number().int().min(1).max(3).default(1)
  }),
  z.object({
    type: z.literal("ACCOUNTS"),
    label: z.string(),
    accountCodeFrom: z.string(),
    accountCodeTo: z.string(),
    accountTypes: z
      .array(z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]))
      .optional(),
    sign: z.enum(["NATURAL", "REVERSE"]).default("NATURAL"),
    indent: z.number().int().min(0).max(4).default(0)
  }),
  z.object({
    type: z.literal("SUBTOTAL"),
    label: z.string(),
    sumRows: z.array(z.number().int().min(0)),
    bold: z.boolean().default(true),
    underline: z.enum(["NONE", "SINGLE", "DOUBLE"]).default("SINGLE")
  }),
  z.object({
    type: z.literal("FORMULA"),
    label: z.string(),
    formula: z.string(), // e.g. "R0+R1-R4"
    bold: z.boolean().default(false),
    underline: z.enum(["NONE", "SINGLE", "DOUBLE"]).default("NONE")
  }),
  z.object({
    type: z.literal("BLANK")
  })
]);

const fslColumnSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PERIOD"), label: z.string().optional() }),
  z.object({ type: z.literal("YTD"), label: z.string().optional() }),
  z.object({ type: z.literal("COMPARATIVE"), label: z.string().optional() }),
  z.object({ type: z.literal("BUDGET"), label: z.string().optional() }),
  z.object({
    type: z.literal("VARIANCE"),
    label: z.string().optional(),
    against: z.enum(["BUDGET", "COMPARATIVE"])
  }),
  z.object({
    type: z.literal("VARIANCE_PCT"),
    label: z.string().optional(),
    against: z.enum(["BUDGET", "COMPARATIVE"])
  })
]);

export const fslTemplateSchema = z.object({
  writer: z.literal("FSL"),
  rows: z.array(fslRowSchema).min(1),
  columns: z
    .array(fslColumnSchema)
    .min(1)
    .default([{ type: "PERIOD" as const }])
});

export type FSLTemplate = z.infer<typeof fslTemplateSchema>;
export type FSLRow = z.infer<typeof fslRowSchema>;
export type FSLColumn = z.infer<typeof fslColumnSchema>;

// ── FTL — Financial Transaction Listing ─────────────────────────────────────

export const ftlTemplateSchema = z.object({
  writer: z.literal("FTL"),
  periodId: z.string().uuid().optional(),
  accountCodeFrom: z.string().optional(),
  accountCodeTo: z.string().optional(),
  accountTypes: z.array(z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"])).optional(),
  reference: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  amountMin: z.number().optional(),
  amountMax: z.number().optional(),
  journalTypeId: z.string().uuid().optional(),
  source: z.string().optional(),
  sortBy: z.enum(["date", "reference", "amount", "account"]).default("date"),
  sortDirection: z.enum(["ASC", "DESC"]).default("DESC"),
  limit: z.number().int().min(1).max(10000).default(1000)
});

export type FTLTemplate = z.infer<typeof ftlTemplateSchema>;

// ── Report Template Union ───────────────────────────────────────────────────

export const reportTemplateSchema = z.discriminatedUnion("writer", [
  falTemplateSchema,
  fslTemplateSchema,
  ftlTemplateSchema
]);

export type ReportTemplate = z.infer<typeof reportTemplateSchema>;

// ── Report Execution Request ────────────────────────────────────────────────

export const executeReportSchema = z.object({
  definitionId: z.string().uuid(),
  periodId: z.string().uuid(),
  comparativePeriodId: z.string().uuid().optional(),
  budgetDefinitionId: z.string().uuid().optional(),
  overrides: z.record(z.unknown()).optional()
});

export type ExecuteReportInput = z.infer<typeof executeReportSchema>;

// ── Drill-Down Request ──────────────────────────────────────────────────────

export const drillDownSchema = z.object({
  accountCodeFrom: z.string(),
  accountCodeTo: z.string(),
  periodId: z.string().uuid(),
  accountTypes: z.array(z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"])).optional()
});

export type DrillDownInput = z.infer<typeof drillDownSchema>;

// ── Report Result Types ─────────────────────────────────────────────────────

export type ReportColumnDef = {
  key: string;
  label: string;
  align: "left" | "right";
};

export type ReportRow = {
  rowIndex: number;
  type: "heading" | "data" | "subtotal" | "formula" | "blank";
  label: string;
  values: Record<string, number | null>;
  formatting?: {
    bold?: boolean;
    underline?: "NONE" | "SINGLE" | "DOUBLE";
    indent?: number;
    level?: number;
  };
  drillDown?: {
    accountCodeFrom: string;
    accountCodeTo: string;
    periodId: string;
    accountTypes?: string[];
  };
};

export type ReportResult = {
  columns: ReportColumnDef[];
  rows: ReportRow[];
  metadata: {
    reportName: string;
    reportType: string;
    entityId: string;
    periodName: string;
    generatedAt: string;
  };
};
