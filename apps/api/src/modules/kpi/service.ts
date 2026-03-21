import { Prisma, type PrismaClient } from "@prisma/client";

export class KPIServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export interface KPIRequest {
  entityId: string;
  periodId: string;
}

export interface RevPARResult {
  periodId: string;
  periodName: string;
  occupiedRooms: number;
  availableRooms: number;
  occupancyPct: number;
  adr: string; // Average Daily Rate
  revpar: string; // Revenue Per Available Room
  trevpar: string; // Total Revenue Per Available Room
  roomRevenue: string;
  totalRevenue: string;
  fbRevenue: string;
  fbCost: string;
  fbCostPct: string;
  gopAmount: string;
  gopPct: string;
  trevpac: string; // Total Revenue Per Available Customer (as a reference metric)
}

export interface BalanceSheetResult {
  periodId: string;
  asOf: string;
  assets: BalanceSheetSection[];
  liabilities: BalanceSheetSection[];
  equity: BalanceSheetSection[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  totalLiabilitiesAndEquity: string;
}

export interface BalanceSheetSection {
  name: string;
  accounts: Array<{ code: string; name: string; balance: string }>;
  total: string;
}

export interface CashFlowResult {
  periodId: string;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: string;
  openingCash: string;
  closingCash: string;
}

export interface CashFlowSection {
  label: string;
  items: Array<{ description: string; amount: string }>;
  total: string;
}

export interface USALIReport {
  periodId: string;
  departments: USALIDepartment[];
  totalRevenue: string;
  totalDepartmentalExpenses: string;
  totalDepartmentalIncome: string;
  undistributedExpenses: string;
  grossOperatingProfit: string;
  managementFees: string;
  ebitda: string;
}

export interface USALIDepartment {
  name: string;
  revenue: string;
  expenses: string;
  departmentalIncome: string;
  incomePct: string;
}

export interface USALIDepartmentComparative {
  name: string;
  // Current period
  revenue: string;
  expenses: string;
  departmentalIncome: string;
  incomePct: string;
  // YTD
  ytdRevenue: string;
  ytdExpenses: string;
  ytdDeptIncome: string;
  ytdIncomePct: string;
  // Prior year (same month, year-1)
  priorRevenue: string;
  priorExpenses: string;
  priorDeptIncome: string;
  priorIncomePct: string;
  // Budget (current month)
  budgetRevenue: string;
  budgetExpenses: string;
  budgetDeptIncome: string;
  // Variance vs budget
  varianceAmount: string;
  variancePct: string;
}

export interface USALIComparativeReport {
  periodId: string;
  periodName: string;
  year: number;
  month: number;
  hasYTD: boolean;
  hasPriorYear: boolean;
  hasBudget: boolean;
  departments: USALIDepartmentComparative[];
  // Current period totals
  totalRevenue: string;
  totalDepartmentalExpenses: string;
  totalDepartmentalIncome: string;
  undistributedExpenses: string;
  grossOperatingProfit: string;
  gopPct: string;
  managementFees: string;
  ebitda: string;
  ebitdaPct: string;
  // YTD totals
  ytdTotalRevenue: string;
  ytdGOP: string;
  ytdGOPPct: string;
  ytdEBITDA: string;
  ytdEBITDAPct: string;
  // Prior year totals
  priorTotalRevenue: string;
  priorGOP: string;
  priorGOPPct: string;
  priorEBITDA: string;
  // Budget totals
  budgetTotalRevenue: string;
  budgetGOP: string;
  budgetEBITDA: string;
  // Variances vs budget
  revenueVariance: string;
  revenueVariancePct: string;
  gopVariance: string;
  gopVariancePct: string;
  ebitdaVariance: string;
  ebitdaVariancePct: string;
}

export class KPIService {
  constructor(private readonly prisma: PrismaClient) {}

