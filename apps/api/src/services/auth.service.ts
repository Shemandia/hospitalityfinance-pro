/**
 * Native Authentication Service
 *
 * Handles login, token refresh, logout, password change, and password reset.
 * Replaces Keycloak OIDC with bcrypt + JWT + Redis sessions.
 */

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { getRegistryClient, resolveTenantByCode } from "../db/tenantRegistry.js";
import { getTenantClient } from "../db/tenantPool.js";
import { withBypassRLS } from "../db/rls-bypass.js";
import type { Prisma } from "../db/client.js";

// ── Configuration ────────────────────────────────────────────────────────────

if (!process.env.JWT_SECRET) {
  throw new Error(
    "FATAL: JWT_SECRET environment variable is not set. Refusing to start with an insecure default."
  );
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ALGORITHM = "HS256" as const;
const ACCESS_EXPIRY = parseInt(process.env.JWT_ACCESS_EXPIRY ?? "900", 10); // 15 min
const REFRESH_EXPIRY = parseInt(process.env.JWT_REFRESH_EXPIRY ?? "604800", 10); // 7 days
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS ?? "12", 10);
const MAX_FAILED = parseInt(process.env.MAX_FAILED_ATTEMPTS ?? "5", 10);
const LOCKOUT_MIN = parseInt(process.env.LOCKOUT_DURATION_MINUTES ?? "15", 10);

// ── Error Types ──────────────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401,
    public code: string = "AUTHENTICATION_FAILED"
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ── Access token ─────────────────────────────────────────────────────────────

/**
 * What the access token carries: who, which tenant, which session. Nothing
 * about roles, permissions or entities — those are resolved per request by
 * AccessService, so a change takes effect without a new token (AUT-06).
 */
export type AccessTokenClaims = {
  sub: string;
  tenantId: string;
  sessionId: string;
  type: "access";
};

export function signAccessToken(userId: string, tenantId: string, sessionId: string): string {
  const claims: AccessTokenClaims = { sub: userId, tenantId, sessionId, type: "access" };
  return jwt.sign(claims, JWT_SECRET, { expiresIn: ACCESS_EXPIRY, algorithm: JWT_ALGORITHM });
}

// ── Auth Service ─────────────────────────────────────────────────────────────

export class AuthService {
  constructor(private redis: any) {} // ioredis instance

  private sessionKey(tenantId: string, userId: string, sessionId: string): string {
    return `session:${tenantId}:${userId}:${sessionId}`;
  }

  private userSessionsKey(tenantId: string, userId: string): string {
    return `user_sessions:${tenantId}:${userId}`;
  }

  private sessionRefreshKey(tenantId: string, userId: string, sessionId: string): string {
    return `session_refresh:${tenantId}:${userId}:${sessionId}`;
  }

  private async indexSession(
    tenantId: string,
    userId: string,
    sessionId: string,
    refreshTokenHash?: string
  ): Promise<void> {
    const userSessionsKey = this.userSessionsKey(tenantId, userId);
    await this.redis.sadd(userSessionsKey, sessionId);
    await this.redis.expire(userSessionsKey, REFRESH_EXPIRY);

    if (refreshTokenHash) {
      const refreshIndexKey = this.sessionRefreshKey(tenantId, userId, sessionId);
      await this.redis.sadd(refreshIndexKey, refreshTokenHash);
      await this.redis.expire(refreshIndexKey, REFRESH_EXPIRY);
    }
  }

  private async scanSessionIds(tenantId: string, userId: string): Promise<string[]> {
    const pattern = this.sessionKey(tenantId, userId, "*");
    const sessionIds = new Set<string>();
    let cursor = "0";

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      for (const key of keys as string[]) {
        const sessionId = key.split(":").pop();
        if (sessionId) sessionIds.add(sessionId);
      }
    } while (cursor !== "0");

