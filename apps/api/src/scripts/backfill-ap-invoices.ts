/**
 * One-time backfill script: Create AP invoices from existing SAF-imported journals
 * that have supplier (C-prefix) credit lines but no corresponding AP invoice.
 *
 * Usage: npx tsx src/scripts/backfill-ap-invoices.ts
 */

import { PrismaClient, Decimal } from "@prisma/client";

const ENTITY_ID = "00000000-0000-0000-0000-000000000002";

async function main() {
  const prisma = new PrismaClient();

  try {
    // Find all POSTED journals from SAF imports (PROC-*, OPERA-*) that don't already have AP invoices
    const journals = await prisma.journal.findMany({
      where: {
        entityId: ENTITY_ID,
        status: "POSTED",
        reference: { startsWith: "PROC-" },
      },
      include: {
        lines: {
          include: {
            account: { select: { id: true, code: true, name: true, type: true } },
          },
        },
        period: true,
      },
      orderBy: { createdAt: "asc" },
    });

    console.log(`Found ${journals.length} PROC journals to check`);

    // Find the entity user for createdById
    const entityUser = await prisma.entityUser.findFirst({
      where: { entityId: ENTITY_ID },
    });
    if (!entityUser) throw new Error("No entity user found");

    let invoicesCreated = 0;
    let suppliersCreated = 0;
    let skipped = 0;

    for (const journal of journals) {
      // Extract invoice number from reference (e.g., "PROC-1003" → "1003")
      const invoiceNumber = (journal.reference ?? "").replace(/^PROC-/, "");

      // Skip "all" grouped journals — they aren't per-invoice
      if (invoiceNumber === "all") {
        console.log(`  SKIP ${journal.reference} — grouped journal`);
        skipped++;
        continue;
      }

      // Find supplier (C-prefix) credit lines
      const vendorCreditLines = journal.lines.filter(
        (l: (typeof journal.lines)[number]) =>
          l.account.code.match(/^C[A-Za-z]/) && parseFloat(l.credit.toString()) > 0
      );

      if (vendorCreditLines.length === 0) {
        console.log(`  SKIP ${journal.reference} — no supplier credit lines`);
        skipped++;
        continue;
      }

      // Find expense (debit) lines
      const expenseDebitLines = journal.lines.filter(
        (l: (typeof journal.lines)[number]) =>
          !l.account.code.match(/^C[A-Za-z]/) && parseFloat(l.debit.toString()) > 0
      );

      // Process each vendor credit
      for (const vendorLine of vendorCreditLines) {
        const vendorCode = vendorLine.account.code;
        const vendorName = vendorLine.account.name;

        // Find or create Supplier record
        let supplier = await prisma.supplier.findUnique({
          where: { entityId_code: { entityId: ENTITY_ID, code: vendorCode } },
        });

        if (!supplier) {
          supplier = await prisma.supplier.create({
            data: {
              entityId: ENTITY_ID,
              name: vendorName || vendorCode,
              code: vendorCode,
              currency: journal.functionalCurrency || "TZS",
              paymentTermsDays: 30,
              isActive: true,
            },
          });
          console.log(`  + Supplier: ${vendorCode} (${vendorName})`);
          suppliersCreated++;
        }

        // Check if AP invoice already exists for this supplier + invoice number
        const existingInvoice = await prisma.aPInvoice.findUnique({
          where: {
            entityId_supplierId_invoiceNumber: {
              entityId: ENTITY_ID,
              supplierId: supplier.id,
              invoiceNumber,
            },
          },
        });

        if (existingInvoice) {
          console.log(`  SKIP ${journal.reference} / ${vendorCode} — invoice already exists`);
          skipped++;
          continue;
        }

        // Build invoice lines from expense debits
        const invoiceLines: Array<{
          description: string;
          quantity: Decimal;
          unitPrice: Decimal;
          amount: Decimal;
          glAccountId?: string;
        }> = expenseDebitLines.map((ed: (typeof expenseDebitLines)[number]) => ({
          description: ed.description || `${ed.account.code} — ${invoiceNumber}`,
          quantity: new Decimal(1),
          unitPrice: ed.debit,
          amount: ed.debit,
          glAccountId: ed.accountId,
        }));

        // Fallback: if no expense lines, use the vendor credit amount
        if (invoiceLines.length === 0) {
          invoiceLines.push({
            description: `SAF Import — ${invoiceNumber}`,
            quantity: new Decimal(1),
            unitPrice: vendorLine.credit,
            amount: vendorLine.credit,
            glAccountId: undefined,
          });
        }

        const netAmount = vendorLine.credit;
        const journalDate = journal.postedAt ?? journal.createdAt;
        const dueDate = new Date(journalDate);
        dueDate.setDate(dueDate.getDate() + supplier.paymentTermsDays);

        await prisma.aPInvoice.create({
          data: {
            entityId: ENTITY_ID,
            supplierId: supplier.id,
            periodId: journal.periodId,
            invoiceNumber,
            invoiceDate: journalDate,
            dueDate,
            currency: journal.functionalCurrency || "TZS",
            grossAmount: netAmount,
            taxAmount: new Decimal(0),
            netAmount,
            functionalAmount: netAmount,
            fxRate: new Decimal(1),
            status: "POSTED",
            glJournalId: journal.id,
            createdById: entityUser.userId,
            approvedById: entityUser.userId,
            lines: {
              create: invoiceLines,
            },
          },
        });

        console.log(`  + Invoice: ${invoiceNumber} → ${vendorCode} (${vendorName}) — ${netAmount}`);
        invoicesCreated++;
      }
    }

    console.log(`\nDone!`);
    console.log(`  Invoices created: ${invoicesCreated}`);
    console.log(`  Suppliers created: ${suppliersCreated}`);
    console.log(`  Skipped: ${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
