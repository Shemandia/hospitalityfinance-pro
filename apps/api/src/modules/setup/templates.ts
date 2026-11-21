/**
 * Starting data the setup wizard offers a new tenant (GET /api/v1/setup/templates).
 *
 * Template data, not rules: the tenant administrator picks from it, adds to
 * it, and what they choose is stored as the tenant's own setup data. It lives
 * here, served by the API, so the web app holds no business lists.
 */

/** The USALI operated and undistributed departments, all pre-selected in the wizard. */
export const USALI_DEPARTMENTS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "ROOMS", name: "Rooms" },
  { code: "F_AND_B", name: "Food & Beverage" },
  { code: "SPA", name: "Spa" },
  { code: "GOLF", name: "Golf" },
  { code: "PARKING", name: "Parking" },
  { code: "TELECOM", name: "Telecommunications" },
  { code: "ADMIN_GENERAL", name: "Admin & General" },
  { code: "SALES_MARKETING", name: "Sales & Marketing" },
  { code: "PROPERTY_OPS", name: "Property Ops & Maintenance" },
  { code: "UTILITIES", name: "Utilities" },
  { code: "MGMT_FEES", name: "Management Fees" },
  { code: "NON_OPERATING", name: "Non-Operating" }
];

/** Currencies offered for functional, reporting and additional currencies (ISO 4217). */
export const SETUP_CURRENCY_CODES: readonly string[] = [
  "USD",
  "EUR",
  "GBP",
  "AED",
  "SAR",
  "QAR",
  "TZS",
  "KES",
  "ZAR",
  "INR",
  "CNY",
  "JPY",
  "SGD",
  "THB",
  "MYR",
  "IDR",
  "PHP",
  "AUD",
  "NZD",
  "CAD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "BRL",
  "MXN",
  "EGP",
  "MAD",
  "TND",
  "BHD",
  "KWD",
  "OMR",
  "JOD"
];

const currencyName = new Intl.DisplayNames(["en"], { type: "currency" });

export type SetupTemplates = {
  departments: Array<{ code: string; name: string }>;
  currencies: Array<{ code: string; name: string }>;
};

export function setupTemplates(): SetupTemplates {
  return {
    departments: USALI_DEPARTMENTS.map((d) => ({ ...d })),
    currencies: SETUP_CURRENCY_CODES.map((code) => ({ code, name: currencyName.of(code) ?? code }))
  };
}