  async getRevPAR(req: KPIRequest): Promise<RevPARResult> {
    const period = await this.prisma.period.findFirst({
      where: { id: req.periodId, entityId: req.entityId }
    });
    if (!period) {
      throw new KPIServiceError("KPI_PERIOD_NOT_FOUND", "Period not found.", 404);
    }

    // PMS statistics for this period — sum daily stats within the period month
    const periodStart = new Date(period.year, period.month - 1, 1);
    const periodEnd = new Date(period.year, period.month, 1);
    const stats = await this.prisma.pMSStatistic.findMany({
      where: { entityId: req.entityId, statDate: { gte: periodStart, lt: periodEnd } }
    });

    const occupiedRooms = stats.reduce((sum, s) => sum + s.occupiedRooms, 0);
    const availableRoomsRaw = stats.reduce((sum, s) => sum + s.availableRooms, 0);
    // Default to 100 available rooms if no PMS data loaded yet
    const availableRooms = availableRoomsRaw > 0 ? availableRoomsRaw : 100;

    // Account balances with USALI classification from account master
    type BalanceRow = {
      code: string;
      closing_balance: Prisma.Decimal;
      account_type: string;
      usali_department: string | null;
    };
    const balances = await this.prisma.$queryRaw<BalanceRow[]>`
      SELECT a.code, apb.closing_balance, a.type as account_type, a.usali_department
      FROM account_period_balances apb
      JOIN accounts a ON a.id = apb.account_id
      WHERE apb.entity_id = ${req.entityId}
        AND apb.period_id = ${req.periodId}
    `;

    // Classify by account type + usali_department, with code-prefix fallback
    let roomRevenue = new Prisma.Decimal(0);
    let fbRevenue = new Prisma.Decimal(0);
    let otherRevenue = new Prisma.Decimal(0);
    let fbCost = new Prisma.Decimal(0);
    let operatingExpenses = new Prisma.Decimal(0);

    for (const b of balances) {
      const bal = b.closing_balance.abs();

      // Use usali_department if available
      const dept = b.usali_department ? normalizeDepartmentName(b.usali_department) : null;

      if (b.account_type === "REVENUE") {
        if (dept === "Rooms" || (!dept && (b.code.startsWith("301") || b.code.startsWith("300")))) {
          roomRevenue = roomRevenue.add(bal);
        } else if (
          dept === "Food & Beverage" ||
          (!dept && (b.code.startsWith("31") || b.code.startsWith("32") || b.code.startsWith("33")))
        ) {
          fbRevenue = fbRevenue.add(bal);
        } else {
          otherRevenue = otherRevenue.add(bal);
        }
      } else if (b.account_type === "EXPENSE") {
        if (
          dept === "Food & Beverage" ||
          (!dept && (b.code.startsWith("42") || b.code.startsWith("43")))
        ) {
          fbCost = fbCost.add(bal);
        } else {
          operatingExpenses = operatingExpenses.add(bal);
        }
      }
    }

    const totalRevenue = roomRevenue.add(fbRevenue).add(otherRevenue);
    const gop = totalRevenue.sub(fbCost).sub(operatingExpenses);

    const occupied = new Prisma.Decimal(occupiedRooms);
    const available = new Prisma.Decimal(availableRooms);
    const occupancyPct = available.isZero()
      ? new Prisma.Decimal(0)
      : occupied.div(available).mul(100);

    const adr = occupied.isZero() ? new Prisma.Decimal(0) : roomRevenue.div(occupied);
    const revpar = available.isZero() ? new Prisma.Decimal(0) : roomRevenue.div(available);
    const trevpar = available.isZero() ? new Prisma.Decimal(0) : totalRevenue.div(available);

    const fbCostPct = fbRevenue.isZero() ? new Prisma.Decimal(0) : fbCost.div(fbRevenue).mul(100);

    const gopPct = totalRevenue.isZero() ? new Prisma.Decimal(0) : gop.div(totalRevenue).mul(100);

    return {
      periodId: req.periodId,
      periodName: period.name,
      occupiedRooms: occupied.toNumber(),
      availableRooms: available.toNumber(),
      occupancyPct: occupancyPct.toDecimalPlaces(2).toNumber(),
      adr: adr.toFixed(2),
      revpar: revpar.toFixed(2),
      trevpar: trevpar.toFixed(2),
      roomRevenue: roomRevenue.toFixed(2),
      totalRevenue: totalRevenue.toFixed(2),
      fbRevenue: fbRevenue.toFixed(2),
      fbCost: fbCost.toFixed(2),
      fbCostPct: fbCostPct.toFixed(2),
      gopAmount: gop.toFixed(2),
      gopPct: gopPct.toFixed(2),
      trevpac: trevpar.toFixed(2)
    };
  }

  async getBalanceSheet(req: KPIRequest): Promise<BalanceSheetResult> {
    const period = await this.prisma.period.findFirst({
      where: { id: req.periodId, entityId: req.entityId },
      include: { entity: { select: { functionalCurrency: true } } }
    });
    if (!period) {
      throw new KPIServiceError("KPI_PERIOD_NOT_FOUND", "Period not found.", 404);
    }

    type BSRow = {
      id: string;
      code: string;
      name: string;
      account_type: string;
      closing_balance: Prisma.Decimal;
    };
    const rows = await this.prisma.$queryRaw<BSRow[]>`
      SELECT a.id, a.code, a.name, a.type as account_type, apb.closing_balance
      FROM account_period_balances apb
      JOIN accounts a ON a.id = apb.account_id
      WHERE apb.entity_id = ${req.entityId}
        AND apb.period_id = ${req.periodId}
        AND a.type IN ('ASSET', 'LIABILITY', 'EQUITY')
      ORDER BY a.code
    `;

    const groupBy = (type: string): BalanceSheetSection[] => {
      const accounts = rows.filter((r) => r.account_type === type);
      if (accounts.length === 0) return [];

      // Group by first 2 digits of code for sub-sections
      const groups = new Map<string, typeof accounts>();
      for (const acct of accounts) {
        const prefix = acct.code.slice(0, 2);
        const label = getSectionLabel(type, prefix);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label)!.push(acct);
      }

      return Array.from(groups.entries()).map(([sectionName, accts]) => ({
        name: sectionName,
        accounts: accts.map((a) => ({
          code: a.code,
          name: a.name,
          balance: a.closing_balance.toFixed(2)
        })),
        total: accts.reduce((s, a) => s.add(a.closing_balance), new Prisma.Decimal(0)).toFixed(2)
      }));
    };

    const assetSections = groupBy("ASSET");
    const liabilitySections = groupBy("LIABILITY");
    const equitySections = groupBy("EQUITY");

