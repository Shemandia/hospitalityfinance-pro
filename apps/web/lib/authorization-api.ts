import type { ApiContext } from "./gl-api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

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

export type AuthorizationStage = {
  id: string;
  entityId: string;
  stageCode: string;
  stageName: string;
  stageOrder: number;
  requiredApprovers: number;
  autoAdvance: boolean;
  rejectionReturnsTo: string;
  returnToStageId: string | null;
  journalTypeId: string | null;
  amountThreshold: string | null;
  userTeamId: string;
  isActive: boolean;
  userTeam?: { id: string; code: string; name: string };
  journalType?: { id: string; code: string; name: string } | null;
};

export type AuthorizationTeam = {
  id: string;
  entityId: string;
  code: string;
  name: string;
  isActive: boolean;
  members: Array<{
    id: string;
    userId: string;
    user: { id: string; name: string; email: string };
  }>;
};

export type AuthorizationDelegation = {
  id: string;
  entityId: string;
  delegatorId: string;
  delegateId: string;
  teamId: string;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  delegator: { id: string; name: string; email: string };
  delegate: { id: string; name: string; email: string };
  team: { id: string; code: string; name: string };
};

export type RejectionCode = {
  id: string;
  entityId: string;
  code: string;
  description: string;
  isActive: boolean;
};

export type QueueItem = {
  journalId: string;
  reference: string | null;
  description: string | null;
  source: string;
  journalAmount: number;
  status: string;
  createdById: string;
  createdAt: string;
  currentStageOrder: number;
  stageName: string;
  stageCode: string;
};

export type AuthHistoryEntry = {
  stageCode: string;
  stageName: string;
  stageOrder: number;
  status: string;
  decidedById: string | null;
  decidedByName: string | null;
  rejectionCode: string | null;
  comments: string | null;
  decidedAt: string | null;
};

// ── Stages ──────────────────────────────────────────────────────────────────

export function listStages(ctx: ApiContext) {
  return request<AuthorizationStage[]>(ctx, "/api/v1/authorization/stages");
}

export function createStage(ctx: ApiContext, payload: Record<string, unknown>) {
  return request<AuthorizationStage>(ctx, "/api/v1/authorization/stages", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateStage(ctx: ApiContext, id: string, payload: Record<string, unknown>) {
  return request<AuthorizationStage>(ctx, `/api/v1/authorization/stages/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteStage(ctx: ApiContext, id: string) {
  return request<void>(ctx, `/api/v1/authorization/stages/${id}`, { method: "DELETE" });
}

// ── Teams ───────────────────────────────────────────────────────────────────

export function listTeams(ctx: ApiContext) {
  return request<AuthorizationTeam[]>(ctx, "/api/v1/authorization/teams");
}

export function createTeam(ctx: ApiContext, payload: Record<string, unknown>) {
  return request<AuthorizationTeam>(ctx, "/api/v1/authorization/teams", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateTeam(ctx: ApiContext, id: string, payload: Record<string, unknown>) {
  return request<AuthorizationTeam>(ctx, `/api/v1/authorization/teams/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteTeam(ctx: ApiContext, id: string) {
  return request<void>(ctx, `/api/v1/authorization/teams/${id}`, { method: "DELETE" });
}

// ── Delegations ─────────────────────────────────────────────────────────────

export function listDelegations(ctx: ApiContext) {
  return request<AuthorizationDelegation[]>(ctx, "/api/v1/authorization/delegations");
}

export function createDelegation(ctx: ApiContext, payload: Record<string, unknown>) {
  return request<AuthorizationDelegation>(ctx, "/api/v1/authorization/delegations", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function revokeDelegation(ctx: ApiContext, id: string) {
  return request<void>(ctx, `/api/v1/authorization/delegations/${id}`, { method: "DELETE" });
}

// ── Rejection Codes ─────────────────────────────────────────────────────────

export function listRejectionCodes(ctx: ApiContext) {
  return request<RejectionCode[]>(ctx, "/api/v1/authorization/rejection-codes");
}

export function createRejectionCode(ctx: ApiContext, payload: Record<string, unknown>) {
  return request<RejectionCode>(ctx, "/api/v1/authorization/rejection-codes", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

// ── Queue ───────────────────────────────────────────────────────────────────

export function getAuthorizationQueue(
  ctx: ApiContext,
  filters?: Record<string, string | number | undefined>
) {
  const search = new URLSearchParams();
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) search.set(key, String(value));
    }
  }
  const query = search.toString();
  return request<QueueItem[]>(ctx, `/api/v1/authorization/queue${query ? `?${query}` : ""}`);
}

// ── Workflow Actions ────────────────────────────────────────────────────────

export function approveJournal(ctx: ApiContext, journalId: string, comments?: string) {
  return request<any>(ctx, `/api/v1/authorization/approve/${journalId}`, {
    method: "POST",
    body: JSON.stringify({ comments })
  });
}

export function rejectJournal(
  ctx: ApiContext,
  journalId: string,
  rejectionCodeId: string,
  comments?: string
) {
  return request<any>(ctx, `/api/v1/authorization/reject/${journalId}`, {
    method: "POST",
    body: JSON.stringify({ rejectionCodeId, comments })
  });
}

export function returnJournal(ctx: ApiContext, journalId: string, comments?: string) {
  return request<any>(ctx, `/api/v1/authorization/return/${journalId}`, {
    method: "POST",
    body: JSON.stringify({ comments })
  });
}

export function voidJournal(ctx: ApiContext, journalId: string, comments?: string) {
  return request<any>(ctx, `/api/v1/authorization/void/${journalId}`, {
    method: "POST",
    body: JSON.stringify({ comments })
  });
}

export function resubmitJournal(ctx: ApiContext, journalId: string) {
  return request<any>(ctx, `/api/v1/authorization/resubmit/${journalId}`, {
    method: "POST"
  });
}

export function bulkApprove(ctx: ApiContext, journalIds: string[], comments?: string) {
  return request<any[]>(ctx, "/api/v1/authorization/bulk-approve", {
    method: "POST",
    body: JSON.stringify({ journalIds, comments })
  });
}

export function bulkReject(
  ctx: ApiContext,
  journalIds: string[],
  rejectionCodeId: string,
  comments?: string
) {
  return request<any[]>(ctx, "/api/v1/authorization/bulk-reject", {
    method: "POST",
    body: JSON.stringify({ journalIds, rejectionCodeId, comments })
  });
}

export function getAuthorizationHistory(ctx: ApiContext, journalId: string) {
  return request<AuthHistoryEntry[]>(ctx, `/api/v1/authorization/history/${journalId}`);
}
