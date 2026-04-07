"use client";

import { useEffect, useState } from "react";
import { WizardLayout, WizardStepContent } from "../../../../../components/wizard-layout";
import { COUNTRIES } from "../../../../../lib/countries";
import { Check, Loader2, AlertTriangle, ExternalLink, FileText } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

const STEPS = [
  { id: 1, name: "Tenant Details" },
  { id: 2, name: "Entitlements" },
  { id: 3, name: "Review & Provision" }
];

const MODULES = ["GL", "AP", "AR", "TRANSFER_DESK", "REPORTING", "FIXED_ASSETS"];

type TenantData = {
  name: string;
  slug: string;
  domain: string;
  adminEmail: string;
  countryCode: string;
};

type EntitlementData = {
  licenseType: "TRIAL" | "STANDARD" | "ENTERPRISE";
  maxProperties: number;
  maxUsers: number;
  enabledModules: string[];
  maxConcurrentSessions: number;
  subscriptionStartDate: string;
  subscriptionEndDate: string;
};

type AdminData = {
  firstName: string;
  lastName: string;
  email: string;
  temporaryPassword: string;
  phone: string;
};

type ProvisioningStep = {
  step: string;
  order: number;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  error?: string;
};

// ── Shared Styles ───────────────────────────────────────────────────────────

const inputClass =
  "w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all";

const labelClass =
  "block text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em] mb-1.5";

// ── Platform Key Gate ───────────────────────────────────────────────────────

export default function OnboardPage() {
  const [platformKey, setPlatformKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const stored = sessionStorage.getItem("hfp-platform-key");
    if (stored) setPlatformKey(stored);
    setChecking(false);
  }, []);

  const handleKeySubmit = async () => {
    setKeyError("");
    try {
      const res = await fetch(`${API_BASE}/api/v1/platform/tenants`, {
        headers: { "X-Platform-Key": keyInput }
      });
      if (res.ok) {
        sessionStorage.setItem("hfp-platform-key", keyInput);
        setPlatformKey(keyInput);
      } else {
        setKeyError("Invalid platform key. Check with your administrator.");
      }
    } catch {
      setKeyError("Cannot reach API server.");
    }
  };

  if (checking) return null;

  if (!platformKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc]">
        <div className="w-full max-w-sm">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.03)] overflow-hidden">
            <div className="p-8 space-y-5">
              <div>
                <h2 className="text-[32px] font-extrabold text-slate-900 tracking-[-0.02em] leading-tight">
                  Platform Authentication
                </h2>
                <p className="mt-2 text-base text-slate-500">
                  Enter your platform API key to access tenant management.
                </p>
              </div>
              <div>
                <label className={labelClass}>Platform API Key</label>
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleKeySubmit()}
                  className={inputClass}
                  placeholder="Enter your platform key"
                />
              </div>
              {keyError && <p className="text-sm text-red-500">{keyError}</p>}
              <button
                onClick={handleKeySubmit}
                disabled={!keyInput}
                className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white shadow-[0_4px_12px_rgba(15,23,42,0.2)] hover:bg-slate-800 transition-all disabled:opacity-50"
              >
                Authenticate
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <OnboardWizard platformKey={platformKey} />;
}

// ── Onboard Wizard ──────────────────────────────────────────────────────────

