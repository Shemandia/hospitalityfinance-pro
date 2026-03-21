/**
 * Payroll Integration Types
 *
 * Generic payroll connector supporting any payroll system that can export
 * salary journals.  Supports both API push and CSV/Excel file upload.
 *
 * USALI Department mapping for hospitality payroll:
 *   - Rooms Division        → 6100 (Rooms Payroll)
 *   - Food & Beverage       → 6200 (F&B Payroll)
 *   - Spa & Recreation      → 6300 (Spa Payroll)
 *   - Admin & General       → 7100 (A&G Payroll)
 *   - Sales & Marketing     → 7200 (S&M Payroll)
 *   - Engineering           → 7300 (Engineering Payroll)
 *   - IT                    → 7400 (IT Payroll)
 */

import { z } from "zod";

const decimalRegex = /^-?\d+(\.\d{1,4})?$/;
const decimalString = z.string().regex(decimalRegex, "Expected decimal string");

// ── Payroll Journal Line ────────────────────────────────────────────────────

export const payrollLineSchema = z.object({
  /** GL account code (e.g., "6100" for Rooms Payroll) */
  accountCode: z.string().min(1).max(20),
  /** Debit amount (salary/benefit expense lines) */
  debit: decimalString.default("0"),
  /** Credit amount (payable/withholding lines) */
  credit: decimalString.default("0"),
  /** Line description (e.g., "Basic Salary - Rooms Division") */
  description: z.string().max(500).optional(),
  /** USALI department code for cost allocation */
  department: z.string().max(50).optional(),
  /** Cost centre for departmental tracking */
  costCentre: z.string().max(50).optional()
});

// ── Single Payroll Run ──────────────────────────────────────────────────────

export const payrollRunSchema = z.object({
  /** Unique reference from payroll system (e.g., "PAY-2026-03-P1") */
  reference: z.string().min(1).max(100),
  /** Description (e.g., "March 2026 Period 1 Payroll") */
  description: z.string().max(500).optional(),
  /** Posting date — determines which GL period to post into */
  postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  /** Functional currency of the payroll */
  currency: z.string().length(3).default("USD"),
  /** Journal lines — must balance (total debits = total credits) */
  lines: z.array(payrollLineSchema).min(1).max(500)
});

// ── Payroll Batch ───────────────────────────────────────────────────────────

export const payrollBatchSchema = z.object({
  /** Source payroll system identifier (e.g., "SAGE_HR", "BAMBOO_HR", "ORACLE_HCM") */
  sourceSystem: z.string().min(1).max(50),
  /** Batch reference for idempotency */
  batchRef: z.string().min(1).max(100),
  /** Auto-post journals to GL (default: false — creates as DRAFT) */
  autoPost: z.boolean().default(false),
  /** Payroll runs in this batch */
  runs: z.array(payrollRunSchema).min(1).max(50)
});

// ── Excel/CSV upload schema ─────────────────────────────────────────────────

export const payrollFileUploadSchema = z.object({
  /** Base64-encoded file content */
  file: z.string().min(1),
  /** Original filename (determines parser: .xlsx, .csv) */
  filename: z.string().min(1).max(255),
  /** Posting date for all lines in the file */
  postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  /** Currency */
  currency: z.string().length(3).default("USD"),
  /** Auto-post */
  autoPost: z.boolean().default(false)
});

// ── Payroll summary types (for grouping by department) ──────────────────────

export const PAYROLL_EXPENSE_CATEGORIES = [
  "BASIC_SALARY",
  "OVERTIME",
  "ALLOWANCES",
  "BENEFITS",
  "EMPLOYER_CONTRIBUTIONS",
  "BONUSES",
  "SERVICE_CHARGE_DISTRIBUTION"
] as const;

export const PAYROLL_LIABILITY_CATEGORIES = [
  "INCOME_TAX",
  "SOCIAL_SECURITY_EMPLOYEE",
  "SOCIAL_SECURITY_EMPLOYER",
  "PENSION_EMPLOYEE",
  "PENSION_EMPLOYER",
  "HEALTH_INSURANCE",
  "UNION_DUES",
  "NET_PAY"
] as const;

// ── Type exports ────────────────────────────────────────────────────────────

export type PayrollLine = z.infer<typeof payrollLineSchema>;
export type PayrollRun = z.infer<typeof payrollRunSchema>;
export type PayrollBatch = z.infer<typeof payrollBatchSchema>;
export type PayrollFileUpload = z.infer<typeof payrollFileUploadSchema>;

export type PayrollImportResult = {
  batchRef: string;
  sourceSystem: string;
  created: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
  journalIds: string[];
  duplicateRefs: string[];
};
