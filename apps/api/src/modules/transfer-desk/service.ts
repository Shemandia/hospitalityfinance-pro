import type { PrismaClient } from "../../db/client.js";
import type {
  ProfileCreateInput,
  ProfileUpdateInput,
  ProfileListQuery,
  ProfileStatusChangeInput
} from "./types.js";

import { ServiceError } from "../../shared/service-error.js";

// ── Error ────────────────────────────────────────────────────────────────────

export class ProfileServiceError extends ServiceError {}

// ── Allowed status transitions ───────────────────────────────────────────────

/**
 * Spec §3 — status transitions:
 *   DRAFT   → ACTIVE, ARCHIVED
 *   ACTIVE  → INACTIVE, ARCHIVED
 *   INACTIVE→ ACTIVE, ARCHIVED
 *   ARCHIVED→ (none — terminal)
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["INACTIVE", "ARCHIVED"],
  INACTIVE: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: []
};

// ── Profile-type-specific validation ─────────────────────────────────────────

/**
 * Validates structural completeness of a profile. Returns a list of error
 * messages; empty array means valid.
 *
 * Rules from the integration module:
 *   TD-BL-002 Import: targetComponent mandatory
 *   TD-BL-003 Export: sourceComponent mandatory
 *   TD-BL-004 Process: targetComponent mandatory
 *   TD-BL-005 transformationId always mandatory
 *   Transfer types: both sourceComponent and targetComponent required
 */
