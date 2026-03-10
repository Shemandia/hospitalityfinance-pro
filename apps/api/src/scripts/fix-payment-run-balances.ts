/**
 * One-time correcting script: The old payment run debited the generic AP Control
 * account (2000) instead of each supplier's own GL account (e.g. CBORA001).
 * This script posts correcting journals:
 *   Dr Vendor Account (CBORA001 etc.)
 *   Cr AP Control (2000)
 *
 * Usage: npx tsx src/scripts/fix-payment-run-balances.ts
 */

import { PrismaClient, Prisma } from "@prisma/client";

const ENTITY_ID = "00000000-0000-0000-0000-000000000002";

async function main() {
  const prisma = new PrismaClient();

  try {
    // Find the AP control account (2000)
    const apControl = await prisma.account.findUnique({
      where: { entityId_code: { entityId: ENTITY_ID, code: "2000" } },
    });
    if (!apControl) throw new Error("AP Control account 2000 not found");

    // Find all payment run journals (they reference PAYRUN-* and debit account 2000)
    const paymentJournals = await prisma.journal.findMany({
      where: {
        entityId: ENTITY_ID,
        description: { contains: "AP payment run" },
        status: "POSTED",
      },
      include: {
        lines: {
          include: { account: { select: { id: true, code: true, name: true } } },
        },
      },
    });

    console.log(`Found ${paymentJournals.length} payment run journals`);

    // Find entity user for journal creation
    const entityUser = await prisma.entityUser.findFirst({
      where: { entityId: ENTITY_ID },
    });
    if (!entityUser) throw new Error("No entity user found");

    // Find the open period
    const openPeriod = await prisma.period.findFirst({
      where: { entityId: ENTITY_ID, status: "OPEN" },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    if (!openPeriod) throw new Error("No open period found");

    // Collect which journals incorrectly debited 2000 instead of the vendor account
    // Each payment journal should have: line 1 = debit (AP clear), line 2 = credit (bank)
    // The description contains the supplier name: "AP payment run <id> - <supplier name>"
    const corrections: Array<{
      journalRef: string;
      supplierName: string;
      amount: Prisma.Decimal;
      vendorAccountId: string;
      vendorAccountCode: string;
    }> = [];

    for (const journal of paymentJournals) {
      // Find the debit line that hits account 2000 (the incorrect one)
      const apDebitLine = journal.lines.find(
        (l) => l.account.code === "2000" && l.debit.greaterThan(0)
      );
      if (!apDebitLine) continue; // This journal doesn't have the problem

      // Extract supplier name from description: "AP payment run <id> - <name>"
      const nameMatch = journal.description?.match(/- (.+)$/);
      const supplierName = nameMatch?.[1] ?? "Unknown";

      // Find the supplier by name to get their code
      const supplier = await prisma.supplier.findFirst({
        where: { entityId: ENTITY_ID, name: supplierName },
      });
      if (!supplier) {
        console.log(`  SKIP ${journal.reference} — supplier "${supplierName}" not found`);
        continue;
      }

      // Find the vendor's GL account by supplier code
      const vendorAccount = await prisma.account.findUnique({
        where: { entityId_code: { entityId: ENTITY_ID, code: supplier.code } },
      });
      if (!vendorAccount) {
        console.log(`  SKIP ${journal.reference} — GL account ${supplier.code} not found`);
        continue;
      }

      // Only correct if vendor account code != "2000" (i.e. the debit went to the wrong place)
      if (vendorAccount.code === "2000") continue;

      corrections.push({
        journalRef: journal.reference ?? journal.id,
        supplierName,
        amount: apDebitLine.debit,
        vendorAccountId: vendorAccount.id,
        vendorAccountCode: vendorAccount.code,
      });
    }

    console.log(`\nCorrections needed: ${corrections.length}`);
    for (const c of corrections) {
      console.log(`  ${c.vendorAccountCode} (${c.supplierName}): ${c.amount}`);
    }

    if (corrections.length === 0) {
      console.log("Nothing to correct!");
      return;
    }

    // Post correcting journals
    let corrected = 0;
    for (const c of corrections) {
      const correctionRef = `CORR-${c.journalRef}`;

      // Check if correction already posted
      const existing = await prisma.journal.findFirst({
        where: { entityId: ENTITY_ID, reference: correctionRef },
      });
      if (existing) {
        console.log(`  SKIP ${correctionRef} — already posted`);
        continue;
      }

      const journal = await prisma.journal.create({
        data: {
          entityId: ENTITY_ID,
          periodId: openPeriod.id,
          reference: correctionRef,
          description: `Correcting entry: reclassify AP payment debit from 2000 to ${c.vendorAccountCode} (${c.supplierName})`,
          source: "AP",
          status: "POSTED",
          functionalCurrency: "TZS",
          createdById: entityUser.userId,
          postedAt: new Date(),
          lines: {
            create: [
              {
                accountId: c.vendorAccountId,
                debit: c.amount,
                credit: new Prisma.Decimal(0),
                currency: "TZS",
                fxRate: new Prisma.Decimal(1),
                debitFunctional: c.amount,
                creditFunctional: new Prisma.Decimal(0),
                description: `Reclassify payment debit to ${c.vendorAccountCode}`,
                lineNumber: 1,
              },
              {
                accountId: apControl.id,
                debit: new Prisma.Decimal(0),
                credit: c.amount,
                currency: "TZS",
                fxRate: new Prisma.Decimal(1),
                debitFunctional: new Prisma.Decimal(0),
                creditFunctional: c.amount,
                description: `Reverse incorrect debit on AP Control 2000`,
                lineNumber: 2,
              },
            ],
          },
        },
        include: { lines: true },
      });

      // Update account period balances
      for (const line of journal.lines) {
        await prisma.accountPeriodBalance.upsert({
          where: {
            entityId_accountId_periodId: {
              entityId: ENTITY_ID,
              accountId: line.accountId,
              periodId: openPeriod.id,
            },
          },
          create: {
            entityId: ENTITY_ID,
            accountId: line.accountId,
            periodId: openPeriod.id,
            openingBalance: new Prisma.Decimal(0),
            periodDebits: line.debitFunctional,
            periodCredits: line.creditFunctional,
            closingBalance: line.debitFunctional.sub(line.creditFunctional),
          },
          update: {
            periodDebits: { increment: line.debitFunctional },
            periodCredits: { increment: line.creditFunctional },
            closingBalance: {
              increment: line.debitFunctional.sub(line.creditFunctional),
            },
          },
        });
      }

      console.log(`  + POSTED ${correctionRef} — Dr ${c.vendorAccountCode} / Cr 2000 — ${c.amount}`);
      corrected++;
    }

    console.log(`\nDone! ${corrected} correcting journals posted.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
