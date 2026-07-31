import { describe, expect, it } from "vitest";
import {
  applyEntityScope,
  applyNullableEntityScope,
  MODELS_WITH_ENTITY_ID,
  MODELS_WITH_NULLABLE_ENTITY_ID,
  MODELS_WITH_SERVICE_SCOPED_ENTITY_ID
} from "../src/db/entityScope.js";
import { RLS_MODELS } from "../src/db/rlsMiddleware.js";
import { isAccountTypeVisibleToEntity } from "../src/modules/account-type/router.js";

describe("applyEntityScope", () => {
  it("adds entityId filter to findMany queries", () => {
    const scoped = applyEntityScope("findMany", {}, "entity-1");
    expect(scoped.where).toEqual({ entityId: "entity-1" });
  });

  it("preserves existing filters by wrapping in AND", () => {
    const scoped = applyEntityScope("findMany", { where: { isActive: true } }, "entity-1");

    expect(scoped.where).toEqual({
      AND: [{ entityId: "entity-1" }, { isActive: true }]
    });
  });

  it("injects entityId into create payload when missing", () => {
    const scoped = applyEntityScope("create", { data: { name: "Entity User" } }, "entity-1");

    expect(scoped.data).toEqual({
      name: "Entity User",
      entityId: "entity-1"
    });
  });

  it("adds entityId to each createMany row", () => {
    const scoped = applyEntityScope(
      "createMany",
      {
        data: [{ name: "A" }, { name: "B", entityId: "entity-1" }]
      },
      "entity-1"
    );

    expect(scoped.data).toEqual([
      { name: "A", entityId: "entity-1" },
      { name: "B", entityId: "entity-1" }
    ]);
  });

  it("rejects create payloads with a mismatched entityId", () => {
    expect(() =>
      applyEntityScope(
        "create",
        { data: { name: "Entity User", entityId: "entity-2" } },
        "entity-1"
      )
    ).toThrow("Entity context mismatch");
  });

  it("rejects createMany rows with a mismatched entityId", () => {
    expect(() =>
      applyEntityScope(
        "createMany",
        {
          data: [{ name: "A" }, { name: "B", entityId: "entity-2" }]
        },
        "entity-1"
      )
    ).toThrow("Entity context mismatch");
  });

  it("keeps application scoping coverage aligned with RLS for entity-scoped models", () => {
    const expectedModels = [
      "RecurringJournal",
      "TransferJournalRange",
      "LedgerSetup",
      "ProcessLock",
      "PeriodCloseStatus",
      "AnalysisDimension",
      "AllocationDefinition",
      "AssetCategory",
      "FixedAsset",
      "DepreciationTable",
      "AuthorizationStage",
      "AuthorizationTeam",
      "AuthorizationDelegation",
      "RejectionCode",
      "AuthorizationSet",
      "JournalAuthorization",
      "PaymentProfile",
      "RevaluationProfile",
      "YearEndConfig",
      "IntercompanyAccountPair",
      "BankAccount",
      "TaxCode"
    ];

    for (const model of expectedModels) {
      expect(MODELS_WITH_ENTITY_ID.has(model), `${model} missing application scope`).toBe(true);
      expect(RLS_MODELS.has(model), `${model} missing RLS scope`).toBe(true);
    }
  });

  it("keeps nullable entity-scoped account types visible only for global or current entity rows", () => {
    expect(MODELS_WITH_NULLABLE_ENTITY_ID.has("AccountTypeDefinition")).toBe(true);
    expect(RLS_MODELS.has("AccountTypeDefinition")).toBe(true);

    const scoped = applyNullableEntityScope("findMany", { where: { isActive: true } }, "entity-1");
    expect(scoped.where).toEqual({
      AND: [{ OR: [{ entityId: null }, { entityId: "entity-1" }] }, { isActive: true }]
    });
  });

  it("rejects nullable entity-scoped creates with a mismatched entityId", () => {
    expect(() =>
      applyNullableEntityScope(
        "create",
        { data: { code: "CUSTOM", entityId: "entity-2" } },
        "entity-1"
      )
    ).toThrow("Entity context mismatch");
  });

  it("allows account type records only when global system or current entity scoped", () => {
    expect(isAccountTypeVisibleToEntity({ entityId: null, isSystem: true }, "entity-1")).toBe(true);
    expect(
      isAccountTypeVisibleToEntity({ entityId: "entity-1", isSystem: false }, "entity-1")
    ).toBe(true);
    expect(
      isAccountTypeVisibleToEntity({ entityId: "entity-2", isSystem: false }, "entity-1")
    ).toBe(false);
    expect(isAccountTypeVisibleToEntity({ entityId: null, isSystem: false }, "entity-1")).toBe(
      false
    );
  });

  it("marks login audit as service-scoped instead of generally app/RLS scoped", () => {
    expect(MODELS_WITH_SERVICE_SCOPED_ENTITY_ID.has("LoginAudit")).toBe(true);
    expect(MODELS_WITH_ENTITY_ID.has("LoginAudit")).toBe(false);
    expect(RLS_MODELS.has("LoginAudit")).toBe(false);
  });
});
