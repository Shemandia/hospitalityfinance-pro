/**
 * Log Redactor — Sensitive Data Masking for Fastify Logger
 *
 * Masks bank details, tax IDs, tokens, and financial amounts in log output.
 * Used as Fastify pino serializer to prevent sensitive data leaking to logs.
 */

const SENSITIVE_KEYS = new Set([
  "bankDetails",
  "bank_details",
  "bankAccountNumber",
  "bank_account_number",
  "iban",
  "swiftCode",
  "swift_code",
  "bic",
  "sortCode",
  "sort_code",
  "routingNumber",
  "routing_number",
  "taxId",
  "tax_id",
  "taxNumber",
  "tax_number",
  "vatNumber",
  "vat_number",
  "password",
  "secret",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "apiKey",
  "api_key",
  "authorization",
  "creditCardNumber",
  "credit_card_number",
  "cvv",
  "ssn",
  "socialSecurityNumber"
]);

const REDACTED = "[REDACTED]";

/**
 * Recursively redact sensitive fields from an object.
 * Returns a new object with sensitive values replaced.
 */
export function redactSensitiveFields(obj: unknown, depth = 0): unknown {
  if (depth > 10) return REDACTED; // prevent infinite recursion
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveFields(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = REDACTED;
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitiveFields(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Pino serializers for Fastify logger.
 * Masks authorization headers and sensitive body fields.
 */
export const logSerializers = {
  req(request: {
    method?: string;
    url?: string;
    hostname?: string;
    remoteAddress?: string;
    headers?: Record<string, unknown>;
  }) {
    return {
      method: request.method,
      url: request.url,
      hostname: request.hostname,
      remoteAddress: request.remoteAddress,
      headers: request.headers
        ? {
            authorization: request.headers.authorization ? "[REDACTED]" : undefined,
            cookie: request.headers.cookie ? "[REDACTED]" : undefined
          }
        : undefined
    };
  },
  res(reply: { statusCode?: number }) {
    return {
      statusCode: reply.statusCode
    };
  }
};
