export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

export type FrontendApiContext = {
  accessToken?: string | null;
  entityId?: string | null;
  tenantSlug?: string | null;
  tenantCode?: string | null;
};

type ApiErrorBody = {
  errors?: Array<{ code?: string; message?: string }>;
  message?: string;
};

export class FrontendApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "FrontendApiError";
    this.status = status;
    this.code = code;
  }
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

export function buildApiHeaders(
  context?: FrontendApiContext | null,
  headers?: HeadersInit,
  options: { json?: boolean } = { json: true }
): HeadersInit {
  const merged: Record<string, string> = {
    ...(options.json === false ? {} : { "Content-Type": "application/json" }),
    ...normalizeHeaders(headers)
  };

  if (context?.accessToken && context.accessToken !== "cookie") {
    merged.Authorization = `Bearer ${context.accessToken}`;
  } else {
    delete merged.Authorization;
  }

  if (context?.entityId) merged["X-Entity-ID"] = context.entityId;
  if (context?.tenantSlug) merged["X-Tenant-Slug"] = context.tenantSlug;
  if (context?.tenantCode) merged["X-Tenant-Code"] = context.tenantCode;

  return merged;
}

function apiUrl(pathOrUrl: string): string {
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${API_BASE_URL}${pathOrUrl}`;
}

async function errorFromResponse(response: Response): Promise<FrontendApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = null;
  }

  const firstError = body?.errors?.[0];
  const message =
    firstError?.message ??
    body?.message ??
    (response.status === 401
      ? "Your session has expired. Please sign in again."
      : response.status === 403
        ? "You do not have permission to perform this action."
        : `Request failed (${response.status})`);

  return new FrontendApiError(response.status, message, firstError?.code);
}

export async function apiFetch(
  pathOrUrl: string,
  context?: FrontendApiContext | null,
  init?: RequestInit & { json?: boolean }
): Promise<Response> {
  const response = await fetch(apiUrl(pathOrUrl), {
    ...init,
    credentials: "include",
    headers: buildApiHeaders(context, init?.headers, { json: init?.json ?? true })
  });

  if (!response.ok) {
    throw await errorFromResponse(response);
  }

  return response;
}

export async function downloadBlob(
  context: FrontendApiContext,
  pathOrUrl: string,
  filename: string
): Promise<void> {
  const response = await apiFetch(pathOrUrl, context, { method: "GET", json: false });
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof FrontendApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Request failed.";
}