    const sumSections = (sections: BalanceSheetSection[]) =>
      sections
        .flatMap((s) => s.accounts)
        .reduce((sum, a) => sum.add(new Prisma.Decimal(a.balance)), new Prisma.Decimal(0));

    const totalAssets = sumSections(assetSections);
    const totalLiabilities = sumSections(liabilitySections);
    const totalEquity = sumSections(equitySections);

    return {
      periodId: req.periodId,
      asOf: `${period.year}-${String(period.month).padStart(2, "0")}-01`,
      assets: assetSections,
      liabilities: liabilitySections,
      equity: equitySections,
      totalAssets: totalAssets.toFixed(2),
      totalLiabilities: totalLiabilities.toFixed(2),
      totalEquity: totalEquity.toFixed(2),
      totalLiabilitiesAndEquity: totalLiabilities.add(totalEquity).toFixed(2)
    };
  }

  async getCashFlow(req: KPIRequest): Promise<CashFlowResult> {
    const period = await this.prisma.period.findFirst({
      where: { id: req.periodId, entityId: req.entityId }
    });
    if (!period) {
      throw new KPIServiceError("KPI_PERIOD_NOT_FOUND", "Period not found.", 404);
    }

    // Indirect method: start with net income, add back non-cash items
    type CFRow = {
      code: string;
      name: string;
      account_type: string;
      period_debits: Prisma.Decimal;
      period_credits: Prisma.Decimal;
      closing_balance: Prisma.Decimal;
    };
    const rows = await this.prisma.$queryRaw<CFRow[]>`
      SELECT a.code, a.name, a.type as account_type,
             apb.period_debits, apb.period_credits, apb.closing_balance
      FROM account_period_balances apb
      JOIN accounts a ON a.id = apb.account_id
      WHERE apb.entity_id = ${req.entityId}
        AND apb.period_id = ${req.periodId}
      ORDER BY a.code
    `;

    const netIncome = rows
      .filter((r) => ["REVENUE", "EXPENSE"].includes(r.account_type))
      .reduce((sum, r) => {
        const net =
          r.account_type === "REVENUE"
            ? r.period_credits.sub(r.period_debits)
            : r.period_debits.sub(r.period_credits);
        return sum.add(net);
      }, new Prisma.Decimal(0));

    // Changes in working capital (AR, AP, Inventory)
    const arChange = rows
      .filter((r) => r.code.startsWith("12"))
      .reduce((s, r) => s.add(r.period_debits.sub(r.period_credits)), new Prisma.Decimal(0));

    const apChange = rows
      .filter((r) => r.code.startsWith("20"))
      .reduce((s, r) => s.add(r.period_credits.sub(r.period_debits)), new Prisma.Decimal(0));

    const inventoryChange = rows
      .filter((r) => r.code.startsWith("13"))
      .reduce((s, r) => s.add(r.period_debits.sub(r.period_credits)).neg(), new Prisma.Decimal(0));

    const operatingTotal = netIncome.add(apChange).sub(arChange).add(inventoryChange);

    // Investing: changes in fixed assets (1500-1999 range)
    const capexChange = rows
      .filter((r) => {
        const code = parseInt(r.code);
        return code >= 1500 && code < 2000 && r.account_type === "ASSET";
      })
      .reduce((s, r) => s.add(r.period_debits.sub(r.period_credits)).neg(), new Prisma.Decimal(0));

    // Financing: changes in long-term debt and equity contributions
    const debtChange = rows
      .filter((r) => r.code.startsWith("25") || r.code.startsWith("26"))
      .reduce((s, r) => s.add(r.period_credits.sub(r.period_debits)), new Prisma.Decimal(0));

    const equityChange = rows
      .filter((r) => r.code.startsWith("30") || r.code.startsWith("31"))
      .reduce((s, r) => s.add(r.period_credits.sub(r.period_debits)), new Prisma.Decimal(0));

    const financingTotal = debtChange.add(equityChange);

    // Opening cash (code 1000)
    const cashAccount = rows.find((r) => r.code === "1000");
    const closingCash = cashAccount ? cashAccount.closing_balance : new Prisma.Decimal(0);
    const netChange = operatingTotal.add(capexChange).add(financingTotal);
    const openingCash = closingCash.sub(netChange);

    return {
      periodId: req.periodId,
      operating: {
        label: "Operating Activities",
        items: [
          { description: "Net Income", amount: netIncome.toFixed(2) },
          { description: "Changes in Accounts Receivable", amount: arChange.neg().toFixed(2) },
          { description: "Changes in Accounts Payable", amount: apChange.toFixed(2) },
          { description: "Changes in Inventory", amount: inventoryChange.toFixed(2) }
        ],
        total: operatingTotal.toFixed(2)
      },
      investing: {
        label: "Investing Activities",
        items: [{ description: "Capital Expenditures", amount: capexChange.toFixed(2) }],
        total: capexChange.toFixed(2)
      },
      financing: {
        label: "Financing Activities",
        items: [
          { description: "Net Borrowings", amount: debtChange.toFixed(2) },
          { description: "Equity Transactions", amount: equityChange.toFixed(2) }
        ],
        total: financingTotal.toFixed(2)
      },
      netChange: netChange.toFixed(2),
      openingCash: openingCash.toFixed(2),
      closingCash: closingCash.toFixed(2)
    };
  }

