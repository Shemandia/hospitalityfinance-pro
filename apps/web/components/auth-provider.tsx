"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";

type AuthUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  entities: Array<{ entityId: string; name: string; type: string }>;
  entityIds: string[];
  mustChangePassword: boolean;
  tenantSlug?: string;
  tenantCode?: string;
};

type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  status: "loading" | "authenticated" | "unauthenticated";
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
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  accessToken: null,
  status: "loading",
  login: async () => ({ error: "Not initialized" }),
  logout: async () => {},
  refresh: async () => false
});

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    status: "loading"
  });
  const router = useRouter();
  const pathname = usePathname();

  // Check auth state on mount by calling /auth/me
  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        credentials: "include"
      });
      if (res.ok) {
        const json = await res.json();
        const profile = json.data;
        setState({
          user: {
            id: profile.id,
            email: profile.email,
            name: profile.name,
            roles: profile.roles ?? [],
            permissions: profile.permissions ?? [],
            entities: profile.entities ?? [],
            entityIds: (profile.entities ?? []).map((e: any) => e.entityId),
            mustChangePassword: profile.mustChangePassword ?? false,
            tenantSlug: profile.tenantSlug,
            tenantCode: profile.tenantCode
          },
          accessToken: "cookie", // Tokens are in httpOnly cookies — we use "cookie" as sentinel
          status: "authenticated"
        });
      } else {
        setState({ user: null, accessToken: null, status: "unauthenticated" });
      }
    } catch {
      setState({ user: null, accessToken: null, status: "unauthenticated" });
    }
  }

  const login = useCallback(async (email: string, password: string, tenantCode: string) => {
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

      const data = json.data;
      const mustChangePassword = data.mustChangePassword ?? false;

      // Set initial state from login response so the UI can proceed
      setState({
        user: {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          roles: data.user.roles ?? [],
          permissions: [],
          entities: [],
          entityIds: data.user.entityIds ?? [],
          mustChangePassword
        },
        accessToken: "cookie",
        status: "authenticated"
      });

      // Immediately fetch full profile (including permissions) from /auth/me
      await checkAuth();

      return { mustChangePassword };
    } catch {
      return { error: "Network error" };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        credentials: "include"
      });
    } catch {
      // Best-effort
    }
    setState({ user: null, accessToken: null, status: "unauthenticated" });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include"
      });
      if (res.ok) {
        // Re-check auth to get fresh user data
        await checkAuth();
        return true;
      }
    } catch {
      // ignore
    }
    setState({ user: null, accessToken: null, status: "unauthenticated" });
    return false;
  }, []);

  // Auto-refresh: set up interval to refresh token before expiry
  useEffect(() => {
    if (state.status !== "authenticated") return;
    // Refresh every 13 minutes (access token lasts 15 min)
    const interval = setInterval(
      () => {
        refresh();
      },
      13 * 60 * 1000
    );
    return () => clearInterval(interval);
  }, [state.status, refresh]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Backwards-compatibility shim: useSession() equivalent
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
              roles: auth.user?.roles ?? [],
              permissions: auth.user?.permissions ?? [],
              entityIds: auth.user?.entityIds ?? [],
              tenantSlug: auth.user?.tenantSlug,
              tenantCode: auth.user?.tenantCode
            },
            error: auth.error
          }
        : null,
    status: auth.status
  };
}
