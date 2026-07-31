import { Prisma, PrismaClient } from "../../../../db/client.js";

// ── MT940 Parser ─────────────────────────────────────────────────────────────
// Parses SWIFT MT940 bank statement format (colon-tag based)

export interface MT940Transaction {
  valueDate: string; // YYYYMMDD
  bookingDate: string; // MMDD (relative to statement date)
  debitCredit: "D" | "C" | "RD" | "RC";
  currency: string;
  amount: number;
  transactionCode: string;
  reference: string;
  narrative: string;
}

export interface MT940Statement {
  accountId: string;
  statementNumber: string;
  openingBalance: number;
  closingBalance: number;
  currency: string;
  transactions: MT940Transaction[];
}

export function parseMT940(raw: string): MT940Statement[] {
  const statements: MT940Statement[] = [];
  // Split on :20: tag which begins a new message
  const blocks = raw.split(/(?=:20:)/);

  for (const block of blocks) {
    if (!block.trim()) continue;

    const statement: MT940Statement = {
      accountId: "",
      statementNumber: "",
      openingBalance: 0,
      closingBalance: 0,
      currency: "USD",
      transactions: []
    };

    // :25: Account identification
    const acctMatch = block.match(/:25:([^\r\n]+)/);
    if (acctMatch) statement.accountId = acctMatch[1].trim();

    // :28C: Statement/sequence number
    const stmtMatch = block.match(/:28C:([^\r\n]+)/);
    if (stmtMatch) statement.statementNumber = stmtMatch[1].trim();

    // :60F: Opening balance — format: D/CYYMMDDCURAMOUNT
    const openMatch = block.match(/:60[FC]:([DC])(\d{6})([A-Z]{3})([0-9,]+)/);
    if (openMatch) {
      statement.currency = openMatch[3];
      statement.openingBalance = parseSwiftAmount(openMatch[4]) * (openMatch[1] === "D" ? -1 : 1);
    }

    // :62F: Closing balance
    const closeMatch = block.match(/:62[FM]:([DC])(\d{6})([A-Z]{3})([0-9,]+)/);
    if (closeMatch) {
      statement.closingBalance = parseSwiftAmount(closeMatch[4]) * (closeMatch[1] === "D" ? -1 : 1);
    }

    // :61: Transaction lines
    const txRegex = /:61:(\d{6})(\d{4})?(C|D|RC|RD)([A-Z]?)([0-9,]+)([A-Z]{4})([^\r\n]*)/g;
    let txMatch: RegExpExecArray | null;
    let lastTxIndex = 0;
    const txBlocks: string[] = [];

    // Find all :61: blocks and associated :86: narrative
    const allTxMatches = [
      ...block.matchAll(/:61:(\d{6})(\d{4})?(C|D|RC|RD)([A-Z]?)([0-9,]+)([A-Z]{4})([^\r\n]*)/g)
    ];
    for (let i = 0; i < allTxMatches.length; i++) {
      const start = allTxMatches[i].index ?? 0;
      const end =
        i + 1 < allTxMatches.length ? (allTxMatches[i + 1].index ?? block.length) : block.length;
      txBlocks.push(block.slice(start, end));
    }

    for (const txBlock of txBlocks) {
      const m = txBlock.match(
        /:61:(\d{6})(\d{0,4})?(C|D|RC|RD)([A-Z]?)([0-9,]+)([A-Z]{4})([^\r\n]*)/
      );
      if (!m) continue;

      const narrativeMatch = txBlock.match(/:86:([^:]*)/s);
      const narrative = narrativeMatch ? narrativeMatch[1].replace(/\r?\n/g, " ").trim() : "";

      statement.transactions.push({
        valueDate: m[1],
        bookingDate: m[2] ?? m[1].slice(2),
        debitCredit: m[3] as "D" | "C" | "RD" | "RC",
        currency: statement.currency,
        amount: parseSwiftAmount(m[5]),
        transactionCode: m[6],
        reference: m[7]?.trim() ?? "",
        narrative
      });
    }

    if (statement.accountId || statement.transactions.length > 0) {
      statements.push(statement);
    }
  }

  return statements;
}