  async getUSALI(req: KPIRequest): Promise<USALIReport> {
    const period = await this.prisma.period.findFirst({
      where: { id: req.periodId, entityId: req.entityId }
    });
    if (!period) {
      throw new KPIServiceError("KPI_PERIOD_NOT_FOUND", "Period not found.", 404);
    }

    type USALIRow = {
      code: string;
      name: string;
      period_debits: Prisma.Decimal;
      period_credits: Prisma.Decimal;
      account_type: string;
      usali_category: string | null;
      usali_department: string | null;
    };
    const rows = await this.prisma.$queryRaw<USALIRow[]>`
      SELECT a.code, a.name, apb.period_debits, apb.period_credits,
             a.type as account_type, a.usali_category, a.usali_department
      FROM account_period_balances apb
      JOIN accounts a ON a.id = apb.account_id
      WHERE apb.entity_id = ${req.entityId}
        AND apb.period_id = ${req.periodId}
      ORDER BY a.code
    `;

    const deptRevenue = new Map<string, Prisma.Decimal>();
    const deptExpense = new Map<string, Prisma.Decimal>();

    for (const row of rows) {
      // Primary strategy: use usali_department from account master data
      // Fallback: use legacy code-prefix mapping
      let mapped: { dept: string; type: "revenue" | "expense" } | null = null;

      if (row.usali_department && row.account_type) {
        const dept = normalizeDepartmentName(row.usali_department);
        if (dept) {
          mapped = {
            dept,
            type: row.account_type === "REVENUE" ? "revenue" : "expense"
          };
        }
      }

      // Fallback to code-prefix mapping for accounts without usali_department
      if (!mapped) {
        mapped = mapAccountToDepartment(row.code);
      }

      if (!mapped) continue;

      const amount =
        mapped.type === "revenue"
          ? row.period_credits.sub(row.period_debits)
          : row.period_debits.sub(row.period_credits);

      if (mapped.type === "revenue") {
        deptRevenue.set(
          mapped.dept,
          (deptRevenue.get(mapped.dept) ?? new Prisma.Decimal(0)).add(amount)
        );
      } else {
        deptExpense.set(
          mapped.dept,
          (deptExpense.get(mapped.dept) ?? new Prisma.Decimal(0)).add(amount)
        );
      }
    }

    // Build operated departments (revenue-generating)
    const operatedDepts = [
      "Rooms",
      "Food & Beverage",
      "Other Operated Departments",
      "Rentals & Other Income"
    ];
    const undistDepts = [
      "Administrative & General",
      "Information & Telecommunications",
      "Sales & Marketing",
      "Property Operations & Maintenance",
      "Utilities",
      "Payroll & Related"
    ];

    const departments: USALIDepartment[] = operatedDepts.map((name) => {
      const rev = deptRevenue.get(name) ?? new Prisma.Decimal(0);
      const exp = deptExpense.get(name) ?? new Prisma.Decimal(0);
      const income = rev.sub(exp);
      const incomePct = rev.isZero() ? new Prisma.Decimal(0) : income.div(rev).mul(100);
      return {
        name,
        revenue: rev.toFixed(2),
        expenses: exp.toFixed(2),
        departmentalIncome: income.toFixed(2),
        incomePct: incomePct.toFixed(2)
      };
    });

    const totalRevenue = operatedDepts.reduce(
      (s, name) => s.add(deptRevenue.get(name) ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0)
    );
    const totalDeptExpenses = operatedDepts.reduce(
      (s, name) => s.add(deptExpense.get(name) ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0)
    );
    const totalDeptIncome = totalRevenue.sub(totalDeptExpenses);

    const undistExpenses = undistDepts.reduce(
      (s, name) => s.add(deptExpense.get(name) ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0)
    );

    const gop = totalDeptIncome.sub(undistExpenses);

    // Management fees — no specific code in this COA; placeholder
    const mgmtFees = new Prisma.Decimal(0);

    const ebitda = gop.sub(mgmtFees);

    return {
      periodId: req.periodId,
      departments,
      totalRevenue: totalRevenue.toFixed(2),
      totalDepartmentalExpenses: totalDeptExpenses.toFixed(2),
      totalDepartmentalIncome: totalDeptIncome.toFixed(2),
      undistributedExpenses: undistExpenses.toFixed(2),
      grossOperatingProfit: gop.toFixed(2),
      managementFees: mgmtFees.toFixed(2),
      ebitda: ebitda.toFixed(2)
    };
  }

  // ── Private helper: compute USALI aggregates from raw rows ────────────────

