import type { FastifyInstance, FastifyReply } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { PrismaClient } from "../../db/client.js";
import { z, ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import {
  runOperaCloudImport,
  importOperaSUNFile
} from "./connectors/opera-cloud/opera-cloud-import-job.js";
import { runSkyJanaSync } from "./connectors/sky-jana/sky-jana-sync-job.js";
import { importBankStatement } from "./connectors/bank/bank-statement-importer.js";
import {
  getReconciliationSummary,
  getUnreconciledTransactions,
  findMatchCandidates,
  matchTransaction,
  unmatchTransaction,
  autoMatchStatement,
  ReconciliationServiceError
} from "./connectors/bank/reconciliation-service.js";
import {
  previewSAFFile,
  getAccountMapping,
  executeSAFImport,
  type GroupingStrategy
} from "./connectors/saf/saf-import-service.js";
import {
  importInvoiceBatch,
  importJournalBatch,
  syncSupplierBatch
} from "./connectors/inbound/inbound-service.js";
import {
  inboundInvoiceBatchSchema,
  inboundJournalBatchSchema,
  inboundSupplierBatchSchema,
  inboundFileImportSchema,
  inboundInvoiceSchema,
  inboundJournalSchema
} from "./connectors/inbound/inbound-types.js";
import { runSimphonyImport } from "./connectors/simphony/simphony-import-job.js";
import { runMewsImport } from "./connectors/mews/mews-import-job.js";
import { importPayrollBatch, importPayrollFile } from "./connectors/payroll/payroll-service.js";
import { payrollBatchSchema, payrollFileUploadSchema } from "./connectors/payroll/payroll-types.js";
import { getOperaCloudCredentials } from "./connectors/opera-cloud/opera-cloud-auth.js";
import { OperaCloudClient } from "./connectors/opera-cloud/opera-cloud-client.js";
import {
  parseSourceData,
  runTransformEngine,
  applyTransform as engineApplyTransform,
  ALL_SOURCE_FORMATS,
  ALL_CONNECTOR_TYPES,
  ALL_SOURCE_TYPES,
  ALL_TRANSFORMS,
  GL_JOURNAL_TARGET_FIELDS,
  AP_INVOICE_TARGET_FIELDS,
  SUPPLIER_SYNC_TARGET_FIELDS,
  type FieldMappingRule as EngineFieldMappingRule,
  type ParseOptions
} from "./transform-engine.js";

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
    });
  }
  if (error instanceof ReconciliationServiceError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({ data: null, errors: [{ code: "INTERNAL_SERVER_ERROR", message }] });
}

function requireEntityId(entityId: string | undefined): string {
  if (!entityId) throw new Error("X-Entity-ID header is required.");
  return entityId;
}

// ── Interface Definition schemas ─────────────────────────────────────────────

// All possible target fields across GL, AP, and Supplier targets
const ALL_TARGET_FIELDS = [
  // GL Journal
  "postingDate",
  "accountCode",
  "debitAmount",
  "creditAmount",
  "currency",
  "reference",
  "lineDescription",
  "dimension1",
  "dimension2",
  "dimension3",
  "dimension4",
  "dimension5",
  "dimension6",
  // AP Invoice
  "supplierCode",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "grossAmount",
  "taxAmount",
  "netAmount",
  "lineAmount",
  "lineGLAccountCode",
  "lineTaxCode",
  "lineCostCentre",
  "lineDepartment",
  "externalPoRef",
  "paymentTerms",
  // Supplier Sync
  "code",
  "name",
  "taxId",
  "paymentTermsDays",
  "bankAccountName",
  "bankAccountNumber",
  "bankRoutingCode",
  "bankSwiftCode",
  "isActive",
  "contactEmail",
  "contactPhone",
  "address"
] as const;

const fieldMappingRuleSchema = z.object({
  targetField: z.enum(ALL_TARGET_FIELDS),
  sourceType: z.enum(["CONSTANT", "COLUMN", "LOOKUP", "FORMULA", "EXPRESSION", "CONDITIONAL"]),
  sourceValue: z.string().min(1),
  transform: z
    .enum([
      "NONE",
      "UPPERCASE",
      "LOWERCASE",
      "TRIM",
      "ABS",
      "NEGATE",
      "ROUND",
      "SUBSTRING",
      "LEFT",
      "RIGHT",
      "PAD_LEFT",
      "PAD_RIGHT",
      "REPLACE",
      "SPLIT",
      "CONCAT",
      "DATE_FORMAT",
      "DATE_PARSE",
      "MULTIPLY",
      "DIVIDE",
      "ADD",
      "MAP_VALUE",
      "STRIP_NON_NUMERIC",
      "DEFAULT_IF_EMPTY"
    ])
    .optional(),
  transformArg: z.string().optional(),
  defaultValue: z.string().optional(),
  required: z.boolean().default(false)
});

