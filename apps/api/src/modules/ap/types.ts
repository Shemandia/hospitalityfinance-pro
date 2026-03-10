import { z } from "zod";

const decimalRegex = /^\d+(\.\d{1,8})?$/;

const decimalStringSchema = z
  .string()
  .regex(decimalRegex, "Expected a positive decimal string.")
  .transform((value) => value.trim());

export const supplierCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50),
  taxId: z.string().max(100).optional(),
  currency: z.string().length(3),
  paymentTermsDays: z.number().int().positive().max(365).default(30),
  bankDetails: z.record(z.unknown()).optional(),
  isActive: z.boolean().default(true)
});

export const supplierUpdateSchema = supplierCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field must be provided."
);

export const apInvoiceLineSchema = z.object({
  description: z.string().min(1).max(1000),
  quantity: decimalStringSchema,
  unitPrice: decimalStringSchema,
  amount: decimalStringSchema,
  glAccountId: z.string().uuid().optional(),
  taxCode: z.string().max(50).optional()
});

export const apInvoiceCreateSchema = z.object({
  supplierId: z.string().uuid(),
  periodId: z.string().uuid(),
  invoiceNumber: z.string().min(1).max(100),
  invoiceDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  currency: z.string().length(3),
  grossAmount: decimalStringSchema,
  taxAmount: decimalStringSchema,
  netAmount: decimalStringSchema,
  functionalAmount: decimalStringSchema,
  fxRate: decimalStringSchema,
  poId: z.string().uuid().optional(),
  paymentTerms: z.string().max(100).optional(),
  lines: z.array(apInvoiceLineSchema).min(1)
});

export const apInvoiceUpdateSchema = z
  .object({
    dueDate: z.coerce.date().optional(),
    grossAmount: decimalStringSchema.optional(),
    taxAmount: decimalStringSchema.optional(),
    netAmount: decimalStringSchema.optional(),
    functionalAmount: decimalStringSchema.optional(),
    fxRate: decimalStringSchema.optional(),
    paymentTerms: z.string().max(100).optional(),
    status: z
      .enum([
        "DRAFT",
        "PENDING_APPROVAL",
        "APPROVED",
        "POSTED",
        "PAID",
        "DISPUTED",
        "CANCELLED"
      ])
      .optional(),
    lines: z.array(apInvoiceLineSchema).min(1).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided.");

export const apInvoiceListQuerySchema = z.object({
  status: z
    .enum([
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "POSTED",
      "PAID",
      "DISPUTED",
      "CANCELLED"
    ])
    .optional(),
  supplierId: z.string().uuid().optional(),
  dueBefore: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(200).default(100)
});

export const apMatchQuerySchema = z.object({
  tolerancePct: z.coerce.number().positive().max(100).optional()
});

export const paymentRunProposalSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  bankFileFormat: z.enum(["SWIFT_MT103", "SEPA_PAIN001", "CSV"]),
  includePosted: z.boolean().default(true),
  includeApproved: z.boolean().default(true),
  supplierIds: z.array(z.string().uuid()).optional(),
});

export const paymentRunConfirmSchema = z.object({
  bankAccountId: z.string().min(1).max(100),
  paymentMethod: z.enum(["BANK_TRANSFER", "CHEQUE", "CARD", "CASH"]).default("BANK_TRANSFER"),
  referencePrefix: z.string().max(30).default("PAYRUN")
});

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
export type APInvoiceCreateInput = z.infer<typeof apInvoiceCreateSchema>;
export type APInvoiceUpdateInput = z.infer<typeof apInvoiceUpdateSchema>;
export type APInvoiceListQuery = z.infer<typeof apInvoiceListQuerySchema>;
export type APMatchQuery = z.infer<typeof apMatchQuerySchema>;
export type PaymentRunProposalInput = z.infer<typeof paymentRunProposalSchema>;
export type PaymentRunConfirmInput = z.infer<typeof paymentRunConfirmSchema>;
