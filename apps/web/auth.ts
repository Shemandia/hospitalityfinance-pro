import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";
import { randomBytes } from "crypto";

const isDev = process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_AUTH === "true";
const keycloakBaseUrl = process.env.KEYCLOAK_BASE_URL ?? "http://localhost:8080";
const keycloakClientId = process.env.AUTH_KEYCLOAK_ID ?? "hfp-web";
const keycloakClientSecret = process.env.AUTH_KEYCLOAK_SECRET ?? "hfp-shared-secret";

// Refresh the access token a little before it expires so in-flight requests
// don't race against the wire-level expiry.
const REFRESH_SKEW_MS = 30_000;

async function refreshKeycloakToken(token: JWT): Promise<JWT> {
  if (!token.refreshToken || !token.tenantSlug) {
    return { ...token, error: "RefreshAccessTokenError" };
  }
  try {
    const res = await fetch(
      `${keycloakBaseUrl}/realms/${token.tenantSlug}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: keycloakClientId,
          client_secret: keycloakClientSecret,
          refresh_token: token.refreshToken
        })
      }
    );
    if (!res.ok) {
      return { ...token, error: "RefreshAccessTokenError" };
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      refresh_expires_in?: number;
    };
    return {
      ...token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      accessTokenExpiresAt: Date.now() + data.expires_in * 1000,
      refreshTokenExpiresAt: data.refresh_expires_in
        ? Date.now() + data.refresh_expires_in * 1000
        : token.refreshTokenExpiresAt,
      error: undefined
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) {
    return {};
  }

  const payload = parts[1]
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");

  try {
    return JSON.parse(Buffer.from(payload, "base64").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "Login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        tenantSlug: { label: "Tenant", type: "text" }
      },
      async authorize(credentials) {
        if (!credentials?.email) return null;
        const tenantSlug = credentials.tenantSlug ? String(credentials.tenantSlug) : undefined;

        // ── Dev mode: bypass Keycloak ──────────────────────────────────────
        if (isDev) {
          const devToken = `dev-${randomBytes(32).toString("hex")}`;
          let name = "Dev User";
          let email = String(credentials.email);

          if (tenantSlug) {
            try {
              const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";
              const platformKey = process.env.HFP_PLATFORM_KEY;
              if (platformKey) {
                const res = await fetch(`${apiBase}/api/v1/platform/tenants/${tenantSlug}`, {
                  headers: { "X-Platform-Key": platformKey }
                });
                if (res.ok) {
                  const json = await res.json();
                  const tenant = json.data;
                  if (tenant) {
                    name = `${tenant.name} Admin`;
                    email = tenant.adminEmail ?? email;
                  }
                }
              }
            } catch {
              // Fall through with defaults
            }
          }

          return {
            id: `dev-${tenantSlug ?? "user"}`,
            email,
            name,
            accessToken: devToken,
            roles: ["admin", "superadmin"],
            entityIds: [],
            tenantSlug
          };
        }

        // ── Production: Keycloak direct grant ─────────────────────────────
        if (!tenantSlug || !credentials.password) return null;

        try {
          const tokenUrl = `${keycloakBaseUrl}/realms/${tenantSlug}/protocol/openid-connect/token`;
          const res = await fetch(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "password",
              client_id: keycloakClientId,
              client_secret: keycloakClientSecret,
              username: String(credentials.email),
              password: String(credentials.password),
              scope: "openid"
            })
          });

          if (!res.ok) return null;

          const tokenData = (await res.json()) as {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
            refresh_expires_in?: number;
          };
          const accessToken = tokenData.access_token;
          const payload = decodeJwtPayload(accessToken);

          const realmAccess = payload.realm_access as { roles?: unknown } | undefined;
          const roles = Array.isArray(realmAccess?.roles)
            ? realmAccess.roles.filter((r): r is string => typeof r === "string")
            : [];
          const entityIds = Array.isArray(payload.entity_ids)
            ? payload.entity_ids.filter((e): e is string => typeof e === "string")
            : [];

          const now = Date.now();
          return {
            id: typeof payload.sub === "string" ? payload.sub : "",
            email: typeof payload.email === "string" ? payload.email : String(credentials.email),
            name:
              typeof payload.name === "string"
                ? payload.name
                : typeof payload.preferred_username === "string"
                  ? payload.preferred_username
                  : String(credentials.email),
            accessToken,
            refreshToken: tokenData.refresh_token,
            accessTokenExpiresAt: tokenData.expires_in
              ? now + tokenData.expires_in * 1000
              : undefined,
            refreshTokenExpiresAt: tokenData.refresh_expires_in
              ? now + tokenData.refresh_expires_in * 1000
              : undefined,
            roles,
            entityIds,
            tenantSlug
          };
        } catch {
          return null;
        }
      }
    })
  ],
  session: {
    strategy: "jwt"
  },
  callbacks: {
    async jwt({ token, account, user }) {
      // ── Initial sign-in: copy fields from the authorize() result ────────────
      if (account?.type === "credentials" && user) {
        const u = user as typeof user & {
          accessToken?: string;
          refreshToken?: string;
          accessTokenExpiresAt?: number;
          refreshTokenExpiresAt?: number;
          roles?: string[];
          entityIds?: string[];
          tenantSlug?: string;
        };
        token.accessToken = u.accessToken ?? `dev-${randomBytes(32).toString("hex")}`;
        token.refreshToken = u.refreshToken;
        token.accessTokenExpiresAt = u.accessTokenExpiresAt;
        token.refreshTokenExpiresAt = u.refreshTokenExpiresAt;
        token.roles = u.roles ?? [];
        token.entityIds = u.entityIds ?? [];
        token.tenantSlug = u.tenantSlug ?? undefined;
        token.error = undefined;
        return token;
      }

      // ── Subsequent calls: dev tokens never expire ───────────────────────────
      if (typeof token.accessToken === "string" && token.accessToken.startsWith("dev-")) {
        return token;
      }

      // ── No expiry tracked (e.g., legacy session): nothing to refresh ────────
      if (!token.accessTokenExpiresAt) {
        return token;
      }

      // ── Still valid (with skew) ─────────────────────────────────────────────
      if (Date.now() < token.accessTokenExpiresAt - REFRESH_SKEW_MS) {
        return token;
      }

      // ── Refresh token itself expired: force re-login ────────────────────────
      if (token.refreshTokenExpiresAt && Date.now() >= token.refreshTokenExpiresAt) {
        return { ...token, error: "RefreshAccessTokenError" as const };
      }

      // ── Refresh ─────────────────────────────────────────────────────────────
      return refreshKeycloakToken(token);
    },
    async session({ session, token }) {
      session.accessToken = typeof token.accessToken === "string" ? token.accessToken : undefined;
      session.error = token.error;
      session.user.roles = Array.isArray(token.roles)
        ? token.roles.filter((item): item is string => typeof item === "string")
        : [];
      session.user.entityIds = Array.isArray(token.entityIds)
        ? token.entityIds.filter((item): item is string => typeof item === "string")
        : [];
      session.user.tenantSlug = typeof token.tenantSlug === "string" ? token.tenantSlug : undefined;
      return session;
    }
  },
  pages: {}
});
