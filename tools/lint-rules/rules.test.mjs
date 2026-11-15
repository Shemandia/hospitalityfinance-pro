// Run with: node --test tools/lint-rules/rules.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "./rules.mjs";

const rules = (file, src) => check(file, src).map((p) => `${p.rule}:${p.line}`);

test("process.env outside a config module is a problem", () => {
  assert.deepEqual(rules("apps/api/src/modules/x.ts", "const a = process.env.FOO;"), [
    "process-env:1"
  ]);
  assert.deepEqual(rules("apps/web/lib/x.ts", "const { A } = process.env;"), ["process-env:1"]);
  assert.deepEqual(rules("packages/p/src/x.ts", "process.env['X'];"), ["process-env:1"]);
});

test("process.env is allowed in the config modules, tests, and for Next.js built-ins in the web app", () => {
  assert.deepEqual(rules("apps/api/src/config.ts", "process.env.FOO;"), []);
  assert.deepEqual(rules("apps/web/lib/server/config.ts", "process.env.FOO;"), []);
  assert.deepEqual(rules("apps/api/tests/a.test.ts", "process.env.FOO;"), []);
  assert.deepEqual(rules("apps/web/middleware.ts", 'process.env.NODE_ENV === "x";'), []);
  assert.deepEqual(rules("apps/api/src/x.ts", "process.env.NODE_ENV;"), ["process-env:1"]);
});

test("console in the API or a package is a problem, except in command-line scripts", () => {
  assert.deepEqual(rules("apps/api/src/jobs/w.ts", 'console.log("x");'), ["console:1"]);
  assert.deepEqual(rules("packages/p/src/x.ts", "const c = console;"), ["console:1"]);
  assert.deepEqual(rules("apps/api/src/scripts/seed.ts", 'console.log("x");'), []);
  assert.deepEqual(rules("apps/web/app/error.tsx", "console.error(e);"), []);
  assert.deepEqual(rules("apps/api/src/x.ts", "obj.console.log(1);"), []);
});

test("a local address in a string is a problem outside tests; comments do not count", () => {
  assert.deepEqual(rules("apps/api/src/x.ts", 'const u = "http://localhost:4000";'), [
    "localhost:1"
  ]);
  assert.deepEqual(rules("apps/web/lib/x.ts", "const u = `http://127.0.0.1:${p}/x`;"), [
    "localhost:1"
  ]);
  assert.deepEqual(rules("apps/api/src/x.ts", "// http://localhost:4000\nconst a = 1;"), []);
  assert.deepEqual(rules("apps/api/tests/x.test.ts", 'fetch("http://localhost");'), []);
  assert.deepEqual(rules("apps/api/src/x.ts", 'const notLocal = "mylocalhostname";'), []);
});