function validateProfileShape(p: {
  profileType: string;
  sourceComponent?: string | null;
  targetComponent?: string | null;
  transformationId?: string | null;
}): string[] {
  const errors: string[] = [];
  if (!p.transformationId) {
    errors.push("transformationId is required (TD-BL-005)");
  }
  switch (p.profileType) {
    case "IMPORT":
      if (!p.targetComponent) errors.push("Import profiles require targetComponent (TD-BL-002)");
      break;
    case "EXPORT":
      if (!p.sourceComponent) errors.push("Export profiles require sourceComponent (TD-BL-003)");
      break;
    case "PROCESS":
      if (!p.targetComponent) errors.push("Process profiles require targetComponent (TD-BL-004)");
      break;
    case "INTERNAL_TRANSFER":
    case "EXTERNAL_TRANSFER":
      if (!p.sourceComponent || !p.targetComponent) {
        errors.push("Transfer profiles require both sourceComponent and targetComponent");
      }
      break;
  }
  return errors;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class ProfileService {
  constructor(private readonly prisma: PrismaClient) {}

  // ── Create ────────────────────────────────────────────────────────────────

  async create(createdBy: string, input: ProfileCreateInput) {
    const db = this.prisma as any;

    // Unique name check
    const existing = await db.transferProfile.findFirst({
      where: { name: input.name }
    });
    if (existing) {
      throw new ProfileServiceError(
        "PROFILE_DUPLICATE_NAME",
        `A profile named "${input.name}" already exists.`,
        409
      );
    }

    const validationErrors = validateProfileShape({
      profileType: input.profileType,
      sourceComponent: input.sourceComponent,
      targetComponent: input.targetComponent,
      transformationId: input.transformationId
    });

    const created = await db.transferProfile.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        profileType: input.profileType,
        sourceComponent: input.sourceComponent ?? null,
        targetComponent: input.targetComponent ?? null,
        sourceFormatId: input.sourceFormatId ?? null,
        targetFormatId: input.targetFormatId ?? null,
        transformationId: input.transformationId ?? null,
        filterId: input.filterId ?? null,
        sourceParams: (input.sourceParams as any) ?? null,
        targetParams: (input.targetParams as any) ?? null,
        savePayload: input.savePayload ?? "NONE",
        isValid: validationErrors.length === 0,
        isActive: true,
        version: 1,
        createdById: createdBy
      }
    });

    // Snapshot v1
    await db.transferProfileVersion.create({
      data: {
        profileId: created.id,
        version: 1,
        snapshot: created,
        changedBy: createdBy,
        changeNote: "Initial version"
      }
    });

    return { ...created, validationErrors };
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async list(query: ProfileListQuery) {
    const db = this.prisma as any;

    const where: Record<string, unknown> = {};
    if (query.profileType) where.profileType = query.profileType;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.isSystem !== undefined) where.isSystem = query.isSystem;
    if (query.search) {
      where.name = { contains: query.search, mode: "insensitive" };
    }

    const [data, total] = await Promise.all([
      db.transferProfile.findMany({
        where,
        orderBy: [{ profileType: "asc" }, { name: "asc" }],
        include: {
          sourceFormat: { select: { id: true, name: true, classification: true } },
          targetFormat: { select: { id: true, name: true, classification: true } },
          transformation: { select: { id: true, name: true } },
          _count: { select: { executions: true, versions: true } }
        },
        skip: query.offset,
        take: query.limit
      }),
      db.transferProfile.count({ where })
    ]);

    return { data, total, limit: query.limit, offset: query.offset };
  }

  // ── Get ───────────────────────────────────────────────────────────────────

  async get(profileId: string) {
    const db = this.prisma as any;

    const data = await db.transferProfile.findUnique({
      where: { id: profileId },
      include: {
        sourceFormat: true,
        targetFormat: true,
        transformation: { select: { id: true, name: true, scriptType: true } },
        filter: { select: { id: true, name: true } },
        versions: {
          select: {
            id: true,
            version: true,
            changedBy: true,
            changedAt: true,
            changeNote: true
          },
          orderBy: { version: "desc" as const },
          take: 10
        }
      }
    });

    if (!data) {
      throw new ProfileServiceError("PROFILE_NOT_FOUND", "Profile not found.", 404);
    }

    return data;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(profileId: string, userId: string, input: ProfileUpdateInput) {
    const db = this.prisma as any;

    const existing = await db.transferProfile.findUnique({
      where: { id: profileId }
    });
    if (!existing) {
      throw new ProfileServiceError("PROFILE_NOT_FOUND", "Profile not found.", 404);
    }
    if (existing.isSystem) {
      throw new ProfileServiceError(
        "PROFILE_SYSTEM_READONLY",
        "System profiles cannot be modified.",
        403
      );
    }

    // Merge for validation
    const merged = {
      profileType: input.profileType ?? existing.profileType,
      sourceComponent: input.sourceComponent ?? existing.sourceComponent,
      targetComponent: input.targetComponent ?? existing.targetComponent,
      transformationId: input.transformationId ?? existing.transformationId
    };
    const validationErrors = validateProfileShape(merged);

    // Build update data — only set fields that were provided
    const updateData: Record<string, unknown> = {
      isValid: validationErrors.length === 0,
      version: { increment: 1 }
    };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.profileType !== undefined) updateData.profileType = input.profileType;
    if (input.sourceComponent !== undefined) updateData.sourceComponent = input.sourceComponent;
    if (input.targetComponent !== undefined) updateData.targetComponent = input.targetComponent;
    if (input.sourceFormatId !== undefined) updateData.sourceFormatId = input.sourceFormatId;
    if (input.targetFormatId !== undefined) updateData.targetFormatId = input.targetFormatId;
    if (input.transformationId !== undefined) updateData.transformationId = input.transformationId;
    if (input.filterId !== undefined) updateData.filterId = input.filterId;
    if (input.targetParams !== undefined) updateData.targetParams = input.targetParams as any;
    if (input.savePayload !== undefined) updateData.savePayload = input.savePayload;

    // Merge wizard step data into sourceParams (JSON column)
    // This keeps all wizard config in one place alongside __status, __fsdSchema, etc.
    const currentSourceParams =
      (input.sourceParams as Record<string, unknown>) ??
      (existing.sourceParams as Record<string, unknown>) ??
      {};
    const wizardMerge: Record<string, unknown> = { ...currentSourceParams };
    if (input.fsdSchema !== undefined) wizardMerge.__fsdSchema = input.fsdSchema;
    if (input.tmlMappings !== undefined) wizardMerge.__tmlMappings = input.tmlMappings;
    if (input.validationRules !== undefined) wizardMerge.__validationRules = input.validationRules;
    if (input.errorHandling !== undefined) wizardMerge.__errorHandling = input.errorHandling;
    if (input.duplicateDetection !== undefined)
      wizardMerge.__duplicateDetection = input.duplicateDetection;
    if (input.postingOptions !== undefined) wizardMerge.__postingOptions = input.postingOptions;
    updateData.sourceParams = wizardMerge;

    const updated = await db.transferProfile.update({
      where: { id: profileId },
      data: updateData
    });

    // Snapshot new version
    await db.transferProfileVersion.create({
      data: {
        profileId: updated.id,
        version: updated.version,
        snapshot: updated,
        changedBy: userId,
        changeNote: "Updated"
      }
    });

    return { ...updated, validationErrors };
  }

  // ── Change Status ─────────────────────────────────────────────────────────

  async changeStatus(profileId: string, userId: string, input: ProfileStatusChangeInput) {
    const db = this.prisma as any;

    const existing = await db.transferProfile.findUnique({
      where: { id: profileId }
    });
    if (!existing) {
      throw new ProfileServiceError("PROFILE_NOT_FOUND", "Profile not found.", 404);
    }

    // Derive current status from isActive flag + existence
    // Existing model uses isActive (boolean) — map to spec statuses:
    //   isActive=true, isValid=false  → DRAFT
    //   isActive=true, isValid=true   → ACTIVE
    //   isActive=false                → could be INACTIVE or ARCHIVED
    // For status transitions, we use a "status" stored in sourceParams.__status
    // or derive from the model fields.
    const currentStatus = this._deriveStatus(existing);
    const targetStatus = input.status;

    const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(targetStatus)) {
      throw new ProfileServiceError(
        "PROFILE_INVALID_STATUS_TRANSITION",
        `Cannot transition from ${currentStatus} to ${targetStatus}. Allowed: ${allowed.join(", ") || "none"}.`,
        409
      );
    }

    // Activation guard: must be valid to activate
    if (targetStatus === "ACTIVE" && !existing.isValid) {
      throw new ProfileServiceError(
        "PROFILE_NOT_VALID",
        "Profile must pass validation before activation. Run POST /profiles/:id/validate first.",
        409
      );
    }

    // Map target status back to model fields
    const data: Record<string, unknown> = {};
    switch (targetStatus) {
      case "ACTIVE":
        data.isActive = true;
        break;
      case "INACTIVE":
        data.isActive = false;
        break;
      case "ARCHIVED":
        data.isActive = false;
        break;
    }
    // Persist the explicit status in sourceParams.__status for roundtrip
    const currentParams = (existing.sourceParams as Record<string, unknown>) ?? {};
    data.sourceParams = { ...currentParams, __status: targetStatus };

    const updated = await db.transferProfile.update({
      where: { id: profileId },
      data
    });

    // Version snapshot for status change
    await db.transferProfileVersion.create({
      data: {
        profileId: updated.id,
        version: (existing.version as number) + 1,
        snapshot: updated,
        changedBy: userId,
        changeNote: input.changeNote ?? `Status changed to ${targetStatus}`
      }
    });
    // Bump the version counter
    await db.transferProfile.update({
      where: { id: profileId },
      data: { version: { increment: 1 } }
    });

    return { ...updated, status: targetStatus };
  }

  // ── Soft Delete (→ ARCHIVED) ──────────────────────────────────────────────

  async softDelete(profileId: string, userId: string) {
    const db = this.prisma as any;

    const existing = await db.transferProfile.findUnique({
      where: { id: profileId }
    });
    if (!existing) {
      throw new ProfileServiceError("PROFILE_NOT_FOUND", "Profile not found.", 404);
    }
    if (existing.isSystem) {
      throw new ProfileServiceError(
        "PROFILE_SYSTEM_READONLY",
        "System profiles cannot be deleted.",
        403
      );
    }

    const currentParams = (existing.sourceParams as Record<string, unknown>) ?? {};

    const updated = await db.transferProfile.update({
      where: { id: profileId },
      data: {
        isActive: false,
        sourceParams: { ...currentParams, __status: "ARCHIVED" }
      }
    });

    // Version snapshot for archive
    await db.transferProfileVersion.create({
      data: {
        profileId: updated.id,
        version: (existing.version as number) + 1,
        snapshot: updated,
        changedBy: userId,
        changeNote: "Archived (soft delete)"
      }
    });
    await db.transferProfile.update({
      where: { id: profileId },
      data: { version: { increment: 1 } }
    });

    return { id: updated.id, isActive: false, status: "ARCHIVED" as const };
  }

  // ── List Versions ─────────────────────────────────────────────────────────

  async listVersions(profileId: string) {
    const db = this.prisma as any;

    // Verify profile exists
    const exists = await db.transferProfile.findUnique({
      where: { id: profileId },
      select: { id: true }
    });
    if (!exists) {
      throw new ProfileServiceError("PROFILE_NOT_FOUND", "Profile not found.", 404);
    }

    return db.transferProfileVersion.findMany({
      where: { profileId },
      orderBy: { version: "desc" as const }
    });
  }

  // ── Get Version ───────────────────────────────────────────────────────────

  async getVersion(profileId: string, versionId: string) {
    const db = this.prisma as any;

    const version = await db.transferProfileVersion.findFirst({
      where: { id: versionId, profileId }
    });
    if (!version) {
      throw new ProfileServiceError("PROFILE_VERSION_NOT_FOUND", "Profile version not found.", 404);
    }

    return version;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Derive the spec-level status from the existing DB model fields.
   *
   * The Prisma model uses `isActive` (boolean) + `isValid` (boolean).
   * The spec §3 defines 4 statuses: DRAFT, ACTIVE, INACTIVE, ARCHIVED.
   *
   * We persist the explicit status in sourceParams.__status when changed
   * via changeStatus(). For profiles that haven't been through changeStatus
   * yet, we infer:
   *   isActive=true  + isValid=false → DRAFT
   *   isActive=true  + isValid=true  → ACTIVE
   *   isActive=false                 → check __status, default INACTIVE
   */
  private _deriveStatus(profile: {
    isActive: boolean;
    isValid: boolean;
    sourceParams: unknown;
  }): string {
    const params = (profile.sourceParams as Record<string, unknown>) ?? {};
    const explicit = params.__status;
    if (typeof explicit === "string") return explicit;

    if (profile.isActive) {
      return profile.isValid ? "ACTIVE" : "DRAFT";
    }
    return "INACTIVE";
  }
}