function OnboardWizard({ platformKey }: { platformKey: string }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [slugEdited, setSlugEdited] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisioningSteps, setProvisioningSteps] = useState<ProvisioningStep[]>([]);
  const [provisionResult, setProvisionResult] = useState<{
    tenantId: string;
    slug: string;
    url: string;
  } | null>(null);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  const [tenant, setTenant] = useState<TenantData>({
    name: "",
    slug: "",
    domain: "",
    adminEmail: "",
    countryCode: ""
  });

  const [entitlements, setEntitlements] = useState<EntitlementData>({
    licenseType: "STANDARD",
    maxProperties: 10,
    maxUsers: 50,
    enabledModules: ["GL", "AP", "AR", "REPORTING"],
    maxConcurrentSessions: 10,
    subscriptionStartDate: new Date().toISOString().split("T")[0],
    subscriptionEndDate: ""
  });

  const [admin, setAdmin] = useState<AdminData>({
    firstName: "",
    lastName: "",
    email: "",
    temporaryPassword: "",
    phone: ""
  });

  const generateSlug = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);

  const getInitials = (name: string) =>
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  const selectedCountry = COUNTRIES.find((c) => c.code === tenant.countryCode);

  const handleNext = () => {
    if (currentStep === 1 && admin.email === "") {
      setAdmin((a) => ({ ...a, email: tenant.adminEmail }));
    }
    setCompletedSteps((prev) => (prev.includes(currentStep) ? prev : [...prev, currentStep]));
    setCurrentStep((s) => s + 1);
  };

  const handleBack = () => setCurrentStep((s) => s - 1);

  const handleProvision = async () => {
    setProvisioning(true);
    setProvisionError(null);
    setProvisioningSteps([
      { step: "creating_database", order: 1, status: "PENDING" },
      { step: "running_migrations", order: 2, status: "PENDING" },
      { step: "applying_security", order: 3, status: "PENDING" },
      { step: "creating_auth", order: 4, status: "PENDING" },
      { step: "seeding_data", order: 5, status: "PENDING" },
      { step: "sending_email", order: 6, status: "PENDING" }
    ]);

    try {
      const response = await fetch(`${API_BASE}/api/v1/platform/tenants/provision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Platform-Key": platformKey
        },
        body: JSON.stringify({
          tenant: {
            name: tenant.name,
            slug: tenant.slug,
            domain: tenant.domain || undefined,
            adminEmail: tenant.adminEmail,
            countryCode: tenant.countryCode
          },
          entitlements: {
            ...entitlements,
            subscriptionEndDate: entitlements.subscriptionEndDate || undefined
          },
          adminUser: {
            firstName: admin.firstName,
            lastName: admin.lastName,
            email: admin.email,
            temporaryPassword: admin.temporaryPassword,
            phone: admin.phone || undefined
          }
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const msg =
          errorBody?.errors?.map((e: any) => e.message).join("; ") ??
          `Server error: ${response.status}`;
        setProvisionError(msg);
        setProvisioning(false);
        return;
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            if (eventType === "step" || eventType === "error") {
              setProvisioningSteps((prev) =>
                prev.map((s) => (s.step === data.step ? { ...s, ...data } : s))
              );
              if (eventType === "error") {
                setProvisionError(data.error);
              }
            } else if (eventType === "complete") {
              setProvisionResult(data);
            }
          }
        }
      }
    } catch (err: any) {
      setProvisionError(err.message ?? "Connection failed");
    }
  };

  const stepLabels: Record<string, string> = {
    creating_database: "Creating database",
    running_migrations: "Running migrations",
    applying_security: "Applying security",
    creating_auth: "Creating auth",
    seeding_data: "Seeding data",
    sending_email: "Sending email"
  };

  // ── Sidebar footer ────────────────────────────────────────────────────────

  const sidebarFooter = tenant.name ? (
    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3">
      <div className="w-9 h-9 bg-white border border-slate-200 rounded-[10px] flex items-center justify-center text-xs font-extrabold text-emerald-500">
        {getInitials(tenant.name)}
      </div>
      <div>
        <div className="text-xs font-bold text-slate-900">{tenant.name}</div>
        <div className="text-[10px] font-bold text-emerald-500 uppercase">Platform Admin</div>
      </div>
    </div>
  ) : undefined;

  // ── Provisioning Complete State ───────────────────────────────────────────

  if (provisioning && provisionResult) {
    return (
      <WizardLayout
        title="Onboard New Tenant"
        steps={STEPS}
        currentStep={3}
        completedSteps={[1, 2, 3]}
        sidebarFooter={sidebarFooter}
      >
        <div>
          {/* Header row */}
          <div className="flex items-start justify-between mb-10">
            <div>
              <h1 className="text-[32px] font-extrabold text-slate-900 tracking-[-0.02em] leading-tight">
                Provisioning Complete
              </h1>
              <p className="mt-2 text-base text-slate-500">
                Your new tenant environment is live and ready.
              </p>
            </div>
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all flex items-center gap-2"
            >
              <FileText className="h-4 w-4" />
              View Logs
            </button>
          </div>

          {/* Logs panel (toggled) */}
          {showLogs && (
            <div className="mb-6 bg-white border border-slate-200 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.03)] overflow-hidden">
              <div className="p-6 space-y-3">
                <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-[0.05em] mb-3">
                  Provisioning Log
                </h3>
                {provisioningSteps.map((ps) => (
                  <div key={ps.step} className="flex items-center gap-3 text-sm">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100">
                      <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
                    </span>
                    <span className="text-slate-700">
                      {stepLabels[ps.step] ??
                        ps.step.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
                    </span>
                    <span className="text-xs text-emerald-500 font-medium ml-auto">Completed</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tenant summary card */}
          <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.03)] overflow-hidden mb-6">
            {/* Top section */}
            <div className="p-8 flex items-center gap-4">
              <div className="w-14 h-14 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center justify-center text-lg font-extrabold text-emerald-600">
                {getInitials(tenant.name)}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-extrabold text-slate-900">{tenant.name}</h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                    Corporate Group
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-sm text-slate-500">
                  <span>{selectedCountry?.code ?? tenant.countryCode}</span>
                  <span className="text-slate-300">|</span>
                  <span>{selectedCountry?.name ?? tenant.countryCode}</span>
                </div>
              </div>
            </div>
            {/* Bottom section */}
            <div className="bg-[#fafafa] px-8 py-5 border-t border-slate-100">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                    <Check className="h-3 w-3 text-emerald-600" strokeWidth={3} />
                  </div>
                  <span className="text-sm text-slate-600">Database and schemas initialized</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                    <Check className="h-3 w-3 text-emerald-600" strokeWidth={3} />
                  </div>
                  <span className="text-sm text-slate-600">Security & SSL protocols active</span>
                </div>
              </div>
            </div>
          </div>

          {/* System Access URL card */}
          <div className="border border-dashed border-slate-300 rounded-3xl p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em] mb-2">
                  System Access URL
                </p>
                <a
                  href={provisionResult.url}
                  className="text-base font-bold text-emerald-500 hover:text-emerald-600 transition-colors flex items-center gap-2"
                >
                  {provisionResult.url}
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <a
                href={provisionResult.url}
                className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white shadow-[0_4px_12px_rgba(15,23,42,0.2)] hover:bg-slate-800 transition-all inline-flex items-center gap-2"
              >
                Go to Dashboard
              </a>
            </div>
          </div>
        </div>
      </WizardLayout>
    );
  }

  // ── Provisioning In Progress / Failed State ───────────────────────────────

  if (provisioning) {
    return (
      <WizardLayout
        title="Onboard New Tenant"
        steps={STEPS}
        currentStep={3}
        completedSteps={[1, 2]}
        sidebarFooter={sidebarFooter}
      >
        <div>
          <div className="mb-12">
            <p className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-2">
              Step 3 of 3
            </p>
            <h1 className="text-[32px] font-extrabold text-slate-900 tracking-[-0.02em] leading-tight">
              {provisionError ? "Provisioning Failed" : "Provisioning\u2026"}
            </h1>
            <p className="mt-2 text-base text-slate-500">
              {provisionError
                ? "An error occurred during provisioning."
                : "Setting up the tenant environment\u2026"}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.03)] overflow-hidden">
            <div className="p-8 space-y-4">
              {provisioningSteps.map((ps) => (
                <div key={ps.step} className="flex items-center gap-4">
                  {/* Status icon */}
                  {ps.status === "COMPLETED" ? (
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <Check className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
                    </div>
                  ) : ps.status === "IN_PROGRESS" ? (
                    <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
                      <Loader2 className="h-4 w-4 text-emerald-500 animate-spin" />
                    </div>
                  ) : ps.status === "FAILED" ? (
                    <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <div className="w-2 h-2 rounded-full bg-slate-300" />
                    </div>
                  )}

                  {/* Step name */}
                  <span
                    className={`text-sm font-medium flex-1 ${
                      ps.status === "FAILED"
                        ? "text-red-700"
                        : ps.status === "IN_PROGRESS"
                          ? "text-slate-900"
                          : ps.status === "COMPLETED"
                            ? "text-slate-700"
                            : "text-slate-400"
                    }`}
                  >
                    {stepLabels[ps.step] ??
                      ps.step.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
                  </span>

                  {/* Status text */}
                  <span
                    className={`text-xs font-medium ${
                      ps.status === "COMPLETED"
                        ? "text-emerald-500"
                        : ps.status === "IN_PROGRESS"
                          ? "text-emerald-500"
                          : ps.status === "FAILED"
                            ? "text-red-500"
                            : "text-slate-300"
                    }`}
                  >
                    {ps.status === "COMPLETED"
                      ? "Completed"
                      : ps.status === "IN_PROGRESS"
                        ? "In progress"
                        : ps.status === "FAILED"
                          ? "Failed"
                          : "Pending"}
                  </span>
                </div>
              ))}

              {/* Error detail */}
              {provisionError && (
                <div className="mt-4 rounded-xl bg-red-50 border border-red-100 p-4">
                  <p className="text-sm text-red-700">{provisionError}</p>
                </div>
              )}
            </div>
          </div>

          {/* Retry button */}
          {provisionError && !provisionResult && (
            <div className="mt-8 flex justify-end">
              <button
                onClick={handleProvision}
                className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white shadow-[0_4px_12px_rgba(15,23,42,0.2)] hover:bg-slate-800 transition-all"
              >
                Retry Provisioning
              </button>
            </div>
          )}
        </div>
      </WizardLayout>
    );
  }

  // ── Wizard Steps ──────────────────────────────────────────────────────────

  return (
    <WizardLayout
      title="Onboard New Tenant"
      steps={STEPS}
      currentStep={currentStep}
      completedSteps={completedSteps}
      onStepClick={setCurrentStep}
      sidebarFooter={sidebarFooter}
    >
      {/* Step 1: Tenant Details */}
      {currentStep === 1 && (
        <WizardStepContent
          stepNumber={1}
          totalSteps={3}
          title="Tenant Details"
          description="Basic information about the hotel chain and admin contact"
          onNext={handleNext}
          isNextDisabled={!tenant.name || !tenant.slug || !tenant.adminEmail || !tenant.countryCode}
        >
          <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.03)] overflow-hidden">
            <div className="p-8 space-y-5">
              {/* Company Name */}
              <div>
                <label className={labelClass}>Company Name *</label>
                <input
                  type="text"
                  value={tenant.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setTenant((t) => ({
                      ...t,
                      name,
                      slug: slugEdited ? t.slug : generateSlug(name)
                    }));
                  }}
                  className={inputClass}
                  placeholder="Jumeirah Group"
                />
              </div>

              {/* Slug + Domain */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>
                    Slug *{" "}
                    {tenant.slug && (
                      <span className="normal-case tracking-normal text-emerald-500">
                        (auto-generated)
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={tenant.slug}
                    onChange={(e) => {
                      setSlugEdited(true);
                      setTenant((t) => ({ ...t, slug: e.target.value }));
                    }}
                    className={`${inputClass} font-mono`}
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    Lowercase letters, numbers, and hyphens only (3-50 chars)
                  </p>
                </div>
                <div>
                  <label className={labelClass}>Domain</label>
                  <input
                    type="text"
                    value={tenant.domain}
                    onChange={(e) => setTenant((t) => ({ ...t, domain: e.target.value }))}
                    className={inputClass}
                    placeholder="finance.jumeirah.com"
                  />
                </div>
              </div>

              {/* Admin Email + Country */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Admin Email *</label>
                  <input
                    type="email"
                    value={tenant.adminEmail}
                    onChange={(e) => setTenant((t) => ({ ...t, adminEmail: e.target.value }))}
                    className={inputClass}
                    placeholder="cfo@jumeirah.com"
                  />
                </div>
                <div>
                  <label className={labelClass}>Country *</label>
                  <select
                    value={tenant.countryCode}
                    onChange={(e) => setTenant((t) => ({ ...t, countryCode: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Select a country...</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </WizardStepContent>
      )}

      {/* Step 2: Entitlements */}
      {currentStep === 2 && (
        <WizardStepContent
          stepNumber={2}
          totalSteps={3}
          title="Entitlements"
          description="Configure license, limits, and module access"
          onBack={handleBack}
          onNext={handleNext}
          isNextDisabled={entitlements.enabledModules.length === 0}
        >
          <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.03)] overflow-hidden">
            <div className="p-8 space-y-5">
              {/* License Type */}
              <div>
                <label className={labelClass}>License Type *</label>
                <select
                  value={entitlements.licenseType}
                  onChange={(e) =>
                    setEntitlements((ent) => ({ ...ent, licenseType: e.target.value as any }))
                  }
                  className={inputClass}
                >
                  <option value="TRIAL">Trial</option>
                  <option value="STANDARD">Standard</option>
                  <option value="ENTERPRISE">Enterprise</option>
                </select>
              </div>

              {/* Max Properties, Users, Sessions */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={labelClass}>Max Properties *</label>
                  <input
                    type="number"
                    min={1}
                    value={entitlements.maxProperties}
                    onChange={(e) =>
                      setEntitlements((ent) => ({
                        ...ent,
                        maxProperties: parseInt(e.target.value) || 1
                      }))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Max Users *</label>
                  <input
                    type="number"
                    min={1}
                    value={entitlements.maxUsers}
                    onChange={(e) =>
                      setEntitlements((ent) => ({
                        ...ent,
                        maxUsers: parseInt(e.target.value) || 1
                      }))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Max Sessions *</label>
                  <input
                    type="number"
                    min={1}
                    value={entitlements.maxConcurrentSessions}
                    onChange={(e) =>
                      setEntitlements((ent) => ({
                        ...ent,
                        maxConcurrentSessions: parseInt(e.target.value) || 1
                      }))
                    }
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Enabled Modules */}
              <div>
                <label className={labelClass + " mb-3"}>Enabled Modules *</label>
                <div className="grid grid-cols-3 gap-2">
                  {MODULES.map((mod) => {
                    const checked = entitlements.enabledModules.includes(mod);
                    return (
                      <label
                        key={mod}
                        className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm cursor-pointer transition-all ${
                          checked
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setEntitlements((ent) => ({
                              ...ent,
                              enabledModules: e.target.checked
                                ? [...ent.enabledModules, mod]
                                : ent.enabledModules.filter((m) => m !== mod)
                            }));
                          }}
                          className="accent-emerald-500"
                        />
                        <span className="font-medium">{mod.replace(/_/g, " ")}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Start / End Date */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Start Date *</label>
                  <input
                    type="date"
                    value={entitlements.subscriptionStartDate}
                    onChange={(e) =>
                      setEntitlements((ent) => ({ ...ent, subscriptionStartDate: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>End Date</label>
                  <input
                    type="date"
                    value={entitlements.subscriptionEndDate}
                    onChange={(e) =>
                      setEntitlements((ent) => ({ ...ent, subscriptionEndDate: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          </div>
        </WizardStepContent>
      )}

      {/* Step 3: Review & Provision */}
      {currentStep === 3 && (
        <WizardStepContent
          stepNumber={3}
          totalSteps={3}
          title="Review & Provision"
          description="Confirm all details, set up admin account, then provision"
          onBack={handleBack}
          onNext={handleProvision}
          nextLabel="Provision Tenant"
          isNextDisabled={
            !admin.firstName ||
            !admin.lastName ||
            !admin.email ||
            admin.temporaryPassword.length < 12
          }
        >
          <div className="space-y-6">
            {/* Tenant Details review */}
            <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.03)] overflow-hidden">
              <div className="p-8">
                <div className="flex items-center justify-between mb-5">
                  <h4 className="text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em]">
                    Tenant Details
                  </h4>
                  <button
                    onClick={() => setCurrentStep(1)}
                    className="text-xs font-bold text-emerald-500 hover:text-emerald-600 transition-colors"
                  >
                    Edit
                  </button>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <div>
                    <dt className="text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em] mb-1">
                      Name
                    </dt>
                    <dd className="font-semibold text-slate-900">{tenant.name}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em] mb-1">
                      Slug
                    </dt>
                    <dd className="font-mono text-slate-700">{tenant.slug}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em] mb-1">
                      Email
                    </dt>
                    <dd className="text-slate-700">{tenant.adminEmail}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em] mb-1">
                      Country
                    </dt>
                    <dd className="text-slate-700">
                      {selectedCountry?.name ?? tenant.countryCode}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Entitlements review */}
            <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.03)] overflow-hidden">
              <div className="p-8">
                <div className="flex items-center justify-between mb-5">
                  <h4 className="text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em]">
                    Entitlements
                  </h4>
                  <button
                    onClick={() => setCurrentStep(2)}
                    className="text-xs font-bold text-emerald-500 hover:text-emerald-600 transition-colors"
                  >
                    Edit
                  </button>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <div>
                    <dt className="text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em] mb-1">
                      License
                    </dt>
                    <dd className="font-semibold text-slate-900">{entitlements.licenseType}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em] mb-1">
                      Properties
                    </dt>
                    <dd className="text-slate-700">{entitlements.maxProperties}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em] mb-1">
                      Users
                    </dt>
                    <dd className="text-slate-700">{entitlements.maxUsers}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em] mb-1">
                      Modules
                    </dt>
                    <dd className="text-slate-700">{entitlements.enabledModules.join(", ")}</dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Admin Account (editable in review step) */}
            <div className="bg-white border border-slate-200 rounded-3xl shadow-[0_10px_30px_rgba(0,0,0,0.03)] overflow-hidden">
              <div className="p-8 space-y-5">
                <h4 className="text-[11px] font-extrabold text-slate-400 uppercase tracking-[0.05em]">
                  Admin Account
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>First Name *</label>
                    <input
                      type="text"
                      value={admin.firstName}
                      onChange={(e) => setAdmin((a) => ({ ...a, firstName: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Last Name *</label>
                    <input
                      type="text"
                      value={admin.lastName}
                      onChange={(e) => setAdmin((a) => ({ ...a, lastName: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Email *</label>
                  <input
                    type="email"
                    value={admin.email}
                    onChange={(e) => setAdmin((a) => ({ ...a, email: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Temporary Password * (min 12 chars)</label>
                  <input
                    type="password"
                    value={admin.temporaryPassword}
                    onChange={(e) => setAdmin((a) => ({ ...a, temporaryPassword: e.target.value }))}
                    className={inputClass}
                  />
                  {admin.temporaryPassword.length > 0 && admin.temporaryPassword.length < 12 && (
                    <p className="mt-1.5 text-xs text-red-500">Must be at least 12 characters</p>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Phone</label>
                  <input
                    type="tel"
                    value={admin.phone}
                    onChange={(e) => setAdmin((a) => ({ ...a, phone: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          </div>
        </WizardStepContent>
      )}
    </WizardLayout>
  );
}
