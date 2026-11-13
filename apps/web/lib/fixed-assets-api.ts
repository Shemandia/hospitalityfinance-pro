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

export type AssetCategory = {
  id: string;
  entityId: string;
  code: string;
  name: string;
  defaultUsefulLifeMonths: number | null;
  defaultDepreciationMethod: string | null;
  defaultBsDepreciationAcct: string | null;
  defaultPlDepreciationAcct: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type FixedAsset = {
  id: string;
  entityId: string;
  assetCode: string;
  lookupCode: string | null;
  description: string;
  categoryId: string | null;
  category?: AssetCategory | null;
  status: "ACTIVE" | "FULLY_DEPRECIATED" | "DISPOSED";
  depreciationMethod: string;
  depreciationRate: number | null;
  usefulLifeMonths: number;
  grossValue: string;
  accumulatedDepreciation: string;
  netValue: string;
  finalValue: string;
  acquisitionDate: string;
  disposalDate: string | null;
  disposalProceeds: string | null;
  bsDepreciationAccount: string;
  plDepreciationAccount: string;
  assetQuantity: number | null;
  analysisCode1: string | null;
  analysisCode2: string | null;
  analysisCode3: string | null;
  analysisCode4: string | null;
  analysisCode5: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DepreciationLine = {
  assetId: string;
  assetCode: string;
  description: string;
  method: string;
  grossValue: string;
  netValueBefore: string;
  depreciationAmount: string;
  netValueAfter: string;
  bsAccount: string;
  plAccount: string;
};

export type DepreciationResult = {
  periodId: string;
  journalId?: string;
  lines: DepreciationLine[];
  totalDepreciation: string;
};

// ── Asset Categories ────────────────────────────────────────────────────────

export function listAssetCategories(ctx: ApiContext) {
  return request<AssetCategory[]>(ctx, "/api/v1/asset-categories");
}

export function createAssetCategory(ctx: ApiContext, payload: Record<string, unknown>) {
  return request<AssetCategory>(ctx, "/api/v1/asset-categories", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

// ── Fixed Assets ────────────────────────────────────────────────────────────

export function listFixedAssets(
  ctx: ApiContext,
  params?: { status?: string; categoryId?: string; search?: string }
) {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.categoryId) search.set("categoryId", params.categoryId);
  if (params?.search) search.set("search", params.search);
  const query = search.toString();
  return request<FixedAsset[]>(ctx, `/api/v1/fixed-assets${query ? `?${query}` : ""}`);
}

export function getFixedAsset(ctx: ApiContext, id: string) {
  return request<FixedAsset>(ctx, `/api/v1/fixed-assets/${id}`);
}

export function createFixedAsset(ctx: ApiContext, payload: Record<string, unknown>) {
  return request<FixedAsset>(ctx, "/api/v1/fixed-assets", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateFixedAsset(ctx: ApiContext, id: string, payload: Record<string, unknown>) {
  return request<FixedAsset>(ctx, `/api/v1/fixed-assets/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export function disposeAsset(ctx: ApiContext, id: string, payload: Record<string, unknown>) {
  return request<FixedAsset>(ctx, `/api/v1/fixed-assets/${id}/dispose`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function transferAsset(ctx: ApiContext, id: string, payload: Record<string, unknown>) {
  return request<FixedAsset>(ctx, `/api/v1/fixed-assets/${id}/transfer`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function revalueAsset(ctx: ApiContext, id: string, payload: { newGrossValue: number }) {
  return request<FixedAsset>(ctx, `/api/v1/fixed-assets/${id}/revalue`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function writeOffAsset(ctx: ApiContext, id: string) {
  return request<FixedAsset>(ctx, `/api/v1/fixed-assets/${id}/write-off`, {
    method: "POST"
  });
}

// ── Depreciation ────────────────────────────────────────────────────────────

export function previewDepreciation(ctx: ApiContext, periodId: string) {
  return request<DepreciationLine[]>(ctx, "/api/v1/fixed-assets/depreciation/preview", {
    method: "POST",
    body: JSON.stringify({ periodId })
  });
}

export function runDepreciation(ctx: ApiContext, periodId: string) {
  return request<DepreciationResult>(ctx, "/api/v1/fixed-assets/depreciation/run", {
    method: "POST",
    body: JSON.stringify({ periodId })
  });
}
