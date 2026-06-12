/**
 * Transfer Desk Profile Wizard — API client.
 *
 * Typed fetch functions for all Transfer Desk endpoints (§4).
 * Follows the same Envelope<T> + ApiContext pattern as gl-api.ts.
 */

import type { ApiContext } from "../gl-api";
import { API_BASE_URL, buildApiHeaders } from "../api-client";
import type {
  Profile,
  ProfileVersion,
  ProfileCreateInput,
  ProfileUpdateInput,
  ProfileStatusChangeInput,
  ProfileListFilters,
  FormatDetectionResult,
  SchemaValidationResult,
  ParsePreviewResult,
  FsdSchemaInput,
  TmlMapping,
  LookupTable,
  LookupTableCreateInput,
  LookupTableUpdateInput,
  TestResults,
  Schedule,
  ScheduleCreateInput,
  HfpTargetField,
  PrebuiltFunction,
  HeldBatchSummary,
  HeldBatchDetail,
  CommitSummary
} from "./types";

// ── Envelope (same shape as gl-api.ts) ───────────────────────────────────────

type Envelope<T> = {
  data: T;
  errors?: Array<{ code: string; message: string }>;
  meta?: Record<string, unknown>;
};

// ── Base request helper ──────────────────────────────────────────────────────

async function request<T>(
  context: ApiContext,
  path: string,
  init?: RequestInit
): Promise<Envelope<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: buildApiHeaders(context, init?.headers)
  });

  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok) {
    const message = payload.errors?.[0]?.message ?? `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

/** Multipart upload (no Content-Type — browser sets boundary) */
async function uploadRequest<T>(
  context: ApiContext,
  path: string,
  formData: FormData
): Promise<Envelope<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: buildApiHeaders(context, undefined, { json: false }),
    body: formData
  });

  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok) {
    const message = payload.errors?.[0]?.message ?? `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

const TD = "/api/v1/transfer-desk";

// ── Profile CRUD ─────────────────────────────────────────────────────────────

export function createProfile(context: ApiContext, input: ProfileCreateInput) {
  return request<Profile>(context, `${TD}/profiles`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function listProfiles(context: ApiContext, filters: ProfileListFilters = {}) {
  return request<Profile[]>(
    context,
    `${TD}/profiles${qs(filters as Record<string, string | number | undefined>)}`
  );
}

export function getProfile(context: ApiContext, profileId: string) {
  return request<Profile>(context, `${TD}/profiles/${profileId}`);
}

export function updateProfile(context: ApiContext, profileId: string, input: ProfileUpdateInput) {
  return request<Profile>(context, `${TD}/profiles/${profileId}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function changeProfileStatus(
  context: ApiContext,
  profileId: string,
  input: ProfileStatusChangeInput
) {
  return request<Profile>(context, `${TD}/profiles/${profileId}/status`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function deleteProfile(context: ApiContext, profileId: string) {
  return request<{ id: string }>(context, `${TD}/profiles/${profileId}`, {
    method: "DELETE"
  });
}

export function listProfileVersions(context: ApiContext, profileId: string) {
  return request<ProfileVersion[]>(context, `${TD}/profiles/${profileId}/versions`);
}

export function getProfileVersion(context: ApiContext, profileId: string, versionId: string) {
  return request<ProfileVersion>(context, `${TD}/profiles/${profileId}/versions/${versionId}`);
}

// ── FSD Auto-Detection & Validation ──────────────────────────────────────────

export async function autoDetectFormat(context: ApiContext, file: File) {
  const buffer = await file.arrayBuffer();
  const base64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ""));
  return request<FormatDetectionResult>(context, `${TD}/fsd/auto-detect`, {
    method: "POST",
    body: JSON.stringify({ file: base64, filename: file.name })
  });
}

export function validateFsdSchema(context: ApiContext, schema: FsdSchemaInput) {
  return request<SchemaValidationResult>(context, `${TD}/fsd/validate-schema`, {
    method: "POST",
    body: JSON.stringify(schema)
  });
}

export async function parsePreview(
  context: ApiContext,
  file: File,
  schema: FsdSchemaInput,
  maxRows?: number
) {
  const buffer = await file.arrayBuffer();
  const base64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ""));
  return request<ParsePreviewResult>(context, `${TD}/fsd/parse-preview`, {
    method: "POST",
    body: JSON.stringify({
      file: base64,
      filename: file.name,
      schema,
      maxRows: maxRows ?? 10
    })
  });
}

// ── TML Mapping ──────────────────────────────────────────────────────────────

export function listTargetFields(context: ApiContext) {
  return request<HfpTargetField[]>(context, `${TD}/mappings/target-fields`);
}

export function listPrebuiltFunctions(context: ApiContext) {
  return request<PrebuiltFunction[]>(context, `${TD}/mappings/functions`);
}

// ── Lookup Tables ────────────────────────────────────────────────────────────

export function listLookupTables(context: ApiContext) {
  return request<LookupTable[]>(context, `${TD}/lookup-tables`);
}

export function getLookupTable(context: ApiContext, tableId: string) {
  return request<LookupTable>(context, `${TD}/lookup-tables/${tableId}`);
}

export function createLookupTable(context: ApiContext, input: LookupTableCreateInput) {
  return request<LookupTable>(context, `${TD}/lookup-tables`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateLookupTable(
  context: ApiContext,
  tableId: string,
  input: LookupTableUpdateInput
) {
  return request<LookupTable>(context, `${TD}/lookup-tables/${tableId}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

// ── Test & Preview (SSE) ─────────────────────────────────────────────────────

/**
 * Start a dry-run test. Returns the testId for SSE streaming.
 * The SSE stream is handled separately via EventSource — see useTestStream hook.
 */
export function startTest(context: ApiContext, profileId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return uploadRequest<{ testId: string }>(context, `${TD}/profiles/${profileId}/test`, formData);
}

/**
 * Build the SSE URL for streaming test progress.
 * Use with EventSource in the useTestStream hook.
 */
export function getTestStreamUrl(profileId: string, testId: string): string {
  return `${API_BASE_URL}${TD}/profiles/${profileId}/test/${testId}/stream`;
}

export function getTestResults(context: ApiContext, profileId: string, testId: string) {
  return request<TestResults>(context, `${TD}/profiles/${profileId}/test/${testId}/results`);
}

// ── Automation Schedule ──────────────────────────────────────────────────────

export function getSchedule(context: ApiContext, profileId: string) {
  return request<Schedule | null>(context, `${TD}/profiles/${profileId}/schedule`);
}

export function createSchedule(context: ApiContext, profileId: string, input: ScheduleCreateInput) {
  return request<Schedule>(context, `${TD}/profiles/${profileId}/schedule`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteSchedule(context: ApiContext, profileId: string) {
  return request<{ id: string }>(context, `${TD}/profiles/${profileId}/schedule`, {
    method: "DELETE"
  });
}

// ── Held-Batch Review ────────────────────────────────────────────────────────

export async function listHeldBatches(
  ctx: ApiContext,
  filters?: { status?: string; profileId?: string }
): Promise<HeldBatchSummary[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.profileId) params.set("profileId", filters.profileId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const res = await request<HeldBatchSummary[]>(ctx, `${TD}/batches${suffix}`);
  return res.data;
}

export async function getHeldBatch(ctx: ApiContext, batchId: string): Promise<HeldBatchDetail> {
  const res = await request<HeldBatchDetail>(ctx, `${TD}/batches/${batchId}`);
  return res.data;
}

export async function rejectBatchItem(
  ctx: ApiContext,
  batchId: string,
  itemId: string,
  reason?: string
): Promise<void> {
  await request(ctx, `${TD}/batches/${batchId}/items/${itemId}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export async function restoreBatchItem(
  ctx: ApiContext,
  batchId: string,
  itemId: string
): Promise<void> {
  await request(ctx, `${TD}/batches/${batchId}/items/${itemId}/restore`, { method: "POST" });
}

export async function commitHeldBatch(ctx: ApiContext, batchId: string): Promise<CommitSummary> {
  const res = await request<CommitSummary>(ctx, `${TD}/batches/${batchId}/commit`, {
    method: "POST"
  });
  return res.data;
}

export async function discardHeldBatch(ctx: ApiContext, batchId: string): Promise<void> {
  await request(ctx, `${TD}/batches/${batchId}/discard`, { method: "POST" });
}
