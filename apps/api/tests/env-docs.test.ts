/**
 * docs/ENV-VARIABLES.md lists exactly the settings in src/config.ts (HC-33).
 * When this fails, run `pnpm --filter @hfp/api docs:env`.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFIG_GROUPS, configSchema } from "../src/config.js";
import { DOC_PATH, currentBlock, renderApiConfigDocs, tableRows } from "../src/scripts/env-docs.js";

/** Markdown escapes (Prettier adds some) do not change what a cell says. */
const plain = (rows: string[][]) =>
  rows.map((row) => row.map((cell) => cell.replace(/\\(.)/g, "$1")));

describe("ENV-VARIABLES.md", () => {
  it("puts every setting in exactly one group", () => {
    const grouped = CONFIG_GROUPS.flatMap((group) => group.keys);
    expect([...grouped].sort()).toEqual(Object.keys(configSchema.shape).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("matches the config module; run pnpm --filter @hfp/api docs:env when it does not", () => {
    const block = currentBlock(readFileSync(DOC_PATH, "utf8"));
    expect(block, "api-config markers missing from docs/ENV-VARIABLES.md").not.toBeNull();
    expect(plain(tableRows(block as string))).toEqual(plain(tableRows(renderApiConfigDocs())));
  });
});
