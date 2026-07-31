/**
 * FSD API routes — auto-detect, validate, parse-preview.
 *
 * These routes integrate the @hfp/fsd-engine package. The engine is
 * a stateless library — no DB access. File content arrives as base64
 * in the JSON body (same pattern as payroll/import-file).
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { FsdEngine } from "@hfp/fsd-engine";
import type { ProfileFsdSchema } from "@hfp/fsd-engine";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { fsdAutoDetectSchema, fsdValidateSchemaInput, fsdParsePreviewSchema } from "./fsd-types.js";

const engine = new FsdEngine();

// ── Error mapper ─────────────────────────────────────────────────────────────

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [
        {
          code: "VALIDATION_ERROR",
          message: error.issues.map((i) => i.message).join("; ")
        }
      ]
    });
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({
    data: null,
    errors: [{ code: "INTERNAL_SERVER_ERROR", message }]
  });
}

// ── Filename → format hint ───────────────────────────────────────────────────

function hintFromFilename(filename: string): { type: string } | undefined {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "csv":
      return { type: "csv" };
    case "tsv":
      return { type: "tsv" };
    case "txt":
      return undefined; // could be fixed-width or TSV — let heuristics decide
    case "xlsx":
    case "xls":
      return { type: "xlsx" };
    case "xml":
    case "sun":
      return { type: "xml_ssml" };
    default:
      return undefined;
  }
}

// ── Router registration ──────────────────────────────────────────────────────

export async function registerFsdRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      // ── POST /transfer-desk/fsd/auto-detect ─────────────────────────────
      //
      // Accepts a base64-encoded sample file. Calls FsdEngine.detectFormat()
      // and returns proposed schema + first rows preview.

      router.post(
        "/transfer-desk/fsd/auto-detect",
        { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
        async (request, reply) => {
          try {
            const payload = fsdAutoDetectSchema.parse(request.body);
            const buffer = Buffer.from(payload.file, "base64");

            // Size guard: 10 MB
            if (buffer.length > 10 * 1024 * 1024) {
              return reply.code(400).send({
                data: null,
                errors: [
                  {
                    code: "FILE_TOO_LARGE",
                    message: "File exceeds 10 MB limit."
                  }
                ]
              });
            }

            const hint = hintFromFilename(payload.filename);
            const detection = engine.detectFormat(buffer, hint as any);

            // Build a proposed schema from the detection result
            const proposedSchema: Record<string, unknown> = {
              version: "1.0",
              format: detection.detectedFormat,
              fields: detection.detectedFields.map((f, i) => ({
                name: f.name,
                target: "",
                type: f.suggestedType,
                ...(detection.detectedFormat.type === "csv" ||
                detection.detectedFormat.type === "tsv"
                  ? { columnName: f.name, columnIndex: i }
                  : {})
              }))
            };

            // Try to parse first 10 rows for preview
            let previewRows: unknown[] = [];
            let previewErrors: unknown[] = [];
            try {
              const parseResult = await engine.parse(
                buffer,
                proposedSchema as unknown as ProfileFsdSchema
              );
              previewRows = parseResult.rows.slice(0, 10);
              previewErrors = parseResult.errors.slice(0, 20);
            } catch {
              // Detection succeeded but preview parse failed — still return detection
            }

            return reply.send({
              data: {
                detection,
                proposedSchema,
                previewRows,
                previewErrors
              },
              errors: []
            });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── POST /transfer-desk/fsd/validate-schema ─────────────────────────
      //
      // Validate an FSD schema JSON via FsdEngine.validateSchema().

      router.post(
        "/transfer-desk/fsd/validate-schema",
        { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
        async (request, reply) => {
          try {
            const payload = fsdValidateSchemaInput.parse(request.body);
            const result = engine.validateSchema(payload.schema);
            return reply.send({ data: result, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── POST /transfer-desk/fsd/parse-preview ──────────────────────────
      //
      // Parse first N rows of uploaded file using given schema.

      router.post(
        "/transfer-desk/fsd/parse-preview",
        { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
        async (request, reply) => {
          try {
            const payload = fsdParsePreviewSchema.parse(request.body);
            const buffer = Buffer.from(payload.file, "base64");

            if (buffer.length > 10 * 1024 * 1024) {
              return reply.code(400).send({
                data: null,
                errors: [
                  {
                    code: "FILE_TOO_LARGE",
                    message: "File exceeds 10 MB limit."
                  }
                ]
              });
            }

            const schema = payload.schema as unknown as ProfileFsdSchema;
            const parseResult = await engine.parse(buffer, schema);

            return reply.send({
              data: {
                rows: parseResult.rows.slice(0, payload.maxRows),
                errors: parseResult.errors,
                rowCount: parseResult.rowCount,
                aborted: parseResult.aborted,
                skippedRows: parseResult.skippedRows
              },
              errors: []
            });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
    },
    { prefix: "/api/v1" }
  );
}
