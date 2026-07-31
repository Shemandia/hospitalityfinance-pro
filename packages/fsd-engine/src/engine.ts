/**
 * FsdEngine — unified public API for the profile-level FSD engine.
 *
 * Provides the 5 methods from spec §10:
 *   validateSchema(schema)          → schema structural validation
 *   parse(buffer, schema)           → file buffer → parsed rows
 *   validate(rows, schema)          → re-validate parsed rows
 *   serialise(rows, schema)         → structured rows → file buffer
 *   detectFormat(sample, hint?)     → auto-detect format from sample
 */

import { validateProfileSchema } from "./profile/schema-validator.js";
import { validateRows } from "./profile/validator.js";
import { parseCsv } from "./parsers/csv.js";
import { parseFixed } from "./parsers/fixed.js";
import { parseXlsx } from "./parsers/xlsx.js";
import { parseXmlSsml } from "./parsers/xml-ssml.js";
import { serialiseCsv } from "./serialisers/csv.js";
import { detectFormat } from "./detector.js";
import type {
  ProfileFsdSchema,
  ProfileFsdFormat,
  ProfileFsdSchemaValidationResult,
  ProfileFsdParseResult,
  ProfileFsdRawRow,
  ProfileFsdStructuredRow,
  ProfileFsdFormatDetectionResult
} from "./profile/types.js";
import type { ProfileFsdValidationResult } from "./profile/validator.js";

export class FsdEngine {
  /**
   * Validate an FSD schema document itself (not data).
   */
  validateSchema(schema: unknown): ProfileFsdSchemaValidationResult {
    return validateProfileSchema(schema);
  }

  /**
   * Parse a file buffer using a schema.
   * Routes to the correct parser based on schema.format.type.
   */
  async parse(buffer: Buffer, schema: ProfileFsdSchema): Promise<ProfileFsdParseResult> {
    const encoding = (schema.format.encoding ?? "utf-8") as BufferEncoding;

    switch (schema.format.type) {
      case "csv":
      case "tsv": {
        const text = buffer.toString(encoding);
        return parseCsv(schema, text);
      }
      case "fixed": {
        const text = buffer.toString(encoding);
        return parseFixed(schema, text);
      }
      case "xlsx": {
        return parseXlsx(schema, buffer);
      }
      case "xml_ssml": {
        const text = buffer.toString(encoding);
        return parseXmlSsml(schema, text);
      }
      default: {
        const type = (schema.format as { type: string }).type;
        return {
          rows: [],
          errors: [
            {
              rowIndex: 0,
              fieldName: "",
              errorCode: "SCHEMA_INVALID",
              message: `Unsupported format type: "${type}".`,
              rawValue: null
            }
          ],
          aborted: false,
          rowCount: 0,
          skippedRows: 0
        };
      }
    }
  }

  /**
   * Validate already-parsed rows (can be called after parse()).
   */
  validate(rows: ProfileFsdRawRow[], schema: ProfileFsdSchema): ProfileFsdValidationResult {
    return validateRows(rows, schema);
  }

  /**
   * Serialise structured rows to a file buffer.
   * Currently supports CSV/TSV only; other formats will be added.
   */
  async serialise(rows: ProfileFsdStructuredRow[], schema: ProfileFsdSchema): Promise<Buffer> {
    switch (schema.format.type) {
      case "csv":
      case "tsv":
        return serialiseCsv(schema, rows);
      default: {
        const type = schema.format.type;
        throw new Error(`Serialisation not yet supported for format type: "${type}".`);
      }
    }
  }

  /**
   * Auto-detect format from a sample buffer.
   */
  detectFormat(sample: Buffer, hint?: Partial<ProfileFsdFormat>): ProfileFsdFormatDetectionResult {
    return detectFormat(sample, hint);
  }
}
