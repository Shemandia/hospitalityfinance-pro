import { Prisma } from "./client.js";

function normalizeValue(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      normalizeValue(item)
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

export function serializeForAudit(value: unknown): unknown {
  return normalizeValue(value);
}
