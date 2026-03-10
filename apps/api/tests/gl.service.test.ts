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
  it("accepts balanced journal lines", () => {
    const service = createServiceWithAccounts([]);
    expect(() =>
      service.validateBalance([
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
    ).not.toThrow();
  });

  it("throws GL_UNBALANCED_JOURNAL for unbalanced lines", () => {
    const service = createServiceWithAccounts([]);
    expect(() =>
      service.validateBalance([
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
    ).toThrowError(GLServiceError);
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
