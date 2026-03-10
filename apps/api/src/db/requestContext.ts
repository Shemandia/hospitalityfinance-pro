import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  entityId: string | null;
  chainId: string | null;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  disableAudit: boolean;
};

const storage = new AsyncLocalStorage<RequestContext>();

function defaultContext(): RequestContext {
  return {
    entityId: null,
    chainId: null,
    userId: null,
    ipAddress: null,
    userAgent: null,
    disableAudit: false
  };
}

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
  const current = getRequestContext();
  storage.enterWith({
    ...current,
    ...patch
  });
}

export async function runWithAuditDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const current = getRequestContext();
  storage.enterWith({
    ...current,
    disableAudit: true
  });
  try {
    return await fn();
  } finally {
    storage.enterWith(current);
  }
}