  private computeUSALIData(
    rows: Array<{
      code: string;
      period_debits: Prisma.Decimal;
      period_credits: Prisma.Decimal;
      account_type: string;
    }>
  ) {
    const deptRevenue = new Map<string, Prisma.Decimal>();
    const deptExpense = new Map<string, Prisma.Decimal>();

    for (const row of rows) {
      const mapped = mapAccountToDepartment(row.code);
      if (!mapped) continue;
      const amount =
        mapped.type === "revenue"
          ? row.period_credits.sub(row.period_debits)
          : row.period_debits.sub(row.period_credits);
      if (mapped.type === "revenue") {
        deptRevenue.set(
          mapped.dept,
          (deptRevenue.get(mapped.dept) ?? new Prisma.Decimal(0)).add(amount)
        );
      } else {
        deptExpense.set(
          mapped.dept,
          (deptExpense.get(mapped.dept) ?? new Prisma.Decimal(0)).add(amount)
        );
      }
    }

    const operatedDepts = [
      "Rooms",
      "Food & Beverage",
      "Other Operated Departments",
      "Rentals & Other Income"
    ];
    const undistDepts = [
      "Administrative & General",
      "Information & Telecommunications",
      "Sales & Marketing",
      "Property Operations & Maintenance",
      "Utilities",
      "Payroll & Related"
    ];

    const totalRevenue = operatedDepts.reduce(
      (s, n) => s.add(deptRevenue.get(n) ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0)
    );
    const totalDeptExpenses = operatedDepts.reduce(
      (s, n) => s.add(deptExpense.get(n) ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0)
    );
    const totalDeptIncome = totalRevenue.sub(totalDeptExpenses);
    const undistExpenses = undistDepts.reduce(
      (s, n) => s.add(deptExpense.get(n) ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0)
    );
    const gop = totalDeptIncome.sub(undistExpenses);
    const gopPct = totalRevenue.isZero() ? new Prisma.Decimal(0) : gop.div(totalRevenue).mul(100);
    const mgmtFees = new Prisma.Decimal(0);
    const ebitda = gop.sub(mgmtFees);
    const ebitdaPct = totalRevenue.isZero()
      ? new Prisma.Decimal(0)
      : ebitda.div(totalRevenue).mul(100);

    return {
      deptRevenue,
      deptExpense,
      totalRevenue,
      totalDeptExpenses,
      totalDeptIncome,
      undistExpenses,
      gop,
      gopPct,
      mgmtFees,
      ebitda,
      ebitdaPct
    };
  }

  // ── Comparative USALI (Current / YTD / Prior Year / Budget) ───────────────