function parseSwiftAmount(s: string): number {
  // SWIFT uses comma as decimal separator
  return parseFloat(s.replace(",", "."));
}

// ── OFX Parser ──────────────────────────────────────────────────────────────
// Parses OFX/QFX SGML/XML bank statement format

export interface OFXTransaction {
  type: string; // DEBIT, CREDIT, etc.
  datePosted: string; // YYYYMMDD
  amount: number;
  fitId: string;
  name: string;
  memo: string;
}

export interface OFXStatement {
  accountId: string;
  currency: string;
  startDate: string;
  endDate: string;
  transactions: OFXTransaction[];
}

export function parseOFX(raw: string): OFXStatement {
  // Handle both SGML (legacy) and XML OFX
  const isXml = raw.trimStart().startsWith("<?xml") || raw.includes("<OFX>");

  function extractOFXTag(content: string, tag: string): string {
    const m = content.match(new RegExp(`<${tag}>([^<]*)`, "i"));
    return m ? m[1].trim() : "";
  }

  function extractAllOFXBlocks(content: string, tag: string): string[] {
    const blocks: string[] = [];
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      blocks.push(m[0]);
    }
    // For SGML, try without closing tags
    if (blocks.length === 0) {
      const sgmlRe = new RegExp(`<${tag}>([\\s\\S]*?)(?=<[A-Z]|$)`, "gi");
      while ((m = sgmlRe.exec(content)) !== null) {
        blocks.push(m[1]);
      }
    }
    return blocks;
  }

  const accountId = extractOFXTag(raw, "ACCTID");
  const currency = extractOFXTag(raw, "CURDEF") || "USD";
  const startDate = extractOFXTag(raw, "DTSTART").slice(0, 8);
  const endDate = extractOFXTag(raw, "DTEND").slice(0, 8);

  const stmttrn = extractAllOFXBlocks(raw, "STMTTRN");
  const transactions: OFXTransaction[] = stmttrn.map((block) => ({
    type: extractOFXTag(block, "TRNTYPE"),
    datePosted: extractOFXTag(block, "DTPOSTED").slice(0, 8),
    amount: parseFloat(extractOFXTag(block, "TRNAMT") || "0"),
    fitId: extractOFXTag(block, "FITID"),
    name: extractOFXTag(block, "NAME"),
    memo: extractOFXTag(block, "MEMO")
  }));

  return { accountId, currency, startDate, endDate, transactions };
}

// ── Import Job ───────────────────────────────────────────────────────────────

export type BankImportResult = {
  statementId: string;
  transactionsImported: number;
  duplicatesSkipped: number;
};

export async function importBankStatement(
  prisma: PrismaClient,
  entityId: string,
  fileContent: string,
  format: "MT940" | "OFX",
  bankAccountRef: string
): Promise<BankImportResult[]> {
  const results: BankImportResult[] = [];

  if (format === "MT940") {
    const statements = parseMT940(fileContent);
    for (const stmt of statements) {
      const result = await importMT940Statement(prisma, entityId, stmt, bankAccountRef);
      results.push(result);
    }
  } else {
    const stmt = parseOFX(fileContent);
    const result = await importOFXStatement(prisma, entityId, stmt, bankAccountRef);
    results.push(result);
  }

  return results;
}

