/**
 * The permission catalogue and the roles every tenant starts with.
 *
 * This is the one list of permission codes the routes may name
 * (tests/route-access.test.ts checks that) and the one definition of the
 * starting roles. The seed and tenant provisioning write it to the database;
 * after that a tenant's roles are data and can be changed in the admin screens.
 */

export type SystemPermission = { code: string; description: string; category: string };

export type SystemRole = {
  code: string;
  name: string;
  description: string;
  /** System roles can only be granted by an administrator with tenant-wide reach. */
  isSystem: boolean;
  permissions: string[];
};

/** The role provisioning gives a tenant's first administrator, tenant-wide. */
export const TENANT_ADMIN_ROLE_CODE = "TENANT_ADMIN";

export const SYSTEM_PERMISSIONS: ReadonlyArray<SystemPermission> = [
  // GL & Journals
  {
    code: "GL_READ",
    description: "View chart of accounts, journals, trial balance",
    category: "General Ledger"
  },
  {
    code: "GL_WRITE",
    description: "Create and edit journals, accounts",
    category: "General Ledger"
  },
  { code: "GL_POST", description: "Post journals", category: "General Ledger" },
  { code: "GL_REVERSE", description: "Reverse posted journals", category: "General Ledger" },
  { code: "GL_APPROVE", description: "Approve journal entries", category: "General Ledger" },
  // Chart of Accounts
  { code: "COA_READ", description: "View chart of accounts", category: "Chart of Accounts" },
  { code: "COA_CREATE", description: "Create new accounts", category: "Chart of Accounts" },
  { code: "COA_EDIT", description: "Edit existing accounts", category: "Chart of Accounts" },
  // Accounts Payable
  {
    code: "AP_READ",
    description: "View suppliers, invoices, payment runs",
    category: "Accounts Payable"
  },
  {
    code: "AP_WRITE",
    description: "Create invoices, manage suppliers",
    category: "Accounts Payable"
  },
  { code: "AP_APPROVE", description: "Approve AP invoices", category: "Accounts Payable" },
  {
    code: "AP_PAYMENT_CONFIRM",
    description: "Confirm and process payment runs",
    category: "Accounts Payable"
  },
  // Payment Runs
  { code: "PAYMENT_RUN_READ", description: "View payment runs", category: "Payment Runs" },
  { code: "PAYMENT_RUN_CREATE", description: "Create payment runs", category: "Payment Runs" },
  { code: "PAYMENT_RUN_APPROVE", description: "Approve payment runs", category: "Payment Runs" },
  // Accounts Receivable
  {
    code: "AR_READ",
    description: "View customers, invoices, ageing",
    category: "Accounts Receivable"
  },
  {
    code: "AR_WRITE",
    description: "Create AR invoices, receipts, allocations",
    category: "Accounts Receivable"
  },
  { code: "AR_DUNNING", description: "Run dunning process", category: "Accounts Receivable" },
  // Budget
  {
    code: "BUDGET_READ",
    description: "View budget definitions and variance",
    category: "Budget"
  },
  {
    code: "BUDGET_WRITE",
    description: "Create and edit budgets, import Excel",
    category: "Budget"
  },
  { code: "BUDGET_APPROVE", description: "Approve budgets", category: "Budget" },
  // FX & Currencies
  { code: "FX_READ", description: "View FX rates and currencies", category: "FX & Currencies" },
  {
    code: "FX_WRITE",
    description: "Manage FX rates, run revaluation",
    category: "FX & Currencies"
  },
  // Reporting
  { code: "REPORT_READ", description: "View and download reports", category: "Reporting" },
  {
    code: "REPORT_WRITE",
    description: "Create report definitions, run reports",
    category: "Reporting"
  },
  { code: "REPORT_EXPORT", description: "Export reports to PDF/Excel", category: "Reporting" },
  {
    code: "REPORT_CREATE_CUSTOM",
    description: "Create custom report templates",
    category: "Reporting"
  },
  // Period Management
  { code: "PERIOD_READ", description: "View accounting periods", category: "Period Management" },
  {
    code: "PERIOD_MANAGE",
    description: "Open, close, lock periods",
    category: "Period Management"
  },
  { code: "PERIOD_REOPEN", description: "Reopen locked periods", category: "Period Management" },
  // Transfer Desk
  {
    code: "TRANSFER_DESK_READ",
    description: "View import profiles and execution history",
    category: "Transfer Desk"
  },
  {
    code: "TRANSFER_DESK_EXECUTE",
    description: "Execute import profiles",
    category: "Transfer Desk"
  },
  {
    code: "TRANSFER_DESK_CONFIG",
    description: "Configure profiles, formats, transformations",
    category: "Transfer Desk"
  },
  // Integrations
  {
    code: "INTEGRATION_READ",
    description: "View import logs and connector mappings",
    category: "Integrations"
  },
  {
    code: "INTEGRATION_IMPORT",
    description: "Run PMS/POS/payroll imports",
    category: "Integrations"
  },
  {
    code: "INTEGRATION_CONFIG",
    description: "Configure connectors and mappings",
    category: "Integrations"
  },
  // Intercompany
  {
    code: "IC_READ",
    description: "View intercompany transactions and balances",
    category: "Intercompany"
  },
  {
    code: "IC_CREATE",
    description: "Create intercompany transactions",
    category: "Intercompany"
  },
  {
    code: "IC_APPROVE",
    description: "Approve intercompany transactions",
    category: "Intercompany"
  },
  {
    code: "IC_REVERSE",
    description: "Reverse posted intercompany transactions",
    category: "Intercompany"
  },
  {
    code: "IC_CONFIG",
    description: "Configure IC entity pairs and account mappings",
    category: "Intercompany"
  },
  {
    code: "IC_RECONCILE",
    description: "Run IC reconciliation and create snapshots",
    category: "Intercompany"
  },
  // Consolidation
  {
    code: "CONSOLIDATION_RUN",
    description: "Run multi-entity consolidation",
    category: "Consolidation"
  },
  // Statistics
  { code: "STATS_READ", description: "View operational statistics", category: "Statistics" },
  { code: "STATS_IMPORT", description: "Import statistics from PMS", category: "Statistics" },
  // Audit
  { code: "AUDIT_READ", description: "View audit log", category: "Audit" },
  // User Management
  {
    code: "ADMIN_USERS_READ",
    description: "View users and role assignments",
    category: "User Management"
  },
  {
    code: "ADMIN_USERS",
    description: "Create, edit, and manage users",
    category: "User Management"
  },
  {
    code: "ADMIN_ROLES_MANAGE",
    description: "Create, edit, and delete roles and permissions",
    category: "User Management"
  },
  // System Administration
  {
    code: "ADMIN_SETTINGS",
    description: "Manage entity settings, properties, journal types",
    category: "System Administration"
  },
  {
    code: "ADMIN_ENTITIES",
    description: "Manage entity hierarchy and assignments",
    category: "System Administration"
  },
  {
    code: "ADMIN_AUDIT_LOG",
    description: "Access full system audit log",
    category: "System Administration"
  }
];

