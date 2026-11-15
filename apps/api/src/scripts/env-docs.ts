/**
 * docs/ENV-VARIABLES.md, API section, generated from src/config.ts (HC-33).
 *
 *   pnpm --filter @hfp/api docs:env
 *
 * rewrites the block between the api-config markers. tests/env-docs.test.ts
 * fails when the file and the config module disagree.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CONFIG_GROUPS, STARTUP, configSchema, type ConfigKey } from "../config.js";

export const DOC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/ENV-VARIABLES.md"
);
export const START =
  "<!-- api-config:start (generated from apps/api/src/config.ts; run pnpm --filter @hfp/api docs:env) -->";
export const END = "<!-- api-config:end -->";

function requiredBy(key: ConfigKey): string {
  const parts: string[] = [];
  for (const [kind, needs] of Object.entries(STARTUP)) {
    if (needs.always.includes(key)) parts.push(kind);
    else if (needs.production.includes(key)) parts.push(`${kind} in production`);
  }
  return parts.join(", ");
}

function defaultOf(field: z.ZodTypeAny): string {
  if (field instanceof z.ZodDefault) {
    const value = field._def.defaultValue();
    return `\`${String(value)}\``;
  }
  return "";
}

/** The generated block, markers included. */
export function renderApiConfigDocs(): string {
  const shape = configSchema.shape as Record<ConfigKey, z.ZodTypeAny>;
  const out: string[] = [START, ""];
  for (const group of CONFIG_GROUPS) {
    out.push(`### ${group.title}`, "");
    out.push("| Variable | Required by | Default | Description |");
    out.push("| --- | --- | --- | --- |");
    for (const key of group.keys) {
      const field = shape[key];
      const description = (field.description ?? "").replace(/\|/g, "\\|");
      out.push(`| \`${key}\` | ${requiredBy(key)} | ${defaultOf(field)} | ${description} |`);
    }
    out.push("");
  }
  out.push(END);
  return out.join("\n");
}

/** The rows of every table in `markdown`, cells trimmed, separator rows left out. */
export function tableRows(markdown: string): string[][] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|[\s:|-]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim())
    );
}

/** The current block in the document, markers included, or null. */
export function currentBlock(doc: string): string | null {
  const start = doc.indexOf(START);
  const end = doc.indexOf(END);
  return start >= 0 && end > start ? doc.slice(start, end + END.length) : null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const doc = readFileSync(DOC_PATH, "utf8");
  const block = currentBlock(doc);
  if (!block) {
    process.stderr.write(`docs:env: markers not found in ${DOC_PATH}\n`);
    process.exit(1);
  }
  writeFileSync(DOC_PATH, doc.replace(block, renderApiConfigDocs()));
  process.stdout.write(`Wrote the API settings to ${DOC_PATH}. Run prettier on it.\n`);
}
