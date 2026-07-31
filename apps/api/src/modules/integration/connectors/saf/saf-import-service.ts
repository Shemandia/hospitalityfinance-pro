/**
 * SAF Import Service
 *
 * Handles the 3-step import workflow:
 *   1. Preview — parse file, validate, return summary (no DB changes)
 *   2. Account Mapping — check which SAF codes match existing GL accounts
 *   3. Execute — create GL journal entries from the SAF file
 */

import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "../../../../db/client.js";
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
import {
  getOrCreateSuspenseAccount,
  computeImbalance,
  suspensePlugSides,
  assertBalanced
} from "../shared/suspense.js";

import { applyBalanceDelta } from "../../../../db/balance-writer.js";
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
  /** F9: set when the identical file was already imported (idempotent no-op). */
  alreadyImported?: boolean;
  /** F9: id of the ImportLog row recording this execution. */
  importLogId?: string;
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

  // F9: audit trail + duplicate-file detection for the SAF path (previously it
  // wrote no ImportLog at all). Hash the raw file; if an identical file already
  // imported successfully for this source, return an idempotent no-op.
  const contentHash = createHash("sha256").update(opts.fileContent).digest("hex");
  const connectorType = `SAF_${opts.sourceModule}`;
  const earliest = parsed.dateRange?.earliest;
  const importBusinessDate =
    earliest && earliest.length === 8
      ? new Date(
          `${earliest.slice(0, 4)}-${earliest.slice(4, 6)}-${earliest.slice(6, 8)}T00:00:00.000Z`
        )
      : new Date();

  const priorImport = await prisma.importLog.findFirst({
    where: {
      entityId: opts.entityId,
      connectorType,
      status: "SUCCESS",
      errorDetails: { path: ["contentHash"], equals: contentHash }
    },
    select: { id: true }
  });
  if (priorImport) {
    result.alreadyImported = true;
    result.importLogId = priorImport.id;
    return result;
  }

  const importLog = await prisma.importLog.create({
    data: {
      entityId: opts.entityId,
      connectorType,
      businessDate: importBusinessDate,
      status: "RUNNING",
      recordsTotal: parsed.lineCount
    },
    select: { id: true }
  });
  result.importLogId = importLog.id;

  try {
    // Build account mapping (code → { id, type }). We track type so that
    // STATISTICAL (memo) account lines can be posted with zero debit/credit
    // and the parsed quantity routed to the new stat_value column.
    const accountMap = new Map<string, { id: string; type: string }>();
    const existingAccounts = await prisma.account.findMany({
      where: { entityId: opts.entityId },
      select: { id: true, code: true, name: true, type: true }
    });
    for (const a of existingAccounts) accountMap.set(a.code, { id: a.id, type: a.type });

    // Auto-create missing accounts if enabled
    if (opts.autoCreateAccounts) {
      for (const code of parsed.uniqueAccounts) {
        if (accountMap.has(code)) continue;

        // Statistical Z-prefix codes (EZZDS/EZZMS files) require an existing
        // STATISTICAL account in the COA. We never auto-create them: the 147
        // EZZ statistics accounts are seeded with hierarchy + usaliDepartment
        // that we can't infer from the SAF line alone.
        if (isStatisticalAccount(code)) {
          continue;
        }

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
          accountMap.set(code, { id: account.id, type: "LIABILITY" });
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
          // Infer account type from the code range using the SAF/Opera/Jana numeric
          // convention documented in the integration guides:
          //   1xxxx = Asset (cash, AR, inventory)      → DEBIT normal
          //   2xxxx = Liability (tax, deposits, tips)  → CREDIT normal
          //   3xxxx = Revenue (rooms, F&B, spa)        → CREDIT normal
          //   4xxxx+ = Cost of sales / expense         → DEBIT normal
          // F7: previously 1xxxx fell to EXPENSE and 3xxxx/5xxxx fell through to the
          // EXPENSE/DEBIT default, so auto-created asset and revenue accounts were
          // mis-typed (wrong sign + wrong P&L/BS classification). These are still
          // heuristics — an explicit ConnectorMapping should be preferred.
          const numCode = parseInt(code, 10);
          let type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
          let normalBalance: "DEBIT" | "CREDIT";
          if (numCode < 20000) {
            type = "ASSET";
            normalBalance = "DEBIT";
          } else if (numCode < 30000) {
            type = "LIABILITY";
            normalBalance = "CREDIT";
          } else if (numCode < 40000) {
            type = "REVENUE";
            normalBalance = "CREDIT";
          } else {
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
          accountMap.set(code, { id: account.id, type });
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

    // Lazily resolved once per import, only if a group actually needs a plug (F2/F6).
    let suspenseAccountId: string | null = null;

    for (const [groupKey, safLines] of groups) {
      const journalLines: Array<{
        accountId: string;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
        statValue: Prisma.Decimal | null;
        description: string;
        lineNumber: number;
      }> = [];

      let lineNum = 1;
      for (const safLine of safLines) {
        const mapping = accountMap.get(safLine.accountCode);
        if (!mapping) {
          result.linesSkipped++;
          continue;
        }

        // STATISTICAL (memo) accounts: single-sided posting with the parsed
        // quantity in stat_value. debit/credit are forced to zero so the
        // line has no GL impact and the D/C marker from the SAF is ignored.
        const isStat = mapping.type === "STATISTICAL";
        journalLines.push({
          accountId: mapping.id,
          debit: new Prisma.Decimal(isStat ? "0" : safLine.dcMarker === "D" ? safLine.amount : "0"),
          credit: new Prisma.Decimal(
            isStat ? "0" : safLine.dcMarker === "C" ? safLine.amount : "0"
          ),
          statValue: isStat ? new Prisma.Decimal(safLine.amount) : null,
          description: safLine.description,
          lineNumber: lineNum++
        });
        result.linesImported++;
      }

      if (journalLines.length === 0) continue;

      // F2/F6: a mapped-only journal can be out of balance because unmapped lines
      // were dropped above. Rather than posting an unbalanced journal (or silently
      // losing the amount), park the residual in the Import Suspense account so the
      // journal balances by construction and finance can reclassify it later.
      const plug = suspensePlugSides(computeImbalance(journalLines));
      if (plug) {
        if (!suspenseAccountId) {
          suspenseAccountId = (await getOrCreateSuspenseAccount(prisma, opts.entityId)).id;
        }
        journalLines.push({
          accountId: suspenseAccountId,
          debit: plug.debit,
          credit: plug.credit,
          statValue: null,
          description: "Import suspense — unmapped/dropped lines",
          lineNumber: lineNum++
        });
      }
      // Safety net: never post an unbalanced journal from this path.
      assertBalanced(journalLines, `SAF journal ${opts.sourceModule}-${groupKey}`);

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

      // Check for duplicate reference — skip if already imported.
      //
      // F1: the reference MUST be scoped by the business (transaction) date.
      // Without the date, `single_entry` groups every line into one journal whose
      // groupKey is the literal "all", so every day's import shares the reference
      // "<module>-all" and every business date after the first is wrongly rejected
      // as a duplicate (and `by_reference` collides the same way because Opera tx
      // codes like G1001 recur daily). Including the date makes each night-audit
      // date unique while still catching a genuine re-import of the SAME day.
      //
      // Restatement (F16): the `status: { not: "REVERSED" }` filter means that once
      // a controller reverses a bad import via reverseJournal(), a corrected file
      // for the same date imports cleanly — reverse-then-reimport, with an audit
      // trail — rather than silently overwriting posted financials.
      const bizDateKey = txDate && txDate.length === 8 ? txDate : "nodate";
      const journalRef = `${opts.sourceModule}-${bizDateKey}-${groupKey}`;
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
          reference: journalRef,
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
              statValue: l.statValue,
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
          // Canonical signed writer — this used to write `debit - credit`
          // unsigned, moving every credit-normal account the wrong way.
          await applyBalanceDelta(
            prisma,
            opts.entityId,
            period.id,
            line.accountId,
            line.debitFunctional,
            line.creditFunctional
          );
        }
      }

      // ── Auto-create AP invoices for supplier (C-prefix) groups ─────────────
      // Find vendor credit lines in this group — these represent supplier invoices
      const vendorCredits = safLines.filter(
        (l) => isVendorAccount(l.accountCode) && l.dcMarker === "C"
      );

      if (vendorCredits.length > 0 && opts.autoPost) {
        // F8: create ONE AP invoice per vendor credit line (each represents a
        // supplier voucher) and attach only the expense/tax debit lines that share
        // that voucher's Transaction Reference. Previously EVERY expense line in the
        // group was attached to EVERY vendor invoice — under single_entry grouping
        // (whole file = one group) that massively overstated AP. VAT is now carried
        // into taxAmount instead of being forced to 0.
        const expenseDebits = safLines.filter(
          (l) =>
            !isVendorAccount(l.accountCode) && l.dcMarker === "D" && accountMap.has(l.accountCode)
        );

        const supplierCache = new Map<string, { id: string; paymentTermsDays: number | null }>();
        const resolveSupplier = async (vendorCode: string) => {
          const cached = supplierCache.get(vendorCode);
          if (cached) return cached;
          let supplier = await prisma.supplier.findUnique({
            where: { entityId_code: { entityId: opts.entityId, code: vendorCode } }
          });
          if (!supplier) {
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
          const entry = { id: supplier.id, paymentTermsDays: supplier.paymentTermsDays };
          supplierCache.set(vendorCode, entry);
          return entry;
        };

        let vendorSeq = 0;
        for (const vc of vendorCredits) {
          vendorSeq++;
          const supplier = await resolveSupplier(vc.accountCode);

          const gross = new Prisma.Decimal(vc.amount);
          const ref = vc.transactionReference?.trim() || "";

          // Match expense/tax debits to this voucher by Transaction Reference.
          // A voucher with no reference gets no auto-matched lines (avoids
          // cross-attaching unrelated expenses); a single summary line is used.
          const matched = ref
            ? expenseDebits.filter((ed) => (ed.transactionReference?.trim() || "") === ref)
            : [];

          // VAT portion = matched debits posted to a tax account (23xxx, per the
          // SAF/Jana convention where 23100 = VAT input).
          const taxAmount = matched
            .filter((ed) => /^23/.test(ed.accountCode))
            .reduce((s, ed) => s.add(new Prisma.Decimal(ed.amount)), new Prisma.Decimal(0));

          const invoiceLines = matched.map((ed) => ({
            description: ed.description || `${ed.accountCode} — ${ref || groupKey}`,
            quantity: new Prisma.Decimal(1),
            unitPrice: new Prisma.Decimal(ed.amount),
            amount: new Prisma.Decimal(ed.amount),
            glAccountId: accountMap.get(ed.accountCode)?.id ?? null
          }));
          if (invoiceLines.length === 0) {
            invoiceLines.push({
              description: `SAF Import — ${ref || groupKey}`,
              quantity: new Prisma.Decimal(1),
              unitPrice: gross,
              amount: gross,
              glAccountId: null
            });
          }

          const netAmount = gross.sub(taxAmount);
          const functionalAmount = gross.mul(fxRate);
          const dueDate = new Date(journalDate);
          dueDate.setDate(dueDate.getDate() + (supplier.paymentTermsDays ?? 30));

          // Unique within this import; vendorSeq avoids collisions when a vendor has
          // multiple vouchers or references are blank.
          const invoiceNumber = `${ref || groupKey}-${vc.accountCode}-${vendorSeq}`;

          await prisma.aPInvoice.create({
            data: {
              entityId: opts.entityId,
              supplierId: supplier.id,
              periodId: period.id,
              invoiceNumber,
              invoiceDate: journalDate,
              dueDate,
              currency: fileCurrency,
              grossAmount: gross,
              taxAmount,
              netAmount,
              functionalAmount,
              fxRate,
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

    await prisma.importLog.update({
      where: { id: importLog.id },
      data: {
        status: "SUCCESS",
        recordsTotal: parsed.lineCount,
        recordsImported: result.linesImported,
        recordsFailed: result.linesSkipped,
        glJournalId: result.journalIds[0] ?? null,
        errorDetails: {
          contentHash,
          filename: opts.filename,
          journalsCreated: result.journalsCreated,
          ...(result.unmappedAccounts.length > 0
            ? { unmappedAccounts: result.unmappedAccounts }
            : {})
        } as Prisma.InputJsonValue
      }
    });

    return result;
  } catch (err) {
    await prisma.importLog.update({
      where: { id: importLog.id },
      data: {
        status: "FAILED",
        errorDetails: {
          contentHash,
          filename: opts.filename,
          message: err instanceof Error ? err.message : String(err)
        } as Prisma.InputJsonValue
      }
    });
    throw err;
  }
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

// ── Statistics cross-validation (EZZDS ↔ EZZMS) ──────────────────────────────

/**
 * Opera exports two parallel statistics views for the same business date:
 *   EZZDS — aggregated daily KPIs (Z101..Z123 — occupied, guests, revenue)
 *   EZZMS — per-market-segment triplets (revenue, rooms, guests for each segment)
 *
 * When both files have been imported, the EZZDS daily totals should line up
 * with the sum of active-segment accounts from EZZMS. Rounding drift is
 * expected — this check emits WARNINGs, never errors, so a small delta never
 * blocks a night audit.
 */
export type StatisticsCrossValidationWarning = {
  type: "ROOM_NIGHTS_MISMATCH" | "GUEST_NIGHTS_MISMATCH" | "REVENUE_STAT_MISMATCH";
  severity: "WARNING";
  message: string;
  dailyValue: string;
  segmentSum: string;
  delta: string;
};

/**
 * Active market segment account triplets from the EZZ COA.
 * Deprecated "Do Not Use" segments are excluded so their rollover drift
 * doesn't pollute the comparison. Source: HFP_Opera_Statistics_Import_v1.1.md §4.3.
 */
const MS_ACTIVE_REVENUE_ACCOUNTS = [
  "Z124",
  "Z126",
  "Z127",
  "Z128",
  "Z129",
  "Z130",
  "Z131",
  "Z132",
  "Z145",
  "Z148",
  "Z158",
  "Z173",
  "Z179",
  "Z185",
  "Z191",
  "Z194",
  "Z210"
];
const MS_ACTIVE_ROOM_NIGHT_ACCOUNTS = [
  "Z133",
  "Z135",
  "Z137",
  "Z139",
  "Z141",
  "Z143",
  "Z146",
  "Z149",
  "Z154",
  "Z156",
  "Z159",
  "Z174",
  "Z180",
  "Z186",
  "Z192",
  "Z195",
  "Z211"
];
const MS_ACTIVE_GUEST_NIGHT_ACCOUNTS = [
  "Z134",
  "Z136",
  "Z138",
  "Z140",
  "Z142",
  "Z144",
  "Z147",
  "Z150",
  "Z155",
  "Z157",
  "Z160",
  "Z175",
  "Z181",
  "Z187",
  "Z193",
  "Z196",
  "Z212"
];

async function sumStatValueForCodes(
  prisma: PrismaClient,
  entityId: string,
  businessDate: Date,
  accountCodes: string[]
): Promise<Prisma.Decimal> {
  if (accountCodes.length === 0) return new Prisma.Decimal(0);

  const startOfDay = new Date(businessDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(businessDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const lines = await (prisma as any).journalLine.findMany({
    where: {
      statValue: { not: null },
      account: { entityId, code: { in: accountCodes }, type: "STATISTICAL" },
      journal: { entityId, postedAt: { gte: startOfDay, lte: endOfDay } }
    },
    select: { statValue: true }
  });

  return lines.reduce(
    (sum: Prisma.Decimal, row: { statValue: Prisma.Decimal | null }) =>
      row.statValue ? sum.add(row.statValue) : sum,
    new Prisma.Decimal(0)
  );
}

async function getDailyStatValue(
  prisma: PrismaClient,
  entityId: string,
  businessDate: Date,
  accountCode: string
): Promise<Prisma.Decimal | null> {
  const total = await sumStatValueForCodes(prisma, entityId, businessDate, [accountCode]);
  return total.isZero() ? null : total;
}

/**
 * Validate that EZZDS daily totals reconcile against the EZZMS segment sums
 * for the same business date. Returns warnings for any mismatch that exceeds
 * the tolerance; an empty array means the two files are consistent.
 *
 * Tolerances: 0.01 for integer counts (room nights, guest nights) and
 * 0.50 for revenue to absorb segment-level rounding.
 */
export async function crossValidateStatistics(
  prisma: PrismaClient,
  entityId: string,
  businessDate: Date
): Promise<StatisticsCrossValidationWarning[]> {
  const warnings: StatisticsCrossValidationWarning[] = [];

  const [dsOccR, dsGuest, dsRoomRev, msRoomNights, msGuestNights, msRevenue] = await Promise.all([
    getDailyStatValue(prisma, entityId, businessDate, "Z104"), // Rooms Occupied
    getDailyStatValue(prisma, entityId, businessDate, "Z107"), // Total In-House Persons
    getDailyStatValue(prisma, entityId, businessDate, "Z950"), // Booking Source Revenue
    sumStatValueForCodes(prisma, entityId, businessDate, MS_ACTIVE_ROOM_NIGHT_ACCOUNTS),
    sumStatValueForCodes(prisma, entityId, businessDate, MS_ACTIVE_GUEST_NIGHT_ACCOUNTS),
    sumStatValueForCodes(prisma, entityId, businessDate, MS_ACTIVE_REVENUE_ACCOUNTS)
  ]);

  const COUNT_TOLERANCE = new Prisma.Decimal("0.01");
  const REVENUE_TOLERANCE = new Prisma.Decimal("0.50");

  if (dsOccR !== null) {
    const delta = dsOccR.sub(msRoomNights).abs();
    if (delta.greaterThan(COUNT_TOLERANCE)) {
      warnings.push({
        type: "ROOM_NIGHTS_MISMATCH",
        severity: "WARNING",
        message: `EZZDS room nights (${dsOccR.toFixed(3)}) != EZZMS segment sum (${msRoomNights.toFixed(3)})`,
        dailyValue: dsOccR.toFixed(3),
        segmentSum: msRoomNights.toFixed(3),
        delta: delta.toFixed(3)
      });
    }
  }

  if (dsGuest !== null) {
    const delta = dsGuest.sub(msGuestNights).abs();
    if (delta.greaterThan(COUNT_TOLERANCE)) {
      warnings.push({
        type: "GUEST_NIGHTS_MISMATCH",
        severity: "WARNING",
        message: `EZZDS guest nights (${dsGuest.toFixed(3)}) != EZZMS segment sum (${msGuestNights.toFixed(3)})`,
        dailyValue: dsGuest.toFixed(3),
        segmentSum: msGuestNights.toFixed(3),
        delta: delta.toFixed(3)
      });
    }
  }

  if (dsRoomRev !== null) {
    const delta = dsRoomRev.sub(msRevenue).abs();
    if (delta.greaterThan(REVENUE_TOLERANCE)) {
      warnings.push({
        type: "REVENUE_STAT_MISMATCH",
        severity: "WARNING",
        message: `EZZDS revenue stat (${dsRoomRev.toFixed(3)}) != EZZMS segment sum (${msRevenue.toFixed(3)})`,
        dailyValue: dsRoomRev.toFixed(3),
        segmentSum: msRevenue.toFixed(3),
        delta: delta.toFixed(3)
      });
    }
  }

  return warnings;
}
