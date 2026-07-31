import { Prisma, PrismaClient } from "../../../../db/client.js";

export class ReconciliationServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "ReconciliationServiceError";
  }
}

export type ReconciliationSummary = {
  statementId: string;
  accountCode: string;
  accountName: string;
  statementDate: string;
  openingBalance: string;
  closingBalance: string;
  currency: string;
  totalTransactions: number;
  reconciledCount: number;
  unreconciledCount: number;
  reconciledAmount: string;
  unreconciledAmount: string;
};

export type MatchCandidate = {
  journalLineId: string;
  journalId: string;
  journalRef: string | null;
  journalDescription: string | null;
  journalDate: string;
  accountCode: string;
  amount: string;
  description: string | null;
  score: number;
  matchReason: string;
};

export type AutoMatchResult = {
  matched: number;
  unmatched: number;
  details: Array<{
    bankTransactionId: string;
    journalLineId: string;
    amount: string;
    matchReason: string;
  }>;
};

/**
 * Get reconciliation summary for a bank statement.
 */
export async function getReconciliationSummary(
  prisma: PrismaClient,
  entityId: string,
  statementId: string
): Promise<ReconciliationSummary> {
  const statement = await prisma.bankStatement.findFirst({
    where: { id: statementId, entityId },
    include: {
      account: { select: { code: true, name: true } },
      transactions: true
    }
  });

  if (!statement) {
    throw new ReconciliationServiceError("STATEMENT_NOT_FOUND", "Bank statement not found.", 404);
  }

  const reconciled = statement.transactions.filter((t) => t.isReconciled);
  const unreconciled = statement.transactions.filter((t) => !t.isReconciled);

  return {
    statementId: statement.id,
    accountCode: statement.account.code,
    accountName: statement.account.name,
    statementDate: statement.statementDate.toISOString().split("T")[0],
    openingBalance: statement.openingBalance.toString(),
    closingBalance: statement.closingBalance.toString(),
    currency: statement.currency.trim(),
    totalTransactions: statement.transactions.length,
    reconciledCount: reconciled.length,
    unreconciledCount: unreconciled.length,
    reconciledAmount: reconciled
      .reduce((s, t) => s.add(t.amount.abs()), new Prisma.Decimal(0))
      .toString(),
    unreconciledAmount: unreconciled
      .reduce((s, t) => s.add(t.amount.abs()), new Prisma.Decimal(0))
      .toString()
  };
}

/**
 * Get unreconciled bank transactions for a statement.
 */
export async function getUnreconciledTransactions(
  prisma: PrismaClient,
  entityId: string,
  statementId: string
) {
  const statement = await prisma.bankStatement.findFirst({
    where: { id: statementId, entityId }
  });
  if (!statement) {
    throw new ReconciliationServiceError("STATEMENT_NOT_FOUND", "Bank statement not found.", 404);
  }

  return prisma.bankTransaction.findMany({
    where: { bankStatementId: statementId, isReconciled: false },
    orderBy: { valueDate: "asc" }
  });
}

/**
 * Find GL journal line match candidates for a specific bank transaction.
 * Searches posted journal lines on the same bank account within a date tolerance.
 */
