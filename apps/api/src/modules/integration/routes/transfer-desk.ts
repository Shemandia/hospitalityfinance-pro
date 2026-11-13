import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../../db/client.js";
import { z } from "zod";
import { prisma } from "../../../db/prisma.js";
import { requirePermission } from "../../../middleware/requirePermission.js";
import { resolveTenant } from "../../../db/tenantRegistry.js";
import {
  enqueueTransferDeskExecution,
  cancelTransferDeskExecution
} from "../../../jobs/transfer-desk-queue.js";
import {
  ALL_SOURCE_FORMATS,
  ALL_CONNECTOR_TYPES,
  ALL_SOURCE_TYPES,
  ALL_TRANSFORMS,
  GL_JOURNAL_TARGET_FIELDS,
  AP_INVOICE_TARGET_FIELDS,
  SUPPLIER_SYNC_TARGET_FIELDS
} from "../transform-engine.js";
import { mapError } from "./_shared.js";

// ── Profile schemas ─────────────────────────────────────────────────────────

const profileCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  profileType: z.enum(["IMPORT", "EXPORT", "PROCESS", "INTERNAL_TRANSFER", "EXTERNAL_TRANSFER"]),
  sourceComponent: z.string().optional(),
  targetComponent: z.string().optional(),
  sourceFormatId: z.string().uuid().optional(),
  targetFormatId: z.string().uuid().optional(),
  transformationId: z.string().uuid().optional(),
  filterId: z.string().uuid().optional(),
  sourceParams: z.record(z.unknown()).optional(),
  targetParams: z.record(z.unknown()).optional(),
  savePayload: z.enum(["NONE", "INPUT", "OUTPUT", "BOTH"]).optional()
});
type ProfileCreateInput = z.infer<typeof profileCreateSchema>;

function validateProfileShape(p: ProfileCreateInput): string[] {
  const errors: string[] = [];
  if (!p.transformationId) {
    errors.push("transformationId is required (TD-BL-005)");
  }
  switch (p.profileType) {
    case "IMPORT":
      if (!p.targetComponent) errors.push("Import profiles require targetComponent (TD-BL-002)");
      break;
    case "EXPORT":
      if (!p.sourceComponent) errors.push("Export profiles require sourceComponent (TD-BL-003)");
      break;
    case "PROCESS":
      if (!p.targetComponent) errors.push("Process profiles require targetComponent (TD-BL-004)");
      break;
    case "INTERNAL_TRANSFER":
    case "EXTERNAL_TRANSFER":
      if (!p.sourceComponent || !p.targetComponent) {
        errors.push("Transfer profiles require both sourceComponent and targetComponent");
      }
      break;
  }
  return errors;
}

// ── Execution schema ────────────────────────────────────────────────────────

const executeProfileSchema = z.object({
  sourceParamOverrides: z.record(z.unknown()).optional(),
  targetParamOverrides: z.record(z.unknown()).optional(),
  inputContent: z.string().optional()
});

// ── Filter schema ───────────────────────────────────────────────────────────

const filterSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  sourceComponent: z.string().min(1),
  filterClauses: z.record(z.unknown())
});

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerTransferDeskRoutes(router: FastifyInstance) {
  // ── Metadata ────────────────────────────────────────────────────────────

  router.get(
    "/transfer-desk/metadata",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (_request, reply) => {
      return reply.send({
        data: {
          sourceFormats: ALL_SOURCE_FORMATS,
          connectorTypes: ALL_CONNECTOR_TYPES,
          sourceTypes: ALL_SOURCE_TYPES,
          transforms: ALL_TRANSFORMS,
          targetTypes: ["GL_JOURNAL", "AP_INVOICE", "SUPPLIER_SYNC"],
          targetFields: {
            GL_JOURNAL: GL_JOURNAL_TARGET_FIELDS,
            AP_INVOICE: AP_INVOICE_TARGET_FIELDS,
            SUPPLIER_SYNC: SUPPLIER_SYNC_TARGET_FIELDS
          },
          filterOperators: [
            "EQUALS",
            "NOT_EQUALS",
            "CONTAINS",
            "STARTS_WITH",
            "GT",
            "LT",
            "NOT_EMPTY"
          ]
        },
        errors: []
      });
    }
  );

  // ── Components (UI-API-003) ─────────────────────────────────────────────

  router.get(
    "/transfer-desk/components",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (_request, reply) => {
      const components = [
        {
          name: "GL_JOURNAL",
          label: "General Ledger Journal",
          description: "GL journal headers and lines. The most common target for journal imports.",
          fields: [
            {
              name: "reference",
              dataType: "string",
              required: true,
              description: "Journal reference / number (auto-assigned if blank)"
            },
            {
              name: "description",
              dataType: "string",
              required: true,
              description: "Journal narrative / description"
            },
            {
              name: "periodId",
              dataType: "string",
              required: true,
              description: "Posting period UUID"
            },
            {
              name: "journalType",
              dataType: "string",
              required: false,
              description: "Journal type code (e.g., AP, AR, GJ)"
            },
            {
              name: "source",
              dataType: "string",
              required: false,
              description: "Journal source enum (IMPORT, MANUAL, etc.)"
            },
            {
              name: "functionalCurrency",
              dataType: "string",
              required: true,
              description: "ISO 4217 currency code"
            },
            {
              name: "lineAccountCode",
              dataType: "string",
              required: true,
              description: "GL account code (line)"
            },
            {
              name: "lineDebit",
              dataType: "decimal",
              required: true,
              description: "Line debit amount in line currency"
            },
            {
              name: "lineCredit",
              dataType: "decimal",
              required: true,
              description: "Line credit amount in line currency"
            },
            {
              name: "lineCurrency",
              dataType: "string",
              required: true,
              description: "Line currency (ISO 4217)"
            },
            {
              name: "lineFxRate",
              dataType: "decimal",
              required: false,
              description: "FX rate to functional currency"
            },
            {
              name: "lineDescription",
              dataType: "string",
              required: false,
              description: "Per-line narrative"
            },
            {
              name: "lineDimension1",
              dataType: "string",
              required: false,
              description: "Analysis dimension T1"
            },
            {
              name: "lineDimension2",
              dataType: "string",
              required: false,
              description: "Analysis dimension T2"
            },
            {
              name: "lineDimension3",
              dataType: "string",
              required: false,
              description: "Analysis dimension T3"
            },
            {
              name: "lineDimension4",
              dataType: "string",
              required: false,
              description: "Analysis dimension T4"
            },
            {
              name: "lineDimension5",
              dataType: "string",
              required: false,
              description: "Analysis dimension T5"
            },
            {
              name: "lineDimension6",
              dataType: "string",
              required: false,
              description: "Analysis dimension T6"
            }
          ]
        },
        {
          name: "AP_INVOICE",
          label: "Accounts Payable Invoice",
          description:
            "AP invoice headers received from Sky Jana MMS as journal imports. HFP owns the AP control account, payment, and aging.",
          fields: [
            {
              name: "supplierCode",
              dataType: "string",
              required: true,
              description: "Supplier code as known to HFP (must already exist in tenant)"
            },
            {
              name: "invoiceNumber",
              dataType: "string",
              required: true,
              description: "Supplier invoice number"
            },
            {
              name: "invoiceDate",
              dataType: "date",
              required: true,
              description: "Invoice issue date"
            },
            {
              name: "dueDate",
              dataType: "date",
              required: true,
              description: "Invoice due date"
            },
            {
              name: "currency",
              dataType: "string",
              required: true,
              description: "Invoice currency (ISO 4217)"
            },
            {
              name: "grossAmount",
              dataType: "decimal",
              required: true,
              description: "Gross amount including tax"
            },
            { name: "taxAmount", dataType: "decimal", required: true, description: "Tax amount" },
            {
              name: "netAmount",
              dataType: "decimal",
              required: true,
              description: "Net amount excluding tax"
            },
            {
              name: "fxRate",
              dataType: "decimal",
              required: false,
              description: "FX rate to functional currency"
            },
            {
              name: "periodId",
              dataType: "string",
              required: true,
              description: "Posting period UUID"
            },
            {
              name: "externalPoRef",
              dataType: "string",
              required: false,
              description: "External PO reference (from Jana)"
            }
          ]
        },
        {
          name: "AR_INVOICE",
          label: "Accounts Receivable Invoice",
          description: "Customer invoices issued by HFP. Source for receipt allocation and aging.",
          fields: [
            {
              name: "customerCode",
              dataType: "string",
              required: true,
              description: "Customer code (must exist in tenant)"
            },
            {
              name: "invoiceNumber",
              dataType: "string",
              required: true,
              description: "AR invoice number"
            },
            {
              name: "invoiceDate",
              dataType: "date",
              required: true,
              description: "Invoice issue date"
            },
            {
              name: "dueDate",
              dataType: "date",
              required: true,
              description: "Invoice due date"
            },
            {
              name: "currency",
              dataType: "string",
              required: true,
              description: "Invoice currency (ISO 4217)"
            },
            { name: "amount", dataType: "decimal", required: true, description: "Total amount" },
            {
              name: "taxAmount",
              dataType: "decimal",
              required: false,
              description: "Tax amount"
            },
            {
              name: "fxRate",
              dataType: "decimal",
              required: false,
              description: "FX rate to functional currency"
            },
            {
              name: "periodId",
              dataType: "string",
              required: true,
              description: "Posting period UUID"
            }
          ]
        },
        {
          name: "AR_RECEIPT",
          label: "Accounts Receivable Receipt",
          description: "Customer payments received. Allocates against AR invoices.",
          fields: [
            {
              name: "customerCode",
              dataType: "string",
              required: true,
              description: "Customer code"
            },
            {
              name: "receiptNumber",
              dataType: "string",
              required: true,
              description: "Receipt reference"
            },
            {
              name: "receiptDate",
              dataType: "date",
              required: true,
              description: "Date of receipt"
            },
            {
              name: "currency",
              dataType: "string",
              required: true,
              description: "Receipt currency"
            },
            {
              name: "amount",
              dataType: "decimal",
              required: true,
              description: "Receipt amount"
            },
            {
              name: "bankAccountCode",
              dataType: "string",
              required: true,
              description: "Bank account that received the payment"
            },
            {
              name: "paymentMethod",
              dataType: "string",
              required: false,
              description: "Payment method (BANK_TRANSFER, CASH, CHEQUE, CARD)"
            }
          ]
        },
        {
          name: "COA_ACCOUNT",
          label: "Chart of Accounts (Account)",
          description:
            "GL account master records. Used by COA import profiles to create or update accounts in bulk.",
          fields: [
            {
              name: "code",
              dataType: "string",
              required: true,
              description: "Account code (unique per entity)"
            },
            { name: "name", dataType: "string", required: true, description: "Account name" },
            {
              name: "type",
              dataType: "string",
              required: true,
              description: "Account type (ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE, STATISTICAL)"
            },
            {
              name: "normalBalance",
              dataType: "string",
              required: true,
              description: "Normal balance side (DEBIT or CREDIT)"
            },
            {
              name: "parentCode",
              dataType: "string",
              required: false,
              description: "Parent account code (for hierarchy)"
            },
            {
              name: "level",
              dataType: "number",
              required: false,
              description: "Hierarchy level (1=root)"
            },
            {
              name: "allowPosting",
              dataType: "boolean",
              required: false,
              description: "Whether postings are allowed at this level"
            },
            {
              name: "isControlAccount",
              dataType: "boolean",
              required: false,
              description: "Whether this is a control account (e.g., AP control 2000)"
            },
            {
              name: "usaliCategory",
              dataType: "string",
              required: false,
              description: "USALI category (Rooms, F&B, A&G, etc.)"
            },
            {
              name: "usaliDepartment",
              dataType: "string",
              required: false,
              description: "USALI department"
            }
          ]
        },
        {
          name: "BUDGET",
          label: "Budget Lines",
          description: "Budget amounts per account per period. Used by budget import profiles.",
          fields: [
            {
              name: "budgetDefinitionCode",
              dataType: "string",
              required: true,
              description: "Budget definition reference (e.g., 'FY2026-OP')"
            },
            {
              name: "accountCode",
              dataType: "string",
              required: true,
              description: "GL account code"
            },
            { name: "periodId", dataType: "string", required: true, description: "Period UUID" },
            {
              name: "amount",
              dataType: "decimal",
              required: true,
              description: "Budget amount in functional currency"
            },
            {
              name: "dimension1",
              dataType: "string",
              required: false,
              description: "Analysis dimension T1 (optional)"
            },
            {
              name: "dimension2",
              dataType: "string",
              required: false,
              description: "Analysis dimension T2 (optional)"
            }
          ]
        },
        {
          name: "BANK_STATEMENT",
          label: "Bank Statement",
          description:
            "Bank statement transactions for reconciliation. Used by bank statement import profiles.",
          fields: [
            {
              name: "bankAccountCode",
              dataType: "string",
              required: true,
              description: "Bank account code as known to HFP"
            },
            {
              name: "statementDate",
              dataType: "date",
              required: true,
              description: "Statement closing date"
            },
            {
              name: "openingBalance",
              dataType: "decimal",
              required: true,
              description: "Statement opening balance"
            },
            {
              name: "closingBalance",
              dataType: "decimal",
              required: true,
              description: "Statement closing balance"
            },
            {
              name: "currency",
              dataType: "string",
              required: true,
              description: "Statement currency"
            },
            { name: "txDate", dataType: "date", required: true, description: "Transaction date" },
            {
              name: "txAmount",
              dataType: "decimal",
              required: true,
              description: "Transaction amount (signed: positive=credit, negative=debit)"
            },
            {
              name: "txReference",
              dataType: "string",
              required: false,
              description: "Transaction reference"
            },
            {
              name: "txDescription",
              dataType: "string",
              required: false,
              description: "Transaction description / narrative"
            },
            {
              name: "txCounterparty",
              dataType: "string",
              required: false,
              description: "Counterparty name"
            }
          ]
        }
      ];
      return reply.send({ data: components, errors: [] });
    }
  );

  // ── Format CRUD (TD-API-030+) ───────────────────────────────────────────

  // TD-API-030 — GET /transfer-desk/formats (list)
  router.get(
    "/transfer-desk/formats",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const { classification } = request.query as { classification?: string };
        const db = prisma as unknown as PrismaClient;
        const data = await db.transferFormat.findMany({
          where: {
            ...(classification ? { classification: classification as any } : {})
          },
          select: {
            id: true,
            name: true,
            description: true,
            classification: true,
            isSystem: true,
            isValid: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                sourceProfiles: true,
                targetProfiles: true
              }
            }
          },
          orderBy: [{ name: "asc" }]
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-031 — GET /transfer-desk/formats/:id (detail with FSD)
  router.get<{ Params: { id: string } }>(
    "/transfer-desk/formats/:id",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const db = prisma as unknown as PrismaClient;
        const data = await db.transferFormat.findUnique({
          where: { id: request.params.id }
        });
        if (!data) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "NOT_FOUND", message: "Format not found" }]
          });
        }
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-032 — POST /transfer-desk/formats/detect (auto-detect from sample file)
  router.post(
    "/transfer-desk/formats/detect",
    { preHandler: [requirePermission(["TRANSFER_DESK_READ", "INTEGRATION_READ"])] },
    async (request, reply) => {
      try {
        const { detectFormat } = await import("../../../jobs/format-auto-detect.js");
        const body = request.body as { fileContent?: string };
        if (!body.fileContent || body.fileContent.trim().length === 0) {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "MISSING_FILE_CONTENT", message: "fileContent is required" }]
          });
        }
        const result = detectFormat(body.fileContent);
        return reply.send({ data: result, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-033 — POST /transfer-desk/formats (create)
  router.post(
    "/transfer-desk/formats",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const body = request.body as {
          name?: string;
          description?: string;
          classification?: string;
          fsdXml?: string;
          guiState?: unknown;
        };

        if (!body.name || body.name.trim().length === 0) {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "MISSING_NAME", message: "Format name is required" }]
          });
        }
        if (!body.fsdXml) {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "MISSING_FSD", message: "fsdXml is required" }]
          });
        }

        // Validate the FSD JSON is parseable
        let parsedFsd: unknown;
        try {
          parsedFsd = JSON.parse(body.fsdXml);
        } catch {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "INVALID_FSD_JSON", message: "fsdXml is not valid JSON" }]
          });
        }

        // Dry-run parse to validate schema structure
        let isValid = true;
        let validationErrors: unknown = null;
        try {
          const { parse } = await import("@hfp/fsd-engine");
          const result = parse(parsedFsd as any, "");
          if (result.errors.some((e: any) => e.code.startsWith("SCHEMA_"))) {
            isValid = false;
            validationErrors = result.errors.filter((e: any) => e.code.startsWith("SCHEMA_"));
          }
        } catch {
          isValid = false;
        }

        const classification =
          body.classification ?? (parsedFsd as any).classification ?? "DELIMITED";
        const db = prisma as unknown as PrismaClient;
        const data = await db.transferFormat.create({
          data: {
            name: body.name.trim(),
            description: body.description?.trim() || null,
            classification: classification as any,
            fsdXml: body.fsdXml,
            guiState: body.guiState ?? undefined,
            isValid,
            validationErrors: validationErrors ?? undefined
          }
        });
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-034 — PUT /transfer-desk/formats/:id (update)
  router.put<{ Params: { id: string } }>(
    "/transfer-desk/formats/:id",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const db = prisma as unknown as PrismaClient;
        const existing = await db.transferFormat.findUnique({
          where: { id: request.params.id }
        });
        if (!existing) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "NOT_FOUND", message: "Format not found" }]
          });
        }
        if (existing.isSystem) {
          return reply.code(403).send({
            data: null,
            errors: [
              {
                code: "SYSTEM_FORMAT",
                message: "System formats cannot be modified. Clone to create a custom version."
              }
            ]
          });
        }

        const body = request.body as {
          name?: string;
          description?: string;
          classification?: string;
          fsdXml?: string;
          guiState?: unknown;
        };

        // Re-validate FSD if updated
        let isValid = existing.isValid;
        let validationErrors = existing.validationErrors;

        if (body.fsdXml) {
          let parsedFsd: unknown;
          try {
            parsedFsd = JSON.parse(body.fsdXml);
          } catch {
            return reply.code(400).send({
              data: null,
              errors: [{ code: "INVALID_FSD_JSON", message: "fsdXml is not valid JSON" }]
            });
          }

          isValid = true;
          validationErrors = null;
          try {
            const { parse } = await import("@hfp/fsd-engine");
            const result = parse(parsedFsd as any, "");
            if (result.errors.some((e: any) => e.code.startsWith("SCHEMA_"))) {
              isValid = false;
              validationErrors = result.errors.filter((e: any) => e.code.startsWith("SCHEMA_"));
            }
          } catch {
            isValid = false;
          }
        }

        const data = await db.transferFormat.update({
          where: { id: request.params.id },
          data: {
            ...(body.name ? { name: body.name.trim() } : {}),
            ...(body.description !== undefined
              ? { description: body.description?.trim() || null }
              : {}),
            ...(body.classification ? { classification: body.classification as any } : {}),
            ...(body.fsdXml
              ? {
                  fsdXml: body.fsdXml,
                  isValid,
                  validationErrors: (validationErrors ?? undefined) as any
                }
              : {}),
            ...(body.guiState !== undefined ? { guiState: body.guiState as any } : {})
          } as any
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ─── Transformation endpoints ──────────────────────────────────────────

  // TD-API-040 — GET /transfer-desk/transformations (list)
  router.get(
    "/transfer-desk/transformations",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const { sourceComponent, targetComponent } = request.query as {
          sourceComponent?: string;
          targetComponent?: string;
        };
        const data = await (prisma as unknown as PrismaClient).transferTransformation.findMany({
          where: {
            ...(sourceComponent ? { sourceComponent } : {}),
            ...(targetComponent ? { targetComponent } : {})
          },
          include: {
            sourceFormat: { select: { id: true, name: true, classification: true } },
            targetFormat: { select: { id: true, name: true, classification: true } },
            _count: { select: { profiles: true } }
          },
          orderBy: { updatedAt: "desc" }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-041 — GET /transfer-desk/transformations/:id (detail)
  router.get<{ Params: { id: string } }>(
    "/transfer-desk/transformations/:id",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const data = await (prisma as unknown as PrismaClient).transferTransformation.findUnique({
          where: { id: request.params.id },
          include: {
            sourceFormat: {
              select: { id: true, name: true, classification: true, fsdXml: true }
            },
            targetFormat: {
              select: { id: true, name: true, classification: true, fsdXml: true }
            },
            _count: { select: { profiles: true } }
          }
        });
        if (!data) {
          return reply.status(404).send({ error: "Transformation not found" });
        }
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-042 — POST /transfer-desk/transformations (create)
  router.post(
    "/transfer-desk/transformations",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const body = request.body as {
          name: string;
          description?: string;
          sourceFormatId?: string;
          targetFormatId?: string;
          sourceComponent?: string;
          targetComponent?: string;
          rulesJson?: unknown;
          functionsJson?: unknown;
        };

        if (!body.name?.trim()) {
          return reply.status(400).send({ error: "name is required" });
        }

        // Validate rulesJson if provided
        let isValid = false;
        let validationErrors: string[] | null = null;
        if (body.rulesJson) {
          try {
            const rules = Array.isArray(body.rulesJson)
              ? body.rulesJson
              : ((body.rulesJson as any).rules ?? []);
            isValid = rules.length > 0 && rules.every((r: any) => r.type && r.target);
          } catch {
            validationErrors = ["rulesJson is not valid"];
          }
        }

        const data = await (prisma as unknown as PrismaClient).transferTransformation.create({
          data: {
            name: body.name.trim(),
            description: body.description?.trim() || null,
            sourceFormatId: body.sourceFormatId || null,
            targetFormatId: body.targetFormatId || null,
            sourceComponent: body.sourceComponent || null,
            targetComponent: body.targetComponent || null,
            rulesJson: (body.rulesJson as any) ?? undefined,
            functionsJson: (body.functionsJson as any) ?? undefined,
            isValid,
            validationErrors: validationErrors ?? undefined
          },
          include: {
            sourceFormat: { select: { id: true, name: true, classification: true } },
            targetFormat: { select: { id: true, name: true, classification: true } }
          }
        });
        return reply.status(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-043 — PUT /transfer-desk/transformations/:id (update)
  router.put<{ Params: { id: string } }>(
    "/transfer-desk/transformations/:id",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const existing = await (
          prisma as unknown as PrismaClient
        ).transferTransformation.findUnique({
          where: { id: request.params.id }
        });
        if (!existing) {
          return reply.status(404).send({ error: "Transformation not found" });
        }
        if (existing.isSystem) {
          return reply.status(403).send({ error: "System transformations cannot be modified" });
        }

        const body = request.body as {
          name?: string;
          description?: string;
          sourceFormatId?: string;
          targetFormatId?: string;
          sourceComponent?: string;
          targetComponent?: string;
          rulesJson?: unknown;
          functionsJson?: unknown;
        };

        // Re-validate if rulesJson changed
        let isValid = existing.isValid;
        let validationErrors = existing.validationErrors;
        if (body.rulesJson !== undefined) {
          try {
            const rules = Array.isArray(body.rulesJson)
              ? body.rulesJson
              : ((body.rulesJson as any)?.rules ?? []);
            isValid = rules.length > 0 && rules.every((r: any) => r.type && r.target);
            validationErrors = null;
          } catch {
            isValid = false;
            validationErrors = ["rulesJson is not valid"] as any;
          }
        }

        const data = await (prisma as unknown as PrismaClient).transferTransformation.update({
          where: { id: request.params.id },
          data: {
            ...(body.name ? { name: body.name.trim() } : {}),
            ...(body.description !== undefined
              ? { description: body.description?.trim() || null }
              : {}),
            ...(body.sourceFormatId !== undefined
              ? { sourceFormatId: body.sourceFormatId || null }
              : {}),
            ...(body.targetFormatId !== undefined
              ? { targetFormatId: body.targetFormatId || null }
              : {}),
            ...(body.sourceComponent !== undefined
              ? { sourceComponent: body.sourceComponent || null }
              : {}),
            ...(body.targetComponent !== undefined
              ? { targetComponent: body.targetComponent || null }
              : {}),
            ...(body.rulesJson !== undefined
              ? {
                  rulesJson: body.rulesJson as any,
                  isValid,
                  validationErrors: validationErrors ?? undefined
                }
              : {}),
            ...(body.functionsJson !== undefined
              ? { functionsJson: body.functionsJson as any }
              : {})
          },
          include: {
            sourceFormat: { select: { id: true, name: true, classification: true } },
            targetFormat: { select: { id: true, name: true, classification: true } }
          }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ─── Automation endpoints ─────────────────────────────────────────────

  // TD-API-050 — GET /transfer-desk/automations (list)
  router.get(
    "/transfer-desk/automations",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const data = await (prisma as unknown as PrismaClient).transferAutomation.findMany({
          include: {
            steps: {
              select: { id: true, stepOrder: true, profileId: true, failOnError: true },
              orderBy: { stepOrder: "asc" }
            },
            schedules: {
              select: {
                id: true,
                cronExpression: true,
                timezone: true,
                isActive: true,
                nextRunAt: true
              }
            },
            _count: { select: { steps: true, schedules: true, executions: true } }
          },
          orderBy: { updatedAt: "desc" }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-051 — GET /transfer-desk/automations/:id (detail)
  router.get<{ Params: { id: string } }>(
    "/transfer-desk/automations/:id",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const data = await (prisma as unknown as PrismaClient).transferAutomation.findUnique({
          where: { id: request.params.id },
          include: {
            steps: {
              include: {
                profile: { select: { id: true, name: true, profileType: true } }
              },
              orderBy: { stepOrder: "asc" }
            },
            schedules: true,
            executions: {
              select: {
                id: true,
                status: true,
                startedAt: true,
                finishedAt: true,
                recordsTotal: true,
                recordsSucceeded: true,
                recordsFailed: true,
                errorMessage: true
              },
              orderBy: { createdAt: "desc" },
              take: 20
            }
          }
        });
        if (!data) {
          return reply.status(404).send({ error: "Automation not found" });
        }
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-052 — POST /transfer-desk/automations (create)
  router.post(
    "/transfer-desk/automations",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const body = request.body as {
          name: string;
          description?: string;
          steps?: Array<{
            profileId: string;
            stepOrder: number;
            failOnError?: boolean;
            sourceParamOverrides?: Record<string, unknown>;
            targetParamOverrides?: Record<string, unknown>;
          }>;
          schedules?: Array<{
            cronExpression: string;
            timezone?: string;
            isActive?: boolean;
            runAsUser?: string;
          }>;
        };

        if (!body.name?.trim()) {
          return reply.status(400).send({ error: "name is required" });
        }

        const data = await (prisma as unknown as PrismaClient).transferAutomation.create({
          data: {
            name: body.name.trim(),
            description: body.description?.trim() || null,
            isEnabled: true,
            steps: body.steps?.length
              ? {
                  create: body.steps.map((s) => ({
                    profileId: s.profileId,
                    stepOrder: s.stepOrder,
                    failOnError: s.failOnError ?? true,
                    sourceParamOverrides: (s.sourceParamOverrides ?? undefined) as any,
                    targetParamOverrides: (s.targetParamOverrides ?? undefined) as any
                  }))
                }
              : undefined,
            schedules: body.schedules?.length
              ? {
                  create: body.schedules.map((s) => ({
                    cronExpression: s.cronExpression,
                    timezone: s.timezone ?? "UTC",
                    isActive: s.isActive ?? true,
                    runAsUser: s.runAsUser ?? null
                  }))
                }
              : undefined
          } as any,
          include: {
            steps: {
              include: {
                profile: { select: { id: true, name: true, profileType: true } }
              },
              orderBy: { stepOrder: "asc" }
            },
            schedules: true
          }
        });
        return reply.status(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-053 — PUT /transfer-desk/automations/:id (update)
  router.put<{ Params: { id: string } }>(
    "/transfer-desk/automations/:id",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const existing = await (prisma as unknown as PrismaClient).transferAutomation.findUnique({
          where: { id: request.params.id }
        });
        if (!existing) {
          return reply.status(404).send({ error: "Automation not found" });
        }

        const body = request.body as {
          name?: string;
          description?: string;
          isEnabled?: boolean;
          steps?: Array<{
            id?: string;
            profileId: string;
            stepOrder: number;
            failOnError?: boolean;
            sourceParamOverrides?: Record<string, unknown>;
            targetParamOverrides?: Record<string, unknown>;
          }>;
          schedules?: Array<{
            id?: string;
            cronExpression: string;
            timezone?: string;
            isActive?: boolean;
            runAsUser?: string;
          }>;
        };

        // If steps provided, delete+recreate (simpler than upsert for ordered lists)
        if (body.steps) {
          await (prisma as unknown as PrismaClient).transferAutomationStep.deleteMany({
            where: { automationId: request.params.id }
          });
        }
        if (body.schedules) {
          await (prisma as unknown as PrismaClient).transferAutomationSchedule.deleteMany({
            where: { automationId: request.params.id }
          });
        }

        const data = await (prisma as unknown as PrismaClient).transferAutomation.update({
          where: { id: request.params.id },
          data: {
            ...(body.name ? { name: body.name.trim() } : {}),
            ...(body.description !== undefined
              ? { description: body.description?.trim() || null }
              : {}),
            ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
            ...(body.steps
              ? {
                  steps: {
                    create: body.steps.map((s) => ({
                      profileId: s.profileId,
                      stepOrder: s.stepOrder,
                      failOnError: s.failOnError ?? true,
                      sourceParamOverrides: (s.sourceParamOverrides ?? undefined) as any,
                      targetParamOverrides: (s.targetParamOverrides ?? undefined) as any
                    }))
                  }
                }
              : {}),
            ...(body.schedules
              ? {
                  schedules: {
                    create: body.schedules.map((s) => ({
                      cronExpression: s.cronExpression,
                      timezone: s.timezone ?? "UTC",
                      isActive: s.isActive ?? true,
                      runAsUser: s.runAsUser ?? null
                    }))
                  }
                }
              : {})
          } as any,
          include: {
            steps: {
              include: {
                profile: { select: { id: true, name: true, profileType: true } }
              },
              orderBy: { stepOrder: "asc" }
            },
            schedules: true
          }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-054 — DELETE /transfer-desk/automations/:id
  router.delete<{ Params: { id: string } }>(
    "/transfer-desk/automations/:id",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const existing = await (prisma as unknown as PrismaClient).transferAutomation.findUnique({
          where: { id: request.params.id }
        });
        if (!existing) {
          return reply.status(404).send({ error: "Automation not found" });
        }

        // Cascade delete steps and schedules
        await (prisma as unknown as PrismaClient).transferAutomationStep.deleteMany({
          where: { automationId: request.params.id }
        });
        await (prisma as unknown as PrismaClient).transferAutomationSchedule.deleteMany({
          where: { automationId: request.params.id }
        });
        await (prisma as unknown as PrismaClient).transferAutomation.delete({
          where: { id: request.params.id }
        });

        return reply.send({ data: { id: request.params.id, deleted: true }, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-055 — POST /transfer-desk/automations/:id/run (immediate execution)
  router.post<{ Params: { id: string } }>(
    "/transfer-desk/automations/:id/run",
    { preHandler: [requirePermission(["TRANSFER_DESK_EXECUTE", "INTEGRATION_IMPORT"])] },
    async (request, reply) => {
      try {
        const automation = await (prisma as unknown as PrismaClient).transferAutomation.findUnique({
          where: { id: request.params.id },
          include: {
            steps: {
              include: { profile: { select: { id: true, name: true } } },
              orderBy: { stepOrder: "asc" }
            }
          }
        });
        if (!automation) {
          return reply.status(404).send({ error: "Automation not found" });
        }
        if (automation.steps.length === 0) {
          return reply.status(400).send({ error: "Automation has no steps — nothing to execute" });
        }

        const body = (request.body as { runtimeParams?: Record<string, unknown> }) ?? {};

        // Create execution rows for each step and enqueue them
        const stepExecutions: Array<{
          stepOrder: number;
          executionId: string;
          profileId: string;
        }> = [];

        for (const step of automation.steps) {
          const execution = await (prisma as unknown as PrismaClient).transferExecution.create({
            data: {
              profileId: step.profileId,
              automationId: automation.id,
              automationStepOrder: step.stepOrder,
              status: "QUEUED",
              triggeredBy: (request as any).userId ?? "system",
              runtimeParams: (body.runtimeParams ?? undefined) as any
            }
          });
          stepExecutions.push({
            stepOrder: step.stepOrder,
            executionId: execution.id,
            profileId: step.profileId
          });
        }

        // Return immediately — the automation-engine will pick these up
        return reply.status(201).send({
          data: {
            automationId: automation.id,
            automationName: automation.name,
            stepsQueued: stepExecutions.length,
            stepExecutions
          },
          errors: []
        });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ─── Lookup Table endpoints ────────────────────────────────────────────

  // TD-API-060 — GET /transfer-desk/lookups (list)
  router.get(
    "/transfer-desk/lookups",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const data = await (prisma as unknown as PrismaClient).transferLookupTable.findMany({
          include: {
            _count: { select: { columns: true, rows: true } }
          },
          orderBy: { updatedAt: "desc" }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-061 — GET /transfer-desk/lookups/:id (detail with full data)
  router.get<{ Params: { id: string } }>(
    "/transfer-desk/lookups/:id",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const data = await (prisma as unknown as PrismaClient).transferLookupTable.findUnique({
          where: { id: request.params.id },
          include: {
            columns: { orderBy: { columnOrder: "asc" } },
            rows: {
              orderBy: { rowOrder: "asc" },
              include: {
                values: {
                  include: {
                    column: { select: { id: true, name: true } }
                  }
                }
              }
            }
          }
        });
        if (!data) {
          return reply.status(404).send({ error: "Lookup table not found" });
        }
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-062 — POST /transfer-desk/lookups (create)
  router.post(
    "/transfer-desk/lookups",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const body = request.body as {
          name: string;
          description?: string;
          columns?: Array<{ name: string; columnOrder: number }>;
        };

        if (!body.name?.trim()) {
          return reply.status(400).send({ error: "name is required" });
        }

        const data = await (prisma as unknown as PrismaClient).transferLookupTable.create({
          data: {
            name: body.name.trim(),
            description: body.description?.trim() || null,
            columns: body.columns?.length
              ? {
                  create: body.columns.map((c) => ({
                    name: c.name,
                    columnOrder: c.columnOrder
                  }))
                }
              : undefined
          },
          include: {
            columns: { orderBy: { columnOrder: "asc" } },
            _count: { select: { rows: true } }
          }
        });
        return reply.status(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-063 — PUT /transfer-desk/lookups/:id (update metadata + columns)
  router.put<{ Params: { id: string } }>(
    "/transfer-desk/lookups/:id",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const existing = await (prisma as unknown as PrismaClient).transferLookupTable.findUnique({
          where: { id: request.params.id }
        });
        if (!existing) {
          return reply.status(404).send({ error: "Lookup table not found" });
        }

        const body = request.body as {
          name?: string;
          description?: string;
          columns?: Array<{ id?: string; name: string; columnOrder: number }>;
        };

        // If columns provided, delete+recreate
        if (body.columns) {
          await (prisma as unknown as PrismaClient).transferLookupColumn.deleteMany({
            where: { tableId: request.params.id }
          });
        }

        const data = await (prisma as unknown as PrismaClient).transferLookupTable.update({
          where: { id: request.params.id },
          data: {
            ...(body.name ? { name: body.name.trim() } : {}),
            ...(body.description !== undefined
              ? { description: body.description?.trim() || null }
              : {}),
            ...(body.columns
              ? {
                  columns: {
                    create: body.columns.map((c) => ({
                      name: c.name,
                      columnOrder: c.columnOrder
                    }))
                  }
                }
              : {})
          },
          include: {
            columns: { orderBy: { columnOrder: "asc" } },
            _count: { select: { rows: true } }
          }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-064 — POST /transfer-desk/lookups/:id/rows (bulk upsert rows)
  router.post<{ Params: { id: string } }>(
    "/transfer-desk/lookups/:id/rows",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const tableId = request.params.id;
        const existing = await (prisma as unknown as PrismaClient).transferLookupTable.findUnique({
          where: { id: tableId }
        });
        if (!existing) {
          return reply.status(404).send({ error: "Lookup table not found" });
        }

        const body = request.body as {
          rows: Array<{
            id?: string;
            businessUnit?: string;
            rangeFrom?: string;
            rangeTo?: string;
            rowOrder: number;
            values: Array<{
              columnId: string;
              valueType: "CONSTANT" | "COPY" | "MAP_TO" | "OMIT" | "REVERSE_SIGN";
              valueParam?: string;
              isDefault?: boolean;
            }>;
          }>;
        };

        if (!body.rows) {
          return reply.status(400).send({ error: "rows array is required" });
        }

        // Delete existing rows + values, then recreate (atomic replace)
        await (prisma as unknown as PrismaClient).transferLookupValue.deleteMany({
          where: { row: { tableId } }
        });
        await (prisma as unknown as PrismaClient).transferLookupRow.deleteMany({
          where: { tableId }
        });

        // Create rows with nested values
        for (const row of body.rows) {
          await (prisma as unknown as PrismaClient).transferLookupRow.create({
            data: {
              tableId,
              businessUnit: row.businessUnit ?? null,
              rangeFrom: row.rangeFrom ?? "",
              rangeTo: row.rangeTo ?? "",
              rowOrder: row.rowOrder,
              values: {
                create: row.values.map((v) => ({
                  columnId: v.columnId,
                  valueType: v.valueType,
                  valueParam: v.valueParam ?? null,
                  isDefault: v.isDefault ?? false
                }))
              }
            }
          });
        }

        // Return updated table
        const data = await (prisma as unknown as PrismaClient).transferLookupTable.findUnique({
          where: { id: tableId },
          include: {
            columns: { orderBy: { columnOrder: "asc" } },
            rows: {
              orderBy: { rowOrder: "asc" },
              include: { values: true }
            }
          }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-065 — DELETE /transfer-desk/lookups/:id
  router.delete<{ Params: { id: string } }>(
    "/transfer-desk/lookups/:id",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const existing = await (prisma as unknown as PrismaClient).transferLookupTable.findUnique({
          where: { id: request.params.id }
        });
        if (!existing) {
          return reply.status(404).send({ error: "Lookup table not found" });
        }

        // Cascade: values → rows → columns → table
        await (prisma as unknown as PrismaClient).transferLookupValue.deleteMany({
          where: { row: { tableId: request.params.id } }
        });
        await (prisma as unknown as PrismaClient).transferLookupRow.deleteMany({
          where: { tableId: request.params.id }
        });
        await (prisma as unknown as PrismaClient).transferLookupColumn.deleteMany({
          where: { tableId: request.params.id }
        });
        await (prisma as unknown as PrismaClient).transferLookupTable.delete({
          where: { id: request.params.id }
        });

        return reply.send({ data: { id: request.params.id, deleted: true }, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-066 — POST /transfer-desk/lookups/:id/import-csv
  router.post<{ Params: { id: string } }>(
    "/transfer-desk/lookups/:id/import-csv",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const tableId = request.params.id;
        const existing = await (prisma as unknown as PrismaClient).transferLookupTable.findUnique({
          where: { id: tableId },
          include: { columns: { orderBy: { columnOrder: "asc" } } }
        });
        if (!existing) {
          return reply.status(404).send({ error: "Lookup table not found" });
        }

        const body = request.body as { csvContent: string; hasHeader?: boolean };
        if (!body.csvContent?.trim()) {
          return reply.status(400).send({ error: "csvContent is required" });
        }

        // Parse CSV
        const lines = body.csvContent.trim().split("\n");
        const startIdx = body.hasHeader !== false ? 1 : 0; // skip header by default
        const columnMap = new Map(existing.columns.map((c: any) => [c.columnOrder, c.id]));

        // Clear existing rows
        await (prisma as unknown as PrismaClient).transferLookupValue.deleteMany({
          where: { row: { tableId } }
        });
        await (prisma as unknown as PrismaClient).transferLookupRow.deleteMany({
          where: { tableId }
        });

        let imported = 0;
        for (let i = startIdx; i < lines.length; i++) {
          const cells = lines[i]!.split(",").map((c) => c.trim());
          // First 3 cells: businessUnit, rangeFrom, rangeTo (metadata columns)
          // Remaining cells map to lookup columns by order
          const row = await (prisma as unknown as PrismaClient).transferLookupRow.create({
            data: {
              tableId,
              businessUnit: cells[0] || null,
              rangeFrom: cells[1] || "",
              rangeTo: cells[2] || "",
              rowOrder: i - startIdx
            }
          });

          // Create values for each column
          for (let colIdx = 0; colIdx < existing.columns.length; colIdx++) {
            const columnId = columnMap.get(colIdx);
            const cellValue = cells[3 + colIdx] ?? "";
            if (columnId) {
              await (prisma as unknown as PrismaClient).transferLookupValue.create({
                data: {
                  rowId: row.id,
                  columnId,
                  valueType: "CONSTANT",
                  valueParam: cellValue || null,
                  isDefault: false
                }
              });
            }
          }
          imported++;
        }

        return reply.send({
          data: { tableId, rowsImported: imported },
          errors: []
        });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ── Profile CRUD (TD-API-009..016) ──────────────────────────────────────

  // TD-API-009 — GET /transfer-desk/profiles (list)
  router.get(
    "/transfer-desk/profiles",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const { profileType, isActive, isSystem } = request.query as {
          profileType?: string;
          isActive?: string;
          isSystem?: string;
        };
        const data = await (prisma as unknown as PrismaClient).transferProfile.findMany({
          where: {
            ...(profileType ? { profileType: profileType as any } : {}),
            ...(isActive !== undefined ? { isActive: isActive === "true" } : {}),
            ...(isSystem !== undefined ? { isSystem: isSystem === "true" } : {})
          },
          orderBy: [{ profileType: "asc" }, { name: "asc" }],
          include: {
            sourceFormat: { select: { id: true, name: true, classification: true } },
            targetFormat: { select: { id: true, name: true, classification: true } },
            transformation: { select: { id: true, name: true } },
            _count: { select: { executions: true, versions: true } }
          }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-010 — GET /transfer-desk/profiles/:id (detail)
  router.get<{ Params: { id: string } }>(
    "/transfer-desk/profiles/:id",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const data = await (prisma as unknown as PrismaClient).transferProfile.findUnique({
          where: { id: request.params.id },
          include: {
            sourceFormat: true,
            targetFormat: true,
            transformation: { select: { id: true, name: true, scriptType: true } },
            filter: { select: { id: true, name: true } },
            versions: {
              select: {
                id: true,
                version: true,
                changedBy: true,
                changedAt: true,
                changeNote: true
              },
              orderBy: { version: "desc" },
              take: 10
            }
          }
        });
        if (!data) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "NOT_FOUND", message: "Profile not found" }]
          });
        }
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-011 — POST /transfer-desk/profiles (create)
  router.post(
    "/transfer-desk/profiles",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const payload = profileCreateSchema.parse(request.body);
        const validationErrors = validateProfileShape(payload);
        const db = prisma as unknown as PrismaClient;
        const created = await db.transferProfile.create({
          data: {
            name: payload.name,
            description: payload.description,
            profileType: payload.profileType as any,
            sourceComponent: payload.sourceComponent,
            targetComponent: payload.targetComponent,
            sourceFormatId: payload.sourceFormatId,
            targetFormatId: payload.targetFormatId,
            transformationId: payload.transformationId,
            filterId: payload.filterId,
            sourceParams: payload.sourceParams as any,
            targetParams: payload.targetParams as any,
            savePayload: (payload.savePayload ?? "NONE") as any,
            isValid: validationErrors.length === 0,
            createdById: (request.user as { sub?: string } | undefined)?.sub
          }
        });
        // Snapshot v1
        await db.transferProfileVersion.create({
          data: {
            profileId: created.id,
            version: 1,
            snapshot: created as any,
            changedBy: (request.user as { sub?: string } | undefined)?.sub,
            changeNote: "Initial version"
          }
        });
        return reply.code(201).send({ data: { ...created, validationErrors }, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-012 — PUT /transfer-desk/profiles/:id (update, creates a new version row)
  router.put<{ Params: { id: string } }>(
    "/transfer-desk/profiles/:id",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const payload = profileCreateSchema.partial().parse(request.body);
        const db = prisma as unknown as PrismaClient;
        const existing = await db.transferProfile.findUnique({
          where: { id: request.params.id }
        });
        if (!existing) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "NOT_FOUND", message: "Profile not found" }]
          });
        }
        const merged = {
          ...existing,
          ...payload,
          sourceParams: (payload.sourceParams ?? existing.sourceParams) as any,
          targetParams: (payload.targetParams ?? existing.targetParams) as any
        };
        const validationErrors = validateProfileShape(merged as ProfileCreateInput);
        const updated = await db.transferProfile.update({
          where: { id: request.params.id },
          data: {
            name: payload.name,
            description: payload.description,
            profileType: payload.profileType as any,
            sourceComponent: payload.sourceComponent,
            targetComponent: payload.targetComponent,
            sourceFormatId: payload.sourceFormatId,
            targetFormatId: payload.targetFormatId,
            transformationId: payload.transformationId,
            filterId: payload.filterId,
            sourceParams: payload.sourceParams as any,
            targetParams: payload.targetParams as any,
            savePayload: payload.savePayload as any,
            isValid: validationErrors.length === 0,
            version: { increment: 1 }
          }
        });
        await db.transferProfileVersion.create({
          data: {
            profileId: updated.id,
            version: updated.version,
            snapshot: updated as any,
            changedBy: (request.user as { sub?: string } | undefined)?.sub,
            changeNote: "Updated"
          }
        });
        return reply.send({ data: { ...updated, validationErrors }, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-013 — DELETE /transfer-desk/profiles/:id (soft delete via isActive=false)
  router.delete<{ Params: { id: string } }>(
    "/transfer-desk/profiles/:id",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const existing = await (prisma as unknown as PrismaClient).transferProfile.findUnique({
          where: { id: request.params.id }
        });
        if (!existing) {
          return reply.status(404).send({ error: "Profile not found" });
        }
        if ((existing as any).isSystem) {
          return reply.status(403).send({ error: "System profiles cannot be deleted" });
        }
        const updated = await (prisma as unknown as PrismaClient).transferProfile.update({
          where: { id: request.params.id },
          data: { isActive: false }
        });
        return reply.send({ data: { id: updated.id, isActive: false }, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-014 — POST /transfer-desk/profiles/:id/clone
  router.post<{ Params: { id: string }; Body: { newName: string } }>(
    "/transfer-desk/profiles/:id/clone",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const { newName } = request.body ?? ({ newName: "" } as { newName: string });
        if (!newName || newName.length < 1 || newName.length > 100) {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "VALIDATION_ERROR", message: "newName is required (1-100 chars)" }]
          });
        }
        const db = prisma as unknown as PrismaClient;
        const src = await db.transferProfile.findUnique({ where: { id: request.params.id } });
        if (!src) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "NOT_FOUND", message: "Profile not found" }]
          });
        }
        const clone = await db.transferProfile.create({
          data: {
            name: newName,
            description: src.description,
            profileType: src.profileType,
            sourceComponent: src.sourceComponent,
            targetComponent: src.targetComponent,
            sourceFormatId: src.sourceFormatId,
            targetFormatId: src.targetFormatId,
            transformationId: src.transformationId,
            filterId: src.filterId,
            sourceParams: src.sourceParams as any,
            targetParams: src.targetParams as any,
            savePayload: src.savePayload,
            isValid: src.isValid,
            version: 1,
            isActive: true,
            createdById: (request.user as { sub?: string } | undefined)?.sub
          }
        });
        return reply.code(201).send({ data: clone, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-015 — GET /transfer-desk/profiles/:id/versions
  router.get<{ Params: { id: string } }>(
    "/transfer-desk/profiles/:id/versions",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const data = await (prisma as unknown as PrismaClient).transferProfileVersion.findMany({
          where: { profileId: request.params.id },
          orderBy: { version: "desc" }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-016 — POST /transfer-desk/profiles/:id/validate
  router.post<{ Params: { id: string } }>(
    "/transfer-desk/profiles/:id/validate",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const profile = await (prisma as unknown as PrismaClient).transferProfile.findUnique({
          where: { id: request.params.id }
        });
        if (!profile) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "NOT_FOUND", message: "Profile not found" }]
          });
        }
        const errors = validateProfileShape(profile as unknown as ProfileCreateInput);
        // Persist the result on the profile
        if (profile.isValid !== (errors.length === 0)) {
          await (prisma as unknown as PrismaClient).transferProfile.update({
            where: { id: profile.id },
            data: { isValid: errors.length === 0 }
          });
        }
        return reply.send({
          data: { valid: errors.length === 0, errors, warnings: [] },
          errors: []
        });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ── Execution (TD-API-001..006) ─────────────────────────────────────────

  // TD-API-001 — POST /transfer-desk/profiles/:id/execute
  router.post<{ Params: { id: string } }>(
    "/transfer-desk/profiles/:id/execute",
    {
      preHandler: [requirePermission(["TRANSFER_DESK_EXECUTE", "INTEGRATION_IMPORT"])],
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
      try {
        const payload = executeProfileSchema.parse(request.body ?? {});
        const db = prisma as unknown as PrismaClient;

        // 1. Load + validate profile
        const profile = await db.transferProfile.findUnique({
          where: { id: request.params.id }
        });
        if (!profile) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "NOT_FOUND", message: "Profile not found" }]
          });
        }
        if (!profile.isActive) {
          return reply.code(409).send({
            data: null,
            errors: [{ code: "PROFILE_INACTIVE", message: "Profile is deactivated" }]
          });
        }
        if (!profile.isValid) {
          return reply.code(409).send({
            data: null,
            errors: [
              {
                code: "PROFILE_INVALID",
                message:
                  "Profile failed validation (TD-BL-006). Run POST /profiles/:id/validate to see errors."
              }
            ]
          });
        }

        // 2. Create execution row (status=QUEUED)
        const runtimeParams = {
          sourceParamOverrides: payload.sourceParamOverrides ?? {},
          targetParamOverrides: payload.targetParamOverrides ?? {},
          hasInlineInput: Boolean(payload.inputContent)
        };
        const execution = await db.transferExecution.create({
          data: {
            profileId: profile.id,
            status: "QUEUED",
            triggeredBy: (request.user as { sub?: string } | undefined)?.sub,
            runtimeParams: runtimeParams as any
          }
        });

        // 3. Look up tenant DB URL for the worker
        const tenantSlug = request.tenantSlug;
        if (!tenantSlug) {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "TENANT_REQUIRED", message: "Tenant context missing" }]
          });
        }
        const tenantRecord = await resolveTenant(tenantSlug);
        if (!tenantRecord) {
          return reply.code(500).send({
            data: null,
            errors: [{ code: "TENANT_NOT_FOUND", message: "Tenant not resolvable from registry" }]
          });
        }

        // 4. Enqueue the job; the transfer-desk worker process picks it up (OPS-10)
        const jobId = await enqueueTransferDeskExecution({
          tenantSlug,
          executionId: execution.id,
          profileId: profile.id
        });

        // Persist the job ID on the execution row for cancel lookup
        await db.transferExecution.update({
          where: { id: execution.id },
          data: { jobId }
        });

        return reply.code(202).send({
          data: {
            executionId: execution.id,
            jobId,
            status: "QUEUED"
          },
          errors: []
        });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-002 — GET /transfer-desk/executions (list)
  router.get(
    "/transfer-desk/executions",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const { profileId, status, limit, offset } = request.query as {
          profileId?: string;
          status?: string;
          limit?: string;
          offset?: string;
        };
        const take = Math.min(Number(limit) || 50, 200);
        const skip = Math.min(Number(offset) || 0, 100000);
        const data = await (prisma as unknown as PrismaClient).transferExecution.findMany({
          where: {
            ...(profileId ? { profileId } : {}),
            ...(status ? { status: status as any } : {})
          },
          orderBy: { createdAt: "desc" },
          take,
          skip,
          include: {
            profile: { select: { id: true, name: true, profileType: true } },
            automation: { select: { id: true, name: true } }
          }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-003 — GET /transfer-desk/executions/:id (detail)
  router.get<{ Params: { id: string } }>(
    "/transfer-desk/executions/:id",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const data = await (prisma as unknown as PrismaClient).transferExecution.findUnique({
          where: { id: request.params.id },
          include: {
            profile: true,
            automation: { select: { id: true, name: true } }
          }
        });
        if (!data) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "NOT_FOUND", message: "Execution not found" }]
          });
        }
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-004 — GET /transfer-desk/executions/:id/logs (record-level logs)
  router.get<{ Params: { id: string } }>(
    "/transfer-desk/executions/:id/logs",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (request, reply) => {
      try {
        const { limit, offset, statusFilter } = request.query as {
          limit?: string;
          offset?: string;
          statusFilter?: string;
        };
        const take = Math.min(Number(limit) || 100, 1000);
        const skip = Math.min(Number(offset) || 0, 1000000);
        const db = prisma as unknown as PrismaClient;
        const [rows, total] = await Promise.all([
          db.transferExecutionLog.findMany({
            where: {
              executionId: request.params.id,
              ...(statusFilter ? { status: statusFilter as any } : {})
            },
            orderBy: { recordIndex: "asc" },
            take,
            skip
          }),
          db.transferExecutionLog.count({
            where: {
              executionId: request.params.id,
              ...(statusFilter ? { status: statusFilter as any } : {})
            }
          })
        ]);
        // BigInt can't be serialized by default — coerce the autoinc id to string
        const serialized = rows.map((r) => ({ ...r, id: r.id.toString() }));
        return reply.send({ data: { rows: serialized, total, take, skip }, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // TD-API-006 — POST /transfer-desk/executions/:id/cancel
  router.post<{ Params: { id: string } }>(
    "/transfer-desk/executions/:id/cancel",
    { preHandler: [requirePermission(["TRANSFER_DESK_EXECUTE", "INTEGRATION_IMPORT"])] },
    async (request, reply) => {
      try {
        const db = prisma as unknown as PrismaClient;
        const execution = await db.transferExecution.findUnique({
          where: { id: request.params.id }
        });
        if (!execution) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "NOT_FOUND", message: "Execution not found" }]
          });
        }
        if (execution.status !== "QUEUED" && execution.status !== "RUNNING") {
          return reply.code(409).send({
            data: null,
            errors: [
              {
                code: "NOT_CANCELLABLE",
                message: `Execution is ${execution.status}, cannot be cancelled`
              }
            ]
          });
        }

        // Best-effort: try to yank the BullMQ job
        const tenantSlug = request.tenantSlug;
        if (tenantSlug) {
          try {
            await cancelTransferDeskExecution(tenantSlug, execution.id);
          } catch {
            // Worker may have already progressed; we still flip the DB row below
          }
        }

        const updated = await db.transferExecution.update({
          where: { id: execution.id },
          data: {
            status: "CANCELLED",
            finishedAt: new Date(),
            errorMessage: "Cancelled by user"
          }
        });
        return reply.send({ data: updated, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ── Filter CRUD (TD-API-017..020) ───────────────────────────────────────

  router.get(
    "/transfer-desk/filters",
    { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
    async (_request, reply) => {
      try {
        const data = await (prisma as unknown as PrismaClient).transferFilter.findMany({
          orderBy: [{ sourceComponent: "asc" }, { name: "asc" }],
          include: { _count: { select: { profiles: true } } }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.post(
    "/transfer-desk/filters",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const payload = filterSchema.parse(request.body);
        const data = await (prisma as unknown as PrismaClient).transferFilter.create({
          data: {
            name: payload.name,
            description: payload.description,
            sourceComponent: payload.sourceComponent,
            filterClauses: payload.filterClauses as any,
            createdById: (request.user as { sub?: string } | undefined)?.sub
          }
        });
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.put<{ Params: { id: string } }>(
    "/transfer-desk/filters/:id",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        const payload = filterSchema.partial().parse(request.body);
        const data = await (prisma as unknown as PrismaClient).transferFilter.update({
          where: { id: request.params.id },
          data: {
            name: payload.name,
            description: payload.description,
            sourceComponent: payload.sourceComponent,
            filterClauses: payload.filterClauses as any
          }
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.delete<{ Params: { id: string } }>(
    "/transfer-desk/filters/:id",
    { preHandler: [requirePermission(["TRANSFER_DESK_CONFIG", "INTEGRATION_CONFIG"])] },
    async (request, reply) => {
      try {
        // Reject if any active profile references this filter
        const refs = await (prisma as unknown as PrismaClient).transferProfile.count({
          where: { filterId: request.params.id }
        });
        if (refs > 0) {
          return reply.code(409).send({
            data: null,
            errors: [
              {
                code: "FILTER_IN_USE",
                message: `Cannot delete: ${refs} profile(s) reference this filter`
              }
            ]
          });
        }
        await (prisma as unknown as PrismaClient).transferFilter.delete({
          where: { id: request.params.id }
        });
        return reply.send({ data: { deleted: true }, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );
}
