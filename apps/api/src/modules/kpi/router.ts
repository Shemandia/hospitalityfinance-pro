import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { withEntityRLS } from "../../db/tenantContext.js";
import { KPIService } from "./service.js";
import { mapError, requireEntityId } from "../../shared/router-utils.js";

const periodQuerySchema = z.object({
  periodId: z.string().uuid()
});

export async function registerKPIRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      // Helper: run a KPI service call inside a transaction with RLS context.
      // KPI methods use $queryRaw which bypasses Prisma $use middleware,
      // so we must set app.current_entity_id explicitly via withEntityRLS.
      async function withKPI<T>(entityId: string, fn: (svc: KPIService) => Promise<T>): Promise<T> {
        return withEntityRLS(prisma as unknown as PrismaClient, entityId, async (tx) => {
          const svc = new KPIService(tx as unknown as PrismaClient);
          return fn(svc);
        });
      }

      router.get(
        "/revpar",
        { preHandler: [requirePermission(["STATS_READ", "REPORT_READ"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = periodQuerySchema.parse(request.query);
            const data = await withKPI(entityId, (svc) => svc.getRevPAR({ entityId, periodId }));
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/balance-sheet",
        { preHandler: [requirePermission("REPORT_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = periodQuerySchema.parse(request.query);
            const data = await withKPI(entityId, (svc) =>
              svc.getBalanceSheet({ entityId, periodId })
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/cash-flow",
        { preHandler: [requirePermission("REPORT_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = periodQuerySchema.parse(request.query);
            const data = await withKPI(entityId, (svc) => svc.getCashFlow({ entityId, periodId }));
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/usali",
        { preHandler: [requirePermission("REPORT_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = periodQuerySchema.parse(request.query);
            const data = await withKPI(entityId, (svc) => svc.getUSALI({ entityId, periodId }));
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/usali-comparative",
        { preHandler: [requirePermission("REPORT_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = periodQuerySchema.parse(request.query);
            const data = await withKPI(entityId, (svc) =>
              svc.getUSALIComparative({ entityId, periodId })
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/currency-exposure",
        { preHandler: [requirePermission("REPORT_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await withKPI(entityId, (svc) => svc.getCurrencyExposure(entityId));
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/entity-summary",
        { preHandler: [requirePermission("REPORT_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { year, month } = z
              .object({
                year: z.coerce.number().int().min(2000).max(2100),
                month: z.coerce.number().int().min(1).max(12)
              })
              .parse(request.query);
            const data = await withKPI(entityId, (svc) =>
              svc.getEntitySummary(entityId, year, month)
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/revpar-trend",
        { preHandler: [requirePermission(["STATS_READ", "REPORT_READ"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = periodQuerySchema.parse(request.query);
            const data = await withKPI(entityId, (svc) =>
              svc.getRevPARTrend({ entityId, periodId })
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/dashboard",
        { preHandler: [requirePermission("REPORT_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = periodQuerySchema.parse(request.query);
            const data = await withKPI(entityId, (svc) => svc.getKPIDashboard(entityId, periodId));
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/usali-comparative/pdf",
        { preHandler: [requirePermission("REPORT_EXPORT")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = periodQuerySchema.parse(request.query);
            const { report, entity } = await withEntityRLS(
              prisma as unknown as PrismaClient,
              entityId,
              async (tx) => {
                const svc = new KPIService(tx as unknown as PrismaClient);
                const report = await svc.getUSALIComparative({ entityId, periodId });
                const entity = await tx.entity.findUniqueOrThrow({ where: { id: entityId } });
                return { report, entity };
              }
            );
            const { renderUSALIPdf } = await import("../reporting/usali-pl-pdf.js");
            const pdf = await renderUSALIPdf({
              entityName: entity.name,
              periodName: report.periodName,
              year: report.year,
              month: report.month,
              hasYTD: report.hasYTD,
              hasPriorYear: report.hasPriorYear,
              hasBudget: report.hasBudget,
              departments: report.departments,
              totalRevenue: report.totalRevenue,
              totalDepartmentalExpenses: report.totalDepartmentalExpenses,
              totalDepartmentalIncome: report.totalDepartmentalIncome,
              undistributedExpenses: report.undistributedExpenses,
              grossOperatingProfit: report.grossOperatingProfit,
              gopPct: report.gopPct,
              managementFees: report.managementFees,
              ebitda: report.ebitda,
              ebitdaPct: report.ebitdaPct,
              ytdTotalRevenue: report.ytdTotalRevenue,
              ytdGOP: report.ytdGOP,
              ytdGOPPct: report.ytdGOPPct,
              ytdEBITDA: report.ytdEBITDA,
              ytdEBITDAPct: report.ytdEBITDAPct,
              priorTotalRevenue: report.priorTotalRevenue,
              priorGOP: report.priorGOP,
              priorGOPPct: report.priorGOPPct,
              budgetTotalRevenue: report.budgetTotalRevenue,
              budgetGOP: report.budgetGOP,
              budgetEBITDA: report.budgetEBITDA,
              revenueVariance: report.revenueVariance,
              gopVariance: report.gopVariance,
              gopVariancePct: report.gopVariancePct
            });
            return reply
              .header("Content-Type", "application/pdf")
              .header("Content-Disposition", `inline; filename="usali-pl-${report.periodName}.pdf"`)
              .send(pdf);
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/balance-sheet/pdf",
        { preHandler: [requirePermission("REPORT_EXPORT")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = periodQuerySchema.parse(request.query);
            const { report, entity } = await withEntityRLS(
              prisma as unknown as PrismaClient,
              entityId,
              async (tx) => {
                const svc = new KPIService(tx as unknown as PrismaClient);
                const report = await svc.getBalanceSheet({ entityId, periodId });
                const entity = await tx.entity.findUniqueOrThrow({ where: { id: entityId } });
                return { report, entity };
              }
            );
            const { renderBalanceSheetPdf } = await import("../reporting/balance-sheet-pdf.js");
            const pdf = await renderBalanceSheetPdf({
              entityName: entity.name,
              asOf: report.asOf,
              assets: report.assets,
              liabilities: report.liabilities,
              equity: report.equity,
              totalAssets: report.totalAssets,
              totalLiabilities: report.totalLiabilities,
              totalEquity: report.totalEquity,
              totalLiabilitiesAndEquity: report.totalLiabilitiesAndEquity
            });
            return reply
              .header("Content-Type", "application/pdf")
              .header("Content-Disposition", `inline; filename="balance-sheet-${report.asOf}.pdf"`)
              .send(pdf);
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/cash-flow/pdf",
        { preHandler: [requirePermission("REPORT_EXPORT")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = periodQuerySchema.parse(request.query);
            const { report, entity, period } = await withEntityRLS(
              prisma as unknown as PrismaClient,
              entityId,
              async (tx) => {
                const svc = new KPIService(tx as unknown as PrismaClient);
                const report = await svc.getCashFlow({ entityId, periodId });
                const entity = await tx.entity.findUniqueOrThrow({ where: { id: entityId } });
                const period = await tx.period.findUniqueOrThrow({ where: { id: periodId } });
                return { report, entity, period };
              }
            );
            const { renderCashFlowPdf } = await import("../reporting/cashflow-pdf.js");
            const pdf = await renderCashFlowPdf({
              entityName: entity.name,
              periodName: `${period.year}-${String(period.month).padStart(2, "0")}`,
              operating: report.operating,
              investing: report.investing,
              financing: report.financing,
              netChange: report.netChange,
              openingCash: report.openingCash,
              closingCash: report.closingCash
            });
            return reply
              .header("Content-Type", "application/pdf")
              .header(
                "Content-Disposition",
                `inline; filename="cashflow-${period.year}-${String(period.month).padStart(2, "0")}.pdf"`
              )
              .send(pdf);
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
    },
    { prefix: "/api/v1/kpi" }
  );
}
