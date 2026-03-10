import type { FastifyInstance, FastifyReply } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { PrismaClient } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { runOperaCloudImport, importOperaSUNFile } from "./connectors/opera-cloud/opera-cloud-import-job.js";
import { runSkyJanaSync } from "./connectors/sky-jana/sky-jana-sync-job.js";
import { importBankStatement } from "./connectors/bank/bank-statement-importer.js";
import {
  previewSAFFile,
  getAccountMapping,
  executeSAFImport,
  type GroupingStrategy,
} from "./connectors/saf/saf-import-service.js";

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
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

const TARGET_FIELDS = [
  "postingDate", "accountCode", "debitAmount", "creditAmount",
  "currency", "reference", "lineDescription",
  "dimension1", "dimension2", "dimension3", "dimension4", "dimension5", "dimension6"
] as const;

const fieldMappingRuleSchema = z.object({
  targetField:  z.enum(TARGET_FIELDS),
  sourceType:   z.enum(["CONSTANT", "COLUMN", "LOOKUP", "FORMULA"]),
  sourceValue:  z.string().min(1),
  transform:    z.enum(["NONE", "UPPERCASE", "LOWERCASE", "ABS", "NEGATE", "DATE_FORMAT"]).optional(),
  transformArg: z.string().optional(),
  defaultValue: z.string().optional(),
  required:     z.boolean().default(false)
});

const interfaceDefinitionCreateSchema = z.object({
  name:          z.string().min(1).max(100),
  connectorType: z.enum(["OPERA_CLOUD", "OPERA_SUN", "SKY_JANA", "BANK", "CUSTOM"]),
  sourceFormat:  z.enum(["CSV", "JSON", "XML", "MT940", "FIXED_WIDTH", "SAF"]),
  description:   z.string().max(500).optional(),
  isActive:      z.boolean().default(true),
  fieldMappings: z.array(fieldMappingRuleSchema).min(1).max(50)
});

const interfaceDefinitionUpdateSchema = interfaceDefinitionCreateSchema.partial();

const previewDraftSchema = z.object({
  sourceFormat:  z.enum(["CSV", "JSON", "XML", "MT940", "FIXED_WIDTH", "SAF"]),
  fieldMappings: z.array(fieldMappingRuleSchema).min(1),
  sampleData:    z.string().min(1).max(100_000),
  delimiter:     z.string().max(1).optional(),
  hasHeader:     z.boolean().optional(),
  maxRows:       z.coerce.number().int().min(1).max(50).optional()
});

// ── Preview engine (server-side) ──────────────────────────────────────────────

type FieldMappingRule = {
  targetField: string;
  sourceType: "CONSTANT" | "COLUMN" | "LOOKUP" | "FORMULA";
  sourceValue: string;
  transform?: string;
  transformArg?: string;
  defaultValue?: string;
  required?: boolean;
};

function applyTransform(value: string, transform?: string, arg?: string): string {
  if (!transform || transform === "NONE") return value;
  if (transform === "UPPERCASE") return value.toUpperCase();
  if (transform === "LOWERCASE") return value.toLowerCase();
  if (transform === "ABS") return String(Math.abs(Number(value)));
  if (transform === "NEGATE") return String(-Number(value));
  if (transform === "DATE_FORMAT" && arg) {
    // Simple ISO → display format
    try {
      const d = new Date(value);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    } catch { /* ignore */ }
  }
  return value;
}

function parseCSVRows(text: string, delimiter = ",", hasHeader = true): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = hasHeader ? lines[0].split(delimiter).map((h) => h.trim()) : lines[0].split(delimiter).map((_, i) => `col${i}`);
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows = dataLines.map((line) => {
    const cells = line.split(delimiter);
    return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
  return { headers, rows };
}

function parseRows(
  sampleData: string,
  sourceFormat: string,
  delimiter = ",",
  hasHeader = true
): Record<string, string>[] {
  if (sourceFormat === "CSV") {
    return parseCSVRows(sampleData, delimiter, hasHeader).rows;
  }
  if (sourceFormat === "JSON") {
    try {
      const parsed = JSON.parse(sampleData);
      return Array.isArray(parsed) ? parsed.map((r) => {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) flat[k] = String(v);
        return flat;
      }) : [Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))];
    } catch { return []; }
  }
  return [];
}

