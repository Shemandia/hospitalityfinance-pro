import type { FastifyInstance } from "fastify";
import { Prisma, type PrismaClient } from "../../../db/client.js";
import { z } from "zod";
import { prisma } from "../../../db/prisma.js";
import { requirePermission } from "../../../middleware/requirePermission.js";
import { GLService } from "../../gl/service.js";
import { mapError, requireEntityId } from "./_shared.js";

const glService = new GLService(prisma as unknown as PrismaClient);

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const coverageQuerySchema = z.object({
  connectorType: z.string().min(1).max(40),
  from: z.string().regex(dateRe, "from must be YYYY-MM-DD"),
  to: z.string().regex(dateRe, "to must be YYYY-MM-DD")
});

const reconQuerySchema = z.object({
  from: z.string().regex(dateRe, "from must be YYYY-MM-DD"),
  to: z.string().regex(dateRe, "to must be YYYY-MM-DD"),
  // Control/detail account codes — default to the documented USALI/Opera codes,
  // overridable per property via query params.
  guestLedgerControl: z.string().max(20).default("12500"),
  cityLedgerControl: z.string().max(20).default("12450"),
  cityLedgerDetail: z.string().max(20).default("11750"),
  depositLedgerControl: z.string().max(20).default("24100")
});

/**
 * Import-level operations shared across connectors:
 *   - F15: reverse a connector import (reverses its GL journal + marks the log
 *     REVERSED, which also unblocks a corrected re-import — F16).
 *   - F5:  business-date coverage / missing-day detection.
 */
