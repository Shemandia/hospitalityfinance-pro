/**
 * Recalculate all account period balances from POSTED journal lines.
 * This fixes balances that were incorrectly maintained due to missing
 * debitFunctional/creditFunctional on SAF import journal lines.
 *
 * Steps:
 * 1. Fix all journal lines with debit/credit > 0 but debitFunctional/creditFunctional = 0
 * 2. Delete all existing account_period_balances
 * 3. Rebuild from POSTED journal lines
 *
 * Usage: npx tsx src/scripts/recalculate-balances.ts
 */

import { PrismaClient, Prisma } from "@prisma/client";

const ENTITY_ID = "00000000-0000-0000-0000-000000000002";

async function main() {
  const prisma = new PrismaClient();

  try {
    // Step 1: Fix journal lines where functional amounts are 0 but actual amounts are not
    console.log("Step 1: Fixing journal lines with missing functional amounts...");
    const brokenLines: Array<{ id: string; debit: Prisma.Decimal; credit: Prisma.Decimal }> =
      await prisma.$queryRaw`
        SELECT id, debit, credit
        FROM journal_lines
        WHERE (debit > 0 AND debit_functional = 0)
           OR (credit > 0 AND credit_functional = 0)
      `;

    console.log(`  Found ${brokenLines.length} journal lines to fix`);

    for (const line of brokenLines) {
      await prisma.journalLine.update({
        where: { id: line.id },
        data: {
          debitFunctional: line.debit,
          creditFunctional: line.credit,
          fxRate: new Prisma.Decimal(1)
        }
      });
    }
    console.log(`  Fixed ${brokenLines.length} lines`);

    // Step 2: Delete all existing balances for this entity
    console.log("\nStep 2: Clearing existing account period balances...");
    const deleted = await prisma.accountPeriodBalance.deleteMany({
      where: { entityId: ENTITY_ID }
    });
    console.log(`  Deleted ${deleted.count} balance records`);

    // Step 3: Rebuild from POSTED journal lines
    console.log("\nStep 3: Rebuilding balances from POSTED journals...");

    const balanceRows: Array<{
      account_id: string;
      period_id: string;
      total_debit: Prisma.Decimal;
      total_credit: Prisma.Decimal;
    }> = await prisma.$queryRaw`
      SELECT jl.account_id, j.period_id,
             COALESCE(SUM(jl.debit_functional), 0) AS total_debit,
             COALESCE(SUM(jl.credit_functional), 0) AS total_credit
      FROM journal_lines jl
      JOIN journals j ON jl.journal_id = j.id
      WHERE j.entity_id = ${ENTITY_ID}
        AND j.status = 'POSTED'
      GROUP BY jl.account_id, j.period_id
    `;

    console.log(`  Found ${balanceRows.length} account-period combinations`);

    let created = 0;
    for (const row of balanceRows) {
      const periodDebits = new Prisma.Decimal(row.total_debit);
      const periodCredits = new Prisma.Decimal(row.total_credit);
      const closingBalance = periodDebits.sub(periodCredits);

      await prisma.accountPeriodBalance.create({
        data: {
          entityId: ENTITY_ID,
          accountId: row.account_id,
          periodId: row.period_id,
          openingBalance: new Prisma.Decimal(0),
          periodDebits,
          periodCredits,
          closingBalance
        }
      });
      created++;
    }

    console.log(`  Created ${created} balance records`);

    // Step 4: Verify vendor accounts
    console.log("\nVerification — Vendor account balances:");
    console.log("─".repeat(80));

    const vendorBalances: Array<{
      code: string;
      name: string;
      period_debits: Prisma.Decimal;
      period_credits: Prisma.Decimal;
      closing_balance: Prisma.Decimal;
    }> = await prisma.$queryRaw`
      SELECT a.code, a.name, apb.period_debits, apb.period_credits, apb.closing_balance
      FROM account_period_balances apb
      JOIN accounts a ON apb.account_id = a.id
      WHERE a.code LIKE 'C%' AND apb.entity_id = ${ENTITY_ID}
      ORDER BY a.code
    `;

    for (const r of vendorBalances) {
      const dr = Number(r.period_debits).toLocaleString();
      const cr = Number(r.period_credits).toLocaleString();
      const bal = Number(r.closing_balance).toLocaleString();
      console.log(
        `  ${String(r.code).trim().padEnd(12)} ${String(r.name).padEnd(42)} Dr:${dr.padStart(14)} Cr:${cr.padStart(14)} Bal:${bal.padStart(14)}`
      );
    }

    console.log("\nDone!");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