async function runPreviewEngine(
  prismaClient: PrismaClient,
  entityId: string,
  connectorType: string,
  fieldMappings: FieldMappingRule[],
  rows: Record<string, string>[]
) {
  // Collect all LOOKUP source values to resolve in one query
  const lookupKeys = fieldMappings
    .filter((fm) => fm.sourceType === "LOOKUP")
    .map((fm) => fm.sourceValue);

  const connectorMappings = lookupKeys.length > 0
    ? await prismaClient.connectorMapping.findMany({
        where: { entityId, connectorType },
        include: { glAccount: { select: { code: true, name: true } } }
      })
    : [];

  const lookupMap = new Map(connectorMappings.map((m) => [m.sourceCode, m.glAccount?.code ?? null]));

  const mappedRows: Array<Record<string, string | null>> = [];
  const errors: Array<{ row: number; field: string; message: string }> = [];
  const unmappedLookups = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const mapped: Record<string, string | null> = {};

    for (const rule of fieldMappings) {
      let value: string | null = null;

      if (rule.sourceType === "CONSTANT") {
        value = rule.sourceValue;
      } else if (rule.sourceType === "COLUMN") {
        value = row[rule.sourceValue] ?? rule.defaultValue ?? null;
        if (value === null || value === "") {
          if (rule.required) errors.push({ row: i + 1, field: rule.targetField, message: `Column "${rule.sourceValue}" is empty or missing` });
          value = rule.defaultValue ?? null;
        }
      } else if (rule.sourceType === "LOOKUP") {
        const sourceKey = row[rule.sourceValue] ?? "";
        const resolved = lookupMap.get(sourceKey) ?? null;
        if (resolved === null) {
          unmappedLookups.add(sourceKey);
          value = rule.defaultValue ?? null;
        } else {
          value = resolved;
        }
      } else if (rule.sourceType === "FORMULA") {
        // Simple template substitution: {columnName}
        value = rule.sourceValue.replace(/\{(\w+)\}/g, (_, col) => row[col] ?? "");
      }

      if (value !== null && rule.transform) {
        value = applyTransform(value, rule.transform, rule.transformArg);
      }

      mapped[rule.targetField] = value;
    }
    mappedRows.push(mapped);
  }

  return {
    parsedRows: rows.length,
    mappedRows,
    errors,
    unmappedLookups: Array.from(unmappedLookups)
  };
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
  app.register(async (router) => {
    router.addHook("preHandler", requireAuth);

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
      } catch (error) { return mapError(reply, error); }
    });

    router.get("/opera-cloud/logs", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { limit, offset } = request.query as { limit?: string; offset?: string };
        const data = await (prisma as unknown as PrismaClient).importLog.findMany({
          where: { entityId, connectorType: "OPERA_CLOUD" },
          orderBy: { createdAt: "desc" },
          take: Math.min(parseInt(limit ?? "50", 10), 200),
          skip: parseInt(offset ?? "0", 10)
        });
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    // ── Sky Jana ────────────────────────────────────────────────────────────

    router.post("/sky-jana/sync", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const data = await runSkyJanaSync(prisma as unknown as PrismaClient, entityId);
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
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
      } catch (error) { return mapError(reply, error); }
    });

    router.get("/bank/statements", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const data = await (prisma as unknown as PrismaClient).bankStatement.findMany({
          where: { entityId },
          include: {
            account: { select: { id: true, code: true, name: true } },
            _count: { select: { transactions: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50
        });
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.get<{ Params: { statementId: string } }>(
      "/bank/statements/:statementId/transactions",
      async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await (prisma as unknown as PrismaClient).bankTransaction.findMany({
            where: {
              bankStatementId: request.params.statementId,
              bankStatement: { entityId },
            },
            orderBy: { valueDate: "desc" }
          });
          return reply.send({ data, errors: [] });
        } catch (error) { return mapError(reply, error); }
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
      } catch (error) { return mapError(reply, error); }
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
      } catch (error) { return mapError(reply, error); }
    });

    router.delete<{ Params: { id: string } }>("/mappings/:id", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        await (prisma as unknown as PrismaClient).connectorMapping.deleteMany({
          where: { id: request.params.id, entityId }
        });
        return reply.code(204).send();
      } catch (error) { return mapError(reply, error); }
    });

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
      } catch (error) { return mapError(reply, error); }
    });

    router.post("/interfaces", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const payload = interfaceDefinitionCreateSchema.parse(request.body);
        const data = await (prisma as unknown as PrismaClient).interfaceDefinition.create({
          data: { entityId, ...payload, fieldMappings: payload.fieldMappings as unknown as import("@prisma/client").Prisma.InputJsonValue }
        });
        return reply.code(201).send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.get<{ Params: { id: string } }>("/interfaces/:id", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const data = await (prisma as unknown as PrismaClient).interfaceDefinition.findFirst({
          where: { entityId, id: request.params.id }
        });
        if (!data) return reply.code(404).send({ data: null, errors: [{ code: "NOT_FOUND", message: "Interface definition not found." }] });
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.put<{ Params: { id: string } }>("/interfaces/:id", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const payload = interfaceDefinitionUpdateSchema.parse(request.body);
        const existing = await (prisma as unknown as PrismaClient).interfaceDefinition.findFirst({ where: { entityId, id: request.params.id } });
        if (!existing) return reply.code(404).send({ data: null, errors: [{ code: "NOT_FOUND", message: "Interface definition not found." }] });
        const data = await (prisma as unknown as PrismaClient).interfaceDefinition.update({
          where: { id: request.params.id },
          data: { ...payload, ...(payload.fieldMappings ? { fieldMappings: payload.fieldMappings as unknown as import("@prisma/client").Prisma.InputJsonValue } : {}) }
        });
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.delete<{ Params: { id: string } }>("/interfaces/:id", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        await (prisma as unknown as PrismaClient).interfaceDefinition.deleteMany({
          where: { entityId, id: request.params.id }
        });
        return reply.code(204).send();
      } catch (error) { return mapError(reply, error); }
    });

    router.post("/interfaces/preview-draft", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const payload = previewDraftSchema.parse(request.body);
        const rows = parseRows(
          payload.sampleData,
          payload.sourceFormat,
          payload.delimiter ?? ",",
          payload.hasHeader ?? true
        ).slice(0, payload.maxRows ?? 10);

        // Determine connectorType from fieldMappings (best-effort: look for LOOKUP rules)
        const connectorType = "OPERA_CLOUD"; // preview-draft uses first LOOKUP connectorType guess
        const result = await runPreviewEngine(
          prisma as unknown as PrismaClient,
          entityId,
          connectorType,
          payload.fieldMappings as FieldMappingRule[],
          rows
        );
        return reply.send({ data: result, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.post<{ Params: { id: string } }>("/interfaces/:id/preview", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { sampleData, maxRows } = request.body as { sampleData: string; maxRows?: number };
        const def = await (prisma as unknown as PrismaClient).interfaceDefinition.findFirst({
          where: { entityId, id: request.params.id }
        });
        if (!def) return reply.code(404).send({ data: null, errors: [{ code: "NOT_FOUND", message: "Interface definition not found." }] });
        const rows = parseRows(sampleData, def.sourceFormat).slice(0, maxRows ?? 10);
        const result = await runPreviewEngine(
          prisma as unknown as PrismaClient,
          entityId,
          def.connectorType,
          def.fieldMappings as unknown as FieldMappingRule[],
          rows
        );
        return reply.send({ data: result, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    // ── Interface Execute (create GL journals from file using an interface def)
    const interfaceExecuteSchema = z.object({
      fileContent: z.string().min(1),
      autoPost: z.boolean().default(false),
      reference: z.string().max(50).optional(),
      periodId: z.string().uuid().optional(),
    });

    router.post<{ Params: { id: string } }>("/interfaces/:id/execute", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const payload = interfaceExecuteSchema.parse(request.body);
        const def = await (prisma as unknown as PrismaClient).interfaceDefinition.findFirst({
          where: { entityId, id: request.params.id }
        });
        if (!def) return reply.code(404).send({ data: null, errors: [{ code: "NOT_FOUND", message: "Interface definition not found." }] });
        if (!def.isActive) return reply.code(422).send({ data: null, errors: [{ code: "INACTIVE", message: "Interface definition is inactive." }] });

        // Parse and transform all rows
        const rows = parseRows(payload.fileContent, def.sourceFormat);
        if (rows.length === 0) {
          return reply.code(422).send({ data: null, errors: [{ code: "EMPTY_FILE", message: "No data rows found in the file." }] });
        }

        const previewResult = await runPreviewEngine(
          prisma as unknown as PrismaClient,
          entityId,
          def.connectorType,
          def.fieldMappings as unknown as FieldMappingRule[],
          rows
        );

        if (previewResult.mappedRows.length === 0) {
          return reply.code(422).send({ data: null, errors: [{ code: "NO_MAPPED_ROWS", message: "Transformation produced no mapped rows." }] });
        }

        // Find open period — use explicit periodId, or posting date from file, then current month, then any open
        let period: { id: string; entityId: string; year: number; month: number; name: string; status: string } | null = null;

        // 0. Explicit periodId from payload
        if (payload.periodId) {
          period = await (prisma as unknown as PrismaClient).period.findFirst({
            where: { entityId, id: payload.periodId, status: "OPEN" },
          });
          if (!period) {
            return reply.code(422).send({ data: null, errors: [{ code: "PERIOD_NOT_OPEN", message: "Selected period is not open." }] });
          }
        }

        // 1. Try posting date from first mapped row
        if (!period) {
          const firstPostingDate = previewResult.mappedRows[0]?.postingDate;
          if (firstPostingDate) {
            const pd = new Date(firstPostingDate);
            if (!isNaN(pd.getTime())) {
              period = await (prisma as unknown as PrismaClient).period.findFirst({
                where: { entityId, status: "OPEN", year: pd.getFullYear(), month: pd.getMonth() + 1 },
              });
            }
          }
        }

        // 2. Try current month
        if (!period) {
          const now = new Date();
          period = await (prisma as unknown as PrismaClient).period.findFirst({
            where: { entityId, status: "OPEN", year: now.getFullYear(), month: now.getMonth() + 1 },
          });
        }

        // 3. Fall back to any open period (most recent)
        if (!period) {
          period = await (prisma as unknown as PrismaClient).period.findFirst({
            where: { entityId, status: "OPEN" },
            orderBy: [{ year: "desc" }, { month: "desc" }],
          });
        }

        if (!period) {
          return reply.code(422).send({ data: null, errors: [{ code: "NO_OPEN_PERIOD", message: "No open accounting period found. Open a period first via Periods page." }] });
        }

        // Find entity user
        const entityUser = await (prisma as unknown as PrismaClient).entityUser.findFirst({
          where: { entityId },
        });
        if (!entityUser) {
          return reply.code(422).send({ data: null, errors: [{ code: "NO_USER", message: "No entity user found." }] });
        }

        // Resolve account codes to IDs
        const accountCodes = new Set<string>();
        for (const row of previewResult.mappedRows) {
          if (row.accountCode) accountCodes.add(row.accountCode);
        }
        const accounts = await (prisma as unknown as PrismaClient).account.findMany({
          where: { entityId, code: { in: Array.from(accountCodes) } },
          select: { id: true, code: true },
        });
        const accountCodeToId = new Map(accounts.map((a: { id: string; code: string }) => [a.code, a.id]));

        // Build journal lines
        const journalLines: Array<{
          accountId: string;
          debit: import("@prisma/client").Prisma.Decimal;
          credit: import("@prisma/client").Prisma.Decimal;
          currency: string;
          fxRate: import("@prisma/client").Prisma.Decimal;
          debitFunctional: import("@prisma/client").Prisma.Decimal;
          creditFunctional: import("@prisma/client").Prisma.Decimal;
          description: string;
          lineNumber: number;
          dimension1?: string;
          dimension2?: string;
          dimension3?: string;
          dimension4?: string;
          dimension5?: string;
          dimension6?: string;
        }> = [];

        const { Prisma: PrismaTypes } = await import("@prisma/client");
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
            dimension6: row.dimension6 ?? undefined,
          });
        }

        if (journalLines.length === 0) {
          return reply.code(422).send({
            data: null,
            errors: [{
              code: "NO_VALID_LINES",
              message: `No valid journal lines. ${unmappedCodes.length} unmapped account codes: ${unmappedCodes.join(", ")}`,
            }],
          });
        }

        const refPrefix = payload.reference ?? `TD-${def.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 15)}`;
        const status = payload.autoPost ? "POSTED" : "DRAFT";

        const journal = await (prisma as unknown as PrismaClient).journal.create({
          data: {
            entityId,
            periodId: period.id,
            reference: `${refPrefix}-${Date.now().toString(36).toUpperCase()}`,
            description: `Transfer Desk import: ${def.name}`,
            functionalCurrency: journalLines[0]?.currency ?? "USD",
            source: "MANUAL" as any,
            status: status as any,
            postedAt: payload.autoPost ? new Date() : undefined,
            createdById: entityUser.userId,
            lines: { create: journalLines },
          },
          include: { lines: true },
        });

        // Update account balances if auto-posted
        if (payload.autoPost) {
          for (const line of journal.lines) {
            await (prisma as unknown as PrismaClient).accountPeriodBalance.upsert({
              where: {
                entityId_accountId_periodId: { entityId, accountId: line.accountId, periodId: period.id },
              },
              create: {
                entityId,
                accountId: line.accountId,
                periodId: period.id,
                openingBalance: new PrismaTypes.Decimal(0),
                periodDebits: line.debitFunctional,
                periodCredits: line.creditFunctional,
                closingBalance: line.debitFunctional.sub(line.creditFunctional),
              },
              update: {
                periodDebits: { increment: line.debitFunctional },
                periodCredits: { increment: line.creditFunctional },
                closingBalance: { increment: line.debitFunctional.sub(line.creditFunctional) },
              },
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
            previewErrors: previewResult.errors.length,
          },
          errors: [],
        });
      } catch (error) { return mapError(reply, error); }
    });

    // ── SAF File Import (Jana .txt / Opera .SUN / generic SAF) ──────────────

    router.post("/import/saf/preview", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { fileContent, filename } = request.body as { fileContent: string; filename?: string };
        if (!fileContent) return reply.code(400).send({ data: null, errors: [{ code: "MISSING_FILE", message: "fileContent is required" }] });
        const data = previewSAFFile(fileContent, filename);

        // Enrich with entity currency info and FX rate
        const entity = await (prisma as unknown as PrismaClient).entity.findUnique({
          where: { id: entityId },
          select: { functionalCurrency: true, reportingCurrency: true },
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
              toCurrency: reportingCurrency.toUpperCase(),
            },
            orderBy: { effectiveDate: "desc" },
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
            fxRateDate,
          },
          errors: [],
        });
      } catch (error) { return mapError(reply, error); }
    });

    router.post("/import/saf/account-mapping", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { fileContent, filename } = request.body as { fileContent: string; filename?: string };
        if (!fileContent) return reply.code(400).send({ data: null, errors: [{ code: "MISSING_FILE", message: "fileContent is required" }] });
        const data = await getAccountMapping(prisma as unknown as PrismaClient, entityId, fileContent, filename);
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    const safExecuteSchema = z.object({
      fileContent: z.string().min(1),
      filename: z.string().min(1).max(255),
      groupingStrategy: z.enum(["single_entry", "by_reference", "by_journal_type"]).default("by_reference"),
      autoPost: z.boolean().default(false),
      autoCreateAccounts: z.boolean().default(true),
      sourceModule: z.string().min(1).max(20).default("PROC"),
      descriptionPrefix: z.string().max(100).default("SAF Import"),
      departmentMapping: z.record(z.string()).optional(),
    });

    router.post("/import/saf/execute", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const payload = safExecuteSchema.parse(request.body);
        const data = await executeSAFImport(prisma as unknown as PrismaClient, {
          entityId,
          ...payload,
        });
        return reply.code(201).send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    // ── Opera .SUN File Import ──────────────────────────────────────────────

    router.post("/opera-sun/import", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { fileContent, filename, notifyEmail } = request.body as {
          fileContent: string; filename: string; notifyEmail?: string;
        };
        if (!fileContent || !filename) {
          return reply.code(400).send({ data: null, errors: [{ code: "MISSING_FIELDS", message: "fileContent and filename are required" }] });
        }
        const data = await importOperaSUNFile(prisma as unknown as PrismaClient, {
          entityId, fileContent, filename, notifyEmail,
        });
        return reply.code(201).send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

  }, { prefix: "/api/v1/integration" });
}
