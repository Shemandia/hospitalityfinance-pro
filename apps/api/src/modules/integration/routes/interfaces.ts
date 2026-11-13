import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import type { PrismaClient } from "../../../db/client.js";
import { z } from "zod";
import { prisma } from "../../../db/prisma.js";
import { requirePermission } from "../../../middleware/requirePermission.js";
import {
  parseSourceData,
  runTransformEngine,
  type FieldMappingRule as EngineFieldMappingRule,
  type ParseOptions
} from "../transform-engine.js";
import { mapError, requireEntityId } from "./_shared.js";
import {
  getOrCreateSuspenseAccount,
  computeImbalance,
  suspensePlugSides,
  assertBalanced
} from "../connectors/shared/suspense.js";

import { applyBalanceDelta } from "../../../db/balance-writer.js";
import { entityActor } from "../../access/actor.js";
// ── Interface Definition schemas ─────────────────────────────────────────────

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

const interfaceExecuteSchema = z.object({
  fileContent: z.string().min(1),
  autoPost: z.boolean().default(false),
  reference: z.string().max(50).optional(),
  periodId: z.string().uuid().optional()
});

// ── Preview engine helpers ──────────────────────────────────────────────────

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

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerInterfaceRoutes(router: FastifyInstance) {
  router.get(
    "/interfaces",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
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
    }
  );

  router.post(
    "/interfaces",
    { preHandler: [requirePermission("INTEGRATION_CONFIG")] },
    async (request, reply) => {
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
              payload.fieldMappings as unknown as import("../../../db/client.js").Prisma.InputJsonValue,
            parseOptions:
              (payload.parseOptions as unknown as import("../../../db/client.js").Prisma.InputJsonValue) ??
              undefined
          }
        });
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.get<{ Params: { id: string } }>(
    "/interfaces/:id",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
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
    }
  );

  router.put<{ Params: { id: string } }>(
    "/interfaces/:id",
    { preHandler: [requirePermission("INTEGRATION_CONFIG")] },
    async (request, reply) => {
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
            payload.fieldMappings as unknown as import("../../../db/client.js").Prisma.InputJsonValue;
        if (payload.parseOptions !== undefined)
          updateData.parseOptions =
            payload.parseOptions as unknown as import("../../../db/client.js").Prisma.InputJsonValue;

        const data = await (prisma as unknown as PrismaClient).interfaceDefinition.update({
          where: { id: request.params.id },
          data: updateData
        });
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.delete<{ Params: { id: string } }>(
    "/interfaces/:id",
    { preHandler: [requirePermission("INTEGRATION_CONFIG")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        await (prisma as unknown as PrismaClient).interfaceDefinition.deleteMany({
          where: { entityId, id: request.params.id }
        });
        return reply.code(204).send();
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.post(
    "/interfaces/preview-draft",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
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
    }
  );

  router.post<{ Params: { id: string } }>(
    "/interfaces/:id/preview",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
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
    }
  );

  // ── Interface Execute (create GL journals from file using an interface def)
  router.post<{ Params: { id: string } }>(
    "/interfaces/:id/execute",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
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
            errors: [{ code: "NO_MAPPED_ROWS", message: "Transformation produced no mapped rows." }]
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

        // The user recorded as the journal's creator
        const actor = await entityActor(prisma as unknown as PrismaClient, entityId);
        if (!actor) {
          return reply.code(422).send({
            data: null,
            errors: [{ code: "NO_USER", message: "No user holds a role at this entity." }]
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
          debit: import("../../../db/client.js").Prisma.Decimal;
          credit: import("../../../db/client.js").Prisma.Decimal;
          currency: string;
          fxRate: import("../../../db/client.js").Prisma.Decimal;
          debitFunctional: import("../../../db/client.js").Prisma.Decimal;
          creditFunctional: import("../../../db/client.js").Prisma.Decimal;
          description: string;
          lineNumber: number;
          dimension1?: string;
          dimension2?: string;
          dimension3?: string;
          dimension4?: string;
          dimension5?: string;
          dimension6?: string;
        }> = [];

        const { Prisma: PrismaTypes } = await import("../../../db/client.js");
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

        // F2: unmapped account codes are dropped above, which can leave the
        // journal unbalanced — and this path can post directly. Park any residual
        // in Import Suspense so the journal always balances.
        const plug = suspensePlugSides(computeImbalance(journalLines));
        if (plug) {
          const suspense = await getOrCreateSuspenseAccount(
            prisma as unknown as PrismaClient,
            entityId
          );
          journalLines.push({
            accountId: suspense.id,
            debit: plug.debit,
            credit: plug.credit,
            currency: journalLines[0]?.currency ?? "USD",
            fxRate: new PrismaTypes.Decimal(1),
            debitFunctional: plug.debit,
            creditFunctional: plug.credit,
            description: `Import suspense — ${unmappedCodes.length} unmapped account code(s)`,
            lineNumber: lineNum++
          });
        }
        assertBalanced(journalLines, `Transfer Desk journal ${def.name}`);

        const refPrefix =
          payload.reference ?? `TD-${def.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 15)}`;
        const status = payload.autoPost ? "POSTED" : "DRAFT";

        // F21: deterministic reference derived from the interface + file content,
        // so re-running the SAME file is idempotent rather than creating a fresh
        // duplicate journal every time (previously `${refPrefix}-${Date.now()}`,
        // which was unique on every call).
        const contentHash = createHash("sha256")
          .update(`${def.id}:${payload.fileContent}`)
          .digest("hex")
          .slice(0, 16);
        const journalRef = `${refPrefix}-${contentHash}`;

        const duplicate = await (prisma as unknown as PrismaClient).journal.findFirst({
          where: { entityId, reference: journalRef, status: { not: "REVERSED" } },
          select: { id: true, reference: true, status: true }
        });
        if (duplicate) {
          return reply.code(200).send({
            data: {
              journalId: duplicate.id,
              reference: duplicate.reference,
              status: duplicate.status,
              alreadyImported: true,
              message:
                "This file was already imported for this interface (idempotent no-op). " +
                "Reverse the existing journal to re-import corrected data."
            },
            errors: []
          });
        }

        const journal = await (prisma as unknown as PrismaClient).journal.create({
          data: {
            entityId,
            periodId: period.id,
            reference: journalRef,
            description: `Transfer Desk import: ${def.name}`,
            functionalCurrency: journalLines[0]?.currency ?? "USD",
            source: (def.connectorType === "PMS"
              ? "PMS"
              : def.connectorType === "POS"
                ? "POS"
                : "MANUAL") as any,
            status: status as any,
            postedAt: payload.autoPost ? new Date() : undefined,
            createdById: actor.userId,
            lines: { create: journalLines }
          },
          include: { lines: true }
        });

        // Update account balances if auto-posted
        if (payload.autoPost) {
          for (const line of journal.lines) {
            // Canonical signed writer — this used to write `debit - credit`
            // unsigned, moving every credit-normal account the wrong way.
            await applyBalanceDelta(
              prisma as unknown as PrismaClient,
              entityId,
              period.id,
              line.accountId,
              line.debitFunctional,
              line.creditFunctional
            );
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
    }
  );
}