export const SYSTEM_ROLES: ReadonlyArray<SystemRole> = [
  {
    code: "VIEWER",
    name: "Viewer",
    description: "Read-only access to dashboards, reports, and financial data",
    isSystem: false,
    permissions: [
      "GL_READ",
      "COA_READ",
      "AP_READ",
      "AR_READ",
      "BUDGET_READ",
      "FX_READ",
      "REPORT_READ",
      "PERIOD_READ",
      "AUDIT_READ",
      "INTEGRATION_READ",
      "TRANSFER_DESK_READ",
      "STATS_READ",
      "PAYMENT_RUN_READ",
      "ADMIN_USERS_READ"
    ]
  },
  {
    code: "CONTROLLER",
    name: "Controller",
    description: "Can post journals, approve invoices, close periods, and run reports",
    isSystem: false,
    permissions: [
      "GL_READ",
      "GL_WRITE",
      "GL_POST",
      "GL_APPROVE",
      "COA_READ",
      "COA_CREATE",
      "COA_EDIT",
      "AP_READ",
      "AP_WRITE",
      "AP_APPROVE",
      "PAYMENT_RUN_READ",
      "PAYMENT_RUN_CREATE",
      "AR_READ",
      "AR_WRITE",
      "AR_DUNNING",
      "BUDGET_READ",
      "BUDGET_WRITE",
      "FX_READ",
      "FX_WRITE",
      "REPORT_READ",
      "REPORT_WRITE",
      "REPORT_EXPORT",
      "PERIOD_READ",
      "PERIOD_MANAGE",
      "AUDIT_READ",
      "INTEGRATION_READ",
      "TRANSFER_DESK_READ",
      "TRANSFER_DESK_EXECUTE",
      "STATS_READ",
      "STATS_IMPORT",
      "ADMIN_USERS_READ"
    ]
  },
  {
    code: "ADMIN",
    name: "Administrator",
    description: "Full module access including imports, payment runs, user management",
    isSystem: false,
    permissions: SYSTEM_PERMISSIONS.filter((p) => p.code !== "PERIOD_REOPEN").map((p) => p.code)
  },
  {
    code: TENANT_ADMIN_ROLE_CODE,
    name: "Tenant Administrator",
    description: "Full system access — manages users, roles, entities, and all modules",
    isSystem: true,
    permissions: SYSTEM_PERMISSIONS.map((p) => p.code)
  }
];
