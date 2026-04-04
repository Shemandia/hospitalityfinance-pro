"use client";

import { useEffect, useState } from "react";
import { WizardLayout, WizardStepContent } from "../../../../../components/wizard-layout";
import { COUNTRIES } from "../../../../../lib/countries";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const STEPS = [
  { id: 1, name: "Tenant Details" },
  { id: 2, name: "Entitlements" },
  { id: 3, name: "Admin Account" },
  { id: 4, name: "Review & Provision" }
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

// ── Platform Key Gate ────────────────────────────────────────────────────────

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
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="w-full max-w-sm space-y-4">
          <h2 className="text-xl font-semibold text-slate-900">Platform Authentication</h2>
          <p className="text-sm text-slate-500">
            Enter your platform API key to access tenant management.
          </p>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleKeySubmit()}
            className="w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Platform API key"
          />
          {keyError && <p className="text-sm text-red-500">{keyError}</p>}
          <button
            onClick={handleKeySubmit}
            disabled={!keyInput}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Authenticate
          </button>
        </div>
      </div>
    );
  }

  return <OnboardWizard platformKey={platformKey} />;
}

// ── Onboard Wizard ───────────────────────────────────────────────────────────

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

  const stepIcons: Record<string, string> = {
    PENDING: "\u25CB",
    IN_PROGRESS: "\u27F3",
    COMPLETED: "\u2713",
    FAILED: "\u2717"
  };

  return (
    <WizardLayout
      title="Onboard New Tenant"
      steps={STEPS}
      currentStep={provisioning ? 4 : currentStep}
      completedSteps={completedSteps}
      onStepClick={provisioning ? undefined : setCurrentStep}
    >
      {/* Step 1: Tenant Details */}
      {currentStep === 1 && !provisioning && (
        <WizardStepContent
          stepNumber={1}
          totalSteps={4}
          title="Tenant Details"
          description="Basic information about the hotel chain"
          onNext={handleNext}
          isNextDisabled={!tenant.name || !tenant.slug || !tenant.adminEmail || !tenant.countryCode}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Company Name *</label>
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
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Jumeirah Group"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Slug *</label>
                <input
                  type="text"
                  value={tenant.slug}
                  onChange={(e) => {
                    setSlugEdited(true);
                    setTenant((t) => ({ ...t, slug: e.target.value }));
                  }}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Lowercase letters, numbers, and hyphens only (3–50 chars)
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Domain</label>
                <input
                  type="text"
                  value={tenant.domain}
                  onChange={(e) => setTenant((t) => ({ ...t, domain: e.target.value }))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  placeholder="finance.jumeirah.com"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Admin Email *</label>
                <input
                  type="email"
                  value={tenant.adminEmail}
                  onChange={(e) => setTenant((t) => ({ ...t, adminEmail: e.target.value }))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  placeholder="cfo@jumeirah.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Country *</label>
                <select
                  value={tenant.countryCode}
                  onChange={(e) => setTenant((t) => ({ ...t, countryCode: e.target.value }))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">Select a country…</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </WizardStepContent>
      )}

      {/* Step 2: Entitlements */}
      {currentStep === 2 && !provisioning && (
        <WizardStepContent
          stepNumber={2}
          totalSteps={4}
          title="Entitlements"
          description="Configure license and module access"
          onBack={handleBack}
          onNext={handleNext}
          isNextDisabled={entitlements.enabledModules.length === 0}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">License Type *</label>
              <select
                value={entitlements.licenseType}
                onChange={(e) =>
                  setEntitlements((ent) => ({ ...ent, licenseType: e.target.value as any }))
                }
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="TRIAL">Trial</option>
                <option value="STANDARD">Standard</option>
                <option value="ENTERPRISE">Enterprise</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Max Properties *</label>
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
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Max Users *</label>
                <input
                  type="number"
                  min={1}
                  value={entitlements.maxUsers}
                  onChange={(e) =>
                    setEntitlements((ent) => ({ ...ent, maxUsers: parseInt(e.target.value) || 1 }))
                  }
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Max Sessions *</label>
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
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Enabled Modules *
              </label>
              <div className="grid grid-cols-3 gap-2">
                {MODULES.map((mod) => (
                  <label key={mod} className="flex items-center gap-2 rounded border p-2 text-sm">
                    <input
                      type="checkbox"
                      checked={entitlements.enabledModules.includes(mod)}
                      onChange={(e) => {
                        setEntitlements((ent) => ({
                          ...ent,
                          enabledModules: e.target.checked
                            ? [...ent.enabledModules, mod]
                            : ent.enabledModules.filter((m) => m !== mod)
                        }));
                      }}
                    />
                    {mod.replace(/_/g, " ")}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Start Date *</label>
                <input
                  type="date"
                  value={entitlements.subscriptionStartDate}
                  onChange={(e) =>
                    setEntitlements((ent) => ({ ...ent, subscriptionStartDate: e.target.value }))
                  }
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">End Date</label>
                <input
                  type="date"
                  value={entitlements.subscriptionEndDate}
                  onChange={(e) =>
                    setEntitlements((ent) => ({ ...ent, subscriptionEndDate: e.target.value }))
                  }
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        </WizardStepContent>
      )}

      {/* Step 3: Admin Account */}
      {currentStep === 3 && !provisioning && (
        <WizardStepContent
          stepNumber={3}
          totalSteps={4}
          title="Admin Account"
          description="First admin user for this tenant"
          onBack={handleBack}
          onNext={handleNext}
          isNextDisabled={
            !admin.firstName ||
            !admin.lastName ||
            !admin.email ||
            admin.temporaryPassword.length < 12
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">First Name *</label>
                <input
                  type="text"
                  value={admin.firstName}
                  onChange={(e) => setAdmin((a) => ({ ...a, firstName: e.target.value }))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Last Name *</label>
                <input
                  type="text"
                  value={admin.lastName}
                  onChange={(e) => setAdmin((a) => ({ ...a, lastName: e.target.value }))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Email *</label>
              <input
                type="email"
                value={admin.email}
                onChange={(e) => setAdmin((a) => ({ ...a, email: e.target.value }))}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">
                Temporary Password * (min 12 chars)
              </label>
              <input
                type="password"
                value={admin.temporaryPassword}
                onChange={(e) => setAdmin((a) => ({ ...a, temporaryPassword: e.target.value }))}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
              {admin.temporaryPassword.length > 0 && admin.temporaryPassword.length < 12 && (
                <p className="mt-1 text-xs text-red-500">Must be at least 12 characters</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Phone</label>
              <input
                type="tel"
                value={admin.phone}
                onChange={(e) => setAdmin((a) => ({ ...a, phone: e.target.value }))}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          </div>
        </WizardStepContent>
      )}

      {/* Step 4: Review & Provision */}
      {currentStep === 4 && !provisioning && (
        <WizardStepContent
          stepNumber={4}
          totalSteps={4}
          title="Review & Provision"
          description="Confirm details and start provisioning"
          onBack={handleBack}
          onNext={handleProvision}
          nextLabel="Provision Tenant"
        >
          <div className="space-y-6">
            <section>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">Tenant Details</h4>
                <button
                  onClick={() => setCurrentStep(1)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Edit
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium">{tenant.name}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Slug</dt>
                  <dd className="font-mono">{tenant.slug}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Email</dt>
                  <dd>{tenant.adminEmail}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Country</dt>
                  <dd>
                    {COUNTRIES.find((c) => c.code === tenant.countryCode)?.name ??
                      tenant.countryCode}
                  </dd>
                </div>
              </dl>
            </section>
            <section>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">Entitlements</h4>
                <button
                  onClick={() => setCurrentStep(2)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Edit
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-slate-500">License</dt>
                  <dd className="font-medium">{entitlements.licenseType}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Properties</dt>
                  <dd>{entitlements.maxProperties}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Users</dt>
                  <dd>{entitlements.maxUsers}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Modules</dt>
                  <dd>{entitlements.enabledModules.join(", ")}</dd>
                </div>
              </dl>
            </section>
            <section>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">Admin Account</h4>
                <button
                  onClick={() => setCurrentStep(3)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Edit
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium">
                    {admin.firstName} {admin.lastName}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Email</dt>
                  <dd>{admin.email}</dd>
                </div>
              </dl>
            </section>
          </div>
        </WizardStepContent>
      )}

      {/* Provisioning Progress */}
      {provisioning && (
        <div>
          <h3 className="text-xl font-semibold text-slate-900">
            {provisionResult
              ? "Provisioning Complete"
              : provisionError
                ? "Provisioning Failed"
                : "Provisioning\u2026"}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {provisionResult
              ? `${tenant.name} is ready to use.`
              : provisionError
                ? "An error occurred during provisioning."
                : "Setting up the tenant environment\u2026"}
          </p>
          <div className="mt-6 space-y-3">
            {provisioningSteps.map((ps) => (
              <div key={ps.step} className="flex items-center gap-3 text-sm">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    ps.status === "COMPLETED"
                      ? "bg-emerald-100 text-emerald-700"
                      : ps.status === "IN_PROGRESS"
                        ? "bg-blue-100 text-blue-700 animate-pulse"
                        : ps.status === "FAILED"
                          ? "bg-red-100 text-red-700"
                          : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {stepIcons[ps.status]}
                </span>
                <span className={ps.status === "FAILED" ? "text-red-700" : "text-slate-700"}>
                  {ps.step.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
                </span>
                {ps.status === "FAILED" && ps.error && (
                  <span className="text-xs text-red-500">&mdash; {ps.error}</span>
                )}
              </div>
            ))}
          </div>
          {provisionResult && (
            <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-medium text-emerald-800">Tenant URL:</p>
              <a href={provisionResult.url} className="text-sm text-blue-600 hover:underline">
                {provisionResult.url}
              </a>
            </div>
          )}
          {provisionError && !provisionResult && (
            <button
              onClick={handleProvision}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Retry Provisioning
            </button>
          )}
        </div>
      )}
    </WizardLayout>
  );
}
