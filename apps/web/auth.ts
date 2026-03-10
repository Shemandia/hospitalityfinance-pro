import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Keycloak from "next-auth/providers/keycloak";

const isDev = process.env.NODE_ENV !== "production";

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
    return JSON.parse(Buffer.from(payload, "base64").toString("utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    ...(isDev
      ? [
          Credentials({
            name: "Dev Login",
            credentials: {
              email: { label: "Email", type: "email", placeholder: "admin@localhost" },
              entityId: { label: "Entity ID", type: "text", placeholder: "entity-uuid" }
            },
            async authorize(credentials) {
              if (!credentials?.email) return null;
              return {
                id: "dev-user",
                email: String(credentials.email),
                name: "Dev User",
                // Attach dev token fields used by session callback
                accessToken: "dev-token",
                roles: ["admin"],
                entityIds: credentials.entityId ? [String(credentials.entityId)] : []
              };
            }
          })
        ]
      : [
          Keycloak({
            issuer: process.env.AUTH_KEYCLOAK_ISSUER,
            clientId: process.env.AUTH_KEYCLOAK_ID,
            clientSecret: process.env.AUTH_KEYCLOAK_SECRET
          })
        ])
  ],
  session: {
    strategy: "jwt"
  },
  callbacks: {
    async jwt({ token, account, user }) {
      // Credentials provider (dev mode) — account.type === "credentials", user carries custom fields
      if (account?.type === "credentials" && user) {
        const u = user as typeof user & { accessToken?: string; roles?: string[]; entityIds?: string[] };
        token.accessToken = u.accessToken ?? "dev-token";
        token.roles = u.roles ?? [];
        token.entityIds = u.entityIds ?? [];
        return token;
      }
      if (account?.access_token) {
        token.accessToken = account.access_token;
        const payload = decodeJwtPayload(account.access_token);
        const realmAccess = payload.realm_access as { roles?: unknown } | undefined;
        token.roles = Array.isArray(realmAccess?.roles)
          ? realmAccess.roles.filter((item): item is string => typeof item === "string")
          : [];
        token.entityIds = Array.isArray(payload.entity_ids)
          ? payload.entity_ids.filter((item): item is string => typeof item === "string")
          : [];
      }

      return token;
    },
    async session({ session, token }) {
      session.accessToken = typeof token.accessToken === "string" ? token.accessToken : undefined;
      session.user.roles = Array.isArray(token.roles)
        ? token.roles.filter((item): item is string => typeof item === "string")
        : [];
      session.user.entityIds = Array.isArray(token.entityIds)
        ? token.entityIds.filter((item): item is string => typeof item === "string")
        : [];
      return session;
    }
  },
  pages: {
    signIn: "/login"
  }
});