  async getUSALIComparative(req: KPIRequest): Promise<USALIComparativeReport> {
    const period = await this.prisma.period.findFirst({
      where: { id: req.periodId, entityId: req.entityId }
    });
    if (!period) throw new KPIServiceError("KPI_PERIOD_NOT_FOUND", "Period not found.", 404);

    // YTD period IDs: same entity+year, months 1..current
    const ytdPeriods = await this.prisma.period.findMany({
      where: { entityId: req.entityId, year: period.year, month: { lte: period.month } },
      select: { id: true }
    });
    const ytdPeriodIds = ytdPeriods.map((p) => p.id);

    // Prior year: same month, year-1
    const priorPeriod = await this.prisma.period.findFirst({
      where: { entityId: req.entityId, year: period.year - 1, month: period.month }
    });

    // Active budget definition for this year
    const budgetDef = await this.prisma.budgetDefinition.findFirst({
      where: { entityId: req.entityId, year: period.year, isActive: true }
    });

    type USALIRow = {
      code: string;
      name: string;
      period_debits: Prisma.Decimal;
      period_credits: Prisma.Decimal;
      account_type: string;
    };

    // Current period
    const currentRows = await this.prisma.$queryRaw<USALIRow[]>`
      SELECT a.code, a.name, apb.period_debits, apb.period_credits, a.type as account_type
      FROM account_period_balances apb
      JOIN accounts a ON a.id = apb.account_id
      WHERE apb.entity_id = ${req.entityId}
        AND apb.period_id = ${req.periodId}
      ORDER BY a.code
    `;

    // YTD (aggregate across periods)
    const ytdRows: USALIRow[] =
      ytdPeriodIds.length > 0
        ? await this.prisma.$queryRaw<USALIRow[]>(
            Prisma.sql`
            SELECT a.code, a.name,
                   SUM(apb.period_debits)  AS period_debits,
                   SUM(apb.period_credits) AS period_credits,
                   a.type AS account_type
            FROM account_period_balances apb
            JOIN accounts a ON a.id = apb.account_id
            WHERE apb.entity_id = ${req.entityId}
              AND apb.period_id IN (${Prisma.join(ytdPeriodIds)})
            GROUP BY a.code, a.name, a.type
            ORDER BY a.code
          `
          )
        : [];

    // Prior year
    const priorRows: USALIRow[] = priorPeriod
      ? await this.prisma.$queryRaw<USALIRow[]>`
          SELECT a.code, a.name, apb.period_debits, apb.period_credits, a.type as account_type
          FROM account_period_balances apb
          JOIN accounts a ON a.id = apb.account_id
          WHERE apb.entity_id = ${req.entityId}
            AND apb.period_id = ${priorPeriod.id}
          ORDER BY a.code
        `
      : [];

    // Budget for this month → convert to USALIRow-compatible shape
    type BudgetRaw = {
      code: string;
      name: string;
      account_type: string;
      budget_amount: Prisma.Decimal;
    };
    const rawBudgetRows: BudgetRaw[] = budgetDef
      ? await this.prisma.$queryRaw<BudgetRaw[]>(
          Prisma.sql`
            SELECT a.code, a.name, a.type AS account_type, SUM(bl.amount) AS budget_amount
            FROM budget_lines bl
            JOIN accounts a ON a.id = bl.account_id
            WHERE bl.budget_definition_id = ${budgetDef.id}
              AND bl.month = ${period.month}
            GROUP BY a.code, a.name, a.type
            ORDER BY a.code
          `
        )
      : [];

    const budgetRows: USALIRow[] = rawBudgetRows.map((r) => ({
      code: r.code,
      name: r.name,
      account_type: r.account_type,
      period_debits: r.account_type === "EXPENSE" ? r.budget_amount : new Prisma.Decimal(0),
      period_credits: r.account_type === "REVENUE" ? r.budget_amount : new Prisma.Decimal(0)
    }));

    const current = this.computeUSALIData(currentRows);
    const ytd = this.computeUSALIData(ytdRows);
    const prior = this.computeUSALIData(priorRows);
    const budget = this.computeUSALIData(budgetRows);

    const operatedDepts = [
      "Rooms",
      "Food & Beverage",
      "Other Operated Departments",
      "Rentals & Other Income"
    ];

    const departments: USALIDepartmentComparative[] = operatedDepts.map((name) => {
      const rev = current.deptRevenue.get(name) ?? new Prisma.Decimal(0);
      const exp = current.deptExpense.get(name) ?? new Prisma.Decimal(0);
      const inc = rev.sub(exp);
      const pct = rev.isZero() ? new Prisma.Decimal(0) : inc.div(rev).mul(100);

      const yRev = ytd.deptRevenue.get(name) ?? new Prisma.Decimal(0);
      const yExp = ytd.deptExpense.get(name) ?? new Prisma.Decimal(0);
      const yInc = yRev.sub(yExp);
      const yPct = yRev.isZero() ? new Prisma.Decimal(0) : yInc.div(yRev).mul(100);

      const pRev = prior.deptRevenue.get(name) ?? new Prisma.Decimal(0);
      const pExp = prior.deptExpense.get(name) ?? new Prisma.Decimal(0);
      const pInc = pRev.sub(pExp);
      const pPct = pRev.isZero() ? new Prisma.Decimal(0) : pInc.div(pRev).mul(100);

      const bRev = budget.deptRevenue.get(name) ?? new Prisma.Decimal(0);
      const bExp = budget.deptExpense.get(name) ?? new Prisma.Decimal(0);
      const bInc = bRev.sub(bExp);
      const varAmt = inc.sub(bInc);
      const varPct = bInc.isZero() ? new Prisma.Decimal(0) : varAmt.div(bInc.abs()).mul(100);

      return {
        name,
        revenue: rev.toFixed(2),
        expenses: exp.toFixed(2),
        departmentalIncome: inc.toFixed(2),
        incomePct: pct.toFixed(2),
        ytdRevenue: yRev.toFixed(2),
        ytdExpenses: yExp.toFixed(2),
        ytdDeptIncome: yInc.toFixed(2),
        ytdIncomePct: yPct.toFixed(2),
        priorRevenue: pRev.toFixed(2),
        priorExpenses: pExp.toFixed(2),
        priorDeptIncome: pInc.toFixed(2),
        priorIncomePct: pPct.toFixed(2),
        budgetRevenue: bRev.toFixed(2),
        budgetExpenses: bExp.toFixed(2),
        budgetDeptIncome: bInc.toFixed(2),
        varianceAmount: varAmt.toFixed(2),
        variancePct: varPct.toFixed(2)
      };
    });

    const varFn = (actual: Prisma.Decimal, bud: Prisma.Decimal) => ({
      amt: actual.sub(bud).toFixed(2),
      pct: bud.isZero() ? "0.00" : actual.sub(bud).div(bud.abs()).mul(100).toFixed(2)
    });

    const revVar = varFn(current.totalRevenue, budget.totalRevenue);
    const gopVar = varFn(current.gop, budget.gop);
    const ebitdaVar = varFn(current.ebitda, budget.ebitda);

    return {
      periodId: req.periodId,
      periodName: period.name,
      year: period.year,
      month: period.month,
      hasYTD: ytdPeriods.length > 1,
      hasPriorYear: priorPeriod !== null,
      hasBudget: budgetDef !== null,
      departments,
      // Current
      totalRevenue: current.totalRevenue.toFixed(2),
      totalDepartmentalExpenses: current.totalDeptExpenses.toFixed(2),
      totalDepartmentalIncome: current.totalDeptIncome.toFixed(2),
      undistributedExpenses: current.undistExpenses.toFixed(2),
      grossOperatingProfit: current.gop.toFixed(2),
      gopPct: current.gopPct.toFixed(2),
      managementFees: current.mgmtFees.toFixed(2),
      ebitda: current.ebitda.toFixed(2),
      ebitdaPct: current.ebitdaPct.toFixed(2),
      // YTD
      ytdTotalRevenue: ytd.totalRevenue.toFixed(2),
      ytdGOP: ytd.gop.toFixed(2),
      ytdGOPPct: ytd.gopPct.toFixed(2),
      ytdEBITDA: ytd.ebitda.toFixed(2),
      ytdEBITDAPct: ytd.ebitdaPct.toFixed(2),
      // Prior year
      priorTotalRevenue: prior.totalRevenue.toFixed(2),
      priorGOP: prior.gop.toFixed(2),
      priorGOPPct: prior.gopPct.toFixed(2),
      priorEBITDA: prior.ebitda.toFixed(2),
      // Budget
      budgetTotalRevenue: budget.totalRevenue.toFixed(2),
      budgetGOP: budget.gop.toFixed(2),
      budgetEBITDA: budget.ebitda.toFixed(2),
      // Variances
      revenueVariance: revVar.amt,
      revenueVariancePct: revVar.pct,
      gopVariance: gopVar.amt,
      gopVariancePct: gopVar.pct,
      ebitdaVariance: ebitdaVar.amt,
      ebitdaVariancePct: ebitdaVar.pct
    };
  }

