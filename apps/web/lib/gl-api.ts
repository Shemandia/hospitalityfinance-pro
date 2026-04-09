const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

type Envelope<T> = {
  data: T;
  errors?: Array<{ code: string; message: string }>;
  meta?: Record<string, unknown>;
};

export type ApiContext = {
  accessToken: string;
  entityId: string;
  tenantSlug?: string;
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
      ...(context.entityId ? { "X-Entity-ID": context.entityId } : {}),
      ...(context.tenantSlug ? { "X-Tenant-Slug": context.tenantSlug } : {}),
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

export type GLAccountBalance = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  /** Decimal string, signed for the account's normal balance side */
  balance: string;
  debits: string;
  credits: string;
};

export async function getGLAccountBalance(context: ApiContext, accountId: string) {
  return request<GLAccountBalance>(context, `/api/v1/gl/accounts/${accountId}/balance`);
}

export type EntitySummaryItem = {
  id: string;
  name: string;
  type: "GROUP" | "PROPERTY";
  functionalCurrency: string;
  reportingCurrency: string;
  timezone: string;
  countryCode: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  isActive: boolean;
  parentId: string | null;
  parent: { id: string; name: string } | null;
  _count: { children: number; users: number };
  createdAt: string;
  updatedAt: string;
  // Backwards compat aliases
  code: string | null;
  currency: string;
};

export type EntityPayload = {
  name: string;
  type: "GROUP" | "PROPERTY";
  parentId?: string | null;
  functionalCurrency?: string;
  reportingCurrency?: string;
  timezone?: string;
  countryCode: string;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  isActive?: boolean;
};

export async function getEntities(context: ApiContext) {
  return request<EntitySummaryItem[]>(context, "/api/v1/entities");
}

export async function getEntityById(context: ApiContext, id: string) {
  return request<EntitySummaryItem>(context, `/api/v1/entities/${id}`);
}

