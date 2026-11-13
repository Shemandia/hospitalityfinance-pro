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

export type RecurringJournalLine = {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
  currency: string;
  fxRate: string;
  description: string;
  account?: { code: string; name: string; type: string };
};

export type RecurringJournal = {
  id: string;
  entityId: string;
  name: string;
  description: string | null;
  frequency: "MONTHLY" | "QUARTERLY" | "ANNUALLY";
  dayOfMonth: number | null;
  autoPost: boolean;
  autoReverse: boolean;
  maxOccurrences: number | null;
  endDate: string | null;
  journalTypeId: string | null;
  source: string;
  functionalCurrency: string;
  isActive: boolean;
  lastGeneratedAt: string | null;
  occurrenceCount: number;
  lines: RecurringJournalLine[];
  createdAt: string;
  updatedAt: string;
};

export type GenerateResult = {
  generated: number;
  journalIds: string[];
};

// ── API Functions ────────────────────────────────────────────────────────────

export function listRecurringJournals(ctx: ApiContext) {
  return request<RecurringJournal[]>(ctx, "/api/v1/gl/recurring-journals");
}

export function getRecurringJournal(ctx: ApiContext, id: string) {
  return request<RecurringJournal>(ctx, `/api/v1/gl/recurring-journals/${id}`);
}

export function createRecurringJournal(ctx: ApiContext, payload: Record<string, unknown>) {
  return request<RecurringJournal>(ctx, "/api/v1/gl/recurring-journals", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateRecurringJournal(
  ctx: ApiContext,
  id: string,
  payload: Record<string, unknown>
) {
  return request<RecurringJournal>(ctx, `/api/v1/gl/recurring-journals/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deactivateRecurringJournal(ctx: ApiContext, id: string) {
  return request<void>(ctx, `/api/v1/gl/recurring-journals/${id}`, {
    method: "DELETE"
  });
}

export function generateRecurringJournals(ctx: ApiContext, id: string, periodId: string) {
  return request<GenerateResult>(ctx, `/api/v1/gl/recurring-journals/${id}/generate`, {
    method: "POST",
    body: JSON.stringify({ periodId })
  });
}