  // ── Currency exposure: AR + AP outstanding grouped by currency ───────────

  async getCurrencyExposure(entityId: string) {
    type ARRow = { currency: string; outstanding: Prisma.Decimal };
    const arRows = await this.prisma.$queryRaw<ARRow[]>`
      SELECT currency, SUM(amount - amount_paid) AS outstanding
      FROM ar_invoices
      WHERE entity_id = ${entityId}
        AND status IN ('POSTED', 'OVERDUE')
      GROUP BY currency
    `;

    type APRow = { currency: string; outstanding: Prisma.Decimal };
    const apRows = await this.prisma.$queryRaw<APRow[]>`
      SELECT currency, SUM(gross_amount) AS outstanding
      FROM ap_invoices
      WHERE entity_id = ${entityId}
        AND status IN ('APPROVED', 'POSTED')
      GROUP BY currency
    `;

    const currencies = new Set([
      ...arRows.map((r) => r.currency),
      ...apRows.map((r) => r.currency)
    ]);
    return Array.from(currencies).map((currency) => {
      const ar = arRows.find((r) => r.currency === currency)?.outstanding ?? new Prisma.Decimal(0);
      const ap = apRows.find((r) => r.currency === currency)?.outstanding ?? new Prisma.Decimal(0);
      return {
        currency,
        arOutstanding: ar.toFixed(2),
        apOutstanding: ap.toFixed(2),
        netExposure: ar.sub(ap).toFixed(2)
      };
    });
  }

  // ── Entity summary for portfolio table (finds period by year+month) ────────

  async getEntitySummary(entityId: string, year: number, month: number) {
    const period = await this.prisma.period.findFirst({
      where: { entityId, year, month },
      include: { entity: { select: { name: true, functionalCurrency: true } } }
    });
    if (!period) return null;

    const req = { entityId, periodId: period.id };
    const [revpar, usali] = await Promise.all([
      this.getRevPAR(req).catch(() => null),
      this.getUSALI(req).catch(() => null)
    ]);

    return {
      entityId,
      entityName: period.entity.name,
      periodId: period.id,
      periodName: period.name,
      currency: period.entity.functionalCurrency,
      occupancyPct: revpar?.occupancyPct.toString() ?? "0",
      revpar: revpar?.revpar ?? "0",
      adr: revpar?.adr ?? "0",
      totalRevenue: usali?.totalRevenue ?? "0",
      grossOperatingProfit: usali?.grossOperatingProfit ?? "0",
      gopPct: revpar?.gopPct ?? "0",
      ebitda: usali?.ebitda ?? "0"
    };
  }

  async getRevPARTrend(
    req: KPIRequest
  ): Promise<Array<{ date: string; revpar: string; adr: string; occupancyPct: string }>> {
    const period = await this.prisma.period.findFirst({
      where: { id: req.periodId, entityId: req.entityId }
    });
    if (!period) throw new KPIServiceError("KPI_PERIOD_NOT_FOUND", "Period not found.", 404);

    const periodStart = new Date(period.year, period.month - 1, 1);
    const periodEnd = new Date(period.year, period.month, 1);

    const stats = await this.prisma.pMSStatistic.findMany({
      where: { entityId: req.entityId, statDate: { gte: periodStart, lt: periodEnd } },
      orderBy: { statDate: "asc" }
    });

    if (stats.length === 0) return [];

    // Get total room revenue for the period, distribute evenly across days
    type RevenueRow = { closing_balance: Prisma.Decimal };
    const revRows = await this.prisma.$queryRaw<RevenueRow[]>`
      SELECT apb.closing_balance
      FROM account_period_balances apb
      JOIN accounts a ON a.id = apb.account_id
      WHERE apb.entity_id = ${req.entityId}
        AND apb.period_id = ${req.periodId}
        AND (a.code LIKE '301%' OR a.code LIKE '300%')
    `;

    const totalRoomRevenue = revRows
      .reduce((s, r) => s.add(r.closing_balance), new Prisma.Decimal(0))
      .abs();

    const daysWithData = new Prisma.Decimal(stats.length);
    const dailyRevenue = daysWithData.isZero()
      ? new Prisma.Decimal(0)
      : totalRoomRevenue.div(daysWithData);

    return stats.map((s) => {
      const available = new Prisma.Decimal(s.availableRooms);
      const occupied = new Prisma.Decimal(s.occupiedRooms);
      const revpar = available.isZero() ? new Prisma.Decimal(0) : dailyRevenue.div(available);
      const adr = occupied.isZero() ? new Prisma.Decimal(0) : dailyRevenue.div(occupied);
      const occupancyPct = available.isZero()
        ? new Prisma.Decimal(0)
        : occupied.div(available).mul(100);
      return {
        date: s.statDate.toISOString().split("T")[0],
        revpar: revpar.toFixed(2),
        adr: adr.toFixed(2),
        occupancyPct: occupancyPct.toFixed(1)
      };
    });
  }

