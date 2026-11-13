import type { ApiContext } from "./gl-api";

// Same origin: the web app proxies the API (lib/server/api-proxy.ts).
const API_BASE_URL = "";

type Envelope<T> = {
  data: T;
  errors?: Array<{ code: string; message: string }>;
};

async function request<T>(
  context: ApiContext,
  path: string,
  init?: RequestInit
): Promise<Envelope<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(context.accessToken && context.accessToken !== "cookie"
        ? { Authorization: `Bearer ${context.accessToken}` }
        : {}),
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

// ── Types ────────────────────────────────────────────────────────────────────

export type AllocationSource = {
  id: string;
  accountCodeFrom: string;
  accountCodeTo: string;
  analysisCode1: string | null;
  analysisCode2: string | null;
  analysisCode3: string | null;
  balanceType: string;
  minimumThreshold: string | null;
  maximumThreshold: string | null;
  sourceOrder: number;
};

export type AllocationTarget = {
  id: string;
  targetAccountCode: string;
  offsetAccountCode: string | null;
  basisType: string;
  fixedPercentage: string | null;
  fixedAmount: string | null;
  ratioAccountCodeFrom: string | null;
  ratioAccountCodeTo: string | null;
  statisticalKey: string | null;
  statisticalValue: string | null;
  analysisCodes: Record<string, string> | null;
  targetOrder: number;
};

export type AllocationDefinition = {
  id: string;
  entityId: string;
  name: string;
  description: string | null;
  allocationType: "CHARGE" | "SPLIT";
  periodId: string | null;
  isSteppedSequence: boolean;
  sequenceOrder: number;
  isActive: boolean;
  isSystem: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  sources: AllocationSource[];
  targets: AllocationTarget[];
};

export type AllocationLineResult = {
  accountId: string;
  accountCode: string;
  debit: string;
  credit: string;
  description: string;
  analysisCodes?: Record<string, string>;
};

export type AllocationResult = {
  definitionId: string;
  definitionName: string;
  allocationType: string;
  sourceAmount: string;
  lines: AllocationLineResult[];
  journalId?: string;
};

// ── API functions ────────────────────────────────────────────────────────────

export function listAllocations(ctx: ApiContext, params?: { isActive?: boolean }) {
  const search = new URLSearchParams();
  if (params?.isActive !== undefined) search.set("isActive", String(params.isActive));
  const query = search.toString();
  return request<AllocationDefinition[]>(ctx, `/api/v1/allocations${query ? `?${query}` : ""}`);
}

export function getAllocation(ctx: ApiContext, id: string) {
  return request<AllocationDefinition>(ctx, `/api/v1/allocations/${id}`);
}

export function createAllocation(ctx: ApiContext, payload: Record<string, unknown>) {
  return request<AllocationDefinition>(ctx, "/api/v1/allocations", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateAllocation(ctx: ApiContext, id: string, payload: Record<string, unknown>) {
  return request<AllocationDefinition>(ctx, `/api/v1/allocations/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteAllocation(ctx: ApiContext, id: string) {
  return request<void>(ctx, `/api/v1/allocations/${id}`, { method: "DELETE" });
}

export function dryRunAllocation(ctx: ApiContext, id: string, periodId?: string) {
  return request<AllocationResult>(ctx, `/api/v1/allocations/${id}/dry-run`, {
    method: "POST",
    body: JSON.stringify(periodId ? { periodId } : {})
  });
}

export function executeAllocation(ctx: ApiContext, id: string, periodId?: string) {
  return request<AllocationResult>(ctx, `/api/v1/allocations/${id}/execute`, {
    method: "POST",
    body: JSON.stringify(periodId ? { periodId } : {})
  });
}

export function runAllSteppedAllocations(ctx: ApiContext, periodId?: string) {
  return request<AllocationResult[]>(ctx, "/api/v1/allocations/run-all", {
    method: "POST",
    body: JSON.stringify(periodId ? { periodId } : {})
  });
}