async function importMT940Statement(
  prisma: PrismaClient,
  entityId: string,
  stmt: MT940Statement,
  bankAccountRef: string
): Promise<BankImportResult> {
  // Resolve the GL bank account by code (bankAccountRef) or fallback
  const bankAccount = await prisma.account.findFirst({
    where: { entityId, code: bankAccountRef, isActive: true }
  });
  if (!bankAccount) {
    throw new Error(`Bank account with code "${bankAccountRef}" not found for entity.`);
  }

  const statementDate =
    stmt.transactions.length > 0 ? parseMT940Date(stmt.transactions[0].valueDate) : new Date();

  const bankStatement = await prisma.bankStatement.create({
    data: {
      entityId,
      accountId: bankAccount.id,
      statementDate,
      currency: stmt.currency,
      openingBalance: new Prisma.Decimal(stmt.openingBalance),
      closingBalance: new Prisma.Decimal(stmt.closingBalance)
    }
  });

  let transactionsImported = 0;
  let duplicatesSkipped = 0;

  for (const tx of stmt.transactions) {
    const valueDate = parseMT940Date(tx.valueDate);
    const isDebit = tx.debitCredit === "D" || tx.debitCredit === "RD";
    const amount = new Prisma.Decimal(tx.amount);

    // Idempotency: check by statement + reference + amount
    const existing = await prisma.bankTransaction.findFirst({
      where: {
        bankStatementId: bankStatement.id,
        reference: tx.reference,
        amount: isDebit ? amount.neg() : amount
      }
    });

    if (existing) {
      duplicatesSkipped++;
      continue;
    }

    await prisma.bankTransaction.create({
      data: {
        bankStatementId: bankStatement.id,
        valueDate,
        description: tx.narrative || tx.reference,
        amount: isDebit ? amount.neg() : amount,
        currency: stmt.currency,
        reference: tx.reference
      }
    });
    transactionsImported++;
  }

  return {
    statementId: bankStatement.id,
    transactionsImported,
    duplicatesSkipped
  };
}

async function importOFXStatement(
  prisma: PrismaClient,
  entityId: string,
  stmt: OFXStatement,
  bankAccountRef: string
): Promise<BankImportResult> {
  // Resolve the GL bank account by code
  const bankAccount = await prisma.account.findFirst({
    where: { entityId, code: bankAccountRef, isActive: true }
  });
  if (!bankAccount) {
    throw new Error(`Bank account with code "${bankAccountRef}" not found for entity.`);
  }

  const startDate = parseOFXDate(stmt.startDate);

  const bankStatement = await prisma.bankStatement.create({
    data: {
      entityId,
      accountId: bankAccount.id,
      statementDate: startDate,
      currency: stmt.currency,
      openingBalance: new Prisma.Decimal(0),
      closingBalance: new Prisma.Decimal(0)
    }
  });

  let transactionsImported = 0;
  let duplicatesSkipped = 0;

  for (const tx of stmt.transactions) {
    const txDate = parseOFXDate(tx.datePosted);
    const amount = new Prisma.Decimal(tx.amount);

    const existing = await prisma.bankTransaction.findFirst({
      where: { bankStatementId: bankStatement.id, reference: tx.fitId }
    });

    if (existing) {
      duplicatesSkipped++;
      continue;
    }

    await prisma.bankTransaction.create({
      data: {
        bankStatementId: bankStatement.id,
        valueDate: txDate,
        description: tx.memo || tx.name,
        amount,
        currency: stmt.currency,
        reference: tx.fitId
      }
    });
    transactionsImported++;
  }

  return {
    statementId: bankStatement.id,
    transactionsImported,
    duplicatesSkipped
  };
}

function parseMT940Date(s: string): Date {
  // Format: YYMMDD
  const year = parseInt(s.slice(0, 2), 10);
  const month = parseInt(s.slice(2, 4), 10) - 1;
  const day = parseInt(s.slice(4, 6), 10);
  const fullYear = year >= 50 ? 1900 + year : 2000 + year;
  return new Date(fullYear, month, day);
}

function parseOFXDate(s: string): Date {
  // Format: YYYYMMDD
  const year = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(4, 6), 10) - 1;
  const day = parseInt(s.slice(6, 8), 10);
  return new Date(year, month, day);
}
