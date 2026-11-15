/**
 * Runs the WP-1 lint rules (rules.mjs) over the tracked source files and
 * exits 1 listing every problem. Part of `pnpm lint`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./rules.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = /\.(ts|tsx|mts|mjs|js|cjs)$/;
const SCOPE = /^(apps\/(api\/src|web)\/|packages\/[^/]+\/src\/)/;
const SKIP = /(^|\/)(node_modules|\.next|dist|generated)\/|\.d\.ts$|^apps\/web\/next-env\.d\.ts$/;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8"
})
  .split("\n")
  .filter((f) => SOURCE.test(f) && SCOPE.test(f) && !SKIP.test(f));

let count = 0;
for (const file of files) {
  for (const p of check(file, readFileSync(resolve(root, file), "utf8"))) {
    count++;
    process.stderr.write(`${file}:${p.line}  ${p.rule}  ${p.text}\n`);
  }
}

if (count > 0) {
  process.stderr.write(
    `\n${count} problem(s). Rules and allowed files: tools/lint-rules/rules.mjs\n`
  );
  process.exit(1);
}
process.stdout.write(`lint rules: ${files.length} files checked, no problems\n`);
