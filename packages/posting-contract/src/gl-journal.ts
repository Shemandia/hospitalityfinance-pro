/**
 * GL journal document, version 1 (docs/IMPORT-PLAN.md section 2).
 *
 * Every import that posts to the general ledger produces this document, and
 * the posting service accepts only this. It names everything by code (entity,
 * journal type, accounts, dimensions, tax codes); internal IDs never appear.
 * What this module checks needs no database: shape, dates, amounts, line
 * rules and balance in the transaction currency. Resolving the codes, the
 * period, the rate and the duplicate check are the posting service's.
 */
import { z } from "zod";
import { fromScaled, isDecimal, scaleOf, toScaled } from "./decimal.js";
import { type ContractError, ContractErrorCode, issuesToErrors } from "./errors.js";

/** Places kept for money (journal_lines.debit/credit: numeric(18,4)). */
export const AMOUNT_SCALE = 4;
/** Places kept for statistical quantities (journal_lines.stat_value: numeric(18,3)). */
export const STAT_SCALE = 3;
/** Places kept for exchange rates (journal_lines.fx_rate: numeric(14,8)). */
export const RATE_SCALE = 8;
/** The ledger has ten analysis dimensions per line. */
export const MAX_DIMENSIONS = 10;

const AMOUNT_DIGITS = 14; // 18 digits, 4 of them after the point.

const code = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

function decimal(scale: number, opts: { signed: boolean; positive?: boolean }) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const fail = (message: string) =>
        ctx.addIssue({
          code: "custom",
          message,
          params: { code: ContractErrorCode.INVALID_AMOUNT }
        });
      if (!isDecimal(value)) return fail(`${value} is not a decimal number`);
      if (!opts.signed && value.startsWith("-")) return fail(`${value} must not be negative`);
      if (scaleOf(value) > scale) return fail(`${value} has more than ${scale} decimal places`);
      const whole = value
        .replace(/^[+-]/, "")
        .split(".")[0]!
        .replace(/^0+(?=\d)/, "");
      if (whole.length > AMOUNT_DIGITS) return fail(`${value} is too large`);
      if (opts.positive && toScaled(value, scale) <= 0n)
        return fail(`${value} must be greater than zero`);
    });
}

/** A calendar date "YYYY-MM-DD" that exists. */
export const isoDate = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const d = m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) : null;
    if (
      !m ||
      !d ||
      d.getUTCFullYear() !== +m[1]! ||
      d.getUTCMonth() !== +m[2]! - 1 ||
      d.getUTCDate() !== +m[3]!
    ) {
      ctx.addIssue({
        code: "custom",
        message: `${value} is not a date (YYYY-MM-DD)`,
        params: { code: ContractErrorCode.INVALID_DATE }
      });
    }
  });

const dimensions = z.record(code(50), code(50)).superRefine((value, ctx) => {
  if (Object.keys(value).length > MAX_DIMENSIONS) {
    ctx.addIssue({
      code: "custom",
      message: `A line has at most ${MAX_DIMENSIONS} dimensions`,
      params: { code: ContractErrorCode.TOO_MANY_DIMENSIONS }
    });
  }
});

export const glJournalLineV1 = z
  .object({
    accountCode: code(30),
    debit: decimal(AMOUNT_SCALE, { signed: false }).optional(),
    credit: decimal(AMOUNT_SCALE, { signed: false }).optional(),
    /** Signed: positive is a debit, negative a credit. Instead of debit/credit. */
    amount: decimal(AMOUNT_SCALE, { signed: true }).optional(),
    /** A quantity for a statistical account (rooms sold, covers). */
    statValue: decimal(STAT_SCALE, { signed: true }).optional(),
    /** Keyed by the entity's dimension names; values are dimension codes. */
    dimensions: dimensions.optional(),
    taxCode: code(20).optional(),
    description: optionalText(1000),
    /** The source's own line reference, for tracing. */
    lineRef: optionalText(100)
  })
  .strict()
  .superRefine((line, ctx) => {
    const fail = (message: string) =>
      ctx.addIssue({ code: "custom", message, params: { code: ContractErrorCode.LINE_SHAPE } });
    const hasSides = line.debit !== undefined || line.credit !== undefined;
    if (line.amount !== undefined && hasSides) {
      return fail("Give either amount or debit/credit, not both");
    }
    if (line.amount === undefined && !hasSides && line.statValue === undefined) {
      return fail("A line needs an amount, a debit or credit, or a statistical value");
    }
    const nonZero = (v?: string) =>
      v !== undefined &&
      isDecimal(v) &&
      scaleOf(v) <= AMOUNT_SCALE &&
      toScaled(v, AMOUNT_SCALE) !== 0n;
    if (nonZero(line.debit) && nonZero(line.credit)) {
      fail("A line is either a debit or a credit, not both");
    }
  });

