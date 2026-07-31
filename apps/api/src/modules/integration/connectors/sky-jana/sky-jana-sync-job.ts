import { Prisma, PrismaClient } from "../../../../db/client.js";
import {
  parseSAFFile,
  extractJanaVouchers,
  isVendorAccount,
  isGLAccount,
  type SAFParseResult
} from "./sky-jana-parser.js";
import { getSkyJanaSftpConfig, SkyJanaSftpClientWrapper } from "./sky-jana-sftp-client.js";

export type SkyJanaSyncResult = {
  filesProcessed: number;
  vouchersCreated: number;
  journalsCreated: number;
  suppliersCreated: number;
  accountsMapped: number;
  accountsUnmapped: string[];
  errors: string[];
};

export async function runSkyJanaSync(
  prisma: PrismaClient,
  entityId: string
): Promise<SkyJanaSyncResult> {
  const config = getSkyJanaSftpConfig();
  const client = new SkyJanaSftpClientWrapper(config);
  const result: SkyJanaSyncResult = {
    filesProcessed: 0,
    vouchersCreated: 0,
    journalsCreated: 0,
    suppliersCreated: 0,
    accountsMapped: 0,
    accountsUnmapped: [],
    errors: []
  };

  await client.connect();

  try {
    // Jana exports .txt SAF files
    const files = await client.listInboundFiles(/\.(txt|saf)$/i);

    for (const filename of files) {
      try {
        const content = await client.downloadFile(filename);
        const parsed = parseSAFFile(content);

        if (parsed.errors.length > 0) {
          result.errors.push(
            `${filename}: ${parsed.errors.length} parse errors — ${parsed.errors[0].message}`
          );
        }

        if (!parsed.isBalanced) {
          result.errors.push(
            `${filename}: File out of balance (debits=${parsed.totalDebits}, credits=${parsed.totalCredits})`
          );
          continue; // Skip unbalanced files
        }

        if (parsed.lineCount === 0) {
          result.errors.push(`${filename}: No transaction lines found`);
          continue;
        }

        // Process the file
        const fileResult = await processSAFFile(prisma, entityId, parsed, filename);
        result.vouchersCreated += fileResult.vouchersCreated;
        result.journalsCreated += fileResult.journalsCreated;
        result.suppliersCreated += fileResult.suppliersCreated;
        result.accountsMapped += fileResult.accountsMapped;
        result.accountsUnmapped.push(...fileResult.accountsUnmapped);

        await client.archiveFile(filename);
        result.filesProcessed++;
      } catch (err) {
        result.errors.push(
          `Failed to process ${filename}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } finally {
    await client.disconnect();
  }

  return result;
}

// ── File processing ───────────────────────────────────────────────────────────

interface FileProcessResult {
  vouchersCreated: number;
  journalsCreated: number;
  suppliersCreated: number;
  accountsMapped: number;
  accountsUnmapped: string[];
}

async function processSAFFile(
  prisma: PrismaClient,
  entityId: string,
  parsed: SAFParseResult,
  filename: string
): Promise<FileProcessResult> {
  const result: FileProcessResult = {
    vouchersCreated: 0,
    journalsCreated: 0,
    suppliersCreated: 0,
    accountsMapped: 0,
    accountsUnmapped: []
  };

  // Extract vouchers grouped by reference
  const vouchers = extractJanaVouchers(parsed);

  // Build account code → GL account ID mapping
  const accountMap = await buildAccountMapping(prisma, entityId, parsed.uniqueAccounts);
  result.accountsMapped = accountMap.mapped.size;
  result.accountsUnmapped = accountMap.unmapped;

  // Build vendor code → supplier ID mapping (auto-create suppliers)
  const vendorCodes = parsed.uniqueAccounts.filter(isVendorAccount);
  const supplierMap = await ensureSuppliers(
    prisma,
    entityId,
    vendorCodes,
    parsed.currency ?? "USD"
  );
  result.suppliersCreated = supplierMap.created;

  // Find the open period for the file's accounting period
  const periodKey = parsed.lines[0]?.accountingPeriod;
  const period = periodKey ? await findOrCreatePeriod(prisma, entityId, periodKey) : null;

  if (!period) {
    throw new Error(`No matching period for accounting period ${periodKey}`);
  }

  // Create journal entries — one per voucher reference
  for (const voucher of vouchers) {
    if (!voucher.isBalanced) continue;

    // Build journal lines: each SAF line becomes a GL journal line
    const voucherLines = [
      ...parsed.lines.filter((l) => l.transactionReference === voucher.reference)
    ];

    const journalLines: Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      description: string;
      lineNumber: number;
    }> = [];

    let lineNum = 1;
    let allMapped = true;

    for (const safLine of voucherLines) {
      const accountId =
        accountMap.mapped.get(safLine.accountCode) ?? supplierMap.accounts.get(safLine.accountCode);

      if (!accountId) {
        allMapped = false;
        continue;
      }

      journalLines.push({
        accountId,
        debit: new Prisma.Decimal(safLine.dcMarker === "D" ? safLine.amount : 0),
        credit: new Prisma.Decimal(safLine.dcMarker === "C" ? safLine.amount : 0),
        description: safLine.description,
        lineNumber: lineNum++
      });
    }

    if (!allMapped || journalLines.length === 0) continue;

    // Create the GL journal
    const txDate = voucher.transactionDate
      ? new Date(
          voucher.transactionDate.substring(0, 4) +
            "-" +
            voucher.transactionDate.substring(4, 6) +
            "-" +
            voucher.transactionDate.substring(6, 8)
        )
      : new Date();

    // Find an entity user for the createdById field
    const entityUser = await prisma.entityUser.findFirst({
      where: { entityId }
    });
    if (!entityUser) throw new Error("No entity user found for journal creation");

    await prisma.journal.create({
      data: {
        entityId,
        periodId: period.id,
        reference: `JANA-${voucher.reference}`,
        description: `Jana Purchasing — ${voucher.reference}`,
        functionalCurrency: voucher.currency,
        source: "PMS",
        status: "DRAFT",
        createdById: entityUser.userId,
        lines: {
          create: journalLines.map((jl) => ({
            ...jl,
            currency: voucher.currency,
            fxRate: new Prisma.Decimal(1),
            debitFunctional: jl.debit,
            creditFunctional: jl.credit
          }))
        }
      }
    });

    result.journalsCreated++;
    result.vouchersCreated++;
  }

  return result;
}

// ── Account mapping ───────────────────────────────────────────────────────────

async function buildAccountMapping(
  prisma: PrismaClient,
  entityId: string,
  safCodes: string[]
): Promise<{ mapped: Map<string, string>; unmapped: string[] }> {
  const glCodes = safCodes.filter(isGLAccount);
  const mapped = new Map<string, string>();
  const unmapped: string[] = [];

  if (glCodes.length === 0) return { mapped, unmapped };

  // Look up by account code
  const accounts = await prisma.account.findMany({
    where: { entityId, code: { in: glCodes } },
    select: { id: true, code: true }
  });

  const codeIndex = new Map(accounts.map((a) => [a.code, a.id]));

  for (const code of glCodes) {
    const id = codeIndex.get(code);
    if (id) {
      mapped.set(code, id);
    } else {
      unmapped.push(code);
    }
  }

  return { mapped, unmapped };
}

// ── Supplier auto-creation ────────────────────────────────────────────────────

async function ensureSuppliers(
  prisma: PrismaClient,
  entityId: string,
  vendorCodes: string[],
  defaultCurrency: string
): Promise<{ accounts: Map<string, string>; created: number }> {
  const accounts = new Map<string, string>();
  let created = 0;

  for (const code of vendorCodes) {
    // Check if supplier exists with this code
    let supplier = await prisma.supplier.findUnique({
      where: { entityId_code: { entityId, code } }
    });

    if (!supplier) {
      // Auto-create supplier from vendor code
      supplier = await prisma.supplier.create({
        data: {
          entityId,
          name: code, // Will need manual naming later
          code,
          currency: defaultCurrency,
          paymentTermsDays: 30,
          isActive: true
        }
      });
      created++;
    }

    // Find or create the creditor GL account for this vendor
    let creditorAccount = await prisma.account.findFirst({
      where: { entityId, code }
    });

    if (!creditorAccount) {
      creditorAccount = await prisma.account.create({
        data: {
          entityId,
          code,
          name: `Creditor — ${code}`,
          type: "LIABILITY",
          normalBalance: "CREDIT",
          allowPosting: true,
          isControlAccount: true,
          level: 3
        }
      });
    }

    accounts.set(code, creditorAccount.id);
  }

  return { accounts, created };
}

// ── Period lookup ─────────────────────────────────────────────────────────────

async function findOrCreatePeriod(
  prisma: PrismaClient,
  entityId: string,
  accountingPeriod: string // YYYYPPP
): Promise<{ id: string } | null> {
  const year = parseInt(accountingPeriod.substring(0, 4), 10);
  const month = parseInt(accountingPeriod.substring(4), 10);

  if (!year || !month || month < 1 || month > 12) return null;

  const period = await prisma.period.findFirst({
    where: { entityId, year, month },
    select: { id: true }
  });

  return period;
}
