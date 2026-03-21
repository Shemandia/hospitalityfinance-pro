import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import { ARService, ARServiceError } from "./service.js";
import { enqueueDunningRun } from "../../jobs/dunning-queue.js";
import {
  ageingQuerySchema,
  arAllocationSchema,
  arInvoiceCreateSchema,
  arInvoiceListQuerySchema,
  arInvoiceUpdateSchema,
  arReceiptCreateSchema,
  customerCreateSchema,
  customerUpdateSchema
} from "./types.js";

const arService = new ARService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
    });
  }
  if (error instanceof ARServiceError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({ data: null, errors: [{ code: "INTERNAL_SERVER_ERROR", message }] });
}

function requireEntityId(entityId: string | undefined): string {
  if (!entityId)
    throw new ARServiceError("AR_ENTITY_REQUIRED", "X-Entity-ID header is required.", 400);
  return entityId;
}

function requireUserId(sub: unknown): string {
  if (typeof sub !== "string" || !sub)
    throw new ARServiceError("AR_USER_REQUIRED", "Token subject required.", 401);
  return sub;
}

export async function registerARRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireWriteAccess);

      // ── Customers ──────────────────────────────────────────────────────────────

      router.get("/customers", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await arService.listCustomers(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/customers/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await arService.getCustomer(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/customers", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = customerCreateSchema.parse(request.body);
          const data = await arService.createCustomer(entityId, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put<{ Params: { id: string } }>("/customers/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = customerUpdateSchema.parse(request.body);
          const data = await arService.updateCustomer(entityId, request.params.id, payload);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── AR Invoices ────────────────────────────────────────────────────────────

      router.get("/invoices", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const query = arInvoiceListQuerySchema.parse(request.query);
          const data = await arService.listInvoices(entityId, query);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/invoices/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await arService.getInvoice(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/invoices", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = arInvoiceCreateSchema.parse(request.body);
          const data = await arService.createInvoice(entityId, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put<{ Params: { id: string } }>("/invoices/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = arInvoiceUpdateSchema.parse(request.body);
          const data = await arService.updateInvoice(entityId, request.params.id, payload);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post<{ Params: { id: string } }>("/invoices/:id/post", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const userId = requireUserId(request.user?.sub);
          const data = await arService.postInvoice(entityId, request.params.id, userId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Receipts ───────────────────────────────────────────────────────────────

      router.get("/receipts", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const { customerId } = request.query as { customerId?: string };
          const data = await arService.listReceipts(entityId, customerId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/receipts", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = arReceiptCreateSchema.parse(request.body);
          const data = await arService.createReceipt(entityId, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Allocations ────────────────────────────────────────────────────────────

      router.post("/allocations", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = arAllocationSchema.parse(request.body);
          const data = await arService.allocateReceipt(entityId, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Ageing Report ──────────────────────────────────────────────────────────

      router.get("/ageing", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const query = ageingQuerySchema.parse(request.query);
          const data = await arService.getAgeingReport(entityId, query);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Dunning ────────────────────────────────────────────────────────────────

      // Synchronous run (backwards-compatible)
      router.post("/dunning/run", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await arService.runDunning(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // Async run via BullMQ queue
      router.post("/dunning/enqueue", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const jobId = await enqueueDunningRun(entityId);
          return reply.code(202).send({
            data: { jobId, message: "Dunning job enqueued. Emails will be sent in background." },
            errors: []
          });
        } catch (error) {
          return mapError(reply, error);
        }
      });
    },
    { prefix: "/api/v1/ar" }
  );
}
