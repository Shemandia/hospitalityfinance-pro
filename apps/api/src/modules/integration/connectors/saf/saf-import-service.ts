/**
 * SAF Import Service
 *
 * Handles the 3-step import workflow:
 *   1. Preview — parse file, validate, return summary (no DB changes)
 *   2. Account Mapping — check which SAF codes match existing GL accounts
 *   3. Execute — create GL journal entries from the SAF file
 */

import { Prisma, PrismaClient } from "@prisma/client";
import {
  parseSAFFile,
  buildPreviewSummary,
  groupByReference,
  isVendorAccount,
  isGLAccount,
  isStatisticalAccount,
  type SAFParseResult,
  type SAFTransactionLine
} from "./saf-parser.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AccountMappingEntry = {
  safCode: string;
  status: "matched" | "partial_match" | "unmatched";
  glAccountId: string | null;
  glAccountCode: string | null;
  glAccountName: string | null;
  isVendor: boolean;
  suggestion: string | null;
};

export type GroupingStrategy = "single_entry" | "by_reference" | "by_journal_type";

export type ExecuteOptions = {
  entityId: string;
  fileContent: string;
  filename: string;
  groupingStrategy: GroupingStrategy;
  autoPost: boolean;
  autoCreateAccounts: boolean;
  sourceModule: string;
  descriptionPrefix: string;
  departmentMapping?: Record<string, string>;
};

export type ExecuteResult = {
  journalsCreated: number;
  journalIds: string[];
  accountsCreated: number;
  suppliersCreated: number;
  invoicesCreated: number;
  linesImported: number;
  linesSkipped: number;
  unmappedAccounts: string[];
  duplicatesSkipped: number;
  duplicateReferences: string[];
};

// ── 1. Preview ────────────────────────────────────────────────────────────────

export function previewSAFFile(fileContent: string, filename?: string) {
  const parsed = parseSAFFile(fileContent, filename);
  return buildPreviewSummary(parsed);
}

// ── 2. Account Mapping ────────────────────────────────────────────────────────

export async function getAccountMapping(
  prisma: PrismaClient,
  entityId: string,
  fileContent: string,
  filename?: string
): Promise<AccountMappingEntry[]> {
  const parsed = parseSAFFile(fileContent, filename);
  const safCodes = parsed.uniqueAccounts;

  // Fetch all existing accounts for this entity
  const existingAccounts = await prisma.account.findMany({
    where: { entityId },
    select: { id: true, code: true, name: true }
  });

  const codeIndex = new Map(existingAccounts.map((a) => [a.code, a]));

  // Fetch connector mappings for any source codes
  const connectorMappings = await prisma.connectorMapping.findMany({
    where: { entityId, sourceCode: { in: safCodes } },
    include: { glAccount: { select: { id: true, code: true, name: true } } }
  });
  const mappingIndex = new Map(
    connectorMappings.filter((m) => m.glAccount).map((m) => [m.sourceCode, m.glAccount!])
  );

  const results: AccountMappingEntry[] = [];

  for (const code of safCodes) {
    const isVendor = isVendorAccount(code);

    // Exact match by code
    const exact = codeIndex.get(code) ?? mappingIndex.get(code);
    if (exact) {
      results.push({
        safCode: code,
        status: "matched",
        glAccountId: exact.id,
        glAccountCode: exact.code,
        glAccountName: exact.name,
        isVendor,
        suggestion: null
      });
      continue;
    }

    // Partial match — find accounts with similar codes
    let suggestion: string | null = null;
    if (isGLAccount(code)) {
      // Try prefix match (e.g. 13050 → 1305x accounts)
      const prefix = code.substring(0, Math.min(4, code.length));
      const similar = existingAccounts.find((a) => a.code.startsWith(prefix));
      if (similar) {
        suggestion = `${similar.code} — ${similar.name}`;
      }
    }

    results.push({
      safCode: code,
      status: suggestion ? "partial_match" : "unmatched",
      glAccountId: null,
      glAccountCode: null,
      glAccountName: null,
      isVendor,
      suggestion
    });
  }

  return results;
}

// ── 3. Execute ────────────────────────────────────────────────────────────────

