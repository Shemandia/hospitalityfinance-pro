import { z } from "zod";

const decimalRegex = /^\d+(\.\d{1,8})?$/;

const decimalStringSchema = z
  .string()
  .regex(decimalRegex, "Expected a positive decimal string.")
  .transform((v) => v.trim());

export const customerCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50),
  type: z.enum(["CORPORATE", "OTA", "TRAVEL_AGENT", "INDIVIDUAL"]).default("CORPORATE"),
  creditLimit: decimalStringSchema.optional(),
  currency: z.string().length(3),
  paymentTermsDays: z.number().int().positive().max(365).default(30),
  billingContact: z.record(z.unknown()).optional(),
  isActive: z.boolean().default(true)
});

export const customerUpdateSchema = customerCreateSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  "At least one field must be provided."
);

export const arInvoiceCreateSchema = z.object({
  customerId: z.string().uuid(),
  invoiceNumber: z.string().min(1).max(100),
  invoiceDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  currency: z.string().length(3),
  amount: decimalStringSchema,
  functionalAmount: decimalStringSchema,
  fxRate: decimalStringSchema,
  notes: z.string().max(2000).optional()
});

export const arInvoiceUpdateSchema = z
  .object({
    dueDate: z.coerce.date().optional(),
    notes: z.string().max(2000).optional(),
    status: z
      .enum(["DRAFT", "POSTED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"])
      .optional()
  })
  .refine((v) => Object.keys(v).length > 0, "At least one field must be provided.");

export const arInvoiceListQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  status: z
    .enum(["DRAFT", "POSTED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"])
    .optional(),
  dueBefore: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(200).default(100)
});

export const arReceiptCreateSchema = z.object({
  customerId: z.string().uuid(),
  receiptDate: z.coerce.date(),
  currency: z.string().length(3),
  amount: decimalStringSchema,
  bankAccountId: z.string().uuid().optional(),
  reference: z.string().max(100).optional()
});

export const arAllocationSchema = z.object({
  receiptId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  allocatedAmount: decimalStringSchema
});

export const ageingQuerySchema = z.object({
  asOfDate: z.coerce.date().optional()
});

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
export type ARInvoiceCreateInput = z.infer<typeof arInvoiceCreateSchema>;
export type ARInvoiceUpdateInput = z.infer<typeof arInvoiceUpdateSchema>;
export type ARInvoiceListQuery = z.infer<typeof arInvoiceListQuerySchema>;
export type ARReceiptCreateInput = z.infer<typeof arReceiptCreateSchema>;
export type ARAllocationInput = z.infer<typeof arAllocationSchema>;
export type AgeingQuery = z.infer<typeof ageingQuerySchema>;