const interfaceDefinitionCreateSchema = z.object({
  name: z.string().min(1).max(100),
  connectorType: z.enum([
    "OPERA_CLOUD",
    "OPERA_SUN",
    "SIMPHONY_POS",
    "MEWS_PMS",
    "SKY_JANA",
    "BANK",
    "PAYROLL",
    "PROCUREMENT",
    "CUSTOM"
  ]),
  sourceFormat: z.enum(["CSV", "JSON", "XML", "MT940", "FIXED_WIDTH", "EXCEL", "SAF"]),
  targetType: z.enum(["GL_JOURNAL", "AP_INVOICE", "SUPPLIER_SYNC"]).default("GL_JOURNAL"),
  description: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
  fieldMappings: z.array(fieldMappingRuleSchema).min(1).max(100),
  parseOptions: z
    .object({
      delimiter: z.string().max(5).optional(),
      hasHeader: z.boolean().optional(),
      skipRows: z.number().int().min(0).max(100).optional(),
      dateFormat: z.string().max(20).optional(),
      decimalSeparator: z.string().max(1).optional(),
      xmlRowTag: z.string().max(50).optional(),
      fixedWidthColumns: z
        .array(
          z.object({
            name: z.string().min(1),
            start: z.number().int().min(0),
            length: z.number().int().min(1)
          })
        )
        .optional(),
      filterRules: z
        .array(
          z.object({
            column: z.string().min(1),
            operator: z.enum([
              "EQUALS",
              "NOT_EQUALS",
              "CONTAINS",
              "STARTS_WITH",
              "GT",
              "LT",
              "NOT_EMPTY"
            ]),
            value: z.string()
          })
        )
        .optional(),
      groupBy: z.array(z.string()).optional()
    })
    .optional()
});

const interfaceDefinitionUpdateSchema = interfaceDefinitionCreateSchema.partial();

const previewDraftSchema = z.object({
  sourceFormat: z.enum(["CSV", "JSON", "XML", "MT940", "FIXED_WIDTH", "EXCEL", "SAF"]),
  connectorType: z.string().optional(),
  fieldMappings: z.array(fieldMappingRuleSchema).min(1),
  sampleData: z.string().min(1).max(500_000),
  delimiter: z.string().max(5).optional(),
  hasHeader: z.boolean().optional(),
  skipRows: z.number().int().min(0).max(100).optional(),
  maxRows: z.coerce.number().int().min(1).max(200).optional(),
  xmlRowTag: z.string().max(50).optional(),
  fixedWidthColumns: z
    .array(
      z.object({
        name: z.string().min(1),
        start: z.number().int().min(0),
        length: z.number().int().min(1)
      })
    )
    .optional(),
  filterRules: z
    .array(
      z.object({
        column: z.string().min(1),
        operator: z.enum([
          "EQUALS",
          "NOT_EQUALS",
          "CONTAINS",
          "STARTS_WITH",
          "GT",
          "LT",
          "NOT_EMPTY"
        ]),
        value: z.string()
      })
    )
    .optional(),
  groupBy: z.array(z.string()).optional()
});

// ── Preview engine — delegates to transform-engine.ts ────────────────────────

type FieldMappingRule = EngineFieldMappingRule;

function parseRows(
  sampleData: string,
  sourceFormat: string,
  delimiter = ",",
  hasHeader = true,
  parseOpts?: ParseOptions
): Record<string, string>[] {
  return parseSourceData(sampleData, sourceFormat as any, {
    delimiter,
    hasHeader,
    ...parseOpts
  });
}

async function runPreviewEngine(
  prismaClient: PrismaClient,
  entityId: string,
  connectorType: string,
  fieldMappings: FieldMappingRule[],
  rows: Record<string, string>[],
  parseOpts?: ParseOptions
) {
  return runTransformEngine(prismaClient, entityId, connectorType, fieldMappings, rows, parseOpts);
}

// ── Validation schemas ───────────────────────────────────────────────────────

const operaImportSchema = z.object({
  hotelId: z.string().min(1),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  notifyEmail: z.string().email().optional()
});

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

// ── Router ──────────────────────────────────────────────────────────────────

