import { makeBalanceWriterStub } from "./helpers/balance-writer-stub.js";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock dependencies ──────────────────────────────────────────────────────

vi.mock("../src/jobs/mv-refresh-job.js", () => ({
  enqueueMVRefresh: vi.fn().mockResolvedValue(undefined)
}));

import {
  AuthorizationService,
  AuthorizationServiceError
} from "../src/modules/authorization/service.js";

// ── Mock DB ────────────────────────────────────────────────────────────────

const ENTITY_ID = "entity-1";
const USER_ID = "user-1";
const USER_ID_2 = "user-2";
const USER_ID_3 = "user-3";
const PERIOD_ID = "period-1";

let stages: any[];
let teams: any[];
let teamMembers: any[];
let delegations: any[];
let rejectionCodes: any[];
let journals: any[];
let journalLines: any[];
let journalAuthorizations: any[];
let authSets: any[];
let balances: any[];
let idCounter: number;

function nextId(prefix: string) {
  idCounter++;
  return `${prefix}-${idCounter}`;
}

function makeMockPrisma() {
  stages = [];
  teams = [];
  teamMembers = [];
  delegations = [];
  rejectionCodes = [];
  journals = [];
  journalLines = [];
  journalAuthorizations = [];
  authSets = [];
  balances = [];
  idCounter = 0;

  function toNum(value: unknown): number {
    if (value && typeof (value as { toNumber?: unknown }).toNumber === "function") {
      return (value as { toNumber: () => number }).toNumber();
    }
    return Number(value);
  }

  function applyBalanceSql(values: unknown[]) {
    const [entityId, accountId, periodId, debitFunctional, creditFunctional, signValue] = values;
    const debit = toNum(debitFunctional);
    const credit = toNum(creditFunctional);
    const sign = Number(signValue);
    let balance = balances.find(
      (b: any) => b.entityId === entityId && b.accountId === accountId && b.periodId === periodId
    );
    if (!balance) {
      balance = {
        id: nextId("bal"),
        entityId,
        accountId,
        periodId,
        openingBalance: 0,
        periodDebits: 0,
        periodCredits: 0,
        closingBalance: 0
      };
      balances.push(balance);
    }
    balance.periodDebits += debit;
    balance.periodCredits += credit;
    balance.closingBalance =
      balance.openingBalance + sign * balance.periodDebits - sign * balance.periodCredits;
  }

  /**
   * Simulate the canonical balance writer (db/balance-writer.ts).
   *
   * It issues one parameterised INSERT via $queryRawUnsafe with
   * ($1 entityId, $2 periodId, then accountId/debit/credit triples) and signs
   * each account by its own normal_balance. Driving the same in-memory ledger
   * keeps these tests asserting real balance arithmetic rather than just that
   * some query was issued.
   */
  function applyBalanceWriterSql(params: unknown[]): Array<{ account_id: string }> {
    const [entityId, periodId] = params;
    const written: Array<{ account_id: string }> = [];
    for (let i = 2; i < params.length; i += 3) {
      const accountId = String(params[i]);
      // Mirrors this file's account fixture: acct-1 is an ASSET (debit-normal),
      // everything else a LIABILITY (credit-normal).
      const sign = accountId === "acct-1" ? 1 : -1;
      applyBalanceSql([entityId, accountId, periodId, params[i + 1], params[i + 2], sign]);
      written.push({ account_id: accountId });
    }
    return written;
  }

  const prisma: any = {
    $executeRaw: vi
      .fn()
      .mockImplementation(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        applyBalanceSql(values);
        return 1;
      }),
    $queryRawUnsafe: vi
      .fn()
      .mockImplementation(async (_sql: string, ...params: unknown[]) =>
        applyBalanceWriterSql(params)
      ),
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(prisma)),

    authorizationStage: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const s = stages.find(
          (s) =>
            (where.id ? s.id === where.id : true) &&
            (where.entityId ? s.entityId === where.entityId : true) &&
            (where.stageCode ? s.stageCode === where.stageCode : true)
        );
        return Promise.resolve(s ?? null);
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        let result = stages.filter((s) => s.entityId === where.entityId);
        if (where.journalTypeId !== undefined) {
          result = result.filter((s) => s.journalTypeId === where.journalTypeId);
        }
        if (where.isActive !== undefined) {
          result = result.filter((s) => s.isActive === where.isActive);
        }
        if (where.userTeamId) {
          if (where.userTeamId.in) {
            result = result.filter((s: any) => where.userTeamId.in.includes(s.userTeamId));
          } else {
            result = result.filter((s: any) => s.userTeamId === where.userTeamId);
          }
        }
        if (where.OR) {
          result = result.filter((s) => {
            return where.OR.some((cond: any) => {
              if (cond.amountThreshold === null) return s.amountThreshold === null;
              if (cond.amountThreshold?.lte !== undefined) {
                return s.amountThreshold !== null && s.amountThreshold <= cond.amountThreshold.lte;
              }
              return false;
            });
          });
        }
        return Promise.resolve(result);
      }),
      create: vi.fn().mockImplementation(({ data, include }: any) => {
        const stage = {
          id: nextId("stage"),
          ...data,
          userTeam: include?.userTeam
            ? (teams.find((t) => t.id === data.userTeamId) ?? null)
            : undefined,
          journalType: include?.journalType ? null : undefined
        };
        stages.push(stage);
        return Promise.resolve(stage);
      }),
      update: vi.fn().mockImplementation(({ where, data, include }: any) => {
        const s = stages.find((s) => s.id === where.id);
        if (s) Object.assign(s, data);
        return Promise.resolve(s);
      }),
      delete: vi.fn().mockImplementation(({ where }: any) => {
        const idx = stages.findIndex((s) => s.id === where.id);
        if (idx >= 0) stages.splice(idx, 1);
        return Promise.resolve({});
      }),
      count: vi.fn().mockImplementation(({ where }: any) => {
        let result = stages.filter((s) => s.entityId === where.entityId || true);
        if (where.userTeamId) result = result.filter((s) => s.userTeamId === where.userTeamId);
        if (where.isActive !== undefined)
          result = result.filter((s) => s.isActive === where.isActive);
        return Promise.resolve(result.length);
      })
    },

    authorizationTeam: {
      findFirst: vi.fn().mockImplementation(({ where, include }: any) => {
        const t = teams.find(
          (t) =>
            (where.id ? t.id === where.id : true) &&
            (where.entityId ? t.entityId === where.entityId : true) &&
            (where.code ? t.code === where.code : true)
        );
        if (!t) return Promise.resolve(null);
        if (include?.members) {
          t.members = teamMembers
            .filter((m: any) => m.teamId === t.id)
            .map((m: any) => ({
              ...m,
              user: { id: m.userId, name: `User ${m.userId}`, email: `${m.userId}@test.com` }
            }));
        }
        return Promise.resolve(t);
      }),
      findMany: vi.fn().mockImplementation(({ where, include }: any) => {
        let result = teams.filter((t) => t.entityId === where.entityId);
        if (include?.members) {
          result = result.map((t) => ({
            ...t,
            members: teamMembers
              .filter((m: any) => m.teamId === t.id)
              .map((m: any) => ({
                ...m,
                user: { id: m.userId, name: `User ${m.userId}`, email: `${m.userId}@test.com` }
              }))
          }));
        }
        return Promise.resolve(result);
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const team = { id: nextId("team"), ...data };
        teams.push(team);
        return Promise.resolve(team);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const t = teams.find((t) => t.id === where.id);
        if (t) Object.assign(t, data);
        return Promise.resolve(t);
      }),
      delete: vi.fn().mockImplementation(({ where }: any) => {
        const idx = teams.findIndex((t) => t.id === where.id);
        if (idx >= 0) teams.splice(idx, 1);
        return Promise.resolve({});
      })
    },

    authorizationTeamMember: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const m = teamMembers.find(
          (m) =>
            (where.teamId ? m.teamId === where.teamId : true) &&
            (where.userId ? m.userId === where.userId : true)
        );
        return Promise.resolve(m ?? null);
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        let result = teamMembers;
        if (where.teamId) result = result.filter((m) => m.teamId === where.teamId);
        if (where.userId) result = result.filter((m) => m.userId === where.userId);
        return Promise.resolve(result);
      }),
      createMany: vi.fn().mockImplementation(({ data }: any) => {
        for (const d of data) {
          teamMembers.push({ id: nextId("member"), ...d });
        }
        return Promise.resolve({ count: data.length });
      }),
      deleteMany: vi.fn().mockImplementation(({ where }: any) => {
        const before = teamMembers.length;
        if (where.teamId) {
          const filtered = teamMembers.filter((m) => m.teamId !== where.teamId);
          teamMembers.length = 0;
          teamMembers.push(...filtered);
        }
        return Promise.resolve({ count: before - teamMembers.length });
      })
    },

    authorizationDelegation: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const d = delegations.find(
          (d) =>
            (where.id ? d.id === where.id : true) &&
            (where.entityId ? d.entityId === where.entityId : true) &&
            (where.delegateId ? d.delegateId === where.delegateId : true) &&
            (where.teamId ? d.teamId === where.teamId : true) &&
            (where.isActive !== undefined ? d.isActive === where.isActive : true) &&
            (where.validFrom?.lte ? d.validFrom <= where.validFrom.lte : true) &&
            (where.validTo?.gte ? d.validTo >= where.validTo.gte : true)
        );
        return Promise.resolve(d ?? null);
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(delegations.filter((d) => d.entityId === where.entityId));
      }),
      create: vi.fn().mockImplementation(({ data, include }: any) => {
        const delegation = { id: nextId("deleg"), ...data };
        delegations.push(delegation);
        return Promise.resolve(delegation);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const d = delegations.find((d) => d.id === where.id);
        if (d) Object.assign(d, data);
        return Promise.resolve(d);
      })
    },

    rejectionCode: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        const rc = rejectionCodes.find(
          (r) =>
            (where.id ? r.id === where.id : true) &&
            (where.entityId ? r.entityId === where.entityId : true) &&
            (where.code ? r.code === where.code : true)
        );
        return Promise.resolve(rc ?? null);
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(rejectionCodes.filter((r) => r.entityId === where.entityId));
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const rc = { id: nextId("rejcode"), ...data };
        rejectionCodes.push(rc);
        return Promise.resolve(rc);
      })
    },

    journal: {
      findFirst: vi.fn().mockImplementation(({ where, include }: any) => {
        const j = journals.find(
          (j) =>
            (where.id ? j.id === where.id : true) &&
            (where.entityId ? j.entityId === where.entityId : true)
        );
        if (!j) return Promise.resolve(null);
        const copy = { ...j };
        if (include?.lines) {
          copy.lines = journalLines
            .filter((l) => l.journalId === j.id)
            .map((line) => ({
              ...line,
              ...(include.lines?.include?.account
                ? {
                    account: {
                      type: line.accountId === "acct-1" ? "ASSET" : "LIABILITY"
                    }
                  }
                : {})
            }));
        }
        return Promise.resolve(copy);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const j = journals.find((j) => j.id === where.id);
        if (j) Object.assign(j, data);
        return Promise.resolve(j);
      }),
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        const ids = where.id?.in ?? [];
        let count = 0;
        for (const j of journals) {
          if (ids.includes(j.id) && (where.entityId ? j.entityId === where.entityId : true)) {
            Object.assign(j, data);
            count++;
          }
        }
        return Promise.resolve({ count });
      })
    },

    journalAuthorization: {
      findFirst: vi.fn().mockImplementation(({ where, include }: any) => {
        const auth = journalAuthorizations.find(
          (a) =>
            (where.journalId ? a.journalId === where.journalId : true) &&
            (where.stageOrder !== undefined ? a.stageOrder === where.stageOrder : true) &&
            (where.status ? a.status === where.status : true) &&
            (where.stageId ? a.stageId === where.stageId : true) &&
            (where.entityId ? a.entityId === where.entityId : true)
        );
        if (!auth) return Promise.resolve(null);
        const copy = { ...auth };
        if (include?.stage) {
          copy.stage = stages.find((s) => s.id === auth.stageId) ?? null;
        }
        if (include?.decidedBy) {
          copy.decidedBy = auth.decidedById ? { name: `User ${auth.decidedById}` } : null;
        }
        if (include?.rejectionCode) {
          copy.rejectionCode = auth.rejectionCodeId
            ? (rejectionCodes.find((r) => r.id === auth.rejectionCodeId) ?? null)
            : null;
        }
        return Promise.resolve(copy);
      }),
      findMany: vi.fn().mockImplementation(({ where, include, orderBy }: any) => {
        let result = journalAuthorizations.filter(
          (a) =>
            (where.journalId ? a.journalId === where.journalId : true) &&
            (where.entityId ? a.entityId === where.entityId : true) &&
            (where.stageId?.in ? where.stageId.in.includes(a.stageId) : true) &&
            (where.status ? a.status === where.status : true)
        );
        if (include?.stage) {
          result = result.map((a) => ({
            ...a,
            stage: stages.find((s) => s.id === a.stageId) ?? null
          }));
        }
        if (include?.decidedBy) {
          result = result.map((a) => ({
            ...a,
            decidedBy: a.decidedById ? { name: `User ${a.decidedById}` } : null
          }));
        }
        if (include?.rejectionCode) {
          result = result.map((a) => ({
            ...a,
            rejectionCode: a.rejectionCodeId
              ? (rejectionCodes.find((r: any) => r.id === a.rejectionCodeId) ?? null)
              : null
          }));
        }
        if (include?.journal) {
          result = result.map((a) => {
            const j = journals.find((j) => j.id === a.journalId);
            return {
              ...a,
              journal: j
                ? {
                    ...j,
                    lines: include.journal.include?.lines
                      ? journalLines.filter((l) => l.journalId === j.id)
                      : undefined
                  }
                : null
            };
          });
        }
        // Sort by stageOrder ascending
        result.sort((a: any, b: any) => (a.stageOrder ?? 0) - (b.stageOrder ?? 0));
        return Promise.resolve(result);
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const auth = { id: nextId("auth"), ...data };
        journalAuthorizations.push(auth);
        return Promise.resolve(auth);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const a = journalAuthorizations.find((a) => a.id === where.id);
        if (a) Object.assign(a, data);
        return Promise.resolve(a);
      }),
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        let count = 0;
        for (const a of journalAuthorizations) {
          if (
            (where.journalId ? a.journalId === where.journalId : true) &&
            (where.status ? a.status === where.status : true)
          ) {
            Object.assign(a, data);
            count++;
          }
        }
        return Promise.resolve({ count });
      }),
      count: vi.fn().mockImplementation(({ where }: any) => {
        let result = journalAuthorizations;
        if (where.stageId) result = result.filter((a) => a.stageId === where.stageId);
        if (where.status) result = result.filter((a) => a.status === where.status);
        return Promise.resolve(result.length);
      })
    },

    authorizationSet: {
      findFirst: vi.fn().mockImplementation(({ where, include }: any) => {
        const s = authSets.find(
          (s) =>
            (where.id ? s.id === where.id : true) &&
            (where.entityId ? s.entityId === where.entityId : true)
        );
        if (!s) return Promise.resolve(null);
        const copy = { ...s };
        if (include?.journals) {
          copy.journals = journals.filter((j) => j.authorizationSetId === s.id);
        }
        if (include?._count) {
          copy._count = { journals: journals.filter((j) => j.authorizationSetId === s.id).length };
        }
        return Promise.resolve(copy);
      }),
      findMany: vi.fn().mockImplementation(({ where, include }: any) => {
        let result = authSets.filter((s) => s.entityId === where.entityId);
        if (include?._count) {
          result = result.map((s) => ({
            ...s,
            _count: { journals: journals.filter((j) => j.authorizationSetId === s.id).length }
          }));
        }
        return Promise.resolve(result);
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const set = { id: nextId("set"), createdAt: new Date(), ...data };
        authSets.push(set);
        return Promise.resolve(set);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const s = authSets.find((s) => s.id === where.id);
        if (s) Object.assign(s, data);
        return Promise.resolve(s);
      })
    },

    accountPeriodBalance: {
      upsert: vi.fn().mockImplementation(({ where, create, update }: any) => {
        const key = where.entityId_accountId_periodId;
        const existing = balances.find(
          (b: any) =>
            b.entityId === key.entityId &&
            b.accountId === key.accountId &&
            b.periodId === key.periodId
        );
        if (existing) {
          if (update.periodDebits?.increment)
            existing.periodDebits += update.periodDebits.increment;
          if (update.periodCredits?.increment)
            existing.periodCredits += update.periodCredits.increment;
          if (update.closingBalance?.increment)
            existing.closingBalance += update.closingBalance.increment;
          return Promise.resolve(existing);
        }
        const record = { id: nextId("bal"), ...create };
        balances.push(record);
        return Promise.resolve(record);
      })
    }
  };

  return prisma;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function seedTeamWithMember(prisma: any, teamCode: string, userId: string) {
  const team = {
    id: nextId("team"),
    entityId: ENTITY_ID,
    code: teamCode,
    name: `Team ${teamCode}`,
    isActive: true
  };
  teams.push(team);
  teamMembers.push({ id: nextId("member"), teamId: team.id, userId });
  return team;
}