export const glJournalDocumentV1 = z
  .object({
    contractVersion: z.literal(1),
    documentType: z.literal("GL_JOURNAL"),
    /** Tenant-defined source system code. */
    sourceSystem: code(20),
    /** The source's own reference; with the entity and source system, posts once. */
    sourceDocumentRef: code(100),
    /** The business date: chooses the period and the exchange-rate date. */
    documentDate: isoDate,
    entityCode: code(20),
    journalTypeCode: code(10).optional(),
    description: optionalText(1000),
    /** Transaction currency. */
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "A currency is three capital letters (ISO 4217)"),
    /** Optional; otherwise looked up for documentDate with the profile's rate type. */
    fxRate: decimal(RATE_SCALE, { signed: false, positive: true }).optional(),
    lines: z.array(glJournalLineV1).min(1).max(10_000)
  })
  .strict()
  .superRefine((doc, ctx) => {
    // Balance in the transaction currency, statistical lines aside. Lines
    // that failed their own checks are skipped (they are reported already).
    let debit = 0n;
    let credit = 0n;
    for (const line of doc.lines) {
      try {
        const { debit: d, credit: c } = sides(line);
        debit += d;
        credit += c;
      } catch {
        return;
      }
    }
    if (debit !== credit) {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: `Debits ${fromScaled(debit, AMOUNT_SCALE)} and credits ${fromScaled(credit, AMOUNT_SCALE)} differ`,
        params: { code: ContractErrorCode.UNBALANCED }
      });
    }
  });

export type GlJournalLineV1 = z.infer<typeof glJournalLineV1>;
export type GlJournalDocumentV1 = z.infer<typeof glJournalDocumentV1>;

/** A line as the posting service takes it: both sides set, scaled amounts as strings. */
export type NormalizedGlLine = {
  lineNumber: number;
  accountCode: string;
  debit: string;
  credit: string;
  statValue?: string;
  dimensions: Record<string, string>;
  taxCode?: string;
  description?: string;
  lineRef?: string;
};

export type NormalizedGlJournal = Omit<GlJournalDocumentV1, "lines"> & {
  lines: NormalizedGlLine[];
  /** Sum of the debits (equal to the credits), in the transaction currency. */
  total: string;
};

function sides(line: GlJournalLineV1): { debit: bigint; credit: bigint } {
  if (line.amount !== undefined) {
    const amount = toScaled(line.amount, AMOUNT_SCALE);
    return amount >= 0n ? { debit: amount, credit: 0n } : { debit: 0n, credit: -amount };
  }
  return {
    debit: line.debit !== undefined ? toScaled(line.debit, AMOUNT_SCALE) : 0n,
    credit: line.credit !== undefined ? toScaled(line.credit, AMOUNT_SCALE) : 0n
  };
}

export type ContractResult<T> = { ok: true; document: T } | { ok: false; errors: ContractError[] };

/**
 * Checks `input` against the GL journal contract and returns it normalised:
 * every line with both sides as non-negative decimal strings, numbered from 1.
 */
export function validateGlJournal(input: unknown): ContractResult<NormalizedGlJournal> {
  const version = (input as { contractVersion?: unknown } | null)?.contractVersion;
  if (version !== undefined && version !== 1) {
    return {
      ok: false,
      errors: [
        {
          code: ContractErrorCode.UNSUPPORTED_VERSION,
          path: "contractVersion",
          message: `Contract version ${String(version)} is not supported; this release reads version 1`
        }
      ]
    };
  }
  const parsed = glJournalDocumentV1.safeParse(input);
  if (!parsed.success) return { ok: false, errors: issuesToErrors(parsed.error.issues) };
  const doc = parsed.data;
  let total = 0n;
  const lines = doc.lines.map((line, i): NormalizedGlLine => {
    const { debit, credit } = sides(line);
    total += debit;
    return {
      lineNumber: i + 1,
      accountCode: line.accountCode,
      debit: fromScaled(debit, AMOUNT_SCALE),
      credit: fromScaled(credit, AMOUNT_SCALE),
      ...(line.statValue !== undefined && { statValue: line.statValue }),
      dimensions: line.dimensions ?? {},
      ...(line.taxCode !== undefined && { taxCode: line.taxCode }),
      ...(line.description !== undefined && { description: line.description }),
      ...(line.lineRef !== undefined && { lineRef: line.lineRef })
    };
  });
  return { ok: true, document: { ...doc, lines, total: fromScaled(total, AMOUNT_SCALE) } };
}
