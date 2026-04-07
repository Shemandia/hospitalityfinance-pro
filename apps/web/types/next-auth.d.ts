import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshAccessTokenError";
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      roles: string[];
      entityIds: string[];
      tenantSlug?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    /** Epoch ms when the access token expires */
    accessTokenExpiresAt?: number;
    /** Epoch ms when the refresh token itself expires */
    refreshTokenExpiresAt?: number;
    error?: "RefreshAccessTokenError";
    roles?: string[];
    entityIds?: string[];
    tenantSlug?: string;
  }
}