export async function executeSAFImport(
  prisma: PrismaClient,
  opts: ExecuteOptions
): Promise<ExecuteResult> {
  const parsed = parseSAFFile(opts.fileContent, opts.filename);

  // Opera statistics files (MS/DS) are intentionally unbalanced — skip balance check
  const isStatsFile =
    parsed.operaFileType === "market_stats" || parsed.operaFileType === "daily_stats";
  if (!parsed.isBalanced && !isStatsFile) {
    throw new Error(
      `File out of balance: debits=${parsed.totalDebits}, credits=${parsed.totalCredits}`
    );
  }

  if (parsed.lineCount === 0) {
    throw new Error("No transaction lines found");
  }

  const result: ExecuteResult = {
    journalsCreated: 0,
    journalIds: [],
    accountsCreated: 0,
    suppliersCreated: 0,
    invoicesCreated: 0,
    linesImported: 0,
    linesSkipped: 0,
    unmappedAccounts: [],
    duplicatesSkipped: 0,
    duplicateReferences: []
  };

  // Build account mapping
  const accountMap = new Map<string, string>();
  const existingAccounts = await prisma.account.findMany({
    where: { entityId: opts.entityId },
    select: { id: true, code: true, name: true }
  });
  for (const a of existingAccounts) accountMap.set(a.code, a.id);

  // Auto-create missing accounts if enabled
  if (opts.autoCreateAccounts) {
    for (const code of parsed.uniqueAccounts) {
      if (accountMap.has(code)) continue;

      if (isVendorAccount(code)) {
        // Create creditor account + supplier
        const account = await prisma.account.create({
          data: {
            entityId: opts.entityId,
            code,
            name: `Creditor — ${code}`,
            type: "LIABILITY",
            normalBalance: "CREDIT",
            allowPosting: true,
            isControlAccount: true,
            level: 3
          }
        });
        accountMap.set(code, account.id);
        result.accountsCreated++;

        // Auto-create supplier
        const existingSupplier = await prisma.supplier.findUnique({
          where: { entityId_code: { entityId: opts.entityId, code } }
        });
        if (!existingSupplier) {
          await prisma.supplier.create({
            data: {
              entityId: opts.entityId,
              name: code,
              code,
              currency: parsed.currency ?? "USD",
              paymentTermsDays: 30,
              isActive: true
            }
          });
          result.suppliersCreated++;
        }
      } else if (isGLAccount(code)) {
        // Infer account type from code range
        const numCode = parseInt(code, 10);
        let type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" = "EXPENSE";
        let normalBalance: "DEBIT" | "CREDIT" = "DEBIT";
        if (numCode < 20000) {
          type = "EXPENSE";
          normalBalance = "DEBIT";
        }
        if (numCode >= 20000 && numCode < 30000) {
          type = "LIABILITY";
          normalBalance = "CREDIT";
        } // Tax accounts etc.
        if (numCode >= 40000 && numCode < 50000) {
          type = "EXPENSE";
          normalBalance = "DEBIT";
        }
        if (numCode >= 60000) {
          type = "EXPENSE";
          normalBalance = "DEBIT";
        }

        const account = await prisma.account.create({
          data: {
            entityId: opts.entityId,
            code,
            name: `Auto-created ${code}`,
            type,
            normalBalance,
            allowPosting: true,
            isControlAccount: false,
            level: 3
          }
        });
        accountMap.set(code, account.id);
        result.accountsCreated++;
      }
    }
  }

  // Track unmapped
  for (const code of parsed.uniqueAccounts) {
    if (!accountMap.has(code)) result.unmappedAccounts.push(code);
  }

  // Find period
  const periodKey = parsed.lines[0]?.accountingPeriod;
  const period = periodKey ? await findPeriod(prisma, opts.entityId, periodKey) : null;
  if (!period) throw new Error(`No matching period for ${periodKey}`);

  // Find user for journal creation
  const entityUser = await prisma.entityUser.findFirst({
    where: { entityId: opts.entityId },
    include: { user: true }
  });
  if (!entityUser) throw new Error("No entity user found");

  // Determine file currency and entity functional currency for FX conversion
  const fileCurrency = (parsed.currency ?? "USD").toUpperCase();
  const entity = await prisma.entity.findUniqueOrThrow({
    where: { id: opts.entityId },
    select: { functionalCurrency: true }
  });
  const functionalCurrency = entity.functionalCurrency.toUpperCase();

  // Look up FX rate if file currency ≠ functional currency
  let fxRate = new Prisma.Decimal(1);
  if (fileCurrency !== functionalCurrency) {
    const rateRecord = await prisma.fXRate.findFirst({
      where: {
        fromCurrency: fileCurrency,
        toCurrency: functionalCurrency,
        rateType: "SPOT"
      },
      orderBy: { effectiveDate: "desc" }
    });
    if (rateRecord) {
      fxRate = rateRecord.rate;
    } else {
      throw new Error(
        `No FX rate found for ${fileCurrency}→${functionalCurrency}. ` +
          `Please add a SPOT rate on the FX page before importing.`
      );
    }
  }

  // Group lines per strategy
  const groups = groupLines(parsed.lines, opts.groupingStrategy);

  for (const [groupKey, safLines] of groups) {
    const journalLines: Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      description: string;
      lineNumber: number;
    }> = [];

    let lineNum = 1;
    for (const safLine of safLines) {
      const accountId = accountMap.get(safLine.accountCode);
      if (!accountId) {
        result.linesSkipped++;
        continue;
      }

      journalLines.push({
        accountId,
        debit: new Prisma.Decimal(safLine.dcMarker === "D" ? safLine.amount : 0),
        credit: new Prisma.Decimal(safLine.dcMarker === "C" ? safLine.amount : 0),
        description: safLine.description,
        lineNumber: lineNum++
      });
      result.linesImported++;
    }

    if (journalLines.length === 0) continue;

    const txDate = safLines[0]?.transactionDate;
    const journalDate =
      txDate && txDate.length === 8
        ? new Date(
            txDate.substring(0, 4) + "-" + txDate.substring(4, 6) + "-" + txDate.substring(6, 8)
          )
        : new Date();

    // Map sourceModule to JournalSource enum
    const sourceMap: Record<string, string> = {
      PROC: "AP",
      OPERA: "PMS",
      PMS: "PMS",
      POS: "POS",
      PAYROLL: "PAYROLL",
      AP: "AP",
      AR: "AR"
    };
    const journalSource = sourceMap[opts.sourceModule] ?? "MANUAL";

    // Check for duplicate reference — skip if already imported
    const journalRef = `${opts.sourceModule}-${groupKey}`;
    const existingJournal = await prisma.journal.findFirst({
      where: {
        entityId: opts.entityId,
        reference: journalRef,
        status: { not: "REVERSED" }
      },
      select: { id: true }
    });
    if (existingJournal) {
      result.duplicatesSkipped++;
      result.duplicateReferences.push(journalRef);
      result.linesSkipped += safLines.length;
      continue;
    }

    const journal = await prisma.journal.create({
      data: {
        entityId: opts.entityId,
        periodId: period.id,
        reference: `${opts.sourceModule}-${groupKey}`,
        description: `${opts.descriptionPrefix} — ${groupKey}`,
        functionalCurrency: functionalCurrency,
        source: journalSource as any,
        status: opts.autoPost ? "POSTED" : "DRAFT",
        postedAt: opts.autoPost ? journalDate : undefined,
        createdById: entityUser.userId,
        lines: {
          create: journalLines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            currency: fileCurrency,
            fxRate: fxRate,
            debitFunctional: l.debit.mul(fxRate),
            creditFunctional: l.credit.mul(fxRate),
            description: l.description,
            lineNumber: l.lineNumber
          }))
        }
      },
      include: { lines: true }
    });

    result.journalsCreated++;
    result.journalIds.push(journal.id);

    // Update account period balances when auto-posting
    if (opts.autoPost) {
      for (const line of journal.lines) {
        await prisma.accountPeriodBalance.upsert({
          where: {
            entityId_accountId_periodId: {
              entityId: opts.entityId,
              accountId: line.accountId,
              periodId: period.id
            }
          },
          create: {
            entityId: opts.entityId,
            accountId: line.accountId,
            periodId: period.id,
            openingBalance: new Prisma.Decimal(0),
            periodDebits: line.debitFunctional,
            periodCredits: line.creditFunctional,
            closingBalance: line.debitFunctional.sub(line.creditFunctional)
          },
          update: {
            periodDebits: { increment: line.debitFunctional },
            periodCredits: { increment: line.creditFunctional },
            closingBalance: { increment: line.debitFunctional.sub(line.creditFunctional) }
          }
        });
      }
    }

    // ── Auto-create AP invoices for supplier (C-prefix) groups ─────────────
    // Find vendor credit lines in this group — these represent supplier invoices
    const vendorCredits = safLines.filter(
      (l) => isVendorAccount(l.accountCode) && l.dcMarker === "C"
    );

    if (vendorCredits.length > 0 && opts.autoPost) {
      // Group vendor credits by supplier code (usually one per group)
      const vendorMap = new Map<string, { totalCredit: number; lines: typeof safLines }>();
      for (const vc of vendorCredits) {
        const existing = vendorMap.get(vc.accountCode);
        if (existing) {
          existing.totalCredit += vc.amount;
          existing.lines.push(vc);
        } else {
          vendorMap.set(vc.accountCode, { totalCredit: vc.amount, lines: [vc] });
        }
      }

      // Collect expense (debit) lines for invoice line items
      const expenseDebits = safLines.filter(
        (l) =>
          !isVendorAccount(l.accountCode) && l.dcMarker === "D" && accountMap.has(l.accountCode)
      );

      for (const [vendorCode, vendorData] of vendorMap) {
        // Find or create Supplier record
        let supplier = await prisma.supplier.findUnique({
          where: { entityId_code: { entityId: opts.entityId, code: vendorCode } }
        });
        if (!supplier) {
          // Look up the GL account name for a better supplier name
          const vendorAccount = existingAccounts.find((a) => a.code === vendorCode);
          supplier = await prisma.supplier.create({
            data: {
              entityId: opts.entityId,
              name: vendorAccount?.name ?? vendorCode,
              code: vendorCode,
              currency: fileCurrency,
              paymentTermsDays: 30,
              isActive: true
            }
          });
          result.suppliersCreated++;
        }

        // Build invoice line items from expense debits
        const invoiceLines = expenseDebits.map((ed) => ({
          description: ed.description || `${ed.accountCode} — ${groupKey}`,
          quantity: new Prisma.Decimal(1),
          unitPrice: new Prisma.Decimal(ed.amount),
          amount: new Prisma.Decimal(ed.amount),
          glAccountId: accountMap.get(ed.accountCode) ?? null
        }));

        // If no expense lines, create a single line from the vendor total
        if (invoiceLines.length === 0) {
          invoiceLines.push({
            description: `SAF Import — ${groupKey}`,
            quantity: new Prisma.Decimal(1),
            unitPrice: new Prisma.Decimal(vendorData.totalCredit),
            amount: new Prisma.Decimal(vendorData.totalCredit),
            glAccountId: null
          });
        }

        const netAmount = new Prisma.Decimal(vendorData.totalCredit);
        const functionalAmount = netAmount.mul(fxRate);
        const dueDate = new Date(journalDate);
        dueDate.setDate(dueDate.getDate() + (supplier.paymentTermsDays ?? 30));

        // Create AP Invoice in POSTED status, linked to the GL journal
        await prisma.aPInvoice.create({
          data: {
            entityId: opts.entityId,
            supplierId: supplier.id,
            periodId: period.id,
            invoiceNumber: groupKey,
            invoiceDate: journalDate,
            dueDate,
            currency: fileCurrency,
            grossAmount: netAmount,
            taxAmount: new Prisma.Decimal(0),
            netAmount,
            functionalAmount: functionalAmount,
            fxRate: fxRate,
            status: "POSTED",
            glJournalId: journal.id,
            createdById: entityUser.userId,
            approvedById: entityUser.userId,
            lines: {
              create: invoiceLines
            }
          }
        });
        result.invoicesCreated++;
      }
    }
  }

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupLines(
  lines: SAFTransactionLine[],
  strategy: GroupingStrategy
): Map<string, SAFTransactionLine[]> {
  if (strategy === "single_entry") {
    return new Map([["all", lines]]);
  }
  if (strategy === "by_reference") {
    const map = new Map<string, SAFTransactionLine[]>();
    for (const l of lines) {
      const key = l.transactionReference || "__no_ref__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    return map;
  }
  // by_journal_type
  const map = new Map<string, SAFTransactionLine[]>();
  for (const l of lines) {
    const key = l.journalType || "__no_type__";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  }
  return map;
}

async function findPeriod(
  prisma: PrismaClient,
  entityId: string,
  accountingPeriod: string
): Promise<{ id: string } | null> {
  const year = parseInt(accountingPeriod.substring(0, 4), 10);
  const month = parseInt(accountingPeriod.substring(4), 10);
  if (!year || !month || month < 1 || month > 12) return null;

  return prisma.period.findFirst({
    where: { entityId, year, month },
    select: { id: true }
  });
}