    return [...sessionIds];
  }

  private async getSessionIds(tenantId: string, userId: string): Promise<string[]> {
    const sessionIds = new Set<string>(
      await this.redis.smembers(this.userSessionsKey(tenantId, userId))
    );

    for (const legacySessionId of await this.scanSessionIds(tenantId, userId)) {
      sessionIds.add(legacySessionId);
    }

    return [...sessionIds];
  }

  private async revokeSessionArtifacts(
    userId: string,
    tenantId: string,
    sessionId: string
  ): Promise<void> {
    const refreshIndexKey = this.sessionRefreshKey(tenantId, userId, sessionId);
    const refreshHashes: string[] = await this.redis.smembers(refreshIndexKey);
    const keysToDelete = [
      this.sessionKey(tenantId, userId, sessionId),
      refreshIndexKey,
      ...refreshHashes.map((hash) => `refresh:${hash}`)
    ];

    await this.redis.del(...keysToDelete);
    await this.redis.srem(this.userSessionsKey(tenantId, userId), sessionId);
  }

  /**
   * Authenticate a user with email + password against a tenant database.
   */
  async login(
    email: string,
    password: string,
    tenantCode: string,
    meta: { ip: string; userAgent: string }
  ) {
    // 1. Resolve tenant from code
    const tenant = await resolveTenantByCode(tenantCode);
    if (!tenant) throw new AuthError("Invalid credentials");

    // 2. Get tenant prisma client
    const tenantPrisma = getTenantClient(tenant.slug, tenant.databaseUrl);

    // 3. Find user by email — bypass RLS (no entity context during login)
    const user = await withBypassRLS(tenantPrisma, (tx: Prisma.TransactionClient) =>
      tx.user.findUnique({ where: { email: email.toLowerCase() } })
    );
    if (!user || !user.passwordHash) throw new AuthError("Invalid credentials");

    // 4. Check account lock
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMin = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new AuthError(
        `Account locked. Try again in ${remainingMin} minutes.`,
        423,
        "ACCOUNT_LOCKED"
      );
    }

    // 5. Verify password
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1;
      const updateData: { failedLoginAttempts: number; lockedUntil?: Date } = {
        failedLoginAttempts: attempts
      };
      if (attempts >= MAX_FAILED) {
        updateData.lockedUntil = new Date(Date.now() + LOCKOUT_MIN * 60000);
      }
      await tenantPrisma.user.update({
        where: { id: user.id },
        data: updateData
      });

      // Audit failed login
      await tenantPrisma.loginAudit.create({
        data: {
          userId: user.id,
          email: user.email,
          action: "LOGIN_FAILED",
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          metadata: { reason: "invalid_password", attempt: attempts }
        }
      });

      throw new AuthError("Invalid credentials");
    }

    // 6. Check if user is active
    if (!user.isActive) throw new AuthError("Account is disabled", 403, "ACCOUNT_DISABLED");

    // 7. Reset failed attempts + update last login
    await tenantPrisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: meta.ip,
        loginCount: { increment: 1 }
      }
    });

    // 8. Generate session + token
    const sessionId = crypto.randomUUID();
    const accessToken = signAccessToken(user.id, tenant.id, sessionId);

    const refreshToken = crypto.randomBytes(48).toString("hex");
    const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");

    // 10. Store session in Redis
    await this.redis.setex(
      this.sessionKey(tenant.id, user.id, sessionId),
      REFRESH_EXPIRY,
      JSON.stringify({
        userId: user.id,
        tenantId: tenant.id,
        tenantCode: tenant.tenantCode,
        tenantSlug: tenant.slug,
        email: user.email,
        deviceInfo: meta.userAgent,
        ipAddress: meta.ip,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString()
      })
    );

    // 11. Store refresh token hash in Redis
    await this.redis.setex(
      `refresh:${refreshTokenHash}`,
      REFRESH_EXPIRY,
      JSON.stringify({
        userId: user.id,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        sessionId,
        issuedAt: new Date().toISOString()
      })
    );
    await this.indexSession(tenant.id, user.id, sessionId, refreshTokenHash);

    // 12. Audit successful login
    await tenantPrisma.loginAudit.create({
      data: {
        userId: user.id,
        email: user.email,
        action: "LOGIN_SUCCESS",
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      }
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_EXPIRY,
      mustChangePassword: user.mustChangePassword,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    };
  }

  /**
   * Refresh an access token using a valid refresh token.
   * Implements rotation: old refresh token is invalidated, new one issued.
   */
  async refresh(refreshToken: string) {
    const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const stored = await this.redis.get(`refresh:${tokenHash}`);

    if (!stored) {
      // Potential token theft — revoked token reused
      throw new AuthError("Invalid refresh token");
    }

    const { userId, tenantId, tenantSlug, sessionId } = JSON.parse(stored);

    // Delete old refresh token (rotation)
    await this.redis.del(`refresh:${tokenHash}`);
    await this.redis.srem(this.sessionRefreshKey(tenantId, userId, sessionId), tokenHash);

    // Verify session still exists
    const sessionKey = this.sessionKey(tenantId, userId, sessionId);
    const session = await this.redis.get(sessionKey);
    if (!session) throw new AuthError("Session expired");

    // Load tenant from registry
    const registryClient = getRegistryClient();
    const tenant = await registryClient.tenant.findUnique({
      where: { id: tenantId }
    });
    if (!tenant || !tenant.isActive) throw new AuthError("Invalid tenant");

    // Load fresh user claims from tenant DB
    const tenantPrisma = getTenantClient(tenant.slug, tenant.databaseUrl);
    const user = await tenantPrisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true }
    });
    if (!user || !user.isActive) throw new AuthError("User not found or disabled");

    const newAccessToken = signAccessToken(user.id, tenant.id, sessionId);

    const newRefreshToken = crypto.randomBytes(48).toString("hex");
    const newRefreshHash = crypto.createHash("sha256").update(newRefreshToken).digest("hex");

    await this.redis.setex(
      `refresh:${newRefreshHash}`,
      REFRESH_EXPIRY,
      JSON.stringify({
        userId,
        tenantId,
        tenantSlug,
        sessionId,
        issuedAt: new Date().toISOString()
      })
    );
    await this.indexSession(tenantId, userId, sessionId, newRefreshHash);

    // Update session activity
    const sessionData = JSON.parse(session);
    sessionData.lastActiveAt = new Date().toISOString();
    await this.redis.setex(sessionKey, REFRESH_EXPIRY, JSON.stringify(sessionData));

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: ACCESS_EXPIRY
    };
  }

  /**
   * Logout: delete session + refresh token from Redis.
   */
  async logout(userId: string, tenantId: string, refreshToken?: string, sessionId?: string) {
    if (refreshToken) {
      const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
      const stored = await this.redis.get(`refresh:${tokenHash}`);
      if (stored) {
        const { sessionId: storedSessionId } = JSON.parse(stored);
        await this.revokeSessionArtifacts(userId, tenantId, storedSessionId);
        return;
      }
    }

    if (sessionId) {
      await this.revokeSessionArtifacts(userId, tenantId, sessionId);
    }
  }

  /**
   * Logout from all sessions for a user.
   */
  async logoutAll(userId: string, tenantId: string) {
    const sessionIds = await this.getSessionIds(tenantId, userId);
    for (const sessionId of sessionIds) {
      await this.revokeSessionArtifacts(userId, tenantId, sessionId);
    }
    await this.redis.del(this.userSessionsKey(tenantId, userId));
  }

  /**
   * Change password for an authenticated user.
   */
  async changePassword(
    userId: string,
    tenantSlug: string,
    tenantDbUrl: string,
    currentPassword: string,
    newPassword: string
  ) {
    const tenantPrisma = getTenantClient(tenantSlug, tenantDbUrl);
    const user = await tenantPrisma.user.findUnique({
      where: { id: userId }
    });
    if (!user || !user.passwordHash) throw new AuthError("User not found", 404, "USER_NOT_FOUND");

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AuthError("Current password is incorrect", 400, "INVALID_PASSWORD");

    validatePasswordPolicy(newPassword);

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await tenantPrisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: hash,
        passwordChangedAt: new Date(),
        mustChangePassword: false
      }
    });
  }

  /**
   * Request a password reset — generates a token and returns it.
   * The caller (route handler) is responsible for sending the email.
   */
  async requestPasswordReset(
    email: string,
    tenantCode: string
  ): Promise<{ token: string; userId: string } | null> {
    const tenant = await resolveTenantByCode(tenantCode);
    if (!tenant) return null; // Don't reveal tenant existence

    const tenantPrisma = getTenantClient(tenant.slug, tenant.databaseUrl);
    const user = await tenantPrisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    if (!user) return null; // Don't reveal user existence

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

    await tenantPrisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetTokenHash,
        passwordResetExpires: new Date(Date.now() + 3600_000) // 1 hour
      }
    });

    return { token: resetToken, userId: user.id };
  }

  /**
   * Reset password using a reset token.
   */
  async resetPassword(token: string, newPassword: string, tenantCode: string) {
    const tenant = await resolveTenantByCode(tenantCode);
    if (!tenant) throw new AuthError("Invalid reset token", 400, "INVALID_TOKEN");

    const tenantPrisma = getTenantClient(tenant.slug, tenant.databaseUrl);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find user by reset token hash (not expired)
    const users = await tenantPrisma.user.findMany({
      where: {
        passwordResetToken: tokenHash,
        passwordResetExpires: { gt: new Date() }
      }
    });
    if (users.length === 0)
      throw new AuthError("Invalid or expired reset token", 400, "INVALID_TOKEN");

    const user = users[0];
    validatePasswordPolicy(newPassword);

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await tenantPrisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hash,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        passwordResetToken: null,
        passwordResetExpires: null,
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });

    // Invalidate all sessions (force re-login)
    await this.logoutAll(user.id, tenant.id);
  }

  /**
   * List active sessions for a user.
   */
  async listSessions(userId: string, tenantId: string) {
    const sessions = [];
    for (const sessionId of await this.getSessionIds(tenantId, userId)) {
      const data = await this.redis.get(this.sessionKey(tenantId, userId, sessionId));
      if (data) {
        sessions.push({ sessionId, ...JSON.parse(data) });
      }
    }
    return sessions;
  }

  /**
   * Revoke a specific session.
   */
  async revokeSession(userId: string, tenantId: string, sessionId: string) {
    await this.revokeSessionArtifacts(userId, tenantId, sessionId);
  }

  /**
   * Validate that a tenant code exists (public endpoint).
   */
  async validateTenantCode(tenantCode: string) {
    const tenant = await resolveTenantByCode(tenantCode);
    if (!tenant) return null;
    return { name: tenant.name, tenantCode: tenant.tenantCode };
  }

  /**
   * The signed-in user's profile: who they are, nothing about what they may
   * do. Permissions and entities come only from GET /api/v1/context, so there
   * is one answer to "what can this user do" (AUT-02).
   */
  async getProfile(userId: string, tenantSlug: string, tenantDbUrl: string) {
    const tenantPrisma = getTenantClient(tenantSlug, tenantDbUrl);
    const user = await withBypassRLS(tenantPrisma, (tx: Prisma.TransactionClient) =>
      tx.user.findUnique({ where: { id: userId } })
    );
    if (!user) throw new AuthError("User not found", 404, "USER_NOT_FOUND");

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      jobTitle: user.jobTitle,
      department: user.department,
      avatarUrl: user.avatarUrl,
      lastLoginAt: user.lastLoginAt,
      mustChangePassword: user.mustChangePassword
    };
  }
}

// ── Password Policy ──────────────────────────────────────────────────────────

function validatePasswordPolicy(password: string): void {
  const errors: string[] = [];
  if (password.length < 12) errors.push("Password must be at least 12 characters");
  if (!/[A-Z]/.test(password)) errors.push("Password must contain an uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("Password must contain a lowercase letter");
  if (!/[0-9]/.test(password)) errors.push("Password must contain a digit");
  if (errors.length > 0) throw new ValidationError(errors.join(". "));
}

// ── Utility: hash a password (for seeding / admin reset) ─────────────────────

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}
