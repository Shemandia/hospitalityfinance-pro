import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string | null;
  entityId: string | null;
  chainId: string | null;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  disableAudit: boolean;
  tenantSlug: string | null;
  tenantDbUrl: string | null;
  /** Depth counter for RLS context wrapping — >0 means inside a scope with RLS set */
  _rlsDepth: number;
};

const storage = new AsyncLocalStorage<RequestContext>();

function defaultContext(): RequestContext {
  return {
    requestId: null,
    entityId: null,
    chainId: null,
    userId: null,
    ipAddress: null,
    userAgent: null,
    disableAudit: false,
    tenantSlug: null,
    tenantDbUrl: null,
    _rlsDepth: 0
  };
}

/**
 * Run a function within a new request context.
 * Uses AsyncLocalStorage.run() which properly scopes context to the callback
 * and all async operations spawned from it — unlike enterWith() which can
 * lose context across Fastify hook boundaries.
 */
export function runWithContext<T>(initial: Partial<RequestContext>, fn: () => T): T {
  return storage.run({ ...defaultContext(), ...initial }, fn);
}

/**
 * @deprecated Use runWithContext() for new code. Kept for backward compat.
 */
export function enterRequestContext(initial?: Partial<RequestContext>): void {
  storage.enterWith({
    ...defaultContext(),
    ...(initial ?? {})
  });
}

export function getRequestContext(): RequestContext {
  return storage.getStore() ?? defaultContext();
}

export function updateRequestContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) {
    Object.assign(store, patch);
  } else {
    // No active store — create one (backward compat with enterWith callers)
    storage.enterWith({ ...defaultContext(), ...patch });
  }
}

export async function runWithAuditDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) return fn();
  const prev = store.disableAudit;
  store.disableAudit = true;
  try {
    return await fn();
  } finally {
    store.disableAudit = prev;
  }
}
