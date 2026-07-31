/**
 * USALI Chart of Accounts Template
 *
 * Standard Uniform System of Accounts for the Lodging Industry.
 * Used by the setup wizard (step 3) and the demo seed script.
 */

export type UsaliAccountDef = {
  code: string;
  name: string;
  type: string;
  normalBalance: "DEBIT" | "CREDIT";
  usaliCategory?: string;
  usaliDepartment?: string;
  parentCode?: string;
  level: number;
  allowPosting: boolean;
};

export const USALI_ACCOUNTS: UsaliAccountDef[] = [
  {
    code: "1000",
    name: "Cash and Cash Equivalents",
    type: "ASSET",
    normalBalance: "DEBIT",
    usaliCategory: "Current Assets",
    level: 1,
    allowPosting: true
  },
  {
    code: "2000",
    name: "Accounts Payable Control",
    type: "LIABILITY",
    normalBalance: "CREDIT",
    usaliCategory: "Current Liabilities",
    level: 1,
    allowPosting: true
  },
  {
    code: "3000",
    name: "Retained Earnings",
    type: "EQUITY",
    normalBalance: "CREDIT",
    usaliCategory: "Equity",
    level: 1,
    allowPosting: true
  },
  {
    code: "4000",
    name: "Total Revenue",
    type: "REVENUE",
    normalBalance: "CREDIT",
    usaliCategory: "Revenue",
    level: 1,
    allowPosting: false
  },
  {
    code: "4100",
    name: "Rooms Revenue",
    type: "REVENUE",
    normalBalance: "CREDIT",
    usaliCategory: "Revenue",
    usaliDepartment: "Rooms",
    parentCode: "4000",
    level: 2,
    allowPosting: true
  },
  {
    code: "4200",
    name: "Food Revenue",
    type: "REVENUE",
    normalBalance: "CREDIT",
    usaliCategory: "Revenue",
    usaliDepartment: "Food and Beverage",
    parentCode: "4000",
    level: 2,
    allowPosting: true
  },
  {
    code: "4300",
    name: "Beverage Revenue",
    type: "REVENUE",
    normalBalance: "CREDIT",
    usaliCategory: "Revenue",
    usaliDepartment: "Food and Beverage",
    parentCode: "4000",
    level: 2,
    allowPosting: true
  },
  {
    code: "5000",
    name: "Total Departmental Expenses",
    type: "EXPENSE",
    normalBalance: "DEBIT",
    usaliCategory: "Departmental Expenses",
    level: 1,
    allowPosting: false
  },
  {
    code: "5100",
    name: "Rooms Payroll Expense",
    type: "EXPENSE",
    normalBalance: "DEBIT",
    usaliCategory: "Departmental Expenses",
    usaliDepartment: "Rooms",
    parentCode: "5000",
    level: 2,
    allowPosting: true
  },
  {
    code: "5200",
    name: "Food Cost Expense",
    type: "EXPENSE",
    normalBalance: "DEBIT",
    usaliCategory: "Departmental Expenses",
    usaliDepartment: "Food and Beverage",
    parentCode: "5000",
    level: 2,
    allowPosting: true
  },
  {
    code: "5300",
    name: "Admin and General Expense",
    type: "EXPENSE",
    normalBalance: "DEBIT",
    usaliCategory: "Undistributed Expenses",
    usaliDepartment: "Admin and General",
    parentCode: "5000",
    level: 2,
    allowPosting: true
  },
  {
    code: "5400",
    name: "Utilities Expense",
    type: "EXPENSE",
    normalBalance: "DEBIT",
    usaliCategory: "Undistributed Expenses",
    usaliDepartment: "Utilities",
    parentCode: "5000",
    level: 2,
    allowPosting: true
  }
];

export const SYSTEM_ACCOUNT_TYPES = [
  {
    id: "sys-acct-type-asset",
    code: "ASSET",
    name: "Assets",
    category: "BALANCE_SHEET" as const,
    normalBalance: "DEBIT" as const,
    sortOrder: 1
  },
  {
    id: "sys-acct-type-liability",
    code: "LIABILITY",
    name: "Liabilities",
    category: "BALANCE_SHEET" as const,
    normalBalance: "CREDIT" as const,
    sortOrder: 2
  },
  {
    id: "sys-acct-type-equity",
    code: "EQUITY",
    name: "Equity",
    category: "BALANCE_SHEET" as const,
    normalBalance: "CREDIT" as const,
    sortOrder: 3
  },
  {
    id: "sys-acct-type-revenue",
    code: "REVENUE",
    name: "Revenue",
    category: "INCOME" as const,
    normalBalance: "CREDIT" as const,
    sortOrder: 4
  },
  {
    id: "sys-acct-type-expense",
    code: "EXPENSE",
    name: "Expenses",
    category: "INCOME" as const,
    normalBalance: "DEBIT" as const,
    sortOrder: 5
  },
  {
    id: "sys-acct-type-statistical",
    code: "STATISTICAL",
    name: "Statistical",
    category: "STATISTICAL" as const,
    normalBalance: "DEBIT" as const,
    sortOrder: 6
  }
];