export function registerImportOpsRoutes(router: FastifyInstance) {
  // ── F15: Reverse a connector import ──────────────────────────────────────
  router.post<{ Params: { id: string } }>(
    "/imports/:id/reverse",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const userId = (request.user as { sub?: string } | undefined)?.sub ?? "";
        if (!userId) {
          return reply.code(401).send({
            data: null,
            errors: [{ code: "NO_USER", message: "Authenticated user is required." }]
          });
        }

        const log = await (prisma as unknown as PrismaClient).importLog.findFirst({
          where: { entityId, id: request.params.id }
        });
        if (!log) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "NOT_FOUND", message: "Import log not found." }]
          });
        }
        if (log.status === "REVERSED") {
          return reply.code(409).send({
            data: null,
            errors: [{ code: "ALREADY_REVERSED", message: "This import was already reversed." }]
          });
        }
        if (!log.glJournalId) {
          return reply.code(422).send({
            data: null,
            errors: [
              {
                code: "NO_JOURNAL",
                message: "This import did not post a GL journal, so there is nothing to reverse."
              }
            ]
          });
        }

        // Reverse the posted journal (creates a mirrored reversing entry and
        // marks the original REVERSED, unwinding the account balances).
        await glService.reverseJournal(entityId, log.glJournalId, userId);

        // Flip the import log so connector idempotency (which matches on SUCCESS)
        // no longer blocks a corrected re-import for the same business date (F16).
        await (prisma as unknown as PrismaClient).importLog.update({
          where: { id: log.id },
          data: { status: "REVERSED" }
        });

        return reply.send({
          data: {
            importLogId: log.id,
            reversedJournalId: log.glJournalId,
            businessDate: log.businessDate,
            status: "REVERSED",
            message:
              "Import reversed. You may now re-import the corrected file for this business date."
          },
          errors: []
        });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ── F5: Business-date coverage / missing-day detection ───────────────────
  router.get(
    "/imports/coverage",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const q = coverageQuerySchema.parse(request.query);

        const fromDate = new Date(`${q.from}T00:00:00.000Z`);
        const toDate = new Date(`${q.to}T00:00:00.000Z`);
        if (fromDate.getTime() > toDate.getTime()) {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "BAD_RANGE", message: "`from` must be on or before `to`." }]
          });
        }

        const logs = await (prisma as unknown as PrismaClient).importLog.findMany({
          where: {
            entityId,
            connectorType: q.connectorType,
            status: "SUCCESS",
            businessDate: { gte: fromDate, lte: toDate }
          },
          select: { businessDate: true }
        });

        const present = new Set(logs.map((l) => l.businessDate.toISOString().slice(0, 10)));

        const allDays: string[] = [];
        const missingDays: string[] = [];
        for (
          let d = new Date(fromDate);
          d.getTime() <= toDate.getTime();
          d.setUTCDate(d.getUTCDate() + 1)
        ) {
          const key = d.toISOString().slice(0, 10);
          allDays.push(key);
          if (!present.has(key)) missingDays.push(key);
        }

        return reply.send({
          data: {
            connectorType: q.connectorType,
            from: q.from,
            to: q.to,
            totalDays: allDays.length,
            importedDays: present.size,
            missingCount: missingDays.length,
            missingDays,
            complete: missingDays.length === 0
          },
          errors: []
        });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ── F13: PMS ledger → GL control-account reconciliation ───────────────────
  // Summarises PMS/POS/AR-sourced POSTED journal movements per account for a
  // date range and checks the documented control-vs-detail relationships
  // (city-ledger control vs AR detail; guest-ledger and deposit control moves).
  // The GL side of the reconciliation — finance ties these to the Opera guest/
  // city-ledger reports. Account codes default to the USALI/Opera codes and are
  // overridable per property.
  router.get(
    "/imports/ledger-reconciliation",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const q = reconQuerySchema.parse(request.query);

        const fromDate = new Date(`${q.from}T00:00:00.000Z`);
        const toDate = new Date(`${q.to}T23:59:59.999Z`);
        if (fromDate.getTime() > toDate.getTime()) {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "BAD_RANGE", message: "`from` must be on or before `to`." }]
          });
        }

        const journals = await (prisma as unknown as PrismaClient).journal.findMany({
          where: {
            entityId,
            status: "POSTED",
            source: { in: ["PMS", "POS", "AR"] as any },
            postedAt: { gte: fromDate, lte: toDate }
          },
          select: {
            lines: {
              select: {
                debitFunctional: true,
                creditFunctional: true,
                account: { select: { code: true, name: true, type: true } }
              }
            }
          }
        });

        // Aggregate movement per account (in functional currency).
        const byAccount = new Map<
          string,
          {
            code: string;
            name: string;
            type: string;
            debit: Prisma.Decimal;
            credit: Prisma.Decimal;
          }
        >();
        for (const j of journals) {
          for (const l of j.lines) {
            const code = l.account.code;
            const entry = byAccount.get(code) ?? {
              code,
              name: l.account.name,
              type: l.account.type,
              debit: new Prisma.Decimal(0),
              credit: new Prisma.Decimal(0)
            };
            entry.debit = entry.debit.add(l.debitFunctional);
            entry.credit = entry.credit.add(l.creditFunctional);
            byAccount.set(code, entry);
          }
        }

        const netOf = (code: string): Prisma.Decimal => {
          const a = byAccount.get(code);
          return a ? a.debit.sub(a.credit) : new Prisma.Decimal(0);
        };
        const TOL = new Prisma.Decimal("0.01");

        const accounts = [...byAccount.values()]
          .map((a) => ({
            code: a.code,
            name: a.name,
            type: a.type,
            debit: a.debit.toFixed(2),
            credit: a.credit.toFixed(2),
            net: a.debit.sub(a.credit).toFixed(2)
          }))
          .sort((a, b) => a.code.localeCompare(b.code));

        // City ledger: control (credit-normal) should offset AR detail (debit).
        const cityControlNet = netOf(q.cityLedgerControl);
        const cityDetailNet = netOf(q.cityLedgerDetail);
        const cityDelta = cityControlNet.add(cityDetailNet);

        return reply.send({
          data: {
            from: q.from,
            to: q.to,
            journalCount: journals.length,
            accounts,
            checks: {
              cityLedger: {
                controlAccount: q.cityLedgerControl,
                controlNet: cityControlNet.toFixed(2),
                detailAccount: q.cityLedgerDetail,
                detailNet: cityDetailNet.toFixed(2),
                delta: cityDelta.toFixed(2),
                balanced: cityDelta.abs().lessThanOrEqualTo(TOL)
              },
              guestLedger: {
                controlAccount: q.guestLedgerControl,
                net: netOf(q.guestLedgerControl).toFixed(2)
              },
              depositLedger: {
                controlAccount: q.depositLedgerControl,
                net: netOf(q.depositLedgerControl).toFixed(2)
              }
            },
            note:
              "GL side only. Tie controlNet/detailNet to the Opera guest & city-ledger " +
              "reports. Movements are in functional currency across POSTED PMS/POS/AR journals."
          },
          errors: []
        });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );
}
