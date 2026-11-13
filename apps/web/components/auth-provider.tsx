"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AccessContext } from "../lib/access";

/**
 * Who is signed in, and what they may do (WP-A step 6).
 *
 * Everything comes from GET /api/v1/context: the tenant, the user, the
 * permissions held tenant-wide and the entities the user can open with the
 * permissions at each. Nothing is read from the token or from role names.
 *
 * A 401 means signed out. Any other failure (503, network) leaves the user
 * signed in and reports the context as unavailable (AUT-10).
 */

type AuthUser = {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
  tenantId: string;
  tenantSlug: string;
  tenantCode: string;
  tenantName: string;
};

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "unavailable";

type AuthState = {
  user: AuthUser | null;
  /** The access context the user's menus and buttons are drawn from. */
  context: AccessContext | null;
  accessToken: string | null;
  status: AuthStatus;
  error?: string;
};

type AuthContextValue = AuthState & {
  login: (
    email: string,
    password: string,
    tenantCode: string
  ) => Promise<{ mustChangePassword: boolean } | { error: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  /** Reload the access context, for example after an administrator changed this user's grants. */
  reloadContext: () => Promise<void>;
};

const SIGNED_OUT: AuthState = {
  user: null,
  context: null,
  accessToken: null,
  status: "unauthenticated"
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  context: null,
  accessToken: null,
  status: "loading",
  login: async () => ({ error: "Not initialized" }),
  logout: async () => {},
  refresh: async () => false,
  reloadContext: async () => {}
});

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

function userFrom(context: AccessContext): AuthUser {
  return {
    id: context.user.id,
    email: context.user.email,
    name: context.user.name ?? "",
    mustChangePassword: context.user.mustChangePassword,
    tenantId: context.tenant.id,
    tenantSlug: context.tenant.slug,
    tenantCode: context.tenant.code,
    tenantName: context.tenant.name
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    context: null,
    accessToken: null,
    status: "loading"
  });

  const loadContext = useCallback(async (): Promise<AuthStatus> => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/context`, { credentials: "include" });
      if (res.ok) {
        const context = ((await res.json()) as { data: AccessContext }).data;
        setState({
          user: userFrom(context),
          context,
          // Tokens are in httpOnly cookies; "cookie" is the sentinel the API clients expect.
          accessToken: "cookie",
          status: "authenticated"
        });
        return "authenticated";
      }
      if (res.status === 401) {
        setState(SIGNED_OUT);
        return "unauthenticated";
      }
      const message = `Your access could not be loaded (${res.status}). Try again in a moment.`;
      setState((prev) => ({ ...prev, status: "unavailable", error: message }));
      return "unavailable";
    } catch {
      setState((prev) => ({
        ...prev,
        status: "unavailable",
        error: "The server could not be reached. Try again in a moment."
      }));
      return "unavailable";
    }
  }, []);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const login = useCallback(
    async (email: string, password: string, tenantCode: string) => {
      try {
        const res = await fetch(`${API_BASE}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, tenantCode }),
          credentials: "include"
        });
        const json = await res.json();
        if (!res.ok) {
          return { error: json.errors?.[0]?.message ?? "Login failed" };
        }
        const mustChangePassword = json.data?.mustChangePassword ?? false;
        const status = await loadContext();
        if (status !== "authenticated") {
          return { error: "Signed in, but your access could not be loaded. Try again." };
        }
        return { mustChangePassword };
      } catch {
        return { error: "Network error" };
      }
    },
    [loadContext]
  );

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
    } catch {
      // Best-effort
    }
    setState(SIGNED_OUT);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include"
      });
      if (res.ok) {
        return (await loadContext()) === "authenticated";
      }
      if (res.status === 401) {
        setState(SIGNED_OUT);
      }
    } catch {
      // A network fault is not a sign-out.
    }
    return false;
  }, [loadContext]);

  const reloadContext = useCallback(async () => {
    await loadContext();
  }, [loadContext]);

  // Refresh before the access token expires (it lasts 15 minutes). Each refresh
  // also reloads the context, so grant changes reach the menus without a sign-in.
  useEffect(() => {
    if (state.status !== "authenticated") return;
    const interval = setInterval(() => void refresh(), 13 * 60 * 1000);
    return () => clearInterval(interval);
  }, [state.status, refresh]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refresh, reloadContext }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** The shape older screens read the session through. Identity only. */
export function useSession() {
  const auth = useAuth();
  return {
    data:
      auth.status === "authenticated"
        ? {
            accessToken: auth.accessToken,
            user: {
              email: auth.user?.email,
              name: auth.user?.name,
              tenantSlug: auth.user?.tenantSlug,
              tenantCode: auth.user?.tenantCode
            },
            error: auth.error
          }
        : null,
    status: auth.status
  };
}
