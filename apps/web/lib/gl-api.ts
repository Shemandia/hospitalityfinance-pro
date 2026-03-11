const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type Envelope<T> = {
  data: T;
  errors?: Array<{ code: string; message: string }>;
  meta?: Record<string, unknown>;
};

export type ApiContext = {
  accessToken: string;
  entityId: string;
};

// ── Core domain types ────────────────────────────────────────────────────────

export type JournalSummary = {
  id: string;
  reference: string;
  description: string;
  status: string;
  source: string;
  periodId: string;
  functionalCurrency: string;
  createdAt: string;
  _count: { lines: number; approvals: number };
};

export type JournalLine = {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
  currency: string;
  fxRate: string;
  debitFunctional: string;
  creditFunctional: string;
  description: string;
  lineNumber: number;
  account: { code: string; name: string; type: string };
};

export type JournalDetail = {
  id: string;
  reference: string;
  description: string;
  status: string;
  source: string;
  periodId: string;
  functionalCurrency: string;
  createdAt: string;
  postedAt: string | null;
  lines: JournalLine[];
  period: { id: string; name: string; status: string };
  approvals: Array<{
    id: string;
    status: string;
    approver: { id: string; name: string; email: string };
    reason?: string | null;
  }>;
};

export type GLAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  subType: string | null;
  level: number;
  parentId: string | null;
  isActive: boolean;
  currency: string;
};

export type AuditEvent = {
  id: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  userId: string | null;
  createdAt: string;
  beforeState: unknown;
  afterState: unknown;
};

async function request<T>(
  context: ApiContext,
  path: string,
  init?: RequestInit
): Promise<Envelope<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${context.accessToken}`,
      "X-Entity-ID": context.entityId,
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok) {
    const message = payload.errors?.[0]?.message ?? `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

export async function getGLJournals(
  context: ApiContext,
  params: { status?: string; periodId?: string; limit?: number; search?: string } = {}
) {
  const search = new URLSearchParams();
  if (params.status) {
    search.set("status", params.status);
  }
  if (params.periodId) {
    search.set("periodId", params.periodId);
  }
  if (params.limit) {
    search.set("limit", String(params.limit));
  }
  if (params.search) {
    search.set("search", params.search);
  }
  const query = search.toString();
  return request<JournalSummary[]>(context, `/api/v1/gl/journals${query ? `?${query}` : ""}`);
}

export async function getGLJournal(context: ApiContext, journalId: string) {
  return request<JournalDetail>(context, `/api/v1/gl/journals/${journalId}`);
}