export async function findMatchCandidates(
  prisma: PrismaClient,
  entityId: string,
  bankTransactionId: string,
  dateTolerance: number = 3
): Promise<MatchCandidate[]> {
  const bankTx = await prisma.bankTransaction.findUnique({
    where: { id: bankTransactionId },
    include: { bankStatement: true }
  });

  if (!bankTx) {
    throw new ReconciliationServiceError("TX_NOT_FOUND", "Bank transaction not found.", 404);
  }

  if (bankTx.bankStatement.entityId !== entityId) {
    throw new ReconciliationServiceError("TX_NOT_FOUND", "Bank transaction not found.", 404);
  }

  const txAmount = bankTx.amount;
  const txDate = bankTx.valueDate;
  const accountId = bankTx.bankStatement.accountId;

  // Calculate date range
  const minDate = new Date(txDate);
  minDate.setDate(minDate.getDate() - dateTolerance);
  const maxDate = new Date(txDate);
  maxDate.setDate(maxDate.getDate() + dateTolerance);

  // Search for journal lines on the same GL account with matching amount
  // Bank debit (negative) = GL credit, Bank credit (positive) = GL debit
  const isDebit = txAmount.isNegative();
  const absAmount = txAmount.abs();

  const journalLines = await prisma.journalLine.findMany({
    where: {
      accountId,
      journal: {
        entityId,
        status: "POSTED",
        postedAt: { gte: minDate, lte: maxDate }
      },
      // Not already matched to another bank transaction
      bankTransactions: { none: {} }
    },
    include: {
      journal: {
        select: {
          id: true,
          reference: true,
          description: true,
          postedAt: true,
          createdAt: true
        }
      },
      account: { select: { code: true } }
    },
    take: 50
  });

  const candidates: MatchCandidate[] = [];

  for (const line of journalLines) {
    // For bank debit (outflow), match GL credit lines
    // For bank credit (inflow), match GL debit lines
    const lineAmount = isDebit ? line.credit : line.debit;
    if (lineAmount.isZero()) continue;

    let score = 0;
    const reasons: string[] = [];

    // Exact amount match
    if (lineAmount.equals(absAmount)) {
      score += 50;
      reasons.push("Exact amount match");
    } else {
      // Amount within 1% tolerance (bank fees etc.)
      const diff = lineAmount.sub(absAmount).abs();
      const pct = diff.div(absAmount.isZero() ? new Prisma.Decimal(1) : absAmount).mul(100);
      if (pct.lte(new Prisma.Decimal(1))) {
        score += 30;
        reasons.push(`Amount within 1% (diff: ${diff.toString()})`);
      } else if (pct.lte(new Prisma.Decimal(5))) {
        score += 10;
        reasons.push(`Amount within 5% (diff: ${diff.toString()})`);
      } else {
        continue; // Skip if amount is too different
      }
    }

    // Date proximity scoring
    const journalDate = line.journal.postedAt ?? line.journal.createdAt;
    const daysDiff = Math.abs((txDate.getTime() - journalDate.getTime()) / 86400000);
    if (daysDiff === 0) {
      score += 30;
      reasons.push("Same date");
    } else if (daysDiff <= 1) {
      score += 20;
      reasons.push("1 day difference");
    } else if (daysDiff <= 3) {
      score += 10;
      reasons.push(`${Math.round(daysDiff)} days difference`);
    }

    // Reference matching
    if (bankTx.reference && line.journal.reference) {
      const bankRef = bankTx.reference.toLowerCase().trim();
      const journalRef = line.journal.reference.toLowerCase().trim();
      if (bankRef === journalRef) {
        score += 20;
        reasons.push("Exact reference match");
      } else if (bankRef.includes(journalRef) || journalRef.includes(bankRef)) {
        score += 10;
        reasons.push("Partial reference match");
      }
    }

    candidates.push({
      journalLineId: line.id,
      journalId: line.journal.id,
      journalRef: line.journal.reference,
      journalDescription: line.journal.description,
      journalDate: (line.journal.postedAt ?? line.journal.createdAt).toISOString(),
      accountCode: line.account.code,
      amount: lineAmount.toString(),
      description: line.description,
      score,
      matchReason: reasons.join("; ")
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  return candidates;
}

/**
 * Manually match a bank transaction to a journal line.
 */
export async function matchTransaction(
  prisma: PrismaClient,
  entityId: string,
  bankTransactionId: string,
  journalLineId: string
): Promise<void> {
  const bankTx = await prisma.bankTransaction.findUnique({
    where: { id: bankTransactionId },
    include: { bankStatement: true }
  });

  if (!bankTx || bankTx.bankStatement.entityId !== entityId) {
    throw new ReconciliationServiceError("TX_NOT_FOUND", "Bank transaction not found.", 404);
  }

  if (bankTx.isReconciled) {
    throw new ReconciliationServiceError(
      "TX_ALREADY_RECONCILED",
      "Transaction is already reconciled.",
      409
    );
  }

  // Verify journal line exists and belongs to entity
  const journalLine = await prisma.journalLine.findUnique({
    where: { id: journalLineId },
    include: { journal: { select: { entityId: true } } }
  });

  if (!journalLine || journalLine.journal.entityId !== entityId) {
    throw new ReconciliationServiceError("JOURNAL_LINE_NOT_FOUND", "Journal line not found.", 404);
  }

  await prisma.bankTransaction.update({
    where: { id: bankTransactionId },
    data: {
      isReconciled: true,
      journalLineId
    }
  });
}

/**
 * Unmatch a bank transaction (remove reconciliation).
 */
export async function unmatchTransaction(
  prisma: PrismaClient,
  entityId: string,
  bankTransactionId: string
): Promise<void> {
  const bankTx = await prisma.bankTransaction.findUnique({
    where: { id: bankTransactionId },
    include: { bankStatement: true }
  });

  if (!bankTx || bankTx.bankStatement.entityId !== entityId) {
    throw new ReconciliationServiceError("TX_NOT_FOUND", "Bank transaction not found.", 404);
  }

  if (!bankTx.isReconciled) {
    throw new ReconciliationServiceError(
      "TX_NOT_RECONCILED",
      "Transaction is not reconciled.",
      409
    );
  }

  await prisma.bankTransaction.update({
    where: { id: bankTransactionId },
    data: {
      isReconciled: false,
      journalLineId: null
    }
  });
}

/**
 * Auto-match all unreconciled transactions in a statement.
 * Only matches transactions with score >= 70 (exact amount + same/close date).
 */
export async function autoMatchStatement(
  prisma: PrismaClient,
  entityId: string,
  statementId: string,
  minScore: number = 70
): Promise<AutoMatchResult> {
  const unreconciled = await getUnreconciledTransactions(prisma, entityId, statementId);
  const result: AutoMatchResult = { matched: 0, unmatched: 0, details: [] };

  for (const tx of unreconciled) {
    const candidates = await findMatchCandidates(prisma, entityId, tx.id);
    const bestMatch = candidates[0];

    if (bestMatch && bestMatch.score >= minScore) {
      await matchTransaction(prisma, entityId, tx.id, bestMatch.journalLineId);
      result.matched++;
      result.details.push({
        bankTransactionId: tx.id,
        journalLineId: bestMatch.journalLineId,
        amount: tx.amount.toString(),
        matchReason: bestMatch.matchReason
      });
    } else {
      result.unmatched++;
    }
  }

  return result;
}
