import type { PrismaClient, JournalSource } from "@prisma/client";
import { Prisma } from "@prisma/client";

export class RecurringJournalError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

type CreateRecurringInput = {
  name: string;
  description?: string;
  journalTypeId?: string;
  source?: JournalSource;
  functionalCurrency: string;
  frequency: "MONTHLY" | "QUARTERLY" | "ANNUALLY";
  dayOfMonth?: number;
  autoPost?: boolean;
  autoReverse?: boolean;
  maxOccurrences?: number;
  endDate?: string;
  lines: Array<{
    accountId: string;
    debit: string;
    credit: string;
    currency: string;
    fxRate?: string;
    description?: string;
    dimension1?: string;
    dimension2?: string;
    dimension3?: string;
    dimension4?: string;
  }>;
};

export class RecurringJournalService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(entityId: string) {
    return this.prisma.recurringJournal.findMany({
      where: { entityId },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
      orderBy: { createdAt: "desc" }
    });
  }

  async getById(entityId: string, id: string) {
    const rj = await this.prisma.recurringJournal.findFirst({
      where: { id, entityId },
      include: { lines: { orderBy: { lineNumber: "asc" } } }
    });
    if (!rj) throw new RecurringJournalError("NOT_FOUND", "Recurring journal not found.", 404);
    return rj;
  }

  async create(entityId: string, userId: string, input: CreateRecurringInput) {
    // Validate lines balance using Decimal arithmetic
    const totalDebit = input.lines.reduce(
      (s, l) => s.add(new Prisma.Decimal(l.debit || "0")),
      new Prisma.Decimal(0)
    );
    const totalCredit = input.lines.reduce(
      (s, l) => s.add(new Prisma.Decimal(l.credit || "0")),
      new Prisma.Decimal(0)
    );
    if (totalDebit.sub(totalCredit).abs().greaterThan(new Prisma.Decimal("0.0001"))) {
      throw new RecurringJournalError(
        "UNBALANCED",
        `Journal lines must balance. Debit: ${totalDebit.toString()}, Credit: ${totalCredit.toString()}`
      );
    }

    if (input.lines.length === 0) {
      throw new RecurringJournalError("NO_LINES", "At least one journal line is required.");
    }

    return this.prisma.recurringJournal.create({
      data: {
        entityId,
        name: input.name,
        description: input.description,
        journalTypeId: input.journalTypeId,
        source: input.source ?? "MANUAL",
        functionalCurrency: input.functionalCurrency,
        frequency: input.frequency,
        dayOfMonth: input.dayOfMonth ?? 1,
        autoPost: input.autoPost ?? false,
        autoReverse: input.autoReverse ?? false,
        maxOccurrences: input.maxOccurrences ?? 0,
        endDate: input.endDate ? new Date(input.endDate) : null,
        createdById: userId,
        lines: {
          create: input.lines.map((l, i) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            currency: l.currency,
            fxRate: l.fxRate ?? 1,
            description: l.description,
            dimension1: l.dimension1,
            dimension2: l.dimension2,
            dimension3: l.dimension3,
            dimension4: l.dimension4,
            lineNumber: i + 1
          }))
        }
      },
      include: { lines: true }
    });
  }

  async update(entityId: string, id: string, patch: Partial<CreateRecurringInput>) {
    const existing = await this.prisma.recurringJournal.findFirst({
      where: { id, entityId }
    });
    if (!existing)
      throw new RecurringJournalError("NOT_FOUND", "Recurring journal not found.", 404);

    return this.prisma.recurringJournal.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.frequency !== undefined && { frequency: patch.frequency }),
        ...(patch.dayOfMonth !== undefined && { dayOfMonth: patch.dayOfMonth }),
        ...(patch.autoPost !== undefined && { autoPost: patch.autoPost }),
        ...(patch.autoReverse !== undefined && { autoReverse: patch.autoReverse }),
        ...(patch.maxOccurrences !== undefined && { maxOccurrences: patch.maxOccurrences }),
        ...(patch.endDate !== undefined && {
          endDate: patch.endDate ? new Date(patch.endDate) : null
        })
      },
      include: { lines: true }
    });
  }

  async deactivate(entityId: string, id: string) {
    const existing = await this.prisma.recurringJournal.findFirst({
      where: { id, entityId }
    });
    if (!existing)
      throw new RecurringJournalError("NOT_FOUND", "Recurring journal not found.", 404);

    return this.prisma.recurringJournal.update({
      where: { id },
      data: { isActive: false }
    });
  }

  /**
   * Generate journals for all due recurring templates in a given entity+period.
   * Called by the BullMQ scheduler job.
   */
  async generateDueJournals(entityId: string, periodId: string, year: number, month: number) {
    const today = new Date();
    const templates = await this.prisma.recurringJournal.findMany({
      where: {
        entityId,
        isActive: true,
        OR: [{ endDate: null }, { endDate: { gte: today } }]
      },
      include: { lines: { orderBy: { lineNumber: "asc" } } }
    });

    const generated: string[] = [];

    for (const tpl of templates) {
      // Check max occurrences
      if (tpl.maxOccurrences > 0 && tpl.occurrenceCount >= tpl.maxOccurrences) continue;

      // Check frequency
      if (!this.isDue(tpl.frequency, tpl.lastGeneratedAt, year, month)) continue;

      // Create journal from template
      const journal = await this.prisma.journal.create({
        data: {
          entityId,
          periodId,
          journalTypeId: tpl.journalTypeId,
          reference: `REC-${tpl.name.slice(0, 20)}-${year}-${String(month).padStart(2, "0")}`,
          description: tpl.description ?? `Recurring: ${tpl.name}`,
          source: tpl.source as JournalSource,
          status: tpl.autoPost ? "POSTED" : "DRAFT",
          postedAt: tpl.autoPost ? new Date() : null,
          functionalCurrency: tpl.functionalCurrency,
          createdById: tpl.createdById,
          lines: {
            create: tpl.lines.map((l) => ({
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              currency: l.currency,
              fxRate: l.fxRate,
              debitFunctional: new Prisma.Decimal(l.debit.toString()).mul(
                new Prisma.Decimal(l.fxRate.toString())
              ),
              creditFunctional: new Prisma.Decimal(l.credit.toString()).mul(
                new Prisma.Decimal(l.fxRate.toString())
              ),
              description: l.description,
              dimension1: l.dimension1,
              dimension2: l.dimension2,
              dimension3: l.dimension3,
              dimension4: l.dimension4,
              lineNumber: l.lineNumber
            }))
          }
        }
      });

      // Update account balances when auto-posting
      if (tpl.autoPost) {
        const createdJournal = await this.prisma.journal.findUnique({
          where: { id: journal.id },
          include: { lines: { include: { account: { select: { type: true } } } } }
        });
        if (createdJournal) {
          for (const line of createdJournal.lines) {
            const accountType = line.account.type;
            // ASSET and EXPENSE are debit-normal (sign = 1)
            // LIABILITY, EQUITY, REVENUE are credit-normal (sign = -1)
            const sign = ["ASSET", "EXPENSE"].includes(accountType) ? 1 : -1;
            await this.prisma.$executeRaw`
              INSERT INTO account_period_balances
                (id, entity_id, account_id, period_id, opening_balance, period_debits, period_credits, closing_balance, created_at, updated_at)
              VALUES (
                gen_random_uuid(), ${entityId}::uuid, ${line.accountId}::uuid, ${periodId}::uuid,
                0, ${line.debitFunctional}::decimal(18,4), ${line.creditFunctional}::decimal(18,4),
                ${sign} * (${line.debitFunctional}::decimal(18,4) - ${line.creditFunctional}::decimal(18,4)),
                NOW(), NOW()
              )
              ON CONFLICT (entity_id, account_id, period_id) DO UPDATE SET
                period_debits   = account_period_balances.period_debits   + EXCLUDED.period_debits,
                period_credits  = account_period_balances.period_credits  + EXCLUDED.period_credits,
                closing_balance = account_period_balances.opening_balance
                  + ${sign} * (account_period_balances.period_debits + EXCLUDED.period_debits)
                  - ${sign} * (account_period_balances.period_credits + EXCLUDED.period_credits),
                updated_at = NOW()
            `;
          }
        }
      }

      // Update template
      await this.prisma.recurringJournal.update({
        where: { id: tpl.id },
        data: {
          occurrenceCount: { increment: 1 },
          lastGeneratedAt: new Date()
        }
      });

      generated.push(journal.id);
    }

    return generated;
  }

  private isDue(
    frequency: string,
    lastGenerated: Date | null,
    year: number,
    month: number
  ): boolean {
    if (!lastGenerated) return true; // Never run before

    const lastYear = lastGenerated.getFullYear();
    const lastMonth = lastGenerated.getMonth() + 1;

    switch (frequency) {
      case "MONTHLY":
        return year !== lastYear || month !== lastMonth;
      case "QUARTERLY":
        // Due if 3+ months since last generation
        return (year - lastYear) * 12 + (month - lastMonth) >= 3;
      case "ANNUALLY":
        return year > lastYear;
      default:
        return false;
    }
  }
}