export async function registerIntegrationRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireWriteAccess);

      await router.register(rateLimit, { max: 10, timeWindow: "1 minute" });

      // ── Opera Cloud ─────────────────────────────────────────────────────────

      router.post("/opera-cloud/import", async (request, reply) => {
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
      });

      router.get("/opera-cloud/logs", async (request, reply) => {
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
      });

      // ── Sky Jana ────────────────────────────────────────────────────────────

      router.post("/sky-jana/sync", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await runSkyJanaSync(prisma as unknown as PrismaClient, entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Bank Feeds ──────────────────────────────────────────────────────────

      router.post("/bank/import", async (request, reply) => {
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
      });

      router.get("/bank/statements", async (request, reply) => {
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
      });

      router.get<{ Params: { statementId: string } }>(
        "/bank/statements/:statementId/transactions",
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

      // ── Connector Mappings ──────────────────────────────────────────────────

      router.get("/mappings", async (request, reply) => {
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
      });

      router.post("/mappings", async (request, reply) => {
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
      });

      router.delete<{ Params: { id: string } }>("/mappings/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          await (prisma as unknown as PrismaClient).connectorMapping.deleteMany({
            where: { id: request.params.id, entityId }
          });
          return reply.code(204).send();
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Transfer Desk Metadata ─────────────────────────────────────────────

      router.get("/transfer-desk/metadata", async (_request, reply) => {
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
      });

      // ── Transfer Desk: Component schemas (UI-API-003) ────────────────────────
      //
      // Lists the HFP components a Transfer Desk profile can read from or
      // write to, with each component's field schema. Used by the profile
      // creation wizard's source/target component dropdowns.
      //
      // Per spec exclusions, this list does NOT include Item Master, Purchase
      // Order, Supplier master, or any inventory/sales order entities — those
      // are owned by Sky Jana MMS. HFP only receives journals from those
      // systems and writes them into its GL.
      router.get("/transfer-desk/components", async (_request, reply) => {
        const components = [
          {
            name: "GL_JOURNAL",
            label: "General Ledger Journal",
            description:
              "GL journal headers and lines. The most common target for journal imports.",
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
            description:
              "Customer invoices issued by HFP. Source for receipt allocation and aging.",
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
                description:
                  "Account type (ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE, STATISTICAL)"
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
      });

      // ── Transfer Desk: Profile CRUD (TD-API-009..016) ────────────────────────
      //
      // Reads (list + detail) are available to any authenticated user via the
      // normal auth gate. Writes require ADMIN/SUPERADMIN (maps to
      // transfer:designer per QW4).

      const profileCreateSchema = z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        profileType: z.enum([
          "IMPORT",
          "EXPORT",
          "PROCESS",
          "INTERNAL_TRANSFER",
          "EXTERNAL_TRANSFER"
        ]),
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

      /**
       * Profile-type-specific validation. Returns a list of error messages;
       * empty array means valid.
       *
       * Per spec:
       *   TD-BL-002 Import: target_component mandatory; source_format_id required if non-SSML
       *   TD-BL-003 Export: source_component mandatory; target_format_id required if non-SSML
       *   TD-BL-004 Process: target_component mandatory; no file params required
       *   TD-BL-005 transformation_id always mandatory (a same-format default exists but
       *             the reference must still be set)
       */
      function validateProfileShape(p: ProfileCreateInput): string[] {
        const errors: string[] = [];
        if (!p.transformationId) {
          errors.push("transformationId is required (TD-BL-005)");
        }
        switch (p.profileType) {
          case "IMPORT":
            if (!p.targetComponent)
              errors.push("Import profiles require targetComponent (TD-BL-002)");
            break;
          case "EXPORT":
            if (!p.sourceComponent)
              errors.push("Export profiles require sourceComponent (TD-BL-003)");
            break;
          case "PROCESS":
            if (!p.targetComponent)
              errors.push("Process profiles require targetComponent (TD-BL-004)");
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

      // TD-API-009 — GET /transfer-desk/profiles (list)
      router.get("/transfer-desk/profiles", async (request, reply) => {
        try {
          const { profileType, isActive } = request.query as {
            profileType?: string;
            isActive?: string;
          };
          const data = await (prisma as unknown as PrismaClient).transferProfile.findMany({
            where: {
              ...(profileType ? { profileType: profileType as any } : {}),
              ...(isActive !== undefined ? { isActive: isActive === "true" } : {})
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
      });

      // TD-API-010 — GET /transfer-desk/profiles/:id (detail)
      router.get<{ Params: { id: string } }>(
        "/transfer-desk/profiles/:id",
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
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
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
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
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
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
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
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
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

      // ── Transfer Desk: Filter CRUD (TD-API-017..020) ─────────────────────────

      const filterSchema = z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        sourceComponent: z.string().min(1),
        filterClauses: z.record(z.unknown())
      });

      router.get("/transfer-desk/filters", async (_request, reply) => {
        try {
          const data = await (prisma as unknown as PrismaClient).transferFilter.findMany({
            orderBy: [{ sourceComponent: "asc" }, { name: "asc" }],
            include: { _count: { select: { profiles: true } } }
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post(
        "/transfer-desk/filters",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
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
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
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
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
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

      // ── Interface Definitions (Transfer Desk) ────────────────────────────────

      router.get("/interfaces", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const { connectorType } = request.query as { connectorType?: string };
          const data = await (prisma as unknown as PrismaClient).interfaceDefinition.findMany({
            where: { entityId, ...(connectorType ? { connectorType } : {}) },
            orderBy: [{ connectorType: "asc" }, { name: "asc" }]
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/interfaces", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = interfaceDefinitionCreateSchema.parse(request.body);
          const data = await (prisma as unknown as PrismaClient).interfaceDefinition.create({
            data: {
              entityId,
              name: payload.name,
              connectorType: payload.connectorType,
              sourceFormat: payload.sourceFormat,
              targetType: payload.targetType ?? "GL_JOURNAL",
              description: payload.description,
              isActive: payload.isActive,
              fieldMappings:
                payload.fieldMappings as unknown as import("../../db/client.js").Prisma.InputJsonValue,
              parseOptions:
                (payload.parseOptions as unknown as import("../../db/client.js").Prisma.InputJsonValue) ??
                undefined
            }
          });
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/interfaces/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await (prisma as unknown as PrismaClient).interfaceDefinition.findFirst({
            where: { entityId, id: request.params.id }
          });
          if (!data)
            return reply.code(404).send({
              data: null,
              errors: [{ code: "NOT_FOUND", message: "Interface definition not found." }]
            });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put<{ Params: { id: string } }>("/interfaces/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = interfaceDefinitionUpdateSchema.parse(request.body);
          const existing = await (prisma as unknown as PrismaClient).interfaceDefinition.findFirst({
            where: { entityId, id: request.params.id }
          });
          if (!existing)
            return reply.code(404).send({
              data: null,
              errors: [{ code: "NOT_FOUND", message: "Interface definition not found." }]
            });
          const updateData: Record<string, unknown> = {};
          if (payload.name !== undefined) updateData.name = payload.name;
          if (payload.connectorType !== undefined) updateData.connectorType = payload.connectorType;
          if (payload.sourceFormat !== undefined) updateData.sourceFormat = payload.sourceFormat;
          if (payload.targetType !== undefined) updateData.targetType = payload.targetType;
          if (payload.description !== undefined) updateData.description = payload.description;
          if (payload.isActive !== undefined) updateData.isActive = payload.isActive;
          if (payload.fieldMappings)
            updateData.fieldMappings =
              payload.fieldMappings as unknown as import("../../db/client.js").Prisma.InputJsonValue;
          if (payload.parseOptions !== undefined)
            updateData.parseOptions =
              payload.parseOptions as unknown as import("../../db/client.js").Prisma.InputJsonValue;

          const data = await (prisma as unknown as PrismaClient).interfaceDefinition.update({
            where: { id: request.params.id },
            data: updateData
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.delete<{ Params: { id: string } }>("/interfaces/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          await (prisma as unknown as PrismaClient).interfaceDefinition.deleteMany({
            where: { entityId, id: request.params.id }
          });
          return reply.code(204).send();
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/interfaces/preview-draft", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = previewDraftSchema.parse(request.body);
          const parseOpts: ParseOptions = {
            delimiter: payload.delimiter ?? ",",
            hasHeader: payload.hasHeader ?? true,
            skipRows: payload.skipRows ?? 0,
            maxRows: payload.maxRows ?? 50,
            xmlRowTag: payload.xmlRowTag,
            fixedWidthColumns: payload.fixedWidthColumns,
            filterRules: payload.filterRules,
            groupBy: payload.groupBy
          };

          const rows = parseRows(
            payload.sampleData,
            payload.sourceFormat,
            parseOpts.delimiter,
            parseOpts.hasHeader,
            parseOpts
          );

          const connectorType = payload.connectorType ?? "CUSTOM";
          const result = await runPreviewEngine(
            prisma as unknown as PrismaClient,
            entityId,
            connectorType,
            payload.fieldMappings as FieldMappingRule[],
            rows,
            parseOpts
          );
          return reply.send({ data: result, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post<{ Params: { id: string } }>("/interfaces/:id/preview", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const { sampleData, maxRows } = request.body as { sampleData: string; maxRows?: number };
          const def = await (prisma as unknown as PrismaClient).interfaceDefinition.findFirst({
            where: { entityId, id: request.params.id }
          });
          if (!def)
            return reply.code(404).send({
              data: null,
              errors: [{ code: "NOT_FOUND", message: "Interface definition not found." }]
            });
          const rows = parseRows(sampleData, def.sourceFormat).slice(0, maxRows ?? 10);
          const result = await runPreviewEngine(
            prisma as unknown as PrismaClient,
            entityId,
            def.connectorType,
            def.fieldMappings as unknown as FieldMappingRule[],
            rows
          );
          return reply.send({ data: result, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Interface Execute (create GL journals from file using an interface def)
      const interfaceExecuteSchema = z.object({
        fileContent: z.string().min(1),
        autoPost: z.boolean().default(false),
        reference: z.string().max(50).optional(),
        periodId: z.string().uuid().optional()
      });

      router.post<{ Params: { id: string } }>("/interfaces/:id/execute", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = interfaceExecuteSchema.parse(request.body);
          const def = await (prisma as unknown as PrismaClient).interfaceDefinition.findFirst({
            where: { entityId, id: request.params.id }
          });
          if (!def)
            return reply.code(404).send({
              data: null,
              errors: [{ code: "NOT_FOUND", message: "Interface definition not found." }]
            });
          if (!def.isActive)
            return reply.code(422).send({
              data: null,
              errors: [{ code: "INACTIVE", message: "Interface definition is inactive." }]
            });

          // Parse and transform all rows using saved parseOptions
          const savedParseOpts = (def as any).parseOptions as ParseOptions | null;
          const rows = parseRows(
            payload.fileContent,
            def.sourceFormat,
            savedParseOpts?.delimiter ?? ",",
            savedParseOpts?.hasHeader ?? true,
            savedParseOpts ?? undefined
          );
          if (rows.length === 0) {
            return reply.code(422).send({
              data: null,
              errors: [{ code: "EMPTY_FILE", message: "No data rows found in the file." }]
            });
          }

          const previewResult = await runPreviewEngine(
            prisma as unknown as PrismaClient,
            entityId,
            def.connectorType,
            def.fieldMappings as unknown as FieldMappingRule[],
            rows,
            savedParseOpts ?? undefined
          );

          if (previewResult.mappedRows.length === 0) {
            return reply.code(422).send({
              data: null,
              errors: [
                { code: "NO_MAPPED_ROWS", message: "Transformation produced no mapped rows." }
              ]
            });
          }

          // Find open period — use explicit periodId, or posting date from file, then current month, then any open
          let period: {
            id: string;
            entityId: string;
            year: number;
            month: number;
            name: string;
            status: string;
          } | null = null;

          // 0. Explicit periodId from payload
          if (payload.periodId) {
            period = await (prisma as unknown as PrismaClient).period.findFirst({
              where: { entityId, id: payload.periodId, status: "OPEN" }
            });
            if (!period) {
              return reply.code(422).send({
                data: null,
                errors: [{ code: "PERIOD_NOT_OPEN", message: "Selected period is not open." }]
              });
            }
          }

          // 1. Try posting date from first mapped row
          if (!period) {
            const firstPostingDate = previewResult.mappedRows[0]?.postingDate;
            if (firstPostingDate) {
              const pd = new Date(firstPostingDate);
              if (!isNaN(pd.getTime())) {
                period = await (prisma as unknown as PrismaClient).period.findFirst({
                  where: {
                    entityId,
                    status: "OPEN",
                    year: pd.getFullYear(),
                    month: pd.getMonth() + 1
                  }
                });
              }
            }
          }

          // 2. Try current month
          if (!period) {
            const now = new Date();
            period = await (prisma as unknown as PrismaClient).period.findFirst({
              where: {
                entityId,
                status: "OPEN",
                year: now.getFullYear(),
                month: now.getMonth() + 1
              }
            });
          }

          // 3. Fall back to any open period (most recent)
          if (!period) {
            period = await (prisma as unknown as PrismaClient).period.findFirst({
              where: { entityId, status: "OPEN" },
              orderBy: [{ year: "desc" }, { month: "desc" }]
            });
          }

          if (!period) {
            return reply.code(422).send({
              data: null,
              errors: [
                {
                  code: "NO_OPEN_PERIOD",
                  message: "No open accounting period found. Open a period first via Periods page."
                }
              ]
            });
          }

          // Find entity user
          const entityUser = await (prisma as unknown as PrismaClient).entityUser.findFirst({
            where: { entityId }
          });
          if (!entityUser) {
            return reply.code(422).send({
              data: null,
              errors: [{ code: "NO_USER", message: "No entity user found." }]
            });
          }

          // Resolve account codes to IDs
          const accountCodes = new Set<string>();
          for (const row of previewResult.mappedRows) {
            if (row.accountCode) accountCodes.add(row.accountCode);
          }
          const accounts = await (prisma as unknown as PrismaClient).account.findMany({
            where: { entityId, code: { in: Array.from(accountCodes) } },
            select: { id: true, code: true }
          });
          const accountCodeToId = new Map(
            accounts.map((a: { id: string; code: string }) => [a.code, a.id])
          );

          // Build journal lines
          const journalLines: Array<{
            accountId: string;
            debit: import("../../db/client.js").Prisma.Decimal;
            credit: import("../../db/client.js").Prisma.Decimal;
            currency: string;
            fxRate: import("../../db/client.js").Prisma.Decimal;
            debitFunctional: import("../../db/client.js").Prisma.Decimal;
            creditFunctional: import("../../db/client.js").Prisma.Decimal;
            description: string;
            lineNumber: number;
            dimension1?: string;
            dimension2?: string;
            dimension3?: string;
            dimension4?: string;
            dimension5?: string;
            dimension6?: string;
          }> = [];

          const { Prisma: PrismaTypes } = await import("../../db/client.js");
          const unmappedCodes: string[] = [];
          let lineNum = 1;

          for (const row of previewResult.mappedRows) {
            const code = row.accountCode;
            if (!code) continue;
            const accountId = accountCodeToId.get(code);
            if (!accountId) {
              unmappedCodes.push(code);
              continue;
            }

            const debit = new PrismaTypes.Decimal(row.debitAmount ?? "0");
            const credit = new PrismaTypes.Decimal(row.creditAmount ?? "0");
            const currency = row.currency ?? "USD";

            journalLines.push({
              accountId,
              debit,
              credit,
              currency,
              fxRate: new PrismaTypes.Decimal(1),
              debitFunctional: debit,
              creditFunctional: credit,
              description: row.lineDescription ?? `${def.name} import`,
              lineNumber: lineNum++,
              dimension1: row.dimension1 ?? undefined,
              dimension2: row.dimension2 ?? undefined,
              dimension3: row.dimension3 ?? undefined,
              dimension4: row.dimension4 ?? undefined,
              dimension5: row.dimension5 ?? undefined,
              dimension6: row.dimension6 ?? undefined
            });
          }

          if (journalLines.length === 0) {
            return reply.code(422).send({
              data: null,
              errors: [
                {
                  code: "NO_VALID_LINES",
                  message: `No valid journal lines. ${unmappedCodes.length} unmapped account codes: ${unmappedCodes.join(", ")}`
                }
              ]
            });
          }

          const refPrefix =
            payload.reference ?? `TD-${def.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 15)}`;
          const status = payload.autoPost ? "POSTED" : "DRAFT";

          const journal = await (prisma as unknown as PrismaClient).journal.create({
            data: {
              entityId,
              periodId: period.id,
              reference: `${refPrefix}-${Date.now().toString(36).toUpperCase()}`,
              description: `Transfer Desk import: ${def.name}`,
              functionalCurrency: journalLines[0]?.currency ?? "USD",
              source: (def.connectorType === "PMS"
                ? "PMS"
                : def.connectorType === "POS"
                  ? "POS"
                  : "MANUAL") as any,
              status: status as any,
              postedAt: payload.autoPost ? new Date() : undefined,
              createdById: entityUser.userId,
              lines: { create: journalLines }
            },
            include: { lines: true }
          });

          // Update account balances if auto-posted
          if (payload.autoPost) {
            for (const line of journal.lines) {
              await (prisma as unknown as PrismaClient).accountPeriodBalance.upsert({
                where: {
                  entityId_accountId_periodId: {
                    entityId,
                    accountId: line.accountId,
                    periodId: period.id
                  }
                },
                create: {
                  entityId,
                  accountId: line.accountId,
                  periodId: period.id,
                  openingBalance: new PrismaTypes.Decimal(0),
                  periodDebits: line.debitFunctional,
                  periodCredits: line.creditFunctional,
                  closingBalance: line.debitFunctional.sub(line.creditFunctional)
                },
                update: {
                  periodDebits: { increment: line.debitFunctional },
                  periodCredits: { increment: line.creditFunctional },
                  closingBalance: { increment: line.debitFunctional.sub(line.creditFunctional) }
                }
              });
            }
          }

          return reply.code(201).send({
            data: {
              journalId: journal.id,
              reference: journal.reference,
              status: journal.status,
              periodName: period.name,
              linesCreated: journal.lines.length,
              unmappedCodes,
              totalRows: previewResult.mappedRows.length,
              previewErrors: previewResult.errors.length
            },
            errors: []
          });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── SAF File Import (Jana .txt / Opera .SUN / generic SAF) ──────────────

      router.post("/import/saf/preview", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const { fileContent, filename } = request.body as {
            fileContent: string;
            filename?: string;
          };
          if (!fileContent)
            return reply.code(400).send({
              data: null,
              errors: [{ code: "MISSING_FILE", message: "fileContent is required" }]
            });
          const data = previewSAFFile(fileContent, filename);

          // Enrich with entity currency info and FX rate
          const entity = await (prisma as unknown as PrismaClient).entity.findUnique({
            where: { id: entityId },
            select: { functionalCurrency: true, reportingCurrency: true }
          });
          const fileCurrency = data.currency ?? entity?.functionalCurrency ?? "USD";
          const baseCurrency = entity?.functionalCurrency ?? "USD";
          const reportingCurrency = entity?.reportingCurrency ?? "USD";

          // Look up FX rate from file currency → reporting currency (if different)
          let fxRate: string | null = null;
          let fxRateDate: string | null = null;
          if (fileCurrency.toUpperCase() !== reportingCurrency.toUpperCase()) {
            const rate = await (prisma as unknown as PrismaClient).fXRate.findFirst({
              where: {
                fromCurrency: fileCurrency.toUpperCase(),
                toCurrency: reportingCurrency.toUpperCase()
              },
              orderBy: { effectiveDate: "desc" }
            });
            if (rate) {
              fxRate = rate.rate.toString();
              fxRateDate = rate.effectiveDate.toISOString().substring(0, 10);
            }
          }

          return reply.send({
            data: {
              ...data,
              baseCurrency,
              reportingCurrency,
              fileCurrency,
              fxRate,
              fxRateDate
            },
            errors: []
          });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/import/saf/account-mapping", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const { fileContent, filename } = request.body as {
            fileContent: string;
            filename?: string;
          };
          if (!fileContent)
            return reply.code(400).send({
              data: null,
              errors: [{ code: "MISSING_FILE", message: "fileContent is required" }]
            });
          const data = await getAccountMapping(
            prisma as unknown as PrismaClient,
            entityId,
            fileContent,
            filename
          );
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      const safExecuteSchema = z.object({
        fileContent: z.string().min(1),
        filename: z.string().min(1).max(255),
        groupingStrategy: z
          .enum(["single_entry", "by_reference", "by_journal_type"])
          .default("by_reference"),
        autoPost: z.boolean().default(false),
        autoCreateAccounts: z.boolean().default(true),
        sourceModule: z.string().min(1).max(20).default("PROC"),
        descriptionPrefix: z.string().max(100).default("SAF Import"),
        departmentMapping: z.record(z.string()).optional()
      });

      router.post("/import/saf/execute", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = safExecuteSchema.parse(request.body);
          const data = await executeSAFImport(prisma as unknown as PrismaClient, {
            entityId,
            ...payload
          });
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Opera .SUN File Import ──────────────────────────────────────────────

      router.post("/opera-sun/import", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const { fileContent, filename, notifyEmail } = request.body as {
            fileContent: string;
            filename: string;
            notifyEmail?: string;
          };
          if (!fileContent || !filename) {
            return reply.code(400).send({
              data: null,
              errors: [{ code: "MISSING_FIELDS", message: "fileContent and filename are required" }]
            });
          }
          const data = await importOperaSUNFile(prisma as unknown as PrismaClient, {
            entityId,
            fileContent,
            filename,
            notifyEmail
          });
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ══════════════════════════════════════════════════════════════════════════
      // ── Inbound Integration API (external systems → HFP) ────────────────────
      // ══════════════════════════════════════════════════════════════════════════

      // ── API: Import AP Invoices ─────────────────────────────────────────────
      router.post("/inbound/invoices", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const batch = inboundInvoiceBatchSchema.parse(request.body);
          const data = await importInvoiceBatch(prisma as unknown as PrismaClient, entityId, batch);
          const status = data.errors.length > 0 && data.created === 0 ? 422 : 201;
          return reply.code(status).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── API: Import GL Journals ─────────────────────────────────────────────
      router.post("/inbound/journals", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const batch = inboundJournalBatchSchema.parse(request.body);
          const data = await importJournalBatch(prisma as unknown as PrismaClient, entityId, batch);
          const status = data.errors.length > 0 && data.created === 0 ? 422 : 201;
          return reply.code(status).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── API: Sync Suppliers ─────────────────────────────────────────────────
      router.post("/inbound/suppliers", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const batch = inboundSupplierBatchSchema.parse(request.body);
          const data = await syncSupplierBatch(prisma as unknown as PrismaClient, entityId, batch);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── File Import: JSON batch upload (invoices or journals) ───────────────
      // Same data format as the API endpoints, but wrapped in a file upload body.
      // Use this for manual imports when the external system can't call APIs directly.
      router.post("/inbound/file-import", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = inboundFileImportSchema.parse(request.body);

          let parsed: unknown;
          try {
            parsed = JSON.parse(payload.fileContent);
          } catch {
            return reply.code(400).send({
              data: null,
              errors: [{ code: "INVALID_JSON", message: "fileContent is not valid JSON." }]
            });
          }

          if (!Array.isArray(parsed)) {
            return reply.code(400).send({
              data: null,
              errors: [{ code: "INVALID_FORMAT", message: "fileContent must be a JSON array." }]
            });
          }

          if (payload.dataType === "invoices") {
            // Validate each invoice against schema
            const invoices = [];
            const validationErrors: Array<{ index: number; message: string }> = [];
            for (let i = 0; i < parsed.length; i++) {
              const result = inboundInvoiceSchema.safeParse(parsed[i]);
              if (result.success) {
                invoices.push(result.data);
              } else {
                validationErrors.push({
                  index: i,
                  message: result.error.issues.map((iss) => iss.message).join("; ")
                });
              }
            }

            if (invoices.length === 0) {
              return reply.code(422).send({
                data: {
                  batchRef: payload.batchRef,
                  created: 0,
                  skipped: parsed.length,
                  errors: validationErrors,
                  createdIds: [],
                  duplicateRefs: []
                },
                errors: []
              });
            }

            const data = await importInvoiceBatch(prisma as unknown as PrismaClient, entityId, {
              sourceSystem: payload.sourceSystem,
              batchRef: payload.batchRef,
              autoPost: payload.autoPost,
              invoices
            });
            // Merge validation errors
            data.errors = [...validationErrors, ...data.errors];
            data.skipped += validationErrors.length;
            return reply.code(201).send({ data, errors: [] });
          } else {
            // journals
            const journals = [];
            const validationErrors: Array<{ index: number; message: string }> = [];
            for (let i = 0; i < parsed.length; i++) {
              const result = inboundJournalSchema.safeParse(parsed[i]);
              if (result.success) {
                journals.push(result.data);
              } else {
                validationErrors.push({
                  index: i,
                  message: result.error.issues.map((iss) => iss.message).join("; ")
                });
              }
            }

            if (journals.length === 0) {
              return reply.code(422).send({
                data: {
                  batchRef: payload.batchRef,
                  created: 0,
                  skipped: parsed.length,
                  errors: validationErrors,
                  createdIds: [],
                  duplicateRefs: []
                },
                errors: []
              });
            }

            const data = await importJournalBatch(prisma as unknown as PrismaClient, entityId, {
              sourceSystem: payload.sourceSystem,
              batchRef: payload.batchRef,
              autoPost: payload.autoPost,
              journals
            });
            data.errors = [...validationErrors, ...data.errors];
            data.skipped += validationErrors.length;
            return reply.code(201).send({ data, errors: [] });
          }
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Simphony POS (OHIP) ──────────────────────────────────────────────────

      router.post("/simphony/import", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const body = z
            .object({
              locationId: z.string().min(1),
              businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              notifyEmail: z.string().email().optional()
            })
            .parse(request.body);

          const data = await runSimphonyImport(prisma as unknown as PrismaClient, {
            entityId,
            locationId: body.locationId,
            businessDate: body.businessDate,
            notifyEmail: body.notifyEmail
          });
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get("/simphony/logs", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const logs = await prisma.importLog.findMany({
            where: { entityId, connectorType: "SIMPHONY_POS" },
            orderBy: { createdAt: "desc" },
            take: 200
          });
          return reply.send({ data: logs, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Opera PMS Enhanced (OHIP) ────────────────────────────────────────────

      router.get("/opera-cloud/statistics", async (request, reply) => {
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

          // Optionally save to PMSStatistic table
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

          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get("/opera-cloud/cashier-report", async (request, reply) => {
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
      });

      router.get("/opera-cloud/city-ledger", async (request, reply) => {
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
      });

      // ── Payroll Integration ──────────────────────────────────────────────────

      router.post("/payroll/import", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const batch = payrollBatchSchema.parse(request.body);
          const data = await importPayrollBatch(prisma as unknown as PrismaClient, entityId, batch);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/payroll/import-file", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = payrollFileUploadSchema.parse(request.body);
          const data = await importPayrollFile(
            prisma as unknown as PrismaClient,
            entityId,
            payload.file,
            payload.filename,
            payload.postingDate,
            payload.currency,
            payload.autoPost
          );
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get("/payroll/logs", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const logs = await prisma.importLog.findMany({
            where: { entityId, connectorType: "PAYROLL" },
            orderBy: { createdAt: "desc" },
            take: 200
          });
          return reply.send({ data: logs, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Mews PMS ────────────────────────────────────────────────────────────

      router.post("/mews/import", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const body = z
            .object({
              startUtc: z.string().min(1),
              endUtc: z.string().min(1),
              notifyEmail: z.string().email().optional()
            })
            .parse(request.body);

          const data = await runMewsImport(prisma as unknown as PrismaClient, {
            entityId,
            startUtc: body.startUtc,
            endUtc: body.endUtc,
            notifyEmail: body.notifyEmail
          });
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get("/mews/logs", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const logs = await prisma.importLog.findMany({
            where: { entityId, connectorType: "MEWS_PMS" },
            orderBy: { createdAt: "desc" },
            take: 200
          });
          return reply.send({ data: logs, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });
    },
    { prefix: "/api/v1/integration" }
  );
}
