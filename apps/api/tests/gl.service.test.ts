import { describe, expect, it } from "vitest";
import { GLService, GLServiceError } from "../src/modules/gl/service.js";

function createServiceWithAccounts(accounts: Array<Record<string, unknown>>) {
  const prismaStub = {
    account: {
      findMany: async () => accounts
    }
  } as unknown as ConstructorParameters<typeof GLService>[0];

  return new GLService(prismaStub as never);
}

describe("GLService.validateBalance", () => {
  const entityId = "entity-1";

  it("accepts balanced journal lines", async () => {
    const service = createServiceWithAccounts([
      { id: "00000000-0000-0000-0000-000000000001", type: "ASSET" },
      { id: "00000000-0000-0000-0000-000000000002", type: "REVENUE" }
    ]);
    await expect(
      service.validateBalance(entityId, [
        {
          accountId: "00000000-0000-0000-0000-000000000001",
          debit: "100.0000",
          credit: "0",
          currency: "USD",
          fxRate: "1"
        },
        {
          accountId: "00000000-0000-0000-0000-000000000002",
          debit: "0",
          credit: "100.0000",
          currency: "USD",
          fxRate: "1"
        }
      ])
    ).resolves.toBeUndefined();
  });

  it("throws GL_UNBALANCED_JOURNAL for unbalanced lines", async () => {
    const service = createServiceWithAccounts([
      { id: "00000000-0000-0000-0000-000000000001", type: "ASSET" },
      { id: "00000000-0000-0000-0000-000000000002", type: "REVENUE" }
    ]);
    await expect(
      service.validateBalance(entityId, [
        {
          accountId: "00000000-0000-0000-0000-000000000001",
          debit: "100.0000",
          credit: "0",
          currency: "USD",
          fxRate: "1"
        },
        {
          accountId: "00000000-0000-0000-0000-000000000002",
          debit: "0",
          credit: "99.0000",
          currency: "USD",
          fxRate: "1"
        }
      ])
    ).rejects.toThrowError(GLServiceError);
  });

  it("throws GL_UNBALANCED_JOURNAL when lines balance in transaction amounts but not functionally", async () => {
    const service = createServiceWithAccounts([
      { id: "00000000-0000-0000-0000-000000000001", type: "ASSET" },
      { id: "00000000-0000-0000-0000-000000000002", type: "REVENUE" }
    ]);
    // 100 EUR @ 1.10 = 110 functional debit vs 100 USD @ 1 = 100 functional credit
    await expect(
      service.validateBalance(entityId, [
        {
          accountId: "00000000-0000-0000-0000-000000000001",
          debit: "100.0000",
          credit: "0",
          currency: "EUR",
          fxRate: "1.10"
        },
        {
          accountId: "00000000-0000-0000-0000-000000000002",
          debit: "0",
          credit: "100.0000",
          currency: "USD",
          fxRate: "1"
        }
      ])
    ).rejects.toThrowError(GLServiceError);
  });

  it("accepts multi-currency lines that balance in functional currency", async () => {
    const service = createServiceWithAccounts([
      { id: "00000000-0000-0000-0000-000000000001", type: "ASSET" },
      { id: "00000000-0000-0000-0000-000000000002", type: "REVENUE" }
    ]);
    // 100 EUR @ 1.10 = 110 functional debit vs 110 USD @ 1 = 110 functional credit
    await expect(
      service.validateBalance(entityId, [
        {
          accountId: "00000000-0000-0000-0000-000000000001",
          debit: "100.0000",
          credit: "0",
          currency: "EUR",
          fxRate: "1.10"
        },
        {
          accountId: "00000000-0000-0000-0000-000000000002",
          debit: "0",
          credit: "110.0000",
          currency: "USD",
          fxRate: "1"
        }
      ])
    ).resolves.toBeUndefined();
  });

  it("skips balance check for statistics-only journals (memo accounts)", async () => {
    const service = createServiceWithAccounts([
      { id: "stat-1", type: "STATISTICAL" },
      { id: "stat-2", type: "STATISTICAL" }
    ]);
    // Intentionally unbalanced: statistical memo postings are single-sided.
    await expect(
      service.validateBalance(entityId, [
        { accountId: "stat-1", debit: "26", credit: "0", currency: "USD", fxRate: "1" },
        { accountId: "stat-2", debit: "48", credit: "0", currency: "USD", fxRate: "1" }
      ])
    ).resolves.toBeUndefined();
  });

  it("checks balance only on non-statistical lines in mixed journals", async () => {
    const service = createServiceWithAccounts([
      { id: "asset-1", type: "ASSET" },
      { id: "rev-1", type: "REVENUE" },
      { id: "stat-1", type: "STATISTICAL" }
    ]);
    await expect(
      service.validateBalance(entityId, [
        { accountId: "asset-1", debit: "100", credit: "0", currency: "USD", fxRate: "1" },
        { accountId: "rev-1", debit: "0", credit: "100", currency: "USD", fxRate: "1" },
        { accountId: "stat-1", debit: "1", credit: "0", currency: "USD", fxRate: "1" }
      ])
    ).resolves.toBeUndefined();
  });
});

describe("GLService.listAccounts", () => {
  it("returns nested account hierarchy", async () => {
    const service = createServiceWithAccounts([
      {
        id: "1",
        code: "4000",
        name: "Revenue",
        type: "REVENUE",
        normalBalance: "CREDIT",
        usaliCategory: "Revenue",
        usaliDepartment: null,
        allowPosting: false,
        level: 1,
        parentId: null
      },
      {
        id: "2",
        code: "4100",
        name: "Rooms Revenue",
        type: "REVENUE",
        normalBalance: "CREDIT",
        usaliCategory: "Revenue",
        usaliDepartment: "Rooms",
        allowPosting: true,
        level: 2,
        parentId: "1"
      }
    ]);

    const tree = await service.listAccounts("entity-1");
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].code).toBe("4100");
  });
});