  async getKPIDashboard(entityId: string, periodId: string) {
    const [revpar, balanceSheet, usali] = await Promise.all([
      this.getRevPAR({ entityId, periodId }),
      this.getBalanceSheet({ entityId, periodId }),
      this.getUSALI({ entityId, periodId })
    ]);
    return { revpar, balanceSheet, usali };
  }
}

/**
 * Maps an account code to its USALI department based on the actual COA structure.
 * Revenue: 30xxx–36xxx, Expenses: 42xxx–68xxx, Payroll: 51xxx/55xxx
 */
/** Normalize various usali_department values from the account master to standard USALI department names */
function normalizeDepartmentName(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  if (lower.includes("room")) return "Rooms";
  if (lower.includes("food") || lower.includes("beverage") || lower === "f&b" || lower === "fb")
    return "Food & Beverage";
  if (lower.includes("spa") || lower.includes("boutique") || lower.includes("other operated"))
    return "Other Operated Departments";
  if (lower.includes("rental") || lower.includes("other income")) return "Rentals & Other Income";
  if (lower.includes("admin") || lower.includes("general")) return "Administrative & General";
  if (lower.includes("telecom") || lower.includes("information") || lower.includes("it"))
    return "Information & Telecommunications";
  if (lower.includes("sales") || lower.includes("marketing")) return "Sales & Marketing";
  if (lower.includes("maintenance") || lower.includes("property op"))
    return "Property Operations & Maintenance";
  if (lower.includes("utilit")) return "Utilities";
  if (lower.includes("payroll") || lower.includes("labour") || lower.includes("labor"))
    return "Payroll & Related";
  return null;
}

function mapAccountToDepartment(
  code: string
): { dept: string; type: "revenue" | "expense" } | null {
  // Revenue accounts (30xxx–36xxx)
  if (code.startsWith("301") || code.startsWith("300")) return { dept: "Rooms", type: "revenue" };
  if (code.startsWith("31") || code.startsWith("32") || code.startsWith("33"))
    return { dept: "Food & Beverage", type: "revenue" };
  if (code.startsWith("34") || code.startsWith("35") || code.startsWith("36"))
    return { dept: "Other Operated Departments", type: "revenue" };
  if (code === "76100" || code === "76150")
    return { dept: "Rentals & Other Income", type: "revenue" };

  // Cost of Sales (42xxx–46xxx)
  if (code.startsWith("42") || code.startsWith("43"))
    return { dept: "Food & Beverage", type: "expense" };
  if (code.startsWith("44") || code.startsWith("45") || code.startsWith("46"))
    return { dept: "Other Operated Departments", type: "expense" };

  // Departmental direct expenses
  if (code.startsWith("61")) return { dept: "Rooms", type: "expense" };
  if (code.startsWith("62")) return { dept: "Food & Beverage", type: "expense" };
  if (code.startsWith("63")) return { dept: "Other Operated Departments", type: "expense" };

  // Undistributed operating expenses (check longer prefixes first)
  if (code.startsWith("640")) return { dept: "Administrative & General", type: "expense" };
  if (code.startsWith("650") || code.startsWith("651"))
    return { dept: "Information & Telecommunications", type: "expense" };
  if (code.startsWith("66")) return { dept: "Sales & Marketing", type: "expense" };
  if (code.startsWith("67")) return { dept: "Property Operations & Maintenance", type: "expense" };
  if (code.startsWith("68")) return { dept: "Utilities", type: "expense" };

  // Payroll & common accounts
  if (code.startsWith("51") || code.startsWith("55"))
    return { dept: "Payroll & Related", type: "expense" };
  if (code.startsWith("60")) return { dept: "Administrative & General", type: "expense" };

  return null;
}

function getSectionLabel(accountType: string, prefix: string): string {
  const map: Record<string, Record<string, string>> = {
    ASSET: {
      "10": "Cash & Cash Equivalents",
      "11": "Cash & Cash Equivalents",
      "12": "Accounts Receivable",
      "13": "Inventories",
      "14": "Prepaid Expenses",
      "15": "Property, Plant & Equipment",
      "16": "Accumulated Depreciation",
      "17": "Intangible Assets",
      "18": "Other Assets",
      "19": "Other Assets"
    },
    LIABILITY: {
      "20": "Accounts Payable",
      "21": "Accrued Liabilities",
      "22": "Deferred Revenue",
      "23": "Short-Term Debt",
      "24": "Current Portion of Long-Term Debt",
      "25": "Long-Term Debt",
      "26": "Other Long-Term Liabilities"
    },
    EQUITY: {
      "30": "Share Capital",
      "31": "Additional Paid-In Capital",
      "32": "Retained Earnings",
      "33": "Other Comprehensive Income"
    }
  };
  return map[accountType]?.[prefix] ?? `${accountType} - ${prefix}xx`;
}
