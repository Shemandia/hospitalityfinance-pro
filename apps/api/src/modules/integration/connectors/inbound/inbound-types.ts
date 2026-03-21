import { z } from "zod";

const decimalRegex = /^\d+(\.\d{1,8})?$/;
const decimalStr = z.string().regex(decimalRegex, "Expected a positive decimal string.");

// ── Inbound AP Invoice (from Material Management or any external system) ────

export const inboundInvoiceLineSchema = z.object({
  description: z.string().min(1).max(1000),
  quantity: decimalStr,
  unitPrice: decimalStr,
  amount: decimalStr,
  glAccountCode: z.string().min(1).max(30),
  taxCode: z.string().max(50).optional(),
  costCenter: z.string().max(50).optional(),
  department: z.string().max(50).optional()
});

export const inboundInvoiceSchema = z.object({
  /** Supplier code in HFP (must exist) */
  supplierCode: z.string().min(1).max(50),
  invoiceNumber: z.string().min(1).max(100),
  invoiceDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  currency: z.string().length(3),
  grossAmount: decimalStr,
  taxAmount: decimalStr,
  netAmount: decimalStr,
  fxRate: decimalStr.default("1"),
  /** PO reference from the sending system */
  externalPoRef: z.string().max(100).optional(),
  /** GRN reference from the sending system */
  externalGrnRef: z.string().max(100).optional(),
  paymentTerms: z.string().max(100).optional(),
  lines: z.array(inboundInvoiceLineSchema).min(1)
});

export const inboundInvoiceBatchSchema = z.object({
  /** Identifies the sending system (e.g. "MM", "PROCUREMENT", "ORACLE") */
  sourceSystem: z.string().min(1).max(50),
  /** Batch reference for idempotency */
  batchRef: z.string().min(1).max(100),
  /** Auto-post invoices to GL on creation (default: false = DRAFT) */
  autoPost: z.boolean().default(false),
  invoices: z.array(inboundInvoiceSchema).min(1).max(500)
});

// ── Inbound GL Journal (from any external system) ───────────────────────────

export const inboundJournalLineSchema = z.object({
  accountCode: z.string().min(1).max(30),
  debit: decimalStr.default("0"),
  credit: decimalStr.default("0"),
  currency: z.string().length(3),
  fxRate: decimalStr.default("1"),
  description: z.string().max(1000).optional(),
  dimension1: z.string().max(50).optional(),
  dimension2: z.string().max(50).optional(),
  dimension3: z.string().max(50).optional(),
  dimension4: z.string().max(50).optional(),
  dimension5: z.string().max(50).optional(),
  dimension6: z.string().max(50).optional()
});

export const inboundJournalSchema = z.object({
  reference: z.string().min(1).max(50),
  description: z.string().max(1000).optional(),
  postingDate: z.coerce.date(),
  source: z.enum(["MANUAL", "PMS", "POS", "PAYROLL", "FX_REVAL", "AP", "AR"]).default("AP"),
  journalTypeCode: z.string().max(10).optional(),
  functionalCurrency: z.string().length(3),
  lines: z.array(inboundJournalLineSchema).min(1)
});

export const inboundJournalBatchSchema = z.object({
  sourceSystem: z.string().min(1).max(50),
  batchRef: z.string().min(1).max(100),
  autoPost: z.boolean().default(false),
  journals: z.array(inboundJournalSchema).min(1).max(500)
});

// ── Inbound Supplier Sync ───────────────────────────────────────────────────

export const inboundSupplierSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  taxId: z.string().max(100).optional(),
  currency: z.string().length(3),
  paymentTermsDays: z.number().int().positive().max(365).default(30),
  bankDetails: z.record(z.unknown()).optional(),
  isActive: z.boolean().default(true)
});

export const inboundSupplierBatchSchema = z.object({
  sourceSystem: z.string().min(1).max(50),
  suppliers: z.array(inboundSupplierSchema).min(1).max(1000)
});

// ── File import schema (CSV/JSON batch upload) ──────────────────────────────

export const inboundFileImportSchema = z.object({
  sourceSystem: z.string().min(1).max(50),
  batchRef: z.string().min(1).max(100),
  /** "invoices" or "journals" */
  dataType: z.enum(["invoices", "journals"]),
  /** JSON string containing array of invoices or journals */
  fileContent: z.string().min(1),
  autoPost: z.boolean().default(false)
});

// ── Result types ────────────────────────────────────────────────────────────

export type InboundInvoiceBatch = z.infer<typeof inboundInvoiceBatchSchema>;
export type InboundJournalBatch = z.infer<typeof inboundJournalBatchSchema>;
export type InboundSupplierBatch = z.infer<typeof inboundSupplierBatchSchema>;
export type InboundFileImport = z.infer<typeof inboundFileImportSchema>;

export type InboundBatchResult = {
  batchRef: string;
  sourceSystem: string;
  created: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
  createdIds: string[];
  duplicateRefs: string[];
};
