import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string | null;
  /** The tenant bound to this context. Without it the shared prisma client refuses to query. */
  tenantId: string | null;
  entityId: string | null;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  disableAudit: boolean;
  tenantSlug: string | null;
  tenantDbUrl: string | null;
  /** Depth counter for RLS context wrapping — >0 means inside a scope with RLS set */
  _rlsDepth: number;
  /**
   * True inside withBypassRLS. The RLS middleware and the entity-scope
   * extension leave queries alone, so they stay on the bypass transaction and
   * are not narrowed to the request's entity.
   */
  rlsBypass: boolean;
};

const storage = new AsyncLocalStorage<RequestContext>();

function defaultContext(): RequestContext {
  return {
    requestId: null,
    tenantId: null,
    entityId: null,
    userId: null,
    ipAddress: null,
    userAgent: null,
    disableAudit: false,
    tenantSlug: null,
    tenantDbUrl: null,
    _rlsDepth: 0,
    rlsBypass: false
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

export function getRequestContext(): RequestContext {
  return storage.getStore() ?? defaultContext();
}

export function updateRequestContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (!store) {
    // Every request and job runs inside runWithContext. Updating a context
    // that does not exist would bind nothing, so it is a programming error.
    throw new Error("updateRequestContext called outside runWithContext.");
  }
  Object.assign(store, patch);
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
