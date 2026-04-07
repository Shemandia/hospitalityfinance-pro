"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { WizardLayout, WizardStepContent } from "../../../../components/wizard-layout";
import { COUNTRIES } from "../../../../lib/countries";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

const STEPS = [
  { id: 1, name: "Organization Structure" },
  { id: 2, name: "Department Structure" },
  { id: 3, name: "Chart of Accounts" },
  { id: 4, name: "Fiscal Periods" },
  { id: 5, name: "Currencies & FX" },
  { id: 6, name: "Invite Users" }
];

const USALI_DEPARTMENTS = [
  { name: "Rooms", code: "ROOMS" },
  { name: "Food & Beverage", code: "F_AND_B" },
  { name: "Spa", code: "SPA" },
  { name: "Golf", code: "GOLF" },
  { name: "Parking", code: "PARKING" },
  { name: "Telecommunications", code: "TELECOM" },
  { name: "Admin & General", code: "ADMIN_GENERAL" },
  { name: "Sales & Marketing", code: "SALES_MARKETING" },
  { name: "Property Ops & Maintenance", code: "PROPERTY_OPS" },
  { name: "Utilities", code: "UTILITIES" },
  { name: "Management Fees", code: "MGMT_FEES" },
  { name: "Non-Operating", code: "NON_OPERATING" }
];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

