import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import { APService, APServiceError } from "./service.js";
import {
  apInvoiceCreateSchema,
  apInvoiceListQuerySchema,
  apInvoiceUpdateSchema,
  paymentRunConfirmSchema,
  paymentRunProposalSchema,
  supplierCreateSchema,
  supplierUpdateSchema
} from "./types.js";

const apService = new APService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [
        {
          code: "VALIDATION_ERROR",
          message: error.issues.map((issue) => issue.message).join("; ")
        }
      ]
    });
  }

  if (error instanceof APServiceError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }

  return reply.code(500).send({
    data: null,
    errors: [
      {
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown error"
      }
    ]
  });
}

function requireEntityId(entityId: string | undefined): string {
  if (!entityId) {
    throw new APServiceError("AP_ENTITY_CONTEXT_REQUIRED", "X-Entity-ID header is required.", 400);
  }
  return entityId;
}

function requireUserSubject(subject: unknown): string {
  if (typeof subject !== "string" || subject.length === 0) {
    throw new APServiceError("AP_USER_CONTEXT_REQUIRED", "User subject is required.", 401);
  }
  return subject;
}

export async function registerAPRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireWriteAccess);

      router.get("/suppliers", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await apService.listSuppliers(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/suppliers", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = supplierCreateSchema.parse(request.body);
          const data = await apService.createSupplier(entityId, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/suppliers/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await apService.getSupplier(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put<{ Params: { id: string } }>("/suppliers/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = supplierUpdateSchema.parse(request.body);
          const data = await apService.updateSupplier(entityId, request.params.id, payload);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.delete<{ Params: { id: string } }>("/suppliers/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await apService.deleteSupplier(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get("/invoices", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const query = apInvoiceListQuerySchema.parse(request.query);
          const data = await apService.listInvoices(entityId, query);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/invoices", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const subject = requireUserSubject(request.user?.sub);
          const payload = apInvoiceCreateSchema.parse(request.body);
          const data = await apService.createInvoice(entityId, subject, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/portal/invoices", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = apInvoiceCreateSchema.parse(request.body);
          const data = await apService.submitSupplierInvoice(entityId, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/invoices/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await apService.getInvoice(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put<{ Params: { id: string } }>("/invoices/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = apInvoiceUpdateSchema.parse(request.body);
          const data = await apService.updateInvoice(entityId, request.params.id, payload);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.delete<{ Params: { id: string } }>("/invoices/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await apService.deleteInvoice(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // PO matching removed — handled by external Material Management system
      // Invoices arrive pre-matched via MM integration

      router.post<{ Params: { id: string } }>("/invoices/:id/approve", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const subject = requireUserSubject(request.user?.sub);
          const data = await apService.approveInvoice(entityId, request.params.id, subject);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post<{ Params: { id: string } }>("/invoices/:id/post", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const subject = requireUserSubject(request.user?.sub);
          const data = await apService.postInvoice(entityId, request.params.id, subject);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/payment-runs/proposal", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const subject = requireUserSubject(request.user?.sub);
          const payload = paymentRunProposalSchema.parse(request.body);
          const data = await apService.proposePaymentRun(entityId, subject, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get("/payment-runs", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const query = request.query as { limit?: string | number };
          const limitValue =
            typeof query.limit === "number"
              ? query.limit
              : typeof query.limit === "string"
                ? Number.parseInt(query.limit, 10)
                : 50;

          if (!Number.isFinite(limitValue) || limitValue <= 0 || limitValue > 200) {
            throw new APServiceError(
              "AP_PAYMENT_RUN_INVALID_LIMIT",
              "limit must be between 1 and 200.",
              422
            );
          }

          const data = await apService.listPaymentRuns(entityId, limitValue);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/payment-runs/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await apService.getPaymentRun(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post<{ Params: { id: string } }>(
        "/payment-runs/:id/approve",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const subject = requireUserSubject(request.user?.sub);
            const data = await apService.approvePaymentRun(entityId, request.params.id, subject);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/payment-runs/:id/confirm",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const subject = requireUserSubject(request.user?.sub);
            const payload = paymentRunConfirmSchema.parse(request.body);
            const data = await apService.confirmPaymentRun(
              entityId,
              request.params.id,
              subject,
              payload
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
      router.get<{ Params: { runId: string; supplierId: string } }>(
        "/payment-runs/:runId/voucher/:supplierId",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { runId, supplierId } = request.params;
            const paymentRun = await apService.getPaymentRun(entityId, runId);

            if (paymentRun.status !== "PROCESSED" && paymentRun.status !== "CONFIRMED") {
              return reply.code(400).send({
                data: null,
                errors: [
                  { code: "AP_VOUCHER_INVALID_STATUS", message: "Payment run must be processed." }
                ]
              });
            }

            const item = paymentRun.items.find((i) => i.supplierId === supplierId);
            if (!item) {
              return reply.code(404).send({
                data: null,
                errors: [
                  {
                    code: "AP_VOUCHER_SUPPLIER_NOT_FOUND",
                    message: "Supplier not in this payment run."
                  }
                ]
              });
            }

            const entity = await prisma.entity.findUniqueOrThrow({ where: { id: entityId } });
            const supplierInvoices = paymentRun.invoices.filter(
              (ri) => ri.invoice.supplierId === supplierId
            );

            const { Prisma } = await import("@prisma/client");
            const { renderPaymentVoucherPdf } = await import("./payment-voucher-pdf.js");

            const pdfBuffer = await renderPaymentVoucherPdf({
              entity: {
                name: entity.name,
                address: entity.address,
                city: entity.city,
                postalCode: entity.postalCode,
                countryCode: entity.countryCode
              },
              supplier: { name: item.supplier.name, code: item.supplier.code },
              payment: {
                reference: `PAYRUN-${runId.slice(0, 8)}`,
                paymentDate: paymentRun.updatedAt,
                currency: item.currency,
                totalAmount: new Prisma.Decimal(item.payableAmount),
                paymentMethod: "BANK_TRANSFER"
              },
              invoiceLines: supplierInvoices.map((ri) => ({
                invoiceNumber: ri.invoice.invoiceNumber,
                invoiceDate: ri.invoice.invoiceDate,
                description: ri.invoice.invoiceNumber,
                debitAmount: new Prisma.Decimal(ri.allocatedAmount),
                creditAmount: new Prisma.Decimal(0)
              }))
            });

            return reply
              .header("Content-Type", "application/pdf")
              .header(
                "Content-Disposition",
                `inline; filename="voucher-${runId.slice(0, 8)}-${item.supplier.code}.pdf"`
              )
              .send(pdfBuffer);
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get<{ Params: { id: string } }>(
        "/payment-runs/:id/download",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const paymentRun = await apService.getPaymentRun(entityId, request.params.id);
            if (!paymentRun.bankFilePath) {
              return reply
                .code(404)
                .send({ data: null, errors: [{ message: "No bank file available." }] });
            }

            const { readFile } = await import("node:fs/promises");
            const { basename } = await import("node:path");
            const content = await readFile(paymentRun.bankFilePath, "utf8");
            const filename = basename(paymentRun.bankFilePath);

            const ext = filename.split(".").pop()?.toLowerCase();
            const contentType =
              ext === "xml" ? "application/xml" : ext === "mt103" ? "text/plain" : "text/csv";

            return reply
              .header("Content-Type", contentType)
              .header("Content-Disposition", `attachment; filename="${filename}"`)
              .send(content);
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
    },
    { prefix: "/api/v1/ap" }
  );
}