export async function createGLJournal(context: ApiContext, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(context, "/api/v1/gl/journals", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function approveGLJournal(context: ApiContext, journalId: string, reason?: string) {
  return request<Record<string, unknown>>(context, `/api/v1/gl/journals/${journalId}/approve`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export async function rejectGLJournal(context: ApiContext, journalId: string, reason?: string) {
  return request<Record<string, unknown>>(context, `/api/v1/gl/journals/${journalId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export async function reverseGLJournal(context: ApiContext, journalId: string) {
  return request<Record<string, unknown>>(context, `/api/v1/gl/journals/${journalId}/reverse`, {
    method: "POST",
    body: "{}"
  });
}

export async function postGLJournal(context: ApiContext, journalId: string) {
  return request<Record<string, unknown>>(context, `/api/v1/gl/journals/${journalId}/post`, {
    method: "POST",
    body: "{}"
  });
}

export async function getGLAccounts(context: ApiContext) {
  return request<GLAccount[]>(context, "/api/v1/gl/accounts");
}

export type EntitySummaryItem = {
  id: string;
  name: string;
  code: string;
  currency: string;
  parentId: string | null;
};

export async function getEntities(context: ApiContext) {
  return request<EntitySummaryItem[]>(context, "/api/v1/entities");
}

export type PeriodStatus = "OPEN" | "CLOSED" | "LOCKED";

export type Period = {
  id: string;
  year: number;
  month: number;
  name: string;
  status: PeriodStatus;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
};

export async function getPeriods(context: ApiContext) {
  return request<Array<Record<string, unknown>>>(context, "/api/v1/periods");
}

export async function getPeriodList(
  context: ApiContext,
  params: { year?: number; status?: PeriodStatus } = {}
) {
  const search = new URLSearchParams();
  if (params.year) search.set("year", String(params.year));
  if (params.status) search.set("status", params.status);
  const q = search.toString();
  return request<Period[]>(context, `/api/v1/periods${q ? `?${q}` : ""}`);
}

export async function createPeriod(
  context: ApiContext,
  payload: { year: number; month: number; name: string }
) {
  return request<Period>(context, "/api/v1/periods", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function closePeriod(context: ApiContext, id: string) {
  return request<Period>(context, `/api/v1/periods/${id}/close`, {
    method: "POST",
    body: "{}"
  });
}

export async function lockPeriod(context: ApiContext, id: string) {
  return request<Period>(context, `/api/v1/periods/${id}/lock`, {
    method: "POST",
    body: "{}"
  });
}

export async function reopenPeriod(context: ApiContext, id: string) {
  return request<Period>(context, `/api/v1/periods/${id}/reopen`, {
    method: "POST",
    body: "{}"
  });
}

export async function getAuditEvents(
  context: ApiContext,
  params: { resourceType: string; resourceId: string; limit?: number }
) {
  const search = new URLSearchParams();
  search.set("resource_type", params.resourceType);
  search.set("resource_id", params.resourceId);
  if (params.limit) {
    search.set("limit", String(params.limit));
  }
  return request<AuditEvent[]>(context, `/api/v1/audit?${search.toString()}`);
}

export async function getReportDefinitions(context: ApiContext) {
  return request<Array<Record<string, unknown>>>(context, "/api/v1/reports/definitions");
}

export async function createReportRun(
  context: ApiContext,
  payload: { definitionId: string; parameters: Record<string, unknown> }
) {
  return request<Record<string, unknown>>(context, "/api/v1/reports/runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getReportRun(context: ApiContext, runId: string) {
  return request<Record<string, unknown>>(context, `/api/v1/reports/runs/${runId}`);
}

export async function getTrialBalance(
  context: ApiContext,
  params: {
    periodId: string;
    comparativePeriodId?: string;
    showZeroBalances?: boolean;
  }
) {
  const search = new URLSearchParams();
  search.set("period_id", params.periodId);
  if (params.comparativePeriodId) {
    search.set("comparative_period_id", params.comparativePeriodId);
  }
  search.set("show_zero_balances", String(Boolean(params.showZeroBalances)));

  return request<Array<Record<string, unknown>>>(
    context,
    `/api/v1/gl/trial-balance?${search.toString()}`
  );
}

export async function getAPPaymentRuns(context: ApiContext, params: { limit?: number } = {}) {
  const search = new URLSearchParams();
  if (params.limit) {
    search.set("limit", String(params.limit));
  }

  return request<Array<Record<string, unknown>>>(
    context,
    `/api/v1/ap/payment-runs${search.toString() ? `?${search.toString()}` : ""}`
  );
}

export async function getAPPaymentRun(context: ApiContext, runId: string) {
  return request<Record<string, unknown>>(context, `/api/v1/ap/payment-runs/${runId}`);
}

export async function createAPPaymentRunProposal(
  context: ApiContext,
  payload: {
    startDate: string;
    endDate: string;
    bankFileFormat: "SWIFT_MT103" | "SEPA_PAIN001" | "CSV";
    includePosted: boolean;
    includeApproved: boolean;
    supplierIds?: string[];
  }
) {
  return request<Record<string, unknown>>(context, "/api/v1/ap/payment-runs/proposal", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function approveAPPaymentRun(context: ApiContext, runId: string) {
  return request<Record<string, unknown>>(context, `/api/v1/ap/payment-runs/${runId}/approve`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function confirmAPPaymentRun(
  context: ApiContext,
  runId: string,
  payload: {
    bankAccountId: string;
    paymentMethod: "BANK_TRANSFER" | "CHEQUE" | "CARD" | "CASH";
    referencePrefix: string;
  }
) {
  return request<Record<string, unknown>>(context, `/api/v1/ap/payment-runs/${runId}/confirm`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getPaymentRunDownloadUrl(runId: string): string {
  return `${API_BASE_URL}/api/v1/ap/payment-runs/${runId}/download`;
}

export function getPaymentVoucherUrl(runId: string, supplierId: string): string {
  return `${API_BASE_URL}/api/v1/ap/payment-runs/${runId}/voucher/${supplierId}`;
}

// ── AR ────────────────────────────────────────────────────────────────────────

export async function getARCustomers(context: ApiContext) {
  return request<Array<Record<string, unknown>>>(context, "/api/v1/ar/customers");
}

export async function createARCustomer(context: ApiContext, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(context, "/api/v1/ar/customers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getARInvoices(
  context: ApiContext,
  params: { status?: string; customerId?: string } = {}
) {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.customerId) search.set("customerId", params.customerId);
  const q = search.toString();
  return request<Array<Record<string, unknown>>>(context, `/api/v1/ar/invoices${q ? `?${q}` : ""}`);
}

export async function createARInvoice(context: ApiContext, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(context, "/api/v1/ar/invoices", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function postARInvoice(context: ApiContext, invoiceId: string) {
  return request<Record<string, unknown>>(context, `/api/v1/ar/invoices/${invoiceId}/post`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function createARReceipt(context: ApiContext, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(context, "/api/v1/ar/receipts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function allocateARReceipt(context: ApiContext, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(context, "/api/v1/ar/allocations", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export type AgeingRow = {
  customerId: string;
  customerName: string;
  customerCode: string;
  currency: string;
  bucket0to30: string;
  bucket31to60: string;
  bucket61to90: string;
  bucket91Plus: string;
  totalOutstanding: string;
};

export type AgeingReport = {
  asOfDate: string;
  data: AgeingRow[];
};

export async function getARAgeing(context: ApiContext, asOf?: string) {
  const qs = asOf ? `?asOf=${asOf}` : "";
  return request<AgeingReport>(context, `/api/v1/ar/ageing${qs}`);
}

export async function runARDunning(context: ApiContext) {
  return request<{ dunningEmailsSent: number; invoiceIds: string[] }>(
    context,
    "/api/v1/ar/dunning/run",
    { method: "POST", body: "{}" }
  );
}

// ── FX ────────────────────────────────────────────────────────────────────────

export async function getFXCurrencies(context: ApiContext) {
  return request<Array<Record<string, unknown>>>(context, "/api/v1/fx/currencies");
}

export async function getFXRates(
  context: ApiContext,
  params: { fromCurrency?: string; toCurrency?: string; rateType?: string } = {}
) {
  const search = new URLSearchParams();
  if (params.fromCurrency) search.set("fromCurrency", params.fromCurrency);
  if (params.toCurrency) search.set("toCurrency", params.toCurrency);
  if (params.rateType) search.set("rateType", params.rateType);
  const q = search.toString();
  return request<Array<Record<string, unknown>>>(context, `/api/v1/fx/rates${q ? `?${q}` : ""}`);
}

export async function upsertFXRate(context: ApiContext, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(context, "/api/v1/fx/rates", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function deleteFXRate(context: ApiContext, id: string) {
  return request<Record<string, unknown>>(context, `/api/v1/fx/rates/${id}`, {
    method: "DELETE"
  });
}

export async function importECBRates(context: ApiContext) {
  return request<Record<string, unknown>>(context, "/api/v1/fx/ecb-import", {
    method: "POST",
    body: JSON.stringify({})
  });
}

// ── Budget ────────────────────────────────────────────────────────────────────

export type BudgetDefinition = {
  id: string;
  name: string;
  year: number;
  entityId: string;
};

export type VarianceLine = {
  accountId: string;
  accountCode: string;
  accountName: string;
  usaliCategory: string | null;
  usaliDepartment: string | null;
  budgetAmount: string;
  actualAmount: string;
  variance: string;
  variancePct: string | null;
};

export type VarianceReport = {
  budgetDefinitionId: string;
  budgetName: string;
  year: number;
  periodId: string;
  periodName: string;
  data: VarianceLine[];
};

export async function getBudgetDefinitions(context: ApiContext) {
  return request<BudgetDefinition[]>(context, "/api/v1/budget/definitions");
}

export async function createBudgetDefinition(
  context: ApiContext,
  payload: Record<string, unknown>
) {
  return request<Record<string, unknown>>(context, "/api/v1/budget/definitions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getBudgetLines(context: ApiContext, definitionId: string) {
  return request<Array<Record<string, unknown>>>(
    context,
    `/api/v1/budget/definitions/${definitionId}/lines`
  );
}

export async function upsertBudgetLines(
  context: ApiContext,
  definitionId: string,
  lines: Array<Record<string, unknown>>
) {
  return request<Record<string, unknown>>(
    context,
    `/api/v1/budget/definitions/${definitionId}/lines`,
    {
      method: "PUT",
      body: JSON.stringify({ lines })
    }
  );
}

export async function getBudgetVariance(
  context: ApiContext,
  budgetDefinitionId: string,
  periodId: string
) {
  return request<VarianceReport>(
    context,
    `/api/v1/budget/variance?budgetDefinitionId=${budgetDefinitionId}&periodId=${periodId}`
  );
}

// ── KPI ───────────────────────────────────────────────────────────────────────

export async function getKPIDashboard(context: ApiContext, periodId: string) {
  return request<Record<string, unknown>>(context, `/api/v1/kpi/dashboard?periodId=${periodId}`);
}

export async function getRevPAR(context: ApiContext, periodId: string) {
  return request<Record<string, unknown>>(context, `/api/v1/kpi/revpar?periodId=${periodId}`);
}

export type BalanceSheetAccount = { code: string; name: string; balance: string };
export type BalanceSheetSection = { name: string; accounts: BalanceSheetAccount[]; total: string };
export type BalanceSheetResult = {
  periodId: string;
  asOf: string;
  assets: BalanceSheetSection[];
  liabilities: BalanceSheetSection[];
  equity: BalanceSheetSection[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  totalLiabilitiesAndEquity: string;
};

export type CashFlowItem = { description: string; amount: string };
export type CashFlowSection = { label: string; items: CashFlowItem[]; total: string };
export type CashFlowResult = {
  periodId: string;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: string;
  openingCash: string;
  closingCash: string;
};

export type USALIDepartment = {
  name: string;
  revenue: string;
  expenses: string;
  departmentalIncome: string;
  incomePct: string;
};

export type USALIReport = {
  periodId: string;
  departments: USALIDepartment[];
  totalRevenue: string;
  totalDepartmentalExpenses: string;
  totalDepartmentalIncome: string;
  undistributedExpenses: string;
  grossOperatingProfit: string;
  managementFees: string;
  ebitda: string;
};

export async function getBalanceSheet(context: ApiContext, periodId: string) {
  return request<BalanceSheetResult>(context, `/api/v1/kpi/balance-sheet?periodId=${periodId}`);
}

export async function getCashFlow(context: ApiContext, periodId: string) {
  return request<CashFlowResult>(context, `/api/v1/kpi/cash-flow?periodId=${periodId}`);
}

export async function getUSALI(context: ApiContext, periodId: string) {
  return request<USALIReport>(context, `/api/v1/kpi/usali?periodId=${periodId}`);
}

export type USALIDepartmentComparative = {
  name: string;
  revenue: string;
  expenses: string;
  departmentalIncome: string;
  incomePct: string;
  ytdRevenue: string;
  ytdExpenses: string;
  ytdDeptIncome: string;
  ytdIncomePct: string;
  priorRevenue: string;
  priorExpenses: string;
  priorDeptIncome: string;
  priorIncomePct: string;
  budgetRevenue: string;
  budgetExpenses: string;
  budgetDeptIncome: string;
  varianceAmount: string;
  variancePct: string;
};

export type USALIComparativeReport = {
  periodId: string;
  periodName: string;
  year: number;
  month: number;
  hasYTD: boolean;
  hasPriorYear: boolean;
  hasBudget: boolean;
  departments: USALIDepartmentComparative[];
  totalRevenue: string;
  totalDepartmentalExpenses: string;
  totalDepartmentalIncome: string;
  undistributedExpenses: string;
  grossOperatingProfit: string;
  gopPct: string;
  managementFees: string;
  ebitda: string;
  ebitdaPct: string;
  ytdTotalRevenue: string;
  ytdGOP: string;
  ytdGOPPct: string;
  ytdEBITDA: string;
  ytdEBITDAPct: string;
  priorTotalRevenue: string;
  priorGOP: string;
  priorGOPPct: string;
  priorEBITDA: string;
  budgetTotalRevenue: string;
  budgetGOP: string;
  budgetEBITDA: string;
  revenueVariance: string;
  revenueVariancePct: string;
  gopVariance: string;
  gopVariancePct: string;
  ebitdaVariance: string;
  ebitdaVariancePct: string;
};

export async function getUSALIComparative(context: ApiContext, periodId: string) {
  return request<USALIComparativeReport>(
    context,
    `/api/v1/kpi/usali-comparative?periodId=${periodId}`
  );
}

export async function getRevPARTrend(context: ApiContext, periodId: string) {
  return request<Array<{ date: string; revpar: string; adr: string; occupancyPct: string }>>(
    context,
    `/api/v1/kpi/revpar-trend?periodId=${periodId}`
  );
}

export type CurrencyExposureRow = {
  currency: string;
  arOutstanding: string;
  apOutstanding: string;
  netExposure: string;
};

export type EntitySummary = {
  entityId: string;
  entityName: string;
  periodId: string;
  periodName: string;
  currency: string;
  occupancyPct: string;
  revpar: string;
  adr: string;
  totalRevenue: string;
  grossOperatingProfit: string;
  gopPct: string;
  ebitda: string;
};

export async function getCurrencyExposure(context: ApiContext) {
  return request<CurrencyExposureRow[]>(context, `/api/v1/kpi/currency-exposure`);
}

/** Override entity ID — used for multi-entity portfolio calls */
export async function getEntitySummary(
  context: ApiContext,
  entityId: string,
  year: number,
  month: number
) {
  return request<EntitySummary | null>(
    { ...context, entityId },
    `/api/v1/kpi/entity-summary?year=${year}&month=${month}`
  );
}

export async function getAPInvoicesDue(context: ApiContext, dueBefore: string) {
  return request<Array<Record<string, unknown>>>(
    context,
    `/api/v1/ap/invoices?dueBefore=${dueBefore}&limit=50`
  );
}

// ── AP full CRUD ──────────────────────────────────────────────────────────────

export type APInvoiceStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "POSTED"
  | "PAID"
  | "DISPUTED"
  | "CANCELLED";

export type APInvoice = {
  id: string;
  supplierId: string;
  supplier?: { id: string; name: string; code: string; currency: string };
  periodId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  grossAmount: string;
  taxAmount: string;
  netAmount: string;
  functionalAmount: string;
  fxRate: string;
  status: APInvoiceStatus;
  paymentTerms?: string | null;
  glJournalId?: string | null;
  createdAt: string;
  lines?: Array<{
    id: string;
    description: string;
    quantity: string;
    unitPrice: string;
    amount: string;
    glAccountId?: string | null;
    taxCode?: string | null;
  }>;
};

export type Supplier = {
  id: string;
  name: string;
  code: string;
  taxId?: string;
  currency: string;
  paymentTermsDays: number;
  bankDetails?: Record<string, string>;
  isActive: boolean;
};

export function getAPInvoices(
  context: ApiContext,
  params?: { status?: string; supplierId?: string; limit?: number }
) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.supplierId) qs.set("supplierId", params.supplierId);
  if (params?.limit) qs.set("limit", String(params.limit));
  return request<APInvoice[]>(context, `/api/v1/ap/invoices${qs.toString() ? `?${qs}` : ""}`);
}

export function getAPInvoice(context: ApiContext, id: string) {
  return request<APInvoice>(context, `/api/v1/ap/invoices/${id}`);
}

export function createAPInvoice(context: ApiContext, payload: Record<string, unknown>) {
  return request<APInvoice>(context, "/api/v1/ap/invoices", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function approveAPInvoice(context: ApiContext, id: string) {
  return request<APInvoice>(context, `/api/v1/ap/invoices/${id}/approve`, {
    method: "POST",
    body: "{}"
  });
}

export function postAPInvoice(context: ApiContext, id: string) {
  return request<APInvoice>(context, `/api/v1/ap/invoices/${id}/post`, {
    method: "POST",
    body: "{}"
  });
}

export function getSuppliers(context: ApiContext) {
  return request<Supplier[]>(context, "/api/v1/ap/suppliers");
}

export function getSupplier(context: ApiContext, id: string) {
  return request<Supplier>(context, `/api/v1/ap/suppliers/${id}`);
}

export function createSupplier(context: ApiContext, payload: Record<string, unknown>) {
  return request<Supplier>(context, "/api/v1/ap/suppliers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateSupplier(context: ApiContext, id: string, payload: Record<string, unknown>) {
  return request<Supplier>(context, `/api/v1/ap/suppliers/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

// ── Account types ────────────────────────────────────────────────────────────

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
export type NormalBalance = "DEBIT" | "CREDIT";

export type AccountNode = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  usaliCategory: string | null;
  usaliDepartment: string | null;
  allowPosting: boolean;
  level: number;
  parentId: string | null;
  children: AccountNode[];
};

export type AccountFormPayload = {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  allowPosting: boolean;
  isControlAccount: boolean;
  level: number;
  parentId?: string;
  usaliCategory?: string;
  usaliDepartment?: string;
};

// ── Account Ledger ─────────────────────────────────────────────────────────

export type LedgerLine = {
  id: string;
  lineNumber: number;
  debit: string;
  credit: string;
  debitFunctional: string;
  creditFunctional: string;
  currency: string;
  fxRate: string;
  description: string | null;
  dimension1: string | null;
  dimension2: string | null;
  journalId: string;
  journalRef: string | null;
  journalDescription: string | null;
  journalStatus: string;
  journalSource: string;
  journalDate: string;
  periodId: string;
  periodName: string | null;
};

export type AccountLedgerResult = {
  account: {
    id: string;
    code: string;
    name: string;
    type: AccountType;
    normalBalance: NormalBalance;
    usaliCategory: string | null;
    usaliDepartment: string | null;
  };
  lines: LedgerLine[];
  total: number;
  limit: number;
  offset: number;
};

export async function getAccountLedger(
  context: ApiContext,
  accountId: string,
  params: { periodId?: string; status?: string; limit?: number; offset?: number } = {}
) {
  const qs = new URLSearchParams();
  if (params.periodId) qs.set("periodId", params.periodId);
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  const q = qs.toString();
  return request<AccountLedgerResult>(
    context,
    `/api/v1/gl/accounts/${accountId}/ledger${q ? `?${q}` : ""}`
  );
}

export async function getGLAccountTree(context: ApiContext) {
  return request<AccountNode[]>(context, "/api/v1/gl/accounts");
}

export async function createGLAccount(context: ApiContext, payload: AccountFormPayload) {
  return request<AccountNode>(context, "/api/v1/gl/accounts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateGLAccount(
  context: ApiContext,
  id: string,
  payload: Partial<AccountFormPayload>
) {
  return request<AccountNode>(context, `/api/v1/gl/accounts/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteGLAccount(context: ApiContext, id: string) {
  return request<{ count: number }>(context, `/api/v1/gl/accounts/${id}`, {
    method: "DELETE"
  });
}

// ── Consolidation ─────────────────────────────────────────────────────────────

export type ConsolidatedLine = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  usaliCategory: string | null;
  usaliDepartment: string | null;
  entityAmounts: Record<string, string>;
  eliminationsAmount: string;
  consolidatedAmount: string;
};

export type ConsolidationResult = {
  runId: string;
  consolidatedLines: ConsolidatedLine[];
  ctaTotalAmount: string;
  eliminationWarnings: string[];
};

export type ConsolidationRun = {
  id: string;
  parentEntityId: string;
  reportingCurrency: string;
  periodId: string;
  status: string;
  runAt: string;
  createdAt: string;
  entityResults: Array<{
    id: string;
    entityId: string;
    localCurrency: string;
    closingRate: string;
    averageRate: string;
    ctaAmount: string;
  }>;
};

export async function runConsolidation(
  context: ApiContext,
  payload: {
    parentEntityId: string;
    childEntityIds: string[];
    reportingCurrency: string;
    periodId: string;
  }
) {
  return request<ConsolidationResult>(context, "/api/v1/consolidation/run", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getConsolidationRuns(context: ApiContext, parentEntityId: string) {
  return request<ConsolidationRun[]>(context, `/api/v1/consolidation/${parentEntityId}/runs`);
}

export async function getConsolidationRun(
  context: ApiContext,
  parentEntityId: string,
  runId: string
) {
  return request<ConsolidationRun>(
    context,
    `/api/v1/consolidation/${parentEntityId}/runs/${runId}`
  );
}

// ── Integration / Connectors ──────────────────────────────────────────────────

export type ImportLog = {
  id: string;
  entityId: string;
  connectorType: string;
  businessDate: string | null;
  status: string;
  recordsImported: number;
  recordsFailed: number;
  errorMessage: string | null;
  createdAt: string;
};

export type ConnectorMapping = {
  id: string;
  entityId: string;
  connectorType: string;
  sourceCode: string;
  notes: string | null;
  glAccountId: string;
  glAccount?: { id: string; code: string; name: string };
};

export type BankStatement = {
  id: string;
  entityId: string;
  accountId: string;
  statementDate: string;
  openingBalance: string;
  closingBalance: string;
  currency: string;
  createdAt: string;
  account?: { id: string; code: string; name: string };
  _count?: { transactions: number };
};

export async function runOperaCloudImport(
  context: ApiContext,
  payload: { hotelId: string; businessDate: string; notifyEmail?: string }
) {
  return request<Record<string, unknown>>(context, "/api/v1/integration/opera-cloud/import", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getOperaCloudLogs(context: ApiContext) {
  return request<ImportLog[]>(context, "/api/v1/integration/opera-cloud/logs");
}

export async function runSkyJanaSync(context: ApiContext) {
  return request<Record<string, unknown>>(context, "/api/v1/integration/sky-jana/sync", {
    method: "POST",
    body: "{}"
  });
}

export async function importBankStatement(
  context: ApiContext,
  payload: { format: "MT940" | "OFX"; bankAccountRef: string; fileContent: string }
) {
  return request<Record<string, unknown>>(context, "/api/v1/integration/bank/import", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getBankStatements(context: ApiContext) {
  return request<BankStatement[]>(context, "/api/v1/integration/bank/statements");
}

export async function getBankTransactions(context: ApiContext, statementId: string) {
  return request<Array<Record<string, unknown>>>(
    context,
    `/api/v1/integration/bank/statements/${statementId}/transactions`
  );
}

export async function getConnectorMappings(context: ApiContext, connectorType?: string) {
  const q = connectorType ? `?connectorType=${encodeURIComponent(connectorType)}` : "";
  return request<ConnectorMapping[]>(context, `/api/v1/integration/mappings${q}`);
}

export async function upsertConnectorMapping(
  context: ApiContext,
  payload: { connectorType: string; sourceCode: string; notes?: string; glAccountId: string }
) {
  return request<ConnectorMapping>(context, "/api/v1/integration/mappings", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function deleteConnectorMapping(context: ApiContext, id: string) {
  return request<void>(context, `/api/v1/integration/mappings/${id}`, {
    method: "DELETE"
  });
}

// ── Transfer Desk — Interface Definitions ─────────────────────────────────────

export type TargetField =
  | "postingDate"
  | "accountCode"
  | "debitAmount"
  | "creditAmount"
  | "currency"
  | "reference"
  | "lineDescription"
  | "dimension1"
  | "dimension2"
  | "dimension3"
  | "dimension4"
  | "dimension5"
  | "dimension6";

export type SourceType = "CONSTANT" | "COLUMN" | "LOOKUP" | "FORMULA";
export type FieldTransform = "NONE" | "UPPERCASE" | "LOWERCASE" | "ABS" | "NEGATE" | "DATE_FORMAT";
export type ConnectorType = "OPERA_CLOUD" | "OPERA_SUN" | "SKY_JANA" | "BANK" | "CUSTOM";
export type SourceFormat = "CSV" | "JSON" | "XML" | "MT940" | "FIXED_WIDTH" | "SAF";

export type FieldMappingRule = {
  targetField: TargetField;
  sourceType: SourceType;
  sourceValue: string;
  transform?: FieldTransform;
  transformArg?: string;
  defaultValue?: string;
  required: boolean;
};

export type InterfaceDefinition = {
  id: string;
  entityId: string;
  name: string;
  connectorType: ConnectorType;
  sourceFormat: SourceFormat;
  description: string | null;
  isActive: boolean;
  fieldMappings: FieldMappingRule[];
  createdAt: string;
  updatedAt: string;
};

export type InterfaceDefinitionPayload = {
  name: string;
  connectorType: ConnectorType;
  sourceFormat: SourceFormat;
  description?: string;
  isActive?: boolean;
  fieldMappings: FieldMappingRule[];
};

export type PreviewResult = {
  parsedRows: number;
  mappedRows: Array<Record<string, string | null>>;
  errors: Array<{ row: number; field: string; message: string }>;
  unmappedLookups: string[];
};

export async function listInterfaceDefinitions(context: ApiContext, connectorType?: ConnectorType) {
  const q = connectorType ? `?connectorType=${connectorType}` : "";
  return request<InterfaceDefinition[]>(context, `/api/v1/integration/interfaces${q}`);
}

export async function getInterfaceDefinition(context: ApiContext, id: string) {
  return request<InterfaceDefinition>(context, `/api/v1/integration/interfaces/${id}`);
}

export async function createInterfaceDefinition(
  context: ApiContext,
  payload: InterfaceDefinitionPayload
) {
  return request<InterfaceDefinition>(context, "/api/v1/integration/interfaces", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateInterfaceDefinition(
  context: ApiContext,
  id: string,
  payload: Partial<InterfaceDefinitionPayload>
) {
  return request<InterfaceDefinition>(context, `/api/v1/integration/interfaces/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteInterfaceDefinition(context: ApiContext, id: string) {
  return request<void>(context, `/api/v1/integration/interfaces/${id}`, { method: "DELETE" });
}

export async function previewInterfaceDefinition(
  context: ApiContext,
  id: string,
  sampleData: string,
  maxRows = 10
) {
  return request<PreviewResult>(context, `/api/v1/integration/interfaces/${id}/preview`, {
    method: "POST",
    body: JSON.stringify({ sampleData, maxRows })
  });
}

export async function previewDraftInterfaceDefinition(
  context: ApiContext,
  payload: {
    sourceFormat: SourceFormat;
    fieldMappings: FieldMappingRule[];
    sampleData: string;
    delimiter?: string;
    hasHeader?: boolean;
    maxRows?: number;
  }
) {
  return request<PreviewResult>(context, "/api/v1/integration/interfaces/preview-draft", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

// ── Interface Execute ─────────────────────────────────────────────────────────

export type InterfaceExecuteResult = {
  journalId: string;
  reference: string;
  status: string;
  periodName?: string;
  linesCreated: number;
  unmappedCodes: string[];
  totalRows: number;
  previewErrors: number;
};

export async function executeInterfaceImport(
  context: ApiContext,
  interfaceId: string,
  payload: {
    fileContent: string;
    autoPost?: boolean;
    reference?: string;
    periodId?: string;
  }
) {
  return request<InterfaceExecuteResult>(
    context,
    `/api/v1/integration/interfaces/${interfaceId}/execute`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

// ── COA Import ──────────────────────────────────────────────────────────────

export type COAPreviewRow = {
  rowNumber: number;
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  allowPosting: boolean;
  isControlAccount: boolean;
  parentCode: string;
  level: number;
  usaliCategory: string;
  usaliDepartment: string;
  status: "new" | "exists" | "update" | "error";
  existingId?: string;
  issues: string[];
};

export type COAPreviewResult = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  newAccounts: number;
  existingAccounts: number;
  rows: COAPreviewRow[];
  errors: Array<{ row: number; column: string; message: string }>;
};

export type COAImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; column: string; message: string }>;
};

export type COAFileInput = {
  fileContent?: string;
  fileBase64?: string;
  sheetName?: string;
};

export function previewCOAImport(context: ApiContext, input: COAFileInput) {
  return request<COAPreviewResult>(context, "/api/v1/gl/accounts/import/preview", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function executeCOAImport(
  context: ApiContext,
  input: COAFileInput,
  options?: { updateExisting?: boolean; reactivateInactive?: boolean; skipErrors?: boolean }
) {
  return request<COAImportResult>(context, "/api/v1/gl/accounts/import/execute", {
    method: "POST",
    body: JSON.stringify({ ...input, ...options })
  });
}

export function getExcelSheetNames(context: ApiContext, fileBase64: string) {
  return request<string[]>(context, "/api/v1/gl/accounts/import/sheets", {
    method: "POST",
    body: JSON.stringify({ fileBase64 })
  });
}

// ── SAF Import ───────────────────────────────────────────────────────────────

export type SAFPreviewSummary = {
  format: "fixed_width" | "pipe_delimited";
  operaFileType: "revenue" | "city_ledger" | "market_stats" | "daily_stats" | null;
  janaFileType: "purchasing" | "internal_movements" | "inventory_differences" | null;
  version: string | null;
  lineCount: number;
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
  difference: number;
  dateRange: { earliest: string; latest: string } | null;
  currency: string | null;
  journalTypes: string[];
  debitAccounts: Array<{ code: string; total: number; lines: number; sampleDesc: string }>;
  creditAccounts: Array<{ code: string; total: number; lines: number; sampleDesc: string }>;
  uniqueAccountCount: number;
  errors: Array<{ line: number; message: string }>;
  // Currency info from entity
  baseCurrency: string;
  reportingCurrency: string;
  fileCurrency: string;
  fxRate: string | null;
  fxRateDate: string | null;
};

export type SAFAccountMapping = {
  safCode: string;
  status: "matched" | "partial_match" | "unmatched";
  glAccountId: string | null;
  glAccountCode: string | null;
  glAccountName: string | null;
  isVendor: boolean;
  suggestion: string | null;
};

export type SAFExecuteResult = {
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
};

export type SAFExecuteOptions = {
  fileContent: string;
  filename: string;
  groupingStrategy: "single_entry" | "by_reference" | "by_journal_type";
  autoPost: boolean;
  autoCreateAccounts: boolean;
  sourceModule: string;
  descriptionPrefix: string;
};

export function previewSAFFile(context: ApiContext, fileContent: string, filename?: string) {
  return request<SAFPreviewSummary>(context, "/api/v1/integration/import/saf/preview", {
    method: "POST",
    body: JSON.stringify({ fileContent, filename })
  });
}

export function getSAFAccountMapping(context: ApiContext, fileContent: string, filename?: string) {
  return request<SAFAccountMapping[]>(context, "/api/v1/integration/import/saf/account-mapping", {
    method: "POST",
    body: JSON.stringify({ fileContent, filename })
  });
}

export function executeSAFImport(context: ApiContext, options: SAFExecuteOptions) {
  return request<SAFExecuteResult>(context, "/api/v1/integration/import/saf/execute", {
    method: "POST",
    body: JSON.stringify(options)
  });
}