const CURRENCIES = [
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

const USER_ROLES = ["ADMIN", "CONTROLLER", "ACCOUNTANT", "VIEWER"];

// ── Types ───────────────────────────────────────────────────────────────────

type Property = {
  name: string;
  code: string;
  city: string;
  countryCode: string;
  currency: string;
  timezone: string;
};

type Department = {
  name: string;
  code: string;
  enabled: boolean;
};

type InviteUser = {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  propertyAccess: string[]; // property codes
};

type StepData = {
  step1?: {
    corporate: {
      name: string;
      code: string;
      countryCode: string;
      functionalCurrency: string;
      reportingCurrency: string;
      timezone: string;
    };
    properties: Property[];
  };
  step2?: { departments: Department[] };
  step3?: { importMethod: string };
  step4?: { fiscalYearStartMonth: number; years: number[] };
  step5?: { additionalCurrencies: string[]; autoImportEcb: boolean };
  step6?: { invitations: { email: string; name: string; role: string; entityIds: string[] }[] };
};

// ── Component ───────────────────────────────────────────────────────────────

export default function SetupPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const tenantSlug = typeof params.tenant === "string" ? params.tenant : "";

  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [corporateName, setCorporateName] = useState("");
  const [corporateCode, setCorporateCode] = useState("");
  const [corporateCountry, setCorporateCountry] = useState("");
  const [functionalCurrency, setFunctionalCurrency] = useState("USD");
  const [reportingCurrency, setReportingCurrency] = useState("USD");
  const [corporateTimezone, setCorporateTimezone] = useState("UTC");
  const [properties, setProperties] = useState<Property[]>([
    { name: "", code: "", city: "", countryCode: "", currency: "USD", timezone: "UTC" }
  ]);

  // Step 2
  const [departments, setDepartments] = useState<Department[]>(
    USALI_DEPARTMENTS.map((d) => ({ ...d, enabled: true }))
  );
  const [customDeptName, setCustomDeptName] = useState("");
  const [customDeptCode, setCustomDeptCode] = useState("");

  // Step 3
  const [importMethod, setImportMethod] = useState("USALI_TEMPLATE");

  // Step 4
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(1);
  const [generateNextYear, setGenerateNextYear] = useState(false);

  // Step 5
  const [additionalCurrencies, setAdditionalCurrencies] = useState<string[]>([]);

  // Step 6
  const [invitedUsers, setInvitedUsers] = useState<InviteUser[]>([
    { email: "", firstName: "", lastName: "", role: "ACCOUNTANT", propertyAccess: [] }
  ]);

  const accessToken = session?.accessToken;

  const apiHeaders = useCallback((): HeadersInit => {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    };
    if (tenantSlug) headers["X-Tenant-Slug"] = tenantSlug;
    return headers;
  }, [accessToken, tenantSlug]);

  // ── Load progress ───────────────────────────────────────────────────────

  useEffect(() => {
    if (status === "loading") return;
    if (!accessToken) return;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/setup/progress`, {
          headers: apiHeaders()
        });
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const json = await res.json();
        const { currentStep: step, completedSteps: completed, stepData } = json.data;

        if (json.data.isCompleted) {
          router.replace(`/${tenantSlug}/dashboard`);
          return;
        }

        if (completed) setCompletedSteps(completed);
        if (step) setCurrentStep(step);

        // Pre-fill from tenant info (provisioning data) if step 1 not yet saved
        const tenantInfo = json.data.tenantInfo;

        // Restore form state from stepData
        if (stepData) {
          const sd = stepData as StepData;
          if (sd.step1?.corporate) {
            setCorporateName(sd.step1.corporate.name ?? "");
            setCorporateCode(sd.step1.corporate.code ?? "");
            setCorporateCountry(sd.step1.corporate.countryCode ?? "");
            setFunctionalCurrency(sd.step1.corporate.functionalCurrency ?? "USD");
            setReportingCurrency(sd.step1.corporate.reportingCurrency ?? "USD");
            setCorporateTimezone(sd.step1.corporate.timezone ?? "UTC");
            if (sd.step1.properties?.length) setProperties(sd.step1.properties);
          } else if (tenantInfo) {
            // Pre-fill from provisioning data (countryCode, maxProperties from registry)
            setCorporateName(tenantInfo.name ?? "");
            if (tenantInfo.countryCode) setCorporateCountry(tenantInfo.countryCode);
          }
          if (sd.step2?.departments?.length) setDepartments(sd.step2.departments);
          if (sd.step3) setImportMethod(sd.step3.importMethod ?? "USALI_TEMPLATE");
          if (sd.step4) {
            setFiscalYearStartMonth(sd.step4.fiscalYearStartMonth ?? 1);
            setGenerateNextYear((sd.step4.years?.length ?? 0) > 1);
          }
          if (sd.step5) {
            setAdditionalCurrencies(sd.step5.additionalCurrencies ?? []);
          }
          if (sd.step6?.invitations?.length) {
            setInvitedUsers(
              sd.step6.invitations.map((inv) => ({
                email: inv.email,
                firstName: inv.name.split(" ")[0] ?? "",
                lastName: inv.name.split(" ").slice(1).join(" ") ?? "",
                role: inv.role,
                propertyAccess: []
              }))
            );
          }
        }
      } catch {
        // progress endpoint not available, start fresh
      }
      setLoading(false);
    })();
  }, [status, accessToken, apiHeaders, router]);

  // ── Helpers ─────────────────────────────────────────────────────────────

  const getStepPayload = (step: number) => {
    switch (step) {
      case 1:
        return {
          corporate: {
            name: corporateName,
            code: corporateCode,
            countryCode: corporateCountry,
            functionalCurrency,
            reportingCurrency,
            timezone: corporateTimezone
          },
          properties: properties.map((p) => ({
            name: p.name,
            code: p.code,
            countryCode: p.countryCode,
            currency: p.currency || functionalCurrency,
            timezone: p.timezone || corporateTimezone
          }))
        };
      case 2:
        return {
          departments: departments
            .filter((d) => d.enabled)
            .map((d) => ({ name: d.name, code: d.code, isActive: true }))
        };
      case 3:
        return { importMethod: importMethod.toLowerCase() };
      case 4: {
        const currentYear = new Date().getFullYear();
        const years = generateNextYear ? [currentYear, currentYear + 1] : [currentYear];
        return { fiscalYearStartMonth, years };
      }
      case 5:
        return { additionalCurrencies, autoImportEcb: false };
      case 6:
        return {
          invitations: invitedUsers
            .filter((u) => u.email.trim())
            .map((u) => ({
              email: u.email,
              name: `${u.firstName} ${u.lastName}`.trim(),
              role: u.role === "ACCOUNTANT" ? "CONTROLLER" : u.role,
              entityIds: []
            }))
        };
      default:
        return {};
    }
  };

  const saveStep = async (step: number, saveOnly = false) => {
    setError(null);
    setSaving(true);
    try {
      const url = `${API_BASE}/api/v1/setup/steps/${step}${saveOnly ? "?saveOnly=true" : ""}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: apiHeaders(),
        body: JSON.stringify(getStepPayload(step))
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Failed to save step ${step}`);
        setSaving(false);
        return false;
      }
      setSaving(false);
      return true;
    } catch {
      setError("Cannot reach the API server.");
      setSaving(false);
      return false;
    }
  };

  const handleNext = async () => {
    const ok = await saveStep(currentStep);
    if (!ok) return;
    setCompletedSteps((prev) => (prev.includes(currentStep) ? prev : [...prev, currentStep]));
    setCurrentStep((s) => s + 1);
  };

  const handleSave = async () => {
    await saveStep(currentStep, true);
  };

  const handleBack = () => setCurrentStep((s) => s - 1);

  const handleComplete = async () => {
    const ok = await saveStep(6);
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/setup/complete`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({})
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? "Failed to complete setup.");
        setSaving(false);
        return;
      }
      router.replace(`/${tenantSlug}/dashboard`);
    } catch {
      setError("Cannot reach the API server.");
      setSaving(false);
    }
  };

  // ── Property helpers ────────────────────────────────────────────────────

  const addProperty = () =>
    setProperties((prev) => [
      ...prev,
      {
        name: "",
        code: "",
        city: "",
        countryCode: corporateCountry,
        currency: functionalCurrency,
        timezone: corporateTimezone
      }
    ]);

  const removeProperty = (idx: number) => setProperties((prev) => prev.filter((_, i) => i !== idx));

  const updateProperty = (idx: number, field: keyof Property, value: string) =>
    setProperties((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));

  // ── Department helpers ──────────────────────────────────────────────────

  const toggleDept = (code: string) =>
    setDepartments((prev) =>
      prev.map((d) => (d.code === code ? { ...d, enabled: !d.enabled } : d))
    );

  const addCustomDept = () => {
    if (!customDeptName.trim() || !customDeptCode.trim()) return;
    setDepartments((prev) => [
      ...prev,
      { name: customDeptName.trim(), code: customDeptCode.trim().toUpperCase(), enabled: true }
    ]);
    setCustomDeptName("");
    setCustomDeptCode("");
  };

  // ── User invite helpers ─────────────────────────────────────────────────

  const addUser = () =>
    setInvitedUsers((prev) => [
      ...prev,
      { email: "", firstName: "", lastName: "", role: "ACCOUNTANT", propertyAccess: [] }
    ]);

  const removeUser = (idx: number) => setInvitedUsers((prev) => prev.filter((_, i) => i !== idx));

  const updateUser = (idx: number, field: keyof InviteUser, value: string | string[]) =>
    setInvitedUsers((prev) => prev.map((u, i) => (i === idx ? { ...u, [field]: value } : u)));

  const toggleUserProperty = (userIdx: number, propertyCode: string) =>
    setInvitedUsers((prev) =>
      prev.map((u, i) =>
        i === userIdx
          ? {
              ...u,
              propertyAccess: u.propertyAccess.includes(propertyCode)
                ? u.propertyAccess.filter((c) => c !== propertyCode)
                : [...u.propertyAccess, propertyCode]
            }
          : u
      )
    );

  // ── Fiscal period preview ───────────────────────────────────────────────

  const getFiscalPeriods = () => {
    const currentYear = new Date().getFullYear();
    const years = generateNextYear ? [currentYear, currentYear + 1] : [currentYear];
    const periods: { year: number; month: string; start: string; end: string }[] = [];

    for (const year of years) {
      for (let i = 0; i < 12; i++) {
        const monthIdx = (fiscalYearStartMonth - 1 + i) % 12;
        const periodYear = fiscalYearStartMonth - 1 + i >= 12 ? year + 1 : year;
        const start = `${periodYear}-${String(monthIdx + 1).padStart(2, "0")}-01`;
        const lastDay = new Date(periodYear, monthIdx + 1, 0).getDate();
        const end = `${periodYear}-${String(monthIdx + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        periods.push({ year, month: MONTH_NAMES[monthIdx], start, end });
      }
    }
    return periods;
  };

  // ── Render ──────────────────────────────────────────────────────────────

  if (status === "loading" || loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-slate-500">Loading setup wizard...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    router.replace(`/${tenantSlug}/login`);
    return null;
  }

  const propertyCodes = properties.filter((p) => p.code.trim()).map((p) => p.code);

  return (
    <WizardLayout
      title="Tenant Setup"
      steps={STEPS}
      currentStep={currentStep}
      completedSteps={completedSteps}
      onStepClick={setCurrentStep}
    >
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Step 1: Organization Structure ─────────────────────────────────── */}
      {currentStep === 1 && (
        <WizardStepContent
          stepNumber={1}
          totalSteps={6}
          title="Organization Structure"
          description="Define your corporate entity and hotel properties"
          onNext={handleNext}
          onSave={handleSave}
          showSave
          isLoading={saving}
          isNextDisabled={
            !corporateName.trim() ||
            !corporateCode.trim() ||
            !corporateCountry ||
            properties.length === 0 ||
            !properties[0].name.trim() ||
            !properties[0].code.trim()
          }
        >
          <div className="space-y-6">
            {/* Corporate entity */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-slate-700">Corporate Entity</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    Corporate Name *
                  </label>
                  <input
                    type="text"
                    value={corporateName}
                    onChange={(e) => setCorporateName(e.target.value)}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    placeholder="Corporate entity name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Code *</label>
                  <input
                    type="text"
                    value={corporateCode}
                    onChange={(e) => setCorporateCode(e.target.value.toUpperCase())}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono"
                    placeholder="EHG"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Country *</label>
                  <select
                    value={corporateCountry}
                    onChange={(e) => setCorporateCountry(e.target.value)}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  >
                    <option value="">Select a country...</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Timezone *</label>
                  <select
                    value={corporateTimezone}
                    onChange={(e) => setCorporateTimezone(e.target.value)}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  >
                    {[
                      "UTC",
                      "Africa/Dar_es_Salaam",
                      "Africa/Nairobi",
                      "Africa/Johannesburg",
                      "Asia/Dubai",
                      "Asia/Riyadh",
                      "Asia/Singapore",
                      "Asia/Bangkok",
                      "Asia/Tokyo",
                      "Europe/London",
                      "Europe/Paris",
                      "Europe/Zurich",
                      "America/New_York",
                      "America/Chicago",
                      "America/Los_Angeles",
                      "Australia/Sydney",
                      "Pacific/Auckland"
                    ].map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    Functional Currency *
                  </label>
                  <select
                    value={functionalCurrency}
                    onChange={(e) => setFunctionalCurrency(e.target.value)}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    Reporting Currency *
                  </label>
                  <select
                    value={reportingCurrency}
                    onChange={(e) => setReportingCurrency(e.target.value)}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Properties */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">Properties</h4>
                <button
                  type="button"
                  onClick={addProperty}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  + Add Property
                </button>
              </div>
              {properties.map((prop, idx) => (
                <div key={idx} className="rounded-md border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500">Property {idx + 1}</span>
                    {properties.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeProperty(idx)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600">Name *</label>
                      <input
                        type="text"
                        value={prop.name}
                        onChange={(e) => updateProperty(idx, "name", e.target.value)}
                        className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                        placeholder="Property name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600">Code *</label>
                      <input
                        type="text"
                        value={prop.code}
                        onChange={(e) => updateProperty(idx, "code", e.target.value.toUpperCase())}
                        className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm font-mono"
                        placeholder="JBH"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600">City</label>
                      <input
                        type="text"
                        value={prop.city}
                        onChange={(e) => updateProperty(idx, "city", e.target.value)}
                        className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                        placeholder="Dubai"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600">Country *</label>
                      <select
                        value={prop.countryCode}
                        onChange={(e) => updateProperty(idx, "countryCode", e.target.value)}
                        className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                      >
                        <option value="">Select...</option>
                        {COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600">Currency *</label>
                      <select
                        value={prop.currency}
                        onChange={(e) => updateProperty(idx, "currency", e.target.value)}
                        className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                      >
                        {CURRENCIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600">Timezone *</label>
                      <select
                        value={prop.timezone}
                        onChange={(e) => updateProperty(idx, "timezone", e.target.value)}
                        className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                      >
                        {[
                          "UTC",
                          "Africa/Dar_es_Salaam",
                          "Africa/Nairobi",
                          "Africa/Johannesburg",
                          "Asia/Dubai",
                          "Asia/Riyadh",
                          "Asia/Singapore",
                          "Asia/Bangkok",
                          "Asia/Tokyo",
                          "Europe/London",
                          "Europe/Paris",
                          "Europe/Zurich",
                          "America/New_York",
                          "America/Chicago",
                          "America/Los_Angeles",
                          "Australia/Sydney",
                          "Pacific/Auckland"
                        ].map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </WizardStepContent>
      )}

      {/* ── Step 2: Department Structure ───────────────────────────────────── */}
      {currentStep === 2 && (
        <WizardStepContent
          stepNumber={2}
          totalSteps={6}
          title="Department Structure"
          description="Select USALI departments and add custom ones"
          onBack={handleBack}
          onNext={handleNext}
          onSave={handleSave}
          showSave
          isLoading={saving}
          isNextDisabled={departments.filter((d) => d.enabled).length === 0}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {departments.map((dept) => (
                <label
                  key={dept.code}
                  className="flex items-center gap-2 rounded border p-2.5 text-sm cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={dept.enabled}
                    onChange={() => toggleDept(dept.code)}
                  />
                  <span>{dept.name}</span>
                  <span className="ml-auto text-xs font-mono text-slate-400">{dept.code}</span>
                </label>
              ))}
            </div>
            <div className="border-t pt-4">
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Add Custom Department</h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customDeptName}
                  onChange={(e) => setCustomDeptName(e.target.value)}
                  className="flex-1 rounded-md border px-3 py-1.5 text-sm"
                  placeholder="Department name"
                />
                <input
                  type="text"
                  value={customDeptCode}
                  onChange={(e) => setCustomDeptCode(e.target.value.toUpperCase())}
                  className="w-32 rounded-md border px-3 py-1.5 text-sm font-mono"
                  placeholder="CODE"
                />
                <button
                  type="button"
                  onClick={addCustomDept}
                  disabled={!customDeptName.trim() || !customDeptCode.trim()}
                  className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </WizardStepContent>
      )}

      {/* ── Step 3: Chart of Accounts ──────────────────────────────────────── */}
      {currentStep === 3 && (
        <WizardStepContent
          stepNumber={3}
          totalSteps={6}
          title="Chart of Accounts"
          description="Choose how to set up your chart of accounts"
          onBack={handleBack}
          onNext={handleNext}
          onSave={handleSave}
          showSave
          isLoading={saving}
        >
          <div className="space-y-3">
            {[
              {
                value: "USALI_TEMPLATE",
                label: "USALI Template",
                desc: "Start with the standard Uniform System of Accounts for the Lodging Industry. Recommended for most hotels.",
                recommended: true
              },
              {
                value: "UPLOAD_EXCEL",
                label: "Upload Excel",
                desc: "Import your existing chart of accounts from an Excel spreadsheet.",
                recommended: false
              },
              {
                value: "START_BLANK",
                label: "Start Blank",
                desc: "Create your chart of accounts from scratch. Best for non-standard setups.",
                recommended: false
              }
            ].map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer gap-3 rounded-md border p-4 transition-colors ${
                  importMethod === opt.value
                    ? "border-blue-500 bg-blue-50"
                    : "hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="importMethod"
                  value={opt.value}
                  checked={importMethod === opt.value}
                  onChange={(e) => setImportMethod(e.target.value)}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium text-slate-900">{opt.label}</span>
                  {opt.recommended && (
                    <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      Recommended
                    </span>
                  )}
                  <p className="mt-1 text-xs text-slate-500">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </WizardStepContent>
      )}

      {/* ── Step 4: Fiscal Periods ─────────────────────────────────────────── */}
      {currentStep === 4 && (
        <WizardStepContent
          stepNumber={4}
          totalSteps={6}
          title="Fiscal Periods"
          description="Configure your fiscal year and generate accounting periods"
          onBack={handleBack}
          onNext={handleNext}
          onSave={handleSave}
          showSave
          isLoading={saving}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Fiscal Year Start Month *
                </label>
                <select
                  value={fiscalYearStartMonth}
                  onChange={(e) => setFiscalYearStartMonth(parseInt(e.target.value))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                >
                  {MONTH_NAMES.map((m, idx) => (
                    <option key={m} value={idx + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={generateNextYear}
                    onChange={(e) => setGenerateNextYear(e.target.checked)}
                  />
                  Also generate next year
                </label>
              </div>
            </div>

            {/* Preview table */}
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Period Preview</h4>
              <div className="max-h-64 overflow-y-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Period</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Start</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">End</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {getFiscalPeriods().map((p, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5">
                          {p.month} {p.year}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-slate-500">{p.start}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-500">{p.end}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </WizardStepContent>
      )}

      {/* ── Step 5: Currencies & FX ────────────────────────────────────────── */}
      {currentStep === 5 && (
        <WizardStepContent
          stepNumber={5}
          totalSteps={6}
          title="Currencies & FX"
          description="Set your functional currency and additional reporting currencies"
          onBack={handleBack}
          onNext={handleNext}
          onSave={handleSave}
          showSave
          isLoading={saving}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">
                Functional Currency
              </label>
              <input
                type="text"
                value={functionalCurrency}
                readOnly
                className="mt-1 w-full rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-500"
              />
              <p className="mt-1 text-xs text-slate-400">
                Set in Step 1 (Organization Structure). Go back to change it.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Additional Currencies
              </label>
              <div className="grid grid-cols-4 gap-2">
                {CURRENCIES.filter((c) => c !== functionalCurrency).map((cur) => (
                  <label
                    key={cur}
                    className="flex items-center gap-1.5 rounded border p-2 text-sm cursor-pointer hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={additionalCurrencies.includes(cur)}
                      onChange={(e) => {
                        setAdditionalCurrencies((prev) =>
                          e.target.checked ? [...prev, cur] : prev.filter((c) => c !== cur)
                        );
                      }}
                    />
                    {cur}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </WizardStepContent>
      )}

      {/* ── Step 6: Invite Users ───────────────────────────────────────────── */}
      {currentStep === 6 && (
        <WizardStepContent
          stepNumber={6}
          totalSteps={6}
          title="Invite Users"
          description="Invite team members to the platform"
          onBack={handleBack}
          onNext={handleComplete}
          onSave={handleSave}
          showSave
          isLoading={saving}
          nextLabel="Complete Setup"
        >
          <div className="space-y-4">
            {invitedUsers.map((user, idx) => (
              <div key={idx} className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">User {idx + 1}</span>
                  {invitedUsers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeUser(idx)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600">Email *</label>
                    <input
                      type="email"
                      value={user.email}
                      onChange={(e) => updateUser(idx, "email", e.target.value)}
                      className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                      placeholder="user@company.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600">First Name</label>
                    <input
                      type="text"
                      value={user.firstName}
                      onChange={(e) => updateUser(idx, "firstName", e.target.value)}
                      className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600">Last Name</label>
                    <input
                      type="text"
                      value={user.lastName}
                      onChange={(e) => updateUser(idx, "lastName", e.target.value)}
                      className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">Role *</label>
                  <select
                    value={user.role}
                    onChange={(e) => updateUser(idx, "role", e.target.value)}
                    className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                  >
                    {USER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r.charAt(0) + r.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </div>
                {propertyCodes.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Property Access
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {propertyCodes.map((code) => (
                        <label
                          key={code}
                          className="flex items-center gap-1 rounded border px-2 py-1 text-xs cursor-pointer hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={user.propertyAccess.includes(code)}
                            onChange={() => toggleUserProperty(idx, code)}
                          />
                          {code}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addUser}
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              + Add Another User
            </button>
          </div>
        </WizardStepContent>
      )}
    </WizardLayout>
  );
}