function seedStage(
  prisma: any,
  code: string,
  order: number,
  teamId: string,
  opts?: Partial<{
    rejectionReturnsTo: string;
    returnToStageId: string | null;
    journalTypeId: string | null;
    amountThreshold: number | null;
  }>
) {
  const stage = {
    id: nextId("stage"),
    entityId: ENTITY_ID,
    stageCode: code,
    stageName: `Stage ${code}`,
    stageOrder: order,
    requiredApprovers: 1,
    autoAdvance: true,
    rejectionReturnsTo: opts?.rejectionReturnsTo ?? "ORIGINATOR",
    returnToStageId: opts?.returnToStageId ?? null,
    journalTypeId: opts?.journalTypeId ?? null,
    amountThreshold: opts?.amountThreshold ?? null,
    userTeamId: teamId,
    isActive: true
  };
  stages.push(stage);
  return stage;
}

function seedJournal(id?: string) {
  const journalId = id ?? nextId("journal");
  const journal = {
    id: journalId,
    entityId: ENTITY_ID,
    reference: `REF-${journalId}`,
    description: "Test journal",
    source: "MANUAL",
    journalTypeId: null as string | null,
    status: "DRAFT",
    currentAuthStageOrder: null as number | null,
    authorizationSetId: null as string | null,
    createdById: USER_ID,
    createdAt: new Date(),
    periodId: PERIOD_ID,
    approvedById: null as string | null,
    postedAt: null as Date | null
  };
  journals.push(journal);
  // Add journal lines (1000 debit, 1000 credit)
  journalLines.push({
    id: nextId("line"),
    journalId,
    accountId: "acct-1",
    debitFunctional: 1000,
    creditFunctional: 0,
    debit: 1000,
    credit: 0
  });
  journalLines.push({
    id: nextId("line"),
    journalId,
    accountId: "acct-2",
    debitFunctional: 0,
    creditFunctional: 1000,
    debit: 0,
    credit: 1000
  });
  return journal;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AuthorizationService", () => {
  let prisma: any;
  let service: AuthorizationService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    service = new AuthorizationService(prisma);
  });

  // ── Stage CRUD ──────────────────────────────────────────────────────────

  describe("Stage CRUD", () => {
    it("creates a stage", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      const result = await service.createStage(ENTITY_ID, {
        stageCode: "S1",
        stageName: "Stage 1",
        stageOrder: 1,
        userTeamId: team.id
      });
      expect(result.stageCode).toBe("S1");
      expect(result.entityId).toBe(ENTITY_ID);
    });

    it("rejects duplicate stage code", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      await service.createStage(ENTITY_ID, {
        stageCode: "S1",
        stageName: "Stage 1",
        stageOrder: 1,
        userTeamId: team.id
      });
      await expect(
        service.createStage(ENTITY_ID, {
          stageCode: "S1",
          stageName: "Duplicate",
          stageOrder: 2,
          userTeamId: team.id
        })
      ).rejects.toThrow("already exists");
    });

    it("rejects stage with non-existent team", async () => {
      await expect(
        service.createStage(ENTITY_ID, {
          stageCode: "S1",
          stageName: "Stage 1",
          stageOrder: 1,
          userTeamId: "nonexistent"
        })
      ).rejects.toThrow("team not found");
    });

    it("lists stages", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      seedStage(prisma, "S2", 2, team.id);
      const result = await service.listStages(ENTITY_ID);
      expect(result.length).toBe(2);
    });

    it("deletes a stage without pending auths", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      const stage = seedStage(prisma, "S1", 1, team.id);
      await service.deleteStage(ENTITY_ID, stage.id);
      expect(stages.length).toBe(0);
    });
  });

  // ── Team CRUD ───────────────────────────────────────────────────────────

  describe("Team CRUD", () => {
    it("creates a team with members", async () => {
      const result = await service.createTeam(ENTITY_ID, {
        code: "APPROVERS",
        name: "Approvers",
        memberIds: [USER_ID, USER_ID_2]
      });
      expect(result).toBeTruthy();
      expect(teamMembers.length).toBe(2);
    });

    it("rejects duplicate team code", async () => {
      await service.createTeam(ENTITY_ID, { code: "FINANCE", name: "Finance" });
      await expect(
        service.createTeam(ENTITY_ID, { code: "FINANCE", name: "Finance 2" })
      ).rejects.toThrow("already exists");
    });

    it("lists teams", async () => {
      seedTeamWithMember(prisma, "T1", USER_ID);
      seedTeamWithMember(prisma, "T2", USER_ID_2);
      const result = await service.listTeams(ENTITY_ID);
      expect(result.length).toBe(2);
    });
  });

  // ── Delegation ──────────────────────────────────────────────────────────

  describe("Delegation", () => {
    it("creates and lists delegations", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      await service.createDelegation(ENTITY_ID, {
        delegatorId: USER_ID,
        delegateId: USER_ID_2,
        teamId: team.id,
        validFrom: "2026-01-01",
        validTo: "2026-12-31"
      });
      const result = await service.listDelegations(ENTITY_ID);
      expect(result.length).toBe(1);
    });

    it("revokes a delegation", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      await service.createDelegation(ENTITY_ID, {
        delegatorId: USER_ID,
        delegateId: USER_ID_2,
        teamId: team.id,
        validFrom: "2026-01-01",
        validTo: "2026-12-31"
      });
      const deleg = delegations[0];
      await service.revokeDelegation(ENTITY_ID, deleg.id);
      expect(delegations[0].isActive).toBe(false);
    });
  });

  // ── Rejection Codes ─────────────────────────────────────────────────────

  describe("Rejection Codes", () => {
    it("creates a rejection code", async () => {
      const result = await service.createRejectionCode(ENTITY_ID, {
        code: "INCOMPLETE",
        description: "Documentation incomplete"
      });
      expect(result.code).toBe("INCOMPLETE");
    });

    it("rejects duplicate rejection code", async () => {
      await service.createRejectionCode(ENTITY_ID, {
        code: "INCOMPLETE",
        description: "Documentation incomplete"
      });
      await expect(
        service.createRejectionCode(ENTITY_ID, {
          code: "INCOMPLETE",
          description: "Duplicate"
        })
      ).rejects.toThrow("already exists");
    });
  });

  // ── Stage Resolution ────────────────────────────────────────────────────

  describe("Stage Resolution", () => {
    it("resolves journal-type-specific stages over global", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "GLOBAL", 1, team.id, { journalTypeId: null });
      seedStage(prisma, "TYPE1_S1", 1, team.id, { journalTypeId: "jtype-1" });

      const result = await service.resolveStages(ENTITY_ID, "jtype-1", 1000);
      expect(result.length).toBe(1);
      expect(result[0].stageCode).toBe("TYPE1_S1");
    });

    it("falls back to global when no type-specific stages", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "GLOBAL", 1, team.id, { journalTypeId: null });

      const result = await service.resolveStages(ENTITY_ID, "jtype-99", 1000);
      expect(result.length).toBe(1);
      expect(result[0].stageCode).toBe("GLOBAL");
    });

    it("filters by amount threshold", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "LOW", 1, team.id, { amountThreshold: null });
      seedStage(prisma, "HIGH", 2, team.id, { amountThreshold: 5000 });

      // Amount 1000 should only hit LOW (null threshold) but not HIGH (5000 > 1000)
      const result = await service.resolveStages(ENTITY_ID, null, 1000);
      expect(result.length).toBe(1);
      expect(result[0].stageCode).toBe("LOW");
    });
  });

  // ── Full Workflow: Submit → Approve → Post ──────────────────────────────

  describe("Full Workflow", () => {
    it("submits journal for authorization, creates auth records", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      seedStage(prisma, "S2", 2, team.id);
      const journal = seedJournal();

      const result = await service.submitForAuthorization(ENTITY_ID, journal.id);
      expect(result.required).toBe(true);
      expect(result.stageCount).toBe(2);
      expect(journal.status).toBe("PENDING_APPROVAL");
      expect(journal.currentAuthStageOrder).toBe(1);
      expect(journalAuthorizations.length).toBe(2);
    });

    it("returns not-required when no stages match", async () => {
      const journal = seedJournal();
      const result = await service.submitForAuthorization(ENTITY_ID, journal.id);
      expect(result.required).toBe(false);
    });

    it("approves stage 1, advances to stage 2", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      const s1 = seedStage(prisma, "S1", 1, team.id);
      const s2 = seedStage(prisma, "S2", 2, team.id);
      const journal = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, journal.id);
      const result = await service.approveStage(ENTITY_ID, journal.id, USER_ID, "Looks good");

      expect(result.action).toBe("advanced");
      expect(result.nextStageOrder).toBe(2);
      expect(journal.currentAuthStageOrder).toBe(2);
    });

    it("approves final stage, posts the journal", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      const journal = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, journal.id);
      const result = await service.approveStage(ENTITY_ID, journal.id, USER_ID);

      expect(result.action).toBe("posted");
      expect(journal.status).toBe("POSTED");
      expect(journal.approvedById).toBe(USER_ID);
      expect(journal.postedAt).toBeInstanceOf(Date);
    });

    it("full two-stage workflow: submit → approve S1 → approve S2 → posted", async () => {
      const team1 = seedTeamWithMember(prisma, "DEPT", USER_ID);
      const team2 = seedTeamWithMember(prisma, "EXEC", USER_ID_2);
      seedStage(prisma, "DEPT_REVIEW", 1, team1.id);
      seedStage(prisma, "EXEC_REVIEW", 2, team2.id);
      const journal = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, journal.id);
      expect(journal.status).toBe("PENDING_APPROVAL");

      // Stage 1 approval
      const r1 = await service.approveStage(ENTITY_ID, journal.id, USER_ID);
      expect(r1.action).toBe("advanced");

      // Stage 2 approval
      const r2 = await service.approveStage(ENTITY_ID, journal.id, USER_ID_2);
      expect(r2.action).toBe("posted");
      expect(journal.status).toBe("POSTED");
      expect(balances.length).toBeGreaterThan(0); // Balance updated
    });

    it("rejects if user is not on the stage team", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      const journal = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, journal.id);

      await expect(service.approveStage(ENTITY_ID, journal.id, USER_ID_3)).rejects.toThrow(
        "not authorized"
      );
    });

    it("allows delegate to approve via delegation", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      const journal = seedJournal();

      // Create delegation for USER_ID_2
      delegations.push({
        id: nextId("deleg"),
        entityId: ENTITY_ID,
        delegatorId: USER_ID,
        delegateId: USER_ID_2,
        teamId: team.id,
        isActive: true,
        validFrom: new Date("2020-01-01"),
        validTo: new Date("2030-12-31")
      });

      await service.submitForAuthorization(ENTITY_ID, journal.id);
      const result = await service.approveStage(ENTITY_ID, journal.id, USER_ID_2);
      expect(result.action).toBe("posted");
    });
  });

  // ── Rejection Routing ───────────────────────────────────────────────────

  describe("Rejection Routing", () => {
    it("rejection returns to originator by default", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id, { rejectionReturnsTo: "ORIGINATOR" });
      const journal = seedJournal();
      const rc = {
        id: nextId("rejcode"),
        entityId: ENTITY_ID,
        code: "BAD",
        description: "Bad entry",
        isActive: true
      };
      rejectionCodes.push(rc);

      await service.submitForAuthorization(ENTITY_ID, journal.id);
      const result = await service.rejectStage(
        ENTITY_ID,
        journal.id,
        USER_ID,
        rc.id,
        "Wrong amounts"
      );

      expect(result.action).toBe("returned_to_originator");
      expect(journal.status).toBe("RETURNED");
      expect(journal.currentAuthStageOrder).toBeNull();
    });

    it("rejection returns to previous stage", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      const s1 = seedStage(prisma, "S1", 1, team.id);
      const s2 = seedStage(prisma, "S2", 2, team.id, { rejectionReturnsTo: "PREVIOUS_STAGE" });
      const journal = seedJournal();
      const rc = {
        id: nextId("rejcode"),
        entityId: ENTITY_ID,
        code: "BAD",
        description: "Bad",
        isActive: true
      };
      rejectionCodes.push(rc);

      await service.submitForAuthorization(ENTITY_ID, journal.id);
      // Approve stage 1
      await service.approveStage(ENTITY_ID, journal.id, USER_ID);
      // Reject at stage 2
      const result = await service.rejectStage(ENTITY_ID, journal.id, USER_ID, rc.id);

      expect(result.action).toBe("returned_to_previous_stage");
      expect(result.stageOrder).toBe(1);
      // Stage 1 should be reset to PENDING
      const s1Auth = journalAuthorizations.find((a: any) => a.stageOrder === 1);
      expect(s1Auth.status).toBe("PENDING");
    });

    it("rejection with SPECIFIC_STAGE routes to target", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      const s1 = seedStage(prisma, "S1", 1, team.id);
      const s2 = seedStage(prisma, "S2", 2, team.id);
      const s3 = seedStage(prisma, "S3", 3, team.id, {
        rejectionReturnsTo: "SPECIFIC_STAGE",
        returnToStageId: s1.id
      });
      const journal = seedJournal();
      const rc = {
        id: nextId("rejcode"),
        entityId: ENTITY_ID,
        code: "BAD",
        description: "Bad",
        isActive: true
      };
      rejectionCodes.push(rc);

      await service.submitForAuthorization(ENTITY_ID, journal.id);
      await service.approveStage(ENTITY_ID, journal.id, USER_ID); // S1 -> S2
      await service.approveStage(ENTITY_ID, journal.id, USER_ID); // S2 -> S3
      const result = await service.rejectStage(ENTITY_ID, journal.id, USER_ID, rc.id);

      expect(result.action).toBe("returned_to_specific_stage");
      expect(result.stageOrder).toBe(1);
    });
  });

  // ── Return for Amendment ────────────────────────────────────────────────

  describe("Return for Amendment", () => {
    it("returns journal to RETURNED status", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      const journal = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, journal.id);
      const result = await service.returnForAmendment(ENTITY_ID, journal.id, USER_ID, "Fix totals");

      expect(result.action).toBe("returned_for_amendment");
      expect(journal.status).toBe("RETURNED");
      // The auth record should have [RETURNED] prefix
      const auth = journalAuthorizations.find(
        (a: any) => a.journalId === journal.id && a.stageOrder === 1
      );
      expect(auth.comments).toContain("[RETURNED]");
    });

    it("rejects return if journal is not PENDING_APPROVAL", async () => {
      const journal = seedJournal();
      await expect(service.returnForAmendment(ENTITY_ID, journal.id, USER_ID)).rejects.toThrow(
        "not pending"
      );
    });
  });

  // ── Void ────────────────────────────────────────────────────────────────

  describe("Void", () => {
    it("voids a pending journal, skips all auth stages", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      seedStage(prisma, "S2", 2, team.id);
      const journal = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, journal.id);
      const result = await service.voidJournal(ENTITY_ID, journal.id, USER_ID, "Cancelled");

      expect(result.action).toBe("voided");
      expect(journal.status).toBe("VOIDED");
      // All pending auths should be SKIPPED
      const pendingCount = journalAuthorizations.filter((a: any) => a.status === "PENDING").length;
      expect(pendingCount).toBe(0);
    });

    it("cannot void a posted journal", async () => {
      const journal = seedJournal();
      journal.status = "POSTED";
      await expect(service.voidJournal(ENTITY_ID, journal.id, USER_ID)).rejects.toThrow(
        "Cannot void"
      );
    });

    it("cannot void an already voided journal", async () => {
      const journal = seedJournal();
      journal.status = "VOIDED";
      await expect(service.voidJournal(ENTITY_ID, journal.id, USER_ID)).rejects.toThrow(
        "already voided"
      );
    });
  });

  // ── Resubmit ────────────────────────────────────────────────────────────

  describe("Resubmit", () => {
    it("resubmits a returned journal, resets all stages", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      seedStage(prisma, "S2", 2, team.id);
      const journal = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, journal.id);
      await service.returnForAmendment(ENTITY_ID, journal.id, USER_ID, "Fix it");

      expect(journal.status).toBe("RETURNED");

      const result = await service.resubmit(ENTITY_ID, journal.id, USER_ID);
      expect(result.action).toBe("resubmitted");
      expect(journal.status).toBe("PENDING_APPROVAL");
      expect(journal.currentAuthStageOrder).toBe(1);
      // All auth records should be reset to PENDING
      const allPending = journalAuthorizations.every((a: any) => a.status === "PENDING");
      expect(allPending).toBe(true);
    });

    it("rejects resubmit for non-RETURNED journal", async () => {
      const journal = seedJournal();
      await expect(service.resubmit(ENTITY_ID, journal.id, USER_ID)).rejects.toThrow("RETURNED");
    });
  });

  // ── isFullyAuthorized ───────────────────────────────────────────────────

  describe("isFullyAuthorized", () => {
    it("returns true when no stages exist", async () => {
      const journal = seedJournal();
      const result = await service.isFullyAuthorized(journal.id);
      expect(result).toBe(true);
    });

    it("returns true when all stages are APPROVED", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      const journal = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, journal.id);
      await service.approveStage(ENTITY_ID, journal.id, USER_ID);

      const result = await service.isFullyAuthorized(journal.id);
      expect(result).toBe(true);
    });

    it("returns false when stages are PENDING", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      const journal = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, journal.id);

      const result = await service.isFullyAuthorized(journal.id);
      expect(result).toBe(false);
    });
  });

  // ── Authorization Queue ─────────────────────────────────────────────────

  describe("Authorization Queue", () => {
    it("returns queue items for user's team", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      const j1 = seedJournal();
      const j2 = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, j1.id);
      await service.submitForAuthorization(ENTITY_ID, j2.id);

      const result = await service.getAuthorizationQueue(ENTITY_ID, USER_ID);
      expect(result.length).toBe(2);
      expect(result[0].stageName).toBe("Stage S1");
    });

    it("returns empty queue for user with no teams", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      const journal = seedJournal();
      await service.submitForAuthorization(ENTITY_ID, journal.id);

      const result = await service.getAuthorizationQueue(ENTITY_ID, USER_ID_3);
      expect(result.length).toBe(0);
    });

    it("filters queue by amount range", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      const journal = seedJournal(); // Amount = 1000

      await service.submitForAuthorization(ENTITY_ID, journal.id);

      const tooHigh = await service.getAuthorizationQueue(ENTITY_ID, USER_ID, { minAmount: 5000 });
      expect(tooHigh.length).toBe(0);

      const inRange = await service.getAuthorizationQueue(ENTITY_ID, USER_ID, {
        minAmount: 500,
        maxAmount: 2000
      });
      expect(inRange.length).toBe(1);
    });
  });

  // ── History ─────────────────────────────────────────────────────────────

  describe("History", () => {
    it("returns authorization history for a journal", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      seedStage(prisma, "S2", 2, team.id);
      const journal = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, journal.id);
      await service.approveStage(ENTITY_ID, journal.id, USER_ID, "OK");

      const history = await service.getHistory(ENTITY_ID, journal.id);
      expect(history.length).toBe(2);
      expect(history[0].status).toBe("APPROVED");
      expect(history[0].comments).toBe("OK");
      expect(history[1].status).toBe("PENDING");
    });
  });

  // ── Bulk Operations ─────────────────────────────────────────────────────

  describe("Bulk Operations", () => {
    it("bulk approves multiple journals", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      const j1 = seedJournal();
      const j2 = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, j1.id);
      await service.submitForAuthorization(ENTITY_ID, j2.id);

      const results = await service.bulkApprove(ENTITY_ID, [j1.id, j2.id], USER_ID, "Batch OK");
      expect(results.length).toBe(2);
      expect(results.every((r: any) => r.status === "approved")).toBe(true);
    });

    it("bulk reject reports errors for invalid journals", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      const j1 = seedJournal();
      const rc = {
        id: nextId("rejcode"),
        entityId: ENTITY_ID,
        code: "BAD",
        description: "Bad",
        isActive: true
      };
      rejectionCodes.push(rc);

      await service.submitForAuthorization(ENTITY_ID, j1.id);

      const results = await service.bulkReject(
        ENTITY_ID,
        [j1.id, "nonexistent-id"],
        USER_ID,
        rc.id
      );
      expect(results.length).toBe(2);
      expect(results[0].status).toBe("rejected");
      expect(results[1].status).toBe("failed");
    });
  });

  // ── Authorization Sets ──────────────────────────────────────────────────

  describe("Authorization Sets", () => {
    it("creates a set and adds journals", async () => {
      const journal = seedJournal();
      const set = await service.createSet(ENTITY_ID, USER_ID, { name: "Batch 1" });
      expect(set.name).toBe("Batch 1");

      const updated = await service.addJournalsToSet(ENTITY_ID, set.id, [journal.id]);
      expect(journal.authorizationSetId).toBe(set.id);
    });

    it("rejects adding to non-OPEN set", async () => {
      const set = await service.createSet(ENTITY_ID, USER_ID, { name: "Batch 1" });
      // Manually close it
      authSets[0].status = "APPROVED";

      await expect(service.addJournalsToSet(ENTITY_ID, set.id, ["some-id"])).rejects.toThrow(
        "OPEN"
      );
    });

    it("lists sets", async () => {
      await service.createSet(ENTITY_ID, USER_ID, { name: "Set A" });
      await service.createSet(ENTITY_ID, USER_ID, { name: "Set B" });
      const result = await service.listSets(ENTITY_ID);
      expect(result.length).toBe(2);
    });
  });

  // ── GL Integration (isFullyAuthorized before posting) ───────────────────

  describe("GL Integration", () => {
    it("_postJournalInternal updates balances and sets POSTED", async () => {
      const team = seedTeamWithMember(prisma, "FINANCE", USER_ID);
      seedStage(prisma, "S1", 1, team.id);
      const journal = seedJournal();

      await service.submitForAuthorization(ENTITY_ID, journal.id);

      // Approve — triggers _postJournalInternal via final stage
      await service.approveStage(ENTITY_ID, journal.id, USER_ID);

      expect(journal.status).toBe("POSTED");
      expect(balances.length).toBe(2); // Two lines -> two balance records
      const debitBal = balances.find((b: any) => b.accountId === "acct-1");
      expect(debitBal.periodDebits).toBe(1000);
      const creditBal = balances.find((b: any) => b.accountId === "acct-2");
      expect(creditBal.periodCredits).toBe(1000);
    });
  });
});