export async function createEntity(context: ApiContext, payload: EntityPayload) {
  return request<EntitySummaryItem>(context, "/api/v1/entities", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateEntity(
  context: ApiContext,
  id: string,
  payload: Partial<EntityPayload>
) {
  return request<EntitySummaryItem>(context, `/api/v1/entities/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteEntity(context: ApiContext, id: string) {
  return request<null>(context, `/api/v1/entities/${id}`, { method: "DELETE" });
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

// ── Report Definitions ────────────────────────────────────────────────────────

export type ReportDefinitionSummary = {
  id: string;
  name: string;
  type: string;
  isSystem: boolean;
  template: Record<string, unknown>;
  createdAt: string;
};

export type ReportRunSummary = {
  id: string;
  definitionId: string;
  status: string;
  outputUrl: string | null;
  errorMessage: string | null;
  runAt: string | null;
  createdAt: string;
  definition?: { id: string; name: string; type: string };
};

export async function getReportDefinitions(context: ApiContext) {
  return request<ReportDefinitionSummary[]>(context, "/api/v1/reports/definitions");
}

export async function getReportDefinition(context: ApiContext, id: string) {
  return request<ReportDefinitionSummary & { _count: { runs: number } }>(
    context,
    `/api/v1/reports/definitions/${id}`
  );
}

export async function createReportDefinition(
  context: ApiContext,
  payload: Record<string, unknown>
) {
  return request<ReportDefinitionSummary>(context, "/api/v1/reports/definitions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateReportDefinition(
  context: ApiContext,
  id: string,
  payload: Record<string, unknown>
) {
  return request<ReportDefinitionSummary>(context, `/api/v1/reports/definitions/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteReportDefinition(context: ApiContext, id: string) {
  return request<null>(context, `/api/v1/reports/definitions/${id}`, { method: "DELETE" });
}

export async function createReportRun(
  context: ApiContext,
  payload: { definitionId: string; parameters: Record<string, unknown> }
) {
  return request<ReportRunSummary>(context, "/api/v1/reports/runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getReportRun(context: ApiContext, runId: string) {
  return request<ReportRunSummary>(context, `/api/v1/reports/runs/${runId}`);
}

export async function getReportHistory(
  context: ApiContext,
  params?: { definitionId?: string; status?: string; limit?: number }
) {
  const search = new URLSearchParams();
  if (params?.definitionId) search.set("definitionId", params.definitionId);
  if (params?.status) search.set("status", params.status);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return request<ReportRunSummary[]>(context, `/api/v1/reports/history${qs ? `?${qs}` : ""}`);
}

export function getReportDownloadUrl(runId: string): string {
  return `${API_BASE_URL}/api/v1/reports/runs/${runId}/download`;
}

export async function getReportTypes(context: ApiContext) {
  return request<Record<string, unknown>>(context, "/api/v1/reports/types");
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

export async function deleteAPPaymentRun(context: ApiContext, runId: string) {
  return request<{ deleted: boolean }>(context, `/api/v1/ap/payment-runs/${runId}`, {
    method: "DELETE"
  });
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

// ── Report PDF URLs ──────────────────────────────────────────────────────────

export function getUSALIPdfUrl(periodId: string): string {
  return `${API_BASE_URL}/api/v1/kpi/usali-comparative/pdf?periodId=${periodId}`;
}

export function getBalanceSheetPdfUrl(periodId: string): string {
  return `${API_BASE_URL}/api/v1/kpi/balance-sheet/pdf?periodId=${periodId}`;
}

export function getCashFlowPdfUrl(periodId: string): string {
  return `${API_BASE_URL}/api/v1/kpi/cash-flow/pdf?periodId=${periodId}`;
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

export type BudgetExcelPreview = {
  rows: Array<{
    rowNumber: number;
    accountCode: string;
    month: number;
    amount: string;
    notes: string | null;
  }>;
  totalRows: number;
  mappedCodes: string[];
  unmappedCodes: string[];
  errors: string[];
};

export type BudgetExcelImportResult = {
  upserted: number;
  skipped: number;
  errors: string[];
};

export async function previewBudgetExcelImport(
  context: ApiContext,
  definitionId: string,
  file: string,
  filename: string
) {
  return request<BudgetExcelPreview>(
    context,
    `/api/v1/budget/definitions/${definitionId}/import-excel/preview`,
    { method: "POST", body: JSON.stringify({ file, filename }) }
  );
}

export async function executeBudgetExcelImport(
  context: ApiContext,
  definitionId: string,
  file: string,
  filename: string
) {
  return request<BudgetExcelImportResult>(
    context,
    `/api/v1/budget/definitions/${definitionId}/import-excel/execute`,
    { method: "POST", body: JSON.stringify({ file, filename }) }
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

export type AccountType = string;
export type NormalBalance = "DEBIT" | "CREDIT";
export type AccountTypeCategory = "BALANCE_SHEET" | "INCOME" | "STATISTICAL";

export type AccountTypeDefinition = {
  id: string;
  code: string;
  name: string;
  category: AccountTypeCategory;
  normalBalance: NormalBalance;
  isSystem: boolean;
  sortOrder: number;
  isActive: boolean;
  entityId: string | null;
};

export type AccountNode = {
  id: string;
  code: string;
  name: string;
  type: string;
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
  type: string;
  normalBalance: NormalBalance;
  allowPosting: boolean;
  isControlAccount: boolean;
  level: number;
  parentId?: string;
  usaliCategory?: string;
  usaliDepartment?: string;
};

// ── Account Type Definition API ──────────────────────────────────────────────

export async function getAccountTypeDefinitions(context: ApiContext) {
  return request<AccountTypeDefinition[]>(context, "/api/v1/account-types");
}

export async function createAccountTypeDefinition(
  context: ApiContext,
  payload: {
    code: string;
    name: string;
    category: AccountTypeCategory;
    normalBalance: NormalBalance;
    sortOrder?: number;
  }
) {
  return request<AccountTypeDefinition>(context, "/api/v1/account-types", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateAccountTypeDefinition(
  context: ApiContext,
  id: string,
  payload: Partial<{
    name: string;
    category: AccountTypeCategory;
    normalBalance: NormalBalance;
    sortOrder: number;
    isActive: boolean;
  }>
) {
  return request<AccountTypeDefinition>(context, `/api/v1/account-types/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteAccountTypeDefinition(context: ApiContext, id: string) {
  return request<{ deleted: boolean }>(context, `/api/v1/account-types/${id}`, {
    method: "DELETE"
  });
}

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
  // GL Journal
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
  | "dimension6"
  // AP Invoice
  | "supplierCode"
  | "invoiceNumber"
  | "invoiceDate"
  | "dueDate"
  | "grossAmount"
  | "taxAmount"
  | "netAmount"
  | "lineAmount"
  | "lineGLAccountCode"
  | "lineTaxCode"
  | "lineCostCentre"
  | "lineDepartment"
  | "externalPoRef"
  | "paymentTerms"
  // Supplier Sync
  | "code"
  | "name"
  | "taxId"
  | "paymentTermsDays"
  | "bankAccountName"
  | "bankAccountNumber"
  | "bankRoutingCode"
  | "bankSwiftCode"
  | "isActive"
  | "contactEmail"
  | "contactPhone"
  | "address";

export type SourceType =
  | "CONSTANT"
  | "COLUMN"
  | "LOOKUP"
  | "FORMULA"
  | "EXPRESSION"
  | "CONDITIONAL";
export type FieldTransform =
  | "NONE"
  | "UPPERCASE"
  | "LOWERCASE"
  | "TRIM"
  | "ABS"
  | "NEGATE"
  | "ROUND"
  | "SUBSTRING"
  | "LEFT"
  | "RIGHT"
  | "PAD_LEFT"
  | "PAD_RIGHT"
  | "REPLACE"
  | "SPLIT"
  | "CONCAT"
  | "DATE_FORMAT"
  | "DATE_PARSE"
  | "MULTIPLY"
  | "DIVIDE"
  | "ADD"
  | "MAP_VALUE"
  | "STRIP_NON_NUMERIC"
  | "DEFAULT_IF_EMPTY";
export type ConnectorType =
  | "OPERA_CLOUD"
  | "OPERA_SUN"
  | "SIMPHONY_POS"
  | "MEWS_PMS"
  | "SKY_JANA"
  | "BANK"
  | "PAYROLL"
  | "PROCUREMENT"
  | "CUSTOM";
export type SourceFormat = "CSV" | "JSON" | "XML" | "EXCEL" | "MT940" | "FIXED_WIDTH" | "SAF";
export type TargetType = "GL_JOURNAL" | "AP_INVOICE" | "SUPPLIER_SYNC";

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

export async function getTransferDeskMetadata(context: ApiContext) {
  return request<Record<string, unknown>>(context, "/api/v1/integration/transfer-desk/metadata");
}

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

// ── Approval Rules ──────────────────────────────────────────────────────────

export type ApprovalRule = {
  id: string;
  entityId: string;
  module: "GL" | "AP" | "AR";
  minAmount: string;
  maxAmount: string | null;
  requiredApprovers: string[];
  requireAll: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalRulePayload = {
  module: "GL" | "AP" | "AR";
  minAmount: number;
  maxAmount?: number;
  requiredApprovers: string[];
  requireAll: boolean;
  isActive: boolean;
};

export type EntityUser = {
  id: string;
  name: string;
  email: string;
};

export function getApprovalRules(context: ApiContext) {
  return request<ApprovalRule[]>(context, "/api/v1/gl/approval-rules");
}

export function getApprovalRule(context: ApiContext, id: string) {
  return request<ApprovalRule>(context, `/api/v1/gl/approval-rules/${id}`);
}

export function createApprovalRule(context: ApiContext, payload: ApprovalRulePayload) {
  return request<ApprovalRule>(context, "/api/v1/gl/approval-rules", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateApprovalRule(
  context: ApiContext,
  id: string,
  payload: Partial<ApprovalRulePayload>
) {
  return request<ApprovalRule>(context, `/api/v1/gl/approval-rules/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteApprovalRule(context: ApiContext, id: string) {
  return request<void>(context, `/api/v1/gl/approval-rules/${id}`, {
    method: "DELETE"
  });
}

export function getEntityUsers(context: ApiContext) {
  return request<EntityUser[]>(context, "/api/v1/gl/users");
}

// ── Bank Reconciliation ─────────────────────────────────────────────────────

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

export type BankTransactionRow = {
  id: string;
  bankStatementId: string;
  valueDate: string;
  description: string;
  amount: string;
  currency: string;
  reference: string | null;
  isReconciled: boolean;
  journalLineId: string | null;
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

// ── Admin — Roles, Permissions, Users ─────────────────────────────────────────

export async function getAdminRoles(context: ApiContext) {
  return request<Array<Record<string, unknown>>>(context, "/api/v1/admin/roles");
}

export async function getAdminRole(context: ApiContext, id: string) {
  return request<Record<string, unknown>>(context, `/api/v1/admin/roles/${id}`);
}

export async function createAdminRole(context: ApiContext, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(context, "/api/v1/admin/roles", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateAdminRole(
  context: ApiContext,
  id: string,
  payload: Record<string, unknown>
) {
  return request<Record<string, unknown>>(context, `/api/v1/admin/roles/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteAdminRole(context: ApiContext, id: string) {
  return request<null>(context, `/api/v1/admin/roles/${id}`, { method: "DELETE" });
}

export async function getAdminPermissions(context: ApiContext) {
  return request<Array<Record<string, unknown>>>(context, "/api/v1/admin/permissions");
}

export async function addRolePermission(context: ApiContext, roleId: string, permissionId: string) {
  return request<Record<string, unknown>>(context, `/api/v1/admin/roles/${roleId}/permissions`, {
    method: "POST",
    body: JSON.stringify({ permissionId })
  });
}

export async function removeRolePermission(
  context: ApiContext,
  roleId: string,
  permissionId: string
) {
  return request<null>(context, `/api/v1/admin/roles/${roleId}/permissions/${permissionId}`, {
    method: "DELETE"
  });
}

export async function getAdminEntityUsers(context: ApiContext) {
  return request<Array<Record<string, unknown>>>(context, "/api/v1/admin/users");
}

export async function inviteEntityUser(
  context: ApiContext,
  payload: { email: string; name: string; role: string }
) {
  return request<Record<string, unknown>>(context, "/api/v1/admin/users/invite", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateEntityUserRole(context: ApiContext, userId: string, role: string) {
  return request<Record<string, unknown>>(context, `/api/v1/admin/users/${userId}/role`, {
    method: "PUT",
    body: JSON.stringify({ role })
  });
}

export async function removeEntityUser(context: ApiContext, userId: string) {
  return request<null>(context, `/api/v1/admin/users/${userId}`, { method: "DELETE" });
}

// ── Entity Hierarchy & Scope Assignment ───────────────────────────────────────

export async function getEntityTree(context: ApiContext) {
  return request<{
    flat: Array<{
      id: string;
      name: string;
      code: string | null;
      type: string;
      parentId: string | null;
      isActive: boolean;
      _count: { children: number; users: number };
    }>;
    tree: unknown[];
  }>(context, "/api/v1/admin/entity-tree");
}

export async function assignUserScope(
  context: ApiContext,
  payload: { userId: string; entityId: string; role: string; cascade: boolean }
) {
  return request<Record<string, unknown>>(context, "/api/v1/admin/users/assign-scope", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function revokeUserScope(
  context: ApiContext,
  payload: { userId: string; entityId: string; cascade: boolean }
) {
  return request<Record<string, unknown>>(context, "/api/v1/admin/users/revoke-scope", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getUserEntityAssignments(context: ApiContext, userId: string) {
  return request<
    Array<{
      entityId: string;
      userId: string;
      role: string;
      entity: {
        id: string;
        name: string;
        code: string | null;
        type: string;
        parentId: string | null;
      };
    }>
  >(context, `/api/v1/admin/users/${userId}/entities`);
}

// ── User Profile & Login Audit ────────────────────────────────────────────────

export type UserProfile = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  loginCount: number;
  createdAt: string;
  entities: Array<{
    role: string;
    entity: { id: string; name: string; type: string };
  }>;
};

export type LoginAuditEntry = {
  id: string;
  action: string;
  ipAddress: string | null;
  createdAt: string;
};

export async function getUserProfile(context: ApiContext) {
  return request<UserProfile>(context, "/api/v1/admin/profile");
}

export async function updateUserProfile(
  context: ApiContext,
  payload: {
    name?: string;
    phone?: string;
    jobTitle?: string;
    department?: string;
  }
) {
  return request<UserProfile>(context, "/api/v1/admin/profile", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function getLoginAudit(
  context: ApiContext,
  params?: { userId?: string; limit?: number }
) {
  const search = new URLSearchParams();
  if (params?.userId) search.set("userId", params.userId);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return request<LoginAuditEntry[]>(context, `/api/v1/admin/login-audit${qs ? `?${qs}` : ""}`);
}

export async function setUserActiveStatus(context: ApiContext, userId: string, isActive: boolean) {
  return request<{ id: string; isActive: boolean }>(
    context,
    `/api/v1/admin/users/${userId}/status`,
    { method: "PUT", body: JSON.stringify({ isActive }) }
  );
}

export async function getUserDetail(context: ApiContext, userId: string) {
  return request<Record<string, unknown>>(context, `/api/v1/admin/users/${userId}/detail`);
}

// ── Mews PMS ─────────────────────────────────────────────────────────────────

export async function runMewsImport(
  context: ApiContext,
  payload: { startUtc: string; endUtc: string; notifyEmail?: string }
) {
  return request<Record<string, unknown>>(context, "/api/v1/integration/mews/import", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getMewsLogs(context: ApiContext) {
  return request<Array<Record<string, unknown>>>(context, "/api/v1/integration/mews/logs");
}

// ── Report Scheduling ────────────────────────────────────────────────────────

export async function setReportSchedule(
  context: ApiContext,
  definitionId: string,
  schedule: { enabled: boolean; cron: string; notifyEmail?: string; periodSelection?: string }
) {
  return request<Record<string, unknown>>(
    context,
    `/api/v1/reports/definitions/${definitionId}/schedule`,
    { method: "POST", body: JSON.stringify(schedule) }
  );
}

export async function removeReportSchedule(context: ApiContext, definitionId: string) {
  return request<null>(context, `/api/v1/reports/definitions/${definitionId}/schedule`, {
    method: "DELETE"
  });
}

// ── Simphony POS ─────────────────────────────────────────────────────────────

export async function runSimphonyImport(
  context: ApiContext,
  payload: { locationId: string; businessDate: string; notifyEmail?: string }
) {
  return request<Record<string, unknown>>(context, "/api/v1/integration/simphony/import", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getSimphonyLogs(context: ApiContext) {
  return request<Array<Record<string, unknown>>>(context, "/api/v1/integration/simphony/logs");
}

// ── Opera PMS Enhanced ───────────────────────────────────────────────────────

export async function getOperaStatistics(
  context: ApiContext,
  hotelId: string,
  businessDate: string
) {
  return request<Record<string, unknown>>(
    context,
    `/api/v1/integration/opera-cloud/statistics?hotelId=${hotelId}&businessDate=${businessDate}`
  );
}

export async function getOperaCashierReport(
  context: ApiContext,
  hotelId: string,
  businessDate: string
) {
  return request<Record<string, unknown>>(
    context,
    `/api/v1/integration/opera-cloud/cashier-report?hotelId=${hotelId}&businessDate=${businessDate}`
  );
}

export async function getOperaCityLedger(
  context: ApiContext,
  hotelId: string,
  businessDate: string
) {
  return request<Record<string, unknown>>(
    context,
    `/api/v1/integration/opera-cloud/city-ledger?hotelId=${hotelId}&businessDate=${businessDate}`
  );
}

// ── Payroll Integration ──────────────────────────────────────────────────────

export async function importPayrollBatch(context: ApiContext, payload: Record<string, unknown>) {
  return request<Record<string, unknown>>(context, "/api/v1/integration/payroll/import", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function importPayrollFile(
  context: ApiContext,
  payload: {
    file: string;
    filename: string;
    postingDate: string;
    currency: string;
    autoPost: boolean;
  }
) {
  return request<Record<string, unknown>>(context, "/api/v1/integration/payroll/import-file", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getPayrollLogs(context: ApiContext) {
  return request<Array<Record<string, unknown>>>(context, "/api/v1/integration/payroll/logs");
}

// ── Bank Reconciliation ──────────────────────────────────────────────────────

export function getReconciliationSummary(context: ApiContext, statementId: string) {
  return request<ReconciliationSummary>(
    context,
    `/api/v1/integration/bank/statements/${statementId}/reconciliation`
  );
}

export function getUnreconciledTransactions(context: ApiContext, statementId: string) {
  return request<BankTransactionRow[]>(
    context,
    `/api/v1/integration/bank/statements/${statementId}/unreconciled`
  );
}

export function getMatchCandidates(
  context: ApiContext,
  transactionId: string,
  dateTolerance?: number
) {
  const qs = dateTolerance ? `?dateTolerance=${dateTolerance}` : "";
  return request<MatchCandidate[]>(
    context,
    `/api/v1/integration/bank/transactions/${transactionId}/candidates${qs}`
  );
}

export function matchBankTransaction(
  context: ApiContext,
  transactionId: string,
  journalLineId: string
) {
  return request<{ matched: boolean }>(
    context,
    `/api/v1/integration/bank/transactions/${transactionId}/match`,
    { method: "POST", body: JSON.stringify({ journalLineId }) }
  );
}

export function unmatchBankTransaction(context: ApiContext, transactionId: string) {
  return request<{ unmatched: boolean }>(
    context,
    `/api/v1/integration/bank/transactions/${transactionId}/unmatch`,
    { method: "POST", body: "{}" }
  );
}

export function autoMatchStatement(context: ApiContext, statementId: string, minScore?: number) {
  return request<AutoMatchResult>(
    context,
    `/api/v1/integration/bank/statements/${statementId}/auto-match`,
    { method: "POST", body: JSON.stringify({ minScore: minScore ?? 70 }) }
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Transfer Desk — Self-Service Designer API client stubs
//
// Per HFP_TransferDesk_SelfService_Designer_v1_0.md §13. The backend routes
// for these are scaffolded incrementally; UI code can already import and call
// them now (they will return 404 until the matching backend endpoint exists).
// Keep the function signatures stable so the UI doesn't need to change when
// the backend is wired up.
// ────────────────────────────────────────────────────────────────────────────

/** UI-API-001 — POST /transfer/formats/detect — auto-detect format from sample */
export type FormatDetectionResult = {
  classification:
    | "delimited"
    | "single_fixed"
    | "multiple_fixed"
    | "other_flat"
    | "user_xml"
    | "simple_xml";
  delimiter: string | null;
  recordSeparator: string | null;
  encoding: string;
  hasHeaders: boolean;
  fields: Array<{
    name: string;
    startPos?: number;
    length?: number;
    sampleValues: string[];
  }>;
  previewRows: Array<Record<string, string>>;
  suggestedFsdXml: string;
  /** 0..100 */
  confidence: number;
};

export function detectFormat(context: ApiContext, sampleContent: string, filename?: string) {
  return request<FormatDetectionResult>(
    context,
    "/api/v1/integration/transfer-desk/formats/detect",
    {
      method: "POST",
      body: JSON.stringify({ sampleContent, filename })
    }
  );
}

/** UI-API-003/004 — GET /transfer/components — list HFP component schemas */
export type ComponentField = {
  name: string;
  dataType: "string" | "number" | "decimal" | "date" | "datetime" | "boolean" | "json";
  required: boolean;
  description: string;
};
export type ComponentSchema = {
  name: string;
  label: string;
  description: string;
  fields: ComponentField[];
};

export function getComponentSchemas(context: ApiContext) {
  return request<ComponentSchema[]>(context, "/api/v1/integration/transfer-desk/components");
}

/** UI-API-005 — POST /transfer/transformations/{id}/auto-map — generate 1:1 mappings */
export type AutoMapResult = {
  mappings: Array<{
    sourceField: string;
    targetField: string;
    confidence: number;
  }>;
  unmappedSourceFields: string[];
  unmappedTargetFields: string[];
};

export function autoMap(context: ApiContext, transformationId: string) {
  return request<AutoMapResult>(
    context,
    `/api/v1/integration/transfer-desk/transformations/${transformationId}/auto-map`,
    { method: "POST", body: "{}" }
  );
}

/** UI-API-006 — GET /transfer/functions/library — list pre-built JS transformation functions */
export type TransformFunctionDef = {
  name: string;
  category: "Date" | "String" | "Number" | "Currency" | "Conditional" | "AccountMapping";
  description: string;
  parameters: Array<{ name: string; type: string; description: string }>;
  returnType: string;
  example: string;
};

export function getFunctionLibrary(context: ApiContext) {
  return request<TransformFunctionDef[]>(
    context,
    "/api/v1/integration/transfer-desk/functions/library"
  );
}

/** UI-API-007 — POST /transfer/functions/test — execute a JS function in the sandbox */
export type FunctionTestResult = {
  result: unknown;
  error?: string;
  executionTimeMs: number;
};

export function testFunction(
  context: ApiContext,
  payload: { functionName: string; functionBody?: string; parameters: Record<string, unknown> }
) {
  return request<FunctionTestResult>(context, "/api/v1/integration/transfer-desk/functions/test", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/** UI-API-008 — GET /transfer/profiles/{id}/validate-full — deep profile validation */
export type ProfileValidationResult = {
  valid: boolean;
  errors: Array<{ field: string; code: string; message: string }>;
  warnings: Array<{ field: string; code: string; message: string }>;
};

export function validateProfile(context: ApiContext, profileId: string) {
  return request<ProfileValidationResult>(
    context,
    `/api/v1/integration/transfer-desk/profiles/${profileId}/validate-full`
  );
}

/** UI-API-009 — POST /transfer/profiles/{id}/dry-run — execute against sample without committing */
export type DryRunResult = {
  dryRunId: string;
  status: "completed" | "failed";
  preview: Array<Record<string, unknown>>;
  errors: Array<{ row: number; field?: string; code: string; message: string }>;
  recordsProcessed: number;
  recordsFailed: number;
};

export function dryRun(
  context: ApiContext,
  profileId: string,
  payload: { sampleContent?: string; parameters?: Record<string, unknown> }
) {
  return request<DryRunResult>(
    context,
    `/api/v1/integration/transfer-desk/profiles/${profileId}/dry-run`,
    { method: "POST", body: JSON.stringify(payload) }
  );
}

/** UI-API-010 — GET /transfer/executions/stats — dashboard stats */
export type ExecutionStats = {
  executionsByDay: Array<{ date: string; succeeded: number; failed: number }>;
  successRate: number; // 0..1
  avgDurationMs: number;
  topProfiles: Array<{ profileId: string; profileName: string; runCount: number }>;
};

export function getExecutionStats(context: ApiContext) {
  return request<ExecutionStats>(context, "/api/v1/integration/transfer-desk/executions/stats");
}

/** UI-API-011 — GET /license/entitlements — tenant license entitlements */
export type LicenseEntitlements = {
  transferDeskEnabled: boolean;
  visualMapperEnabled: boolean;
  customFunctionsEnabled: boolean;
  automationEnabled: boolean;
  maxProfilesPerTenant: number | null;
  maxConcurrentExecutions: number;
  tier: "starter" | "pro" | "enterprise";
};

export function getLicenseEntitlements(context: ApiContext) {
  return request<LicenseEntitlements>(context, "/api/v1/license/entitlements");
}

// ────────────────────────────────────────────────────────────────────────────
// Transfer Desk — Profile CRUD client (TD-API-009..016)
// Matches the backend routes added in Sprint 3 commit 1.
// ────────────────────────────────────────────────────────────────────────────

export type TransferProfileType =
  | "IMPORT"
  | "EXPORT"
  | "PROCESS"
  | "INTERNAL_TRANSFER"
  | "EXTERNAL_TRANSFER";

/** Hard-coded profile type definitions for the creation wizard */
export const TRANSFER_PROFILE_TYPES: ReadonlyArray<{
  value: TransferProfileType;
  label: string;
  description: string;
}> = [
  {
    value: "IMPORT",
    label: "Import",
    description: "Read data from an external file or system and write it into an HFP component"
  },
  {
    value: "EXPORT",
    label: "Export",
    description: "Extract data from an HFP component and write it to a file or external system"
  },
  {
    value: "PROCESS",
    label: "Process",
    description: "Run an internal process against an HFP component (e.g. allocations, revaluations)"
  },
  {
    value: "INTERNAL_TRANSFER",
    label: "Internal Transfer",
    description: "Move data between two HFP components within the same property"
  },
  {
    value: "EXTERNAL_TRANSFER",
    label: "External Transfer",
    description: "Move data between an HFP component and an external system endpoint"
  }
] as const;

// ────────────────────────────────────────────────────────────────────────────
// Transfer Desk — Format types & client (TD-API-030..031)
// ────────────────────────────────────────────────────────────────────────────

export type FormatClassification =
  | "DELIMITED"
  | "SINGLE_FIXED"
  | "MULTIPLE_FIXED"
  | "OTHER_FLAT"
  | "USER_XML"
  | "SIMPLE_XML";

export type TransferFormatSummary = {
  id: string;
  name: string;
  description: string | null;
  classification: FormatClassification;
  isSystem: boolean;
  isValid: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { sourceProfiles: number; targetProfiles: number };
};

export type TransferFormatDetail = TransferFormatSummary & {
  fsdXml: string;
  guiState: unknown | null;
  validationErrors: unknown | null;
  createdById: string | null;
};

export function listTransferFormats(
  context: ApiContext,
  filters: { classification?: FormatClassification } = {}
) {
  const q = new URLSearchParams();
  if (filters.classification) q.set("classification", filters.classification);
  const qs = q.toString();
  return request<TransferFormatSummary[]>(
    context,
    `/api/v1/integration/transfer-desk/formats${qs ? `?${qs}` : ""}`
  );
}

export function getTransferFormat(context: ApiContext, formatId: string) {
  return request<TransferFormatDetail>(
    context,
    `/api/v1/integration/transfer-desk/formats/${formatId}`
  );
}

// ── Format auto-detection (TD-API-032) ──────────────────────────────────────

export type DetectedField = {
  name: string;
  type: "string" | "integer" | "number" | "date" | "boolean";
  required: boolean;
  maxLength: number;
  minLength: number;
  startPos?: number;
  length?: number;
  sampleValues: string[];
};

export type DetectionResult = {
  classification: FormatClassification;
  delimiter?: string;
  recordSep: string;
  encoding: string;
  hasHeaders: boolean;
  fields: DetectedField[];
  confidence: number;
  previewRows: Record<string, string>[];
  suggestedSchema: unknown;
};

export function detectFormatFromFile(context: ApiContext, fileContent: string) {
  return request<DetectionResult>(context, "/api/v1/integration/transfer-desk/formats/detect", {
    method: "POST",
    body: JSON.stringify({ fileContent })
  });
}

// ── Format create / update (TD-API-033..034) ────────────────────────────────

export type FormatCreateInput = {
  name: string;
  description?: string;
  classification: FormatClassification;
  fsdXml: string;
  guiState?: unknown;
};

export type FormatUpdateInput = {
  name?: string;
  description?: string;
  classification?: FormatClassification;
  fsdXml?: string;
  guiState?: unknown;
};

export function createTransferFormat(context: ApiContext, input: FormatCreateInput) {
  return request<TransferFormatDetail>(context, "/api/v1/integration/transfer-desk/formats", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateTransferFormat(
  context: ApiContext,
  formatId: string,
  input: FormatUpdateInput
) {
  return request<TransferFormatDetail>(
    context,
    `/api/v1/integration/transfer-desk/formats/${formatId}`,
    {
      method: "PUT",
      body: JSON.stringify(input)
    }
  );
}

// ── Transformation types + CRUD (TD-API-040..043) ─────────────────────────

export type TransferTransformationSummary = {
  id: string;
  name: string;
  description: string | null;
  scriptType: "TML" | "XSL";
  sourceFormatId: string | null;
  targetFormatId: string | null;
  sourceComponent: string | null;
  targetComponent: string | null;
  isSystem: boolean;
  isValid: boolean;
  createdAt: string;
  updatedAt: string;
  sourceFormat: { id: string; name: string; classification: FormatClassification } | null;
  targetFormat: { id: string; name: string; classification: FormatClassification } | null;
  _count?: { profiles: number };
};

export type TransferTransformationDetail = TransferTransformationSummary & {
  rulesJson: unknown;
  functionsJson: unknown;
  validationErrors: unknown | null;
  createdById: string | null;
  sourceFormat: {
    id: string;
    name: string;
    classification: FormatClassification;
    fsdXml: string;
  } | null;
  targetFormat: {
    id: string;
    name: string;
    classification: FormatClassification;
    fsdXml: string;
  } | null;
};

export type TransformationCreateInput = {
  name: string;
  description?: string;
  sourceFormatId?: string;
  targetFormatId?: string;
  sourceComponent?: string;
  targetComponent?: string;
  rulesJson?: unknown;
  functionsJson?: unknown;
};

export type TransformationUpdateInput = {
  name?: string;
  description?: string;
  sourceFormatId?: string;
  targetFormatId?: string;
  sourceComponent?: string;
  targetComponent?: string;
  rulesJson?: unknown;
  functionsJson?: unknown;
};

export function listTransferTransformations(
  context: ApiContext,
  filters: { sourceComponent?: string; targetComponent?: string } = {}
) {
  const q = new URLSearchParams();
  if (filters.sourceComponent) q.set("sourceComponent", filters.sourceComponent);
  if (filters.targetComponent) q.set("targetComponent", filters.targetComponent);
  const qs = q.toString();
  return request<TransferTransformationSummary[]>(
    context,
    `/api/v1/integration/transfer-desk/transformations${qs ? `?${qs}` : ""}`
  );
}

export function getTransferTransformation(context: ApiContext, id: string) {
  return request<TransferTransformationDetail>(
    context,
    `/api/v1/integration/transfer-desk/transformations/${id}`
  );
}

export function createTransferTransformation(
  context: ApiContext,
  input: TransformationCreateInput
) {
  return request<TransferTransformationDetail>(
    context,
    "/api/v1/integration/transfer-desk/transformations",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function updateTransferTransformation(
  context: ApiContext,
  id: string,
  input: TransformationUpdateInput
) {
  return request<TransferTransformationDetail>(
    context,
    `/api/v1/integration/transfer-desk/transformations/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(input)
    }
  );
}

export type TransferProfileSummary = {
  id: string;
  name: string;
  description: string | null;
  profileType: TransferProfileType;
  sourceComponent: string | null;
  targetComponent: string | null;
  sourceFormatId: string | null;
  targetFormatId: string | null;
  transformationId: string | null;
  filterId: string | null;
  isValid: boolean;
  isActive: boolean;
  version: number;
  savePayload: "NONE" | "INPUT" | "OUTPUT" | "BOTH";
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  sourceFormat?: { id: string; name: string; classification: string } | null;
  targetFormat?: { id: string; name: string; classification: string } | null;
  transformation?: { id: string; name: string } | null;
  _count?: { executions: number; versions: number };
};

export type TransferProfileDetail = TransferProfileSummary & {
  sourceParams: Record<string, unknown> | null;
  targetParams: Record<string, unknown> | null;
  versions?: Array<{
    id: string;
    version: number;
    changedBy: string | null;
    changedAt: string;
    changeNote: string | null;
  }>;
};

export type TransferProfileInput = {
  name: string;
  description?: string;
  profileType: TransferProfileType;
  sourceComponent?: string;
  targetComponent?: string;
  sourceFormatId?: string;
  targetFormatId?: string;
  transformationId?: string;
  filterId?: string;
  sourceParams?: Record<string, unknown>;
  targetParams?: Record<string, unknown>;
  savePayload?: "NONE" | "INPUT" | "OUTPUT" | "BOTH";
};

export function listTransferProfiles(
  context: ApiContext,
  filters: { profileType?: TransferProfileType; isActive?: boolean } = {}
) {
  const q = new URLSearchParams();
  if (filters.profileType) q.set("profileType", filters.profileType);
  if (filters.isActive !== undefined) q.set("isActive", String(filters.isActive));
  const qs = q.toString();
  return request<TransferProfileSummary[]>(
    context,
    `/api/v1/integration/transfer-desk/profiles${qs ? `?${qs}` : ""}`
  );
}

export function getTransferProfile(context: ApiContext, profileId: string) {
  return request<TransferProfileDetail>(
    context,
    `/api/v1/integration/transfer-desk/profiles/${profileId}`
  );
}

export function createTransferProfile(context: ApiContext, payload: TransferProfileInput) {
  return request<TransferProfileDetail>(context, `/api/v1/integration/transfer-desk/profiles`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateTransferProfile(
  context: ApiContext,
  profileId: string,
  payload: Partial<TransferProfileInput>
) {
  return request<TransferProfileDetail>(
    context,
    `/api/v1/integration/transfer-desk/profiles/${profileId}`,
    { method: "PUT", body: JSON.stringify(payload) }
  );
}

export function deleteTransferProfile(context: ApiContext, profileId: string) {
  return request<{ id: string; isActive: false }>(
    context,
    `/api/v1/integration/transfer-desk/profiles/${profileId}`,
    { method: "DELETE" }
  );
}

export function cloneTransferProfile(context: ApiContext, profileId: string, newName: string) {
  return request<TransferProfileDetail>(
    context,
    `/api/v1/integration/transfer-desk/profiles/${profileId}/clone`,
    { method: "POST", body: JSON.stringify({ newName }) }
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Transfer Desk — Execution client (TD-API-001..006)
// ────────────────────────────────────────────────────────────────────────────

export type TransferExecutionStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type TransferExecutionSummary = {
  id: string;
  profileId: string;
  automationId: string | null;
  status: TransferExecutionStatus;
  jobId: string | null;
  triggeredBy: string | null;
  recordsTotal: number;
  recordsSucceeded: number;
  recordsFailed: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  profile?: { id: string; name: string; profileType: TransferProfileType };
  automation?: { id: string; name: string } | null;
};

export type TransferExecutionLog = {
  id: string;
  executionId: string;
  recordIndex: number;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  sourceData: unknown;
  transformedData: unknown;
  errorCode: string | null;
  errorMessage: string | null;
};

export function executeTransferProfile(
  context: ApiContext,
  profileId: string,
  payload: {
    sourceParamOverrides?: Record<string, unknown>;
    targetParamOverrides?: Record<string, unknown>;
    inputContent?: string;
  } = {}
) {
  return request<{ executionId: string; jobId: string; status: TransferExecutionStatus }>(
    context,
    `/api/v1/integration/transfer-desk/profiles/${profileId}/execute`,
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function listTransferExecutions(
  context: ApiContext,
  filters: {
    profileId?: string;
    status?: TransferExecutionStatus;
    limit?: number;
    offset?: number;
  } = {}
) {
  const q = new URLSearchParams();
  if (filters.profileId) q.set("profileId", filters.profileId);
  if (filters.status) q.set("status", filters.status);
  if (filters.limit) q.set("limit", String(filters.limit));
  if (filters.offset) q.set("offset", String(filters.offset));
  const qs = q.toString();
  return request<TransferExecutionSummary[]>(
    context,
    `/api/v1/integration/transfer-desk/executions${qs ? `?${qs}` : ""}`
  );
}

export function getTransferExecution(context: ApiContext, executionId: string) {
  return request<TransferExecutionSummary>(
    context,
    `/api/v1/integration/transfer-desk/executions/${executionId}`
  );
}

export function getTransferExecutionLogs(
  context: ApiContext,
  executionId: string,
  params: { limit?: number; offset?: number; statusFilter?: "SUCCESS" | "FAILED" | "SKIPPED" } = {}
) {
  const q = new URLSearchParams();
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  if (params.statusFilter) q.set("statusFilter", params.statusFilter);
  const qs = q.toString();
  return request<{ rows: TransferExecutionLog[]; total: number; take: number; skip: number }>(
    context,
    `/api/v1/integration/transfer-desk/executions/${executionId}/logs${qs ? `?${qs}` : ""}`
  );
}

export function cancelTransferExecution(context: ApiContext, executionId: string) {
  return request<TransferExecutionSummary>(
    context,
    `/api/v1/integration/transfer-desk/executions/${executionId}/cancel`,
    { method: "POST", body: "{}" }
  );
}
