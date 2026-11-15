/**
 * Copies the generated Prisma clients (src/db/generated) next to the compiled
 * code (dist/db/generated). tsc compiles the TypeScript that imports them but
 * does not copy their JavaScript or query engine, so without this the built
 * API fails at its first import.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const api = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(api, "src/db/generated");
const to = resolve(api, "dist/db/generated");
if (!existsSync(from)) {
  process.stderr.write(
    "src/db/generated is missing: run pnpm --filter @hfp/api db:generate first.\n"
  );
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
