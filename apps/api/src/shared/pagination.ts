/**
 * Page sizes for list endpoints (HC-39).
 *
 * One default and one maximum, PAGE_SIZE_DEFAULT and PAGE_SIZE_MAX, for every
 * list a client pages through. A missing page size gets the default; a larger
 * one than the maximum gets the maximum.
 */

import { z } from "zod";
import { config } from "../config.js";

function wholeNumber(value: unknown): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : undefined;
}

/** The page size for a requested `limit`: the default when it is absent or not a positive whole number. */
export function pageLimit(requested?: unknown): number {
  const { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } = config();
  const n = wholeNumber(requested);
  return Math.min(n !== undefined && n >= 1 ? n : PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX);
}

/** The rows to skip for a requested `offset`: 0 when it is absent or not a whole number of at least 0. */
export function pageOffset(requested?: unknown): number {
  const n = wholeNumber(requested);
  return n !== undefined && n >= 0 ? n : 0;
}

/** Query fields for a paged list: a positive `limit`, clamped to the maximum, and an `offset`. */
export const pageFields = {
  limit: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .transform((v) => pageLimit(v)),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .transform((v) => pageOffset(v))
};

/** What a paged list returns beside its rows, so a client can draw "21–40 of 312". */
export type PageMeta = { total: number; limit: number; offset: number };

export function pageMeta(total: number, limit: number, offset: number): PageMeta {
  return { total, limit, offset };
}
