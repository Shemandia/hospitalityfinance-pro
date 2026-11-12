import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../../db/client.js";
import { z } from "zod";
import { prisma } from "../../../db/prisma.js";
import { requirePermission } from "../../../middleware/requirePermission.js";
import { importBankStatement } from "../connectors/bank/bank-statement-importer.js";
import {
  getReconciliationSummary,
  getUnreconciledTransactions,
  findMatchCandidates,
  matchTransaction,
  unmatchTransaction,
  autoMatchStatement
} from "../connectors/bank/reconciliation-service.js";
import { mapError, requireEntityId } from "./_shared.js";

const bankImportSchema = z.object({
  format: z.enum(["MT940", "OFX"]),
  bankAccountRef: z.string().min(1),
  fileContent: z.string().min(1)
});

const connectorMappingSchema = z.object({
  connectorType: z.string().min(1),
  sourceCode: z.string().min(1),
  notes: z.string().optional(),
  glAccountId: z.string().uuid()
});

export function registerBankRoutes(router: FastifyInstance) {
  // ── Bank Feeds ──────────────────────────────────────────────────────────

  router.post(
    "/bank/import",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const payload = bankImportSchema.parse(request.body);
        const data = await importBankStatement(
          prisma as unknown as PrismaClient,
          entityId,
          payload.fileContent,
          payload.format,
          payload.bankAccountRef
        );
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.get(
    "/bank/statements",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const data = await (prisma as unknown as PrismaClient).bankStatement.findMany({
          where: { entityId },
          include: {
            account: { select: { id: true, code: true, name: true } },
            _count: { select: { transactions: true } }
          },
          orderBy: { createdAt: "desc" },
          take: 50
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.get<{ Params: { statementId: string } }>(
    "/bank/statements/:statementId/transactions",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const data = await (prisma as unknown as PrismaClient).bankTransaction.findMany({
          where: {
            bankStatementId: request.params.statementId,
            bankStatement: { entityId }
          },
          orderBy: { valueDate: "desc" }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ── Bank Reconciliation ────────────────────────────────────────────────

  router.get<{ Params: { statementId: string } }>(
    "/bank/statements/:statementId/reconciliation",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const data = await getReconciliationSummary(
          prisma as unknown as PrismaClient,
          entityId,
          request.params.statementId
        );
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.get<{ Params: { statementId: string } }>(
    "/bank/statements/:statementId/unreconciled",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const data = await getUnreconciledTransactions(
          prisma as unknown as PrismaClient,
          entityId,
          request.params.statementId
        );
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.get<{ Params: { transactionId: string } }>(
    "/bank/transactions/:transactionId/candidates",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { dateTolerance } = request.query as { dateTolerance?: string };
        const data = await findMatchCandidates(
          prisma as unknown as PrismaClient,
          entityId,
          request.params.transactionId,
          dateTolerance ? parseInt(dateTolerance, 10) : 3
        );
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.post<{ Params: { transactionId: string } }>(
    "/bank/transactions/:transactionId/match",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { journalLineId } = z
          .object({ journalLineId: z.string().uuid() })
          .parse(request.body);
        await matchTransaction(
          prisma as unknown as PrismaClient,
          entityId,
          request.params.transactionId,
          journalLineId
        );
        return reply.send({ data: { matched: true }, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.post<{ Params: { transactionId: string } }>(
    "/bank/transactions/:transactionId/unmatch",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        await unmatchTransaction(
          prisma as unknown as PrismaClient,
          entityId,
          request.params.transactionId
        );
        return reply.send({ data: { unmatched: true }, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.post<{ Params: { statementId: string } }>(
    "/bank/statements/:statementId/auto-match",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { minScore } = (request.body ?? {}) as { minScore?: number };
        const data = await autoMatchStatement(
          prisma as unknown as PrismaClient,
          entityId,
          request.params.statementId,
          minScore ?? 70
        );
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ── Connector Mappings ───────────────────────────────���──────────────────

  router.get(
    "/mappings",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { connectorType } = request.query as { connectorType?: string };
        const data = await (prisma as unknown as PrismaClient).connectorMapping.findMany({
          where: { entityId, ...(connectorType ? { connectorType } : {}) },
          include: { glAccount: { select: { id: true, code: true, name: true } } },
          orderBy: [{ connectorType: "asc" }, { sourceCode: "asc" }]
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.post(
    "/mappings",
    { preHandler: [requirePermission("INTEGRATION_CONFIG")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const payload = connectorMappingSchema.parse(request.body);
        const data = await (prisma as unknown as PrismaClient).connectorMapping.upsert({
          where: {
            entityId_connectorType_sourceCode: {
              entityId,
              connectorType: payload.connectorType,
              sourceCode: payload.sourceCode
            }
          },
          create: { entityId, ...payload },
          update: { glAccountId: payload.glAccountId, notes: payload.notes }
        });
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.delete<{ Params: { id: string } }>(
    "/mappings/:id",
    { preHandler: [requirePermission("INTEGRATION_CONFIG")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        await (prisma as unknown as PrismaClient).connectorMapping.deleteMany({
          where: { id: request.params.id, entityId }
        });
        return reply.code(204).send();
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );
}
