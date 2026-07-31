import { Prisma, PrismaClient } from "../../db/client.js";
import type {
  BudgetDefinitionCreateInput,
  BudgetLinesBulkInput,
  BudgetVarianceQuery
} from "./types.js";

import { ServiceError } from "../../shared/service-error.js";

export class BudgetServiceError extends ServiceError {}

export class BudgetService {
  constructor(private readonly prisma: PrismaClient) {}

  // ── Budget Definitions ────────────────────────────────────────────────────────

  listDefinitions(entityId: string) {
    return this.prisma.budgetDefinition.findMany({
      where: { entityId },
      orderBy: [{ year: "desc" }, { name: "asc" }]
    });
  }

  async getDefinition(entityId: string, id: string) {
    const def = await this.prisma.budgetDefinition.findFirst({
      where: { entityId, id },
      include: {
        lines: {
          include: { account: true },
          orderBy: [{ month: "asc" }]
        }
      }
    });
    if (!def) {
      throw new BudgetServiceError("BUDGET_DEF_NOT_FOUND", "Budget definition not found.", 404);
    }
    return def;
  }

  async createDefinition(entityId: string, input: BudgetDefinitionCreateInput) {
    const existing = await this.prisma.budgetDefinition.findFirst({
      where: { entityId, name: input.name, year: input.year }
    });
    if (existing) {
      throw new BudgetServiceError(
        "BUDGET_DEF_EXISTS",
        `Budget definition "${input.name}" for year ${input.year} already exists.`,
        409
      );
    }
    return this.prisma.budgetDefinition.create({
      data: { entityId, name: input.name, year: input.year }
    });
  }

  // ── Budget Lines (bulk upsert) ─────────────────────────────────────────────────

  async upsertLines(entityId: string, budgetDefinitionId: string, input: BudgetLinesBulkInput) {
    const def = await this.prisma.budgetDefinition.findFirst({
      where: { entityId, id: budgetDefinitionId }
    });
    if (!def) {
      throw new BudgetServiceError("BUDGET_DEF_NOT_FOUND", "Budget definition not found.", 404);
    }

    const results = await this.prisma.$transaction(
      input.lines.map((line) =>
        this.prisma.budgetLine.upsert({
          where: {
            budgetDefinitionId_accountId_month: {
              budgetDefinitionId,
              accountId: line.accountId,
              month: line.month
            }
          },
          create: {
            budgetDefinitionId,
            accountId: line.accountId,
            month: line.month,
            amount: new Prisma.Decimal(line.amount),
            notes: line.notes
          },
          update: {
            amount: new Prisma.Decimal(line.amount),
            notes: line.notes
          }
        })
      )
    );

    return { upserted: results.length };
  }

  // ── Budget vs Actual Variance ──────────────────────────────────────────────────

  async getVarianceReport(entityId: string, query: BudgetVarianceQuery) {
    const def = await this.prisma.budgetDefinition.findFirst({
      where: { entityId, id: query.budgetDefinitionId }
    });
    if (!def) {
      throw new BudgetServiceError("BUDGET_DEF_NOT_FOUND", "Budget definition not found.", 404);
    }

    const period = await this.prisma.period.findFirst({
      where: { entityId, id: query.periodId }
    });
    if (!period) {
      throw new BudgetServiceError("BUDGET_PERIOD_NOT_FOUND", "Period not found.", 404);
    }

    type VarianceRow = {
      account_id: string;
      account_code: string;
      account_name: string;
      usali_category: string | null;
      usali_department: string | null;
      budget_amount: Prisma.Decimal;
      actual_amount: Prisma.Decimal;
      variance: Prisma.Decimal;
      variance_pct: Prisma.Decimal | null;
    };

    const rows = await this.prisma.$queryRaw<VarianceRow[]>`
      SELECT
        mv."accountId"                                              AS account_id,
        mv.account_code,
        mv.account_name,
        mv.usali_category,
        mv.usali_department,
        COALESCE(bl.amount, 0)::numeric(18,4)                      AS budget_amount,
        COALESCE(mv.closing_balance, 0)::numeric(18,4)             AS actual_amount,
        (COALESCE(mv.closing_balance, 0) - COALESCE(bl.amount, 0))::numeric(18,4) AS variance,
        CASE WHEN COALESCE(bl.amount, 0) = 0 THEN NULL
             ELSE ROUND(
               ((COALESCE(mv.closing_balance, 0) - COALESCE(bl.amount, 0)) / ABS(bl.amount)) * 100,
               4
             )
        END AS variance_pct
      FROM mv_period_account_balances mv
      LEFT JOIN budget_lines bl
        ON bl.account_id = mv."accountId"
       AND bl.budget_definition_id = ${query.budgetDefinitionId}
       AND bl.month = ${period.month}
      WHERE mv."entityId" = ${entityId}
        AND mv."periodId" = ${query.periodId}
        AND mv.is_active = true
        AND (bl.amount IS NOT NULL OR mv.closing_balance IS NOT NULL)
      ORDER BY mv.account_code ASC;
    `;

    return {
      budgetDefinitionId: def.id,
      budgetName: def.name,
      year: def.year,
      periodId: period.id,
      periodName: period.name,
      data: rows.map((row) => ({
        accountId: row.account_id,
        accountCode: row.account_code,
        accountName: row.account_name,
        usaliCategory: row.usali_category,
        usaliDepartment: row.usali_department,
        budgetAmount: row.budget_amount.toString(),
        actualAmount: row.actual_amount.toString(),
        variance: row.variance.toString(),
        variancePct: row.variance_pct?.toString() ?? null
      }))
    };
  }
}
