import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../../db/client.js";
import { z } from "zod";
import { prisma } from "../../../db/prisma.js";
import { requirePermission } from "../../../middleware/requirePermission.js";
import { runOperaCloudImport } from "../connectors/opera-cloud/opera-cloud-import-job.js";
import { getOperaCloudCredentials } from "../connectors/opera-cloud/opera-cloud-auth.js";
import { OperaCloudClient } from "../connectors/opera-cloud/opera-cloud-client.js";
import { mapError, requireEntityId } from "./_shared.js";

const operaImportSchema = z.object({
  hotelId: z.string().min(1),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  notifyEmail: z.string().email().optional()
});

export function registerOperaRoutes(router: FastifyInstance) {
  // ── Opera Cloud ─────────────────────────────────────────────────────────

  router.post(
    "/opera-cloud/import",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const payload = operaImportSchema.parse(request.body);
        const data = await runOperaCloudImport(prisma as unknown as PrismaClient, {
          entityId,
          hotelId: payload.hotelId,
          businessDate: payload.businessDate,
          notifyEmail: payload.notifyEmail
        });
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.get(
    "/opera-cloud/logs",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { limit, offset } = request.query as { limit?: string; offset?: string };
        const data = await (prisma as unknown as PrismaClient).importLog.findMany({
          where: { entityId, connectorType: "OPERA_CLOUD" },
          orderBy: { createdAt: "desc" },
          take: Math.min(parseInt(limit ?? "50", 10), 200),
          skip: Math.min(parseInt(offset ?? "0", 10), 100000)
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ── Opera PMS Enhanced (OHIP) ────────────────────────────────────────────

  router.get(
    "/opera-cloud/statistics",
    { preHandler: [requirePermission(["STATS_READ", "INTEGRATION_READ"])] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const query = z
          .object({
            hotelId: z.string().min(1),
            businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
          })
          .parse(request.query);

        const creds = getOperaCloudCredentials();
        const client = new OperaCloudClient(creds);
        const data = await client.getHotelStatistics(query.hotelId, query.businessDate);

        // F20: sanity-validate the occupancy figures rather than trusting OHIP
        // blindly. Surface warnings; do not silently alter the reported numbers.
        const warnings: string[] = [];
        const availableRooms = data.totalRooms - data.outOfOrderRooms;
        if (availableRooms >= 0 && data.roomsSold > availableRooms) {
          warnings.push(
            `roomsSold (${data.roomsSold}) exceeds available rooms (${availableRooms} = ${data.totalRooms} total − ${data.outOfOrderRooms} OOO).`
          );
        }
        if (data.occupancyPct < 0 || data.occupancyPct > 100) {
          warnings.push(`occupancyPct (${data.occupancyPct}) is outside the 0–100 range.`);
        }
        if (data.totalRooms < 0 || data.roomsSold < 0) {
          warnings.push("Negative room counts reported by PMS.");
        }

        await (prisma as any).pMSStatistic
          ?.upsert({
            where: {
              entityId_statDate: { entityId, statDate: new Date(query.businessDate) }
            },
            create: {
              entityId,
              statDate: new Date(query.businessDate),
              availableRooms: data.totalRooms - data.outOfOrderRooms,
              occupiedRooms: data.roomsSold
            },
            update: {
              availableRooms: data.totalRooms - data.outOfOrderRooms,
              occupiedRooms: data.roomsSold
            }
          })
          .catch(() => {
            /* PMSStatistic table may not exist yet */
          });

        return reply.send({ data: { ...data, warnings }, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.get(
    "/opera-cloud/cashier-report",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        requireEntityId(request.entityId);
        const query = z
          .object({
            hotelId: z.string().min(1),
            businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
          })
          .parse(request.query);

        const creds = getOperaCloudCredentials();
        const client = new OperaCloudClient(creds);
        const data = await client.getCashierReport(query.hotelId, query.businessDate);
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.get(
    "/opera-cloud/city-ledger",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        requireEntityId(request.entityId);
        const query = z
          .object({
            hotelId: z.string().min(1),
            businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
          })
          .parse(request.query);

        const creds = getOperaCloudCredentials();
        const client = new OperaCloudClient(creds);
        const data = await client.getCityLedgerSummary(query.hotelId, query.businessDate);
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );
}
