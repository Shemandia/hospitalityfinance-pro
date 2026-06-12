# Tier 1 Critical Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all six Tier 1 findings from `docs/CRITICAL-ASSESSMENT-2026-06-11.md`: TML sandbox RCE (NS1), role-scope privilege escalation (NS2), missing balance updates in LER/year-end/intercompany posting engines (NF1–NF3), depreciation double-posting (NF4), consolidation cross-entity IDOR (NS3), and secrets-rotation guidance (NS4).

**Architecture:** Security fixes are surgical: the sandbox fails closed on isolated-vm, JWT claims become scope-aware via a pure helper used by login+refresh, and role grants get a privilege ceiling. Financial fixes all route through the canonical `GLRepository.batchUpdateAccountBalances` (the same call `GLService.postJournalInternal` uses), invoked inside each engine's existing transaction. Consolidation validates child lineage by walking `parent_id` upward (same pattern as `plugins/auth.ts`).

**Tech Stack:** Fastify 4, Prisma (multi-tenant), Prisma.Decimal, vitest (unit tests with hand-rolled prisma mocks), isolated-vm.

**Repo root for all paths/commands:** `D:\FINANCIAL PROJECT\HospitalityFinance\hospitalityfinance-pro`

---

## Ground rules for the executor

- The working tree has **large pre-existing uncommitted drift**. NEVER `git add -A` or `git add .`. Stage only the files named in each task's commit step.
- Before starting: `git rev-parse --abbrev-ref HEAD`. If on `master`/`main`, run `git switch -c fix/tier1-critical-remediation` (dirty tree carries over — that is fine and expected).
- API tests run from `apps/api`: `npx vitest run tests/<file>.test.ts`. tml-engine tests run from `packages/tml-engine`: `npx vitest run`.
- Typecheck after each API task: `cd apps/api && npx tsc --noEmit`.
- Existing mock conventions: each test file builds a `mockPrisma` object with `$transaction: vi.fn().mockImplementation(async (fn) => fn(mockPrisma))` so the tx client _is_ the mock. Follow that pattern.
- Where a task says "spy on GLRepository", use:
  ```ts
  import { GLRepository } from "../src/modules/gl/repository.js";
  // in beforeEach:
  balanceSpy = vi
    .spyOn(GLRepository.prototype, "batchUpdateAccountBalances")
    .mockResolvedValue(undefined as any);
  ```
  This intercepts the canonical balance write without needing `$executeRawUnsafe` on the mock.

---

### Task 1: TML sandbox — fail closed, validate identifiers (NS1, R1.1)

**Files:**

- Modify: `packages/tml-engine/src/sandbox.ts` (full rewrite below)
- Modify: `packages/tml-engine/package.json` (add `isolated-vm` dependency)
- Create: `packages/tml-engine/tests/sandbox-security.test.ts`
- Modify: `packages/tml-engine/tests/tml-engine.test.ts`, `packages/tml-engine/tests/compiler.test.ts` (env flag, first line of each file)

Background: `createSandbox` currently does `require("isolated-vm")` inside a bare try/catch. The package is in no package.json AND the package is ESM (`"type": "module"`) so bare `require` throws `ReferenceError` — the fallback to `node:vm` **always** engages. `node:vm` is not a security boundary (`this.constructor.constructor("return process")()` escapes). Also `fn.name`/`fn.params` are interpolated raw into generated source.

Design decisions:

- isolated-vm becomes a real dependency, loaded via `createRequire(import.meta.url)` (works from ESM).
- If it cannot load: throw `SandboxUnavailableError` — **unless** `TML_ALLOW_INSECURE_SANDBOX=true` AND `NODE_ENV !== "production"` (dev/test escape hatch for machines without native build tooling). Production always fails closed.
- `validateUserFunctions` rejects any function name or param not matching `/^[A-Za-z_$][A-Za-z0-9_$]*$/` or in a denylist — closes the source-injection sink.
- `SandboxOptions.ivmLoader` is a test-only injection point for simulating load failure.

- [ ] **Step 1: Write the failing tests**

Create `packages/tml-engine/tests/sandbox-security.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createSandbox, SandboxUnavailableError, SandboxValidationError } from "../src/sandbox.js";

const req = createRequire(import.meta.url);
let hasIvm = true;
try {
  req.resolve("isolated-vm");
} catch {
  hasIvm = false;
}

const failingLoader = () => {
  throw new Error("isolated-vm not installed");
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sandbox identifier validation", () => {
  it("rejects a function name containing injected code", () => {
    expect(() =>
      createSandbox(
        [{ name: "f(){};process.mainModule;function g", params: [], body: "return 1;" }],
        ""
      )
    ).toThrow(SandboxValidationError);
  });

  it("rejects a parameter containing injected code", () => {
    expect(() =>
      createSandbox(
        [{ name: "f", params: ["x) { return 1; } function evil("], body: "return x;" }],
        ""
      )
    ).toThrow(SandboxValidationError);
  });

  it("rejects reserved names", () => {
    for (const name of ["eval", "arguments", "constructor", "globalThis", "__call"]) {
      expect(() => createSandbox([{ name, params: [], body: "return 1;" }], "")).toThrow(
        SandboxValidationError
      );
    }
  });

  it("accepts a normal function definition", () => {
    vi.stubEnv("TML_ALLOW_INSECURE_SANDBOX", "true");
    const sb = createSandbox([{ name: "double", params: ["x"], body: "return x * 2;" }], "", {
      ivmLoader: hasIvm ? undefined : failingLoader
    });
    expect(sb.callFunction("double", [21])).toBe(42);
    sb.dispose();
  });
});

describe("fail-closed behaviour", () => {
  it("throws SandboxUnavailableError when isolated-vm cannot load and no override is set", () => {
    vi.stubEnv("TML_ALLOW_INSECURE_SANDBOX", "");
    expect(() => createSandbox([], "", { ivmLoader: failingLoader })).toThrow(
      SandboxUnavailableError
    );
  });

  it("refuses the insecure fallback in production even with the flag set", () => {
    vi.stubEnv("TML_ALLOW_INSECURE_SANDBOX", "true");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createSandbox([], "", { ivmLoader: failingLoader })).toThrow(
      SandboxUnavailableError
    );
  });

  it("allows the vm fallback only with the explicit flag outside production", () => {
    vi.stubEnv("TML_ALLOW_INSECURE_SANDBOX", "true");
    vi.stubEnv("NODE_ENV", "test");
    const sb = createSandbox([{ name: "id", params: ["x"], body: "return x;" }], "", {
      ivmLoader: failingLoader
    });
    expect(sb.callFunction("id", ["ok"])).toBe("ok");
    sb.dispose();
  });
});

describe.runIf(hasIvm)("isolated-vm escape resistance", () => {
  it("does not expose process via constructor chain", () => {
    const sb = createSandbox(
      [
        {
          name: "tryEscape",
          params: [],
          body: 'try { var p = this.constructor.constructor("return process")(); return p ? "escaped" : "blocked"; } catch (e) { return "blocked"; }'
        }
      ],
      ""
    );
    expect(sb.callFunction("tryEscape", [])).toBe("blocked");
    sb.dispose();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/tml-engine && npx vitest run tests/sandbox-security.test.ts`
Expected: FAIL — `SandboxValidationError`/`SandboxUnavailableError` are not exported; validation tests throw nothing.

- [ ] **Step 3: Rewrite `packages/tml-engine/src/sandbox.ts`**

Full new content:

```ts
/**
 * @hfp/tml-engine — JavaScript sandbox
 *
 * Executes user-defined JavaScript functions inside an isolated-vm V8
 * isolate. Fails closed if isolated-vm cannot be loaded — Node's vm
 * module is NOT a security boundary and is only available behind an
 * explicit non-production override (TML_ALLOW_INSECURE_SANDBOX=true).
 */

import { createRequire } from "node:module";
import * as vm from "node:vm";
import type { TmlUserFunction } from "./types.js";

// ── Public interface ───────────────────────────────────────────────────────

export interface Sandbox {
  callFunction(name: string, params: (string | number)[]): string | number;
  dispose(): void;
}

export interface SandboxOptions {
  timeoutMs?: number;
  memoryMb?: number;
  /** Test-only hook: override how isolated-vm is loaded. */
  ivmLoader?: () => unknown;
}

export class SandboxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxValidationError";
  }
}

export class SandboxUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      "isolated-vm is required to execute TML user functions but could not be loaded. " +
        "Refusing to fall back to Node's vm module (not a security boundary). " +
        "Install isolated-vm, or set TML_ALLOW_INSECURE_SANDBOX=true in non-production environments only."
    );
    this.name = "SandboxUnavailableError";
    this.cause = cause;
  }
}

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MEMORY_MB = 64;

// ── Identifier validation ──────────────────────────────────────────────────

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const FORBIDDEN_NAMES = new Set([
  "eval",
  "arguments",
  "constructor",
  "prototype",
  "__proto__",
  "globalThis",
  "this",
  "__call"
]);

export function validateUserFunctions(userFunctions: TmlUserFunction[]): void {
  for (const fn of userFunctions) {
    assertSafeIdentifier(fn.name, `function name "${fn.name}"`);
    for (const param of fn.params) {
      assertSafeIdentifier(param, `parameter "${param}" of function "${fn.name}"`);
    }
  }
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_RE.test(value) || FORBIDDEN_NAMES.has(value)) {
    throw new SandboxValidationError(
      `Invalid TML ${label}: identifiers must match ${IDENTIFIER_RE} and not be a reserved name.`
    );
  }
}

// ── Loading isolated-vm ────────────────────────────────────────────────────

const nodeRequire = createRequire(import.meta.url);

function loadIsolatedVm(): unknown {
  return nodeRequire("isolated-vm");
}

function insecureFallbackAllowed(): boolean {
  return process.env.TML_ALLOW_INSECURE_SANDBOX === "true" && process.env.NODE_ENV !== "production";
}

/**
 * Create a sandbox with the given user functions and built-in function source.
 * Validates all user-function identifiers, then requires isolated-vm.
 */
export function createSandbox(
  userFunctions: TmlUserFunction[],
  builtinSource: string,
  options?: SandboxOptions
): Sandbox {
  validateUserFunctions(userFunctions);

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryMb = options?.memoryMb ?? DEFAULT_MEMORY_MB;
  const fnSource = buildFunctionSource(userFunctions, builtinSource);

  let ivm: any;
  try {
    ivm = (options?.ivmLoader ?? loadIsolatedVm)();
  } catch (cause) {
    if (insecureFallbackAllowed()) {
      return createVmSandbox(fnSource, timeoutMs);
    }
    throw new SandboxUnavailableError(cause);
  }

  return createIsolatedVmSandbox(ivm, fnSource, timeoutMs, memoryMb);
}

// ── Function source builder ────────────────────────────────────────────────

function buildFunctionSource(userFunctions: TmlUserFunction[], builtinSource: string): string {
  const parts: string[] = [builtinSource];

  for (const fn of userFunctions) {
    parts.push(`function ${fn.name}(${fn.params.join(", ")}) { ${fn.body} }`);
  }

  return parts.join("\n\n");
}

// ── isolated-vm sandbox ────────────────────────────────────────────────────

function createIsolatedVmSandbox(
  ivm: any,
  fnSource: string,
  timeoutMs: number,
  memoryMb: number
): Sandbox {
  const isolate = new ivm.Isolate({ memoryLimit: memoryMb });
  const context = isolate.createContextSync();

  // Compile and run the function definitions
  const script = isolate.compileScriptSync(fnSource);
  script.runSync(context, { timeout: timeoutMs });

  // Inject a __call helper that invokes a named function with JSON-encoded args
  const callHelper = isolate.compileScriptSync(`
    function __call(name, argsJson) {
      var fn = eval(name);
      var args = JSON.parse(argsJson);
      return JSON.stringify(fn.apply(null, args));
    }
  `);
  callHelper.runSync(context, { timeout: timeoutMs });

  return {
    callFunction(name: string, params: (string | number)[]): string | number {
      const callScript = isolate.compileScriptSync(
        `__call(${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(params))})`
      );
      const raw = callScript.runSync(context, { timeout: timeoutMs });
      const parsed = JSON.parse(String(raw));
      return typeof parsed === "number" ? parsed : String(parsed);
    },
    dispose() {
      isolate.dispose();
    }
  };
}

// ── Node vm fallback (insecure — dev/test only, behind explicit env flag) ──

function createVmSandbox(fnSource: string, timeoutMs: number): Sandbox {
  const sandbox: Record<string, unknown> = {};
  const ctx = vm.createContext(sandbox);

  vm.runInContext(fnSource, ctx, { timeout: timeoutMs });

  vm.runInContext(
    `function __call(name, argsJson) {
      var fn = eval(name);
      var args = JSON.parse(argsJson);
      return JSON.stringify(fn.apply(null, args));
    }`,
    ctx,
    { timeout: timeoutMs }
  );

  return {
    callFunction(name: string, params: (string | number)[]): string | number {
      const expr = `__call(${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(params))})`;
      const raw = vm.runInContext(expr, ctx, { timeout: timeoutMs });
      const parsed = JSON.parse(String(raw));
      return typeof parsed === "number" ? parsed : String(parsed);
    },
    dispose() {
      // Node vm contexts are garbage-collected; nothing to dispose
    }
  };
}
```

Also export the new error classes from `packages/tml-engine/src/index.ts` — extend the existing export line:

```ts
export {
  createSandbox,
  validateUserFunctions,
  SandboxValidationError,
  SandboxUnavailableError,
  type Sandbox,
  type SandboxOptions
} from "./sandbox.js";
```

- [ ] **Step 4: Add the dependency and keep existing tests green**

In `packages/tml-engine/package.json` add:

```json
  "dependencies": {
    "isolated-vm": "^5.0.3"
  },
```

Then install with the repo's package manager (check for `pnpm-lock.yaml` vs `package-lock.json` at repo root and use `pnpm install` / `npm install` accordingly). **isolated-vm compiles natively; on this Windows machine the build may fail.** If it fails: remove nothing, keep the dependency declared, and note the failure — the code is still fail-closed-secure, and tests cover the fallback path via the env flag.

Add as the first line (before imports' usage, after imports is fine) of `packages/tml-engine/tests/tml-engine.test.ts` and `packages/tml-engine/tests/compiler.test.ts`:

```ts
process.env.TML_ALLOW_INSECURE_SANDBOX ??= "true";
```

If any `apps/api` tests fail later with `SandboxUnavailableError`, set the same env var in that test file (or the vitest setup file if one exists).

- [ ] **Step 5: Run the full tml-engine suite**

Run: `cd packages/tml-engine && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS (escape-resistance suite skipped if isolated-vm didn't build), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/tml-engine/src/sandbox.ts packages/tml-engine/src/index.ts packages/tml-engine/package.json packages/tml-engine/tests/sandbox-security.test.ts packages/tml-engine/tests/tml-engine.test.ts packages/tml-engine/tests/compiler.test.ts
# plus the lockfile touched by the install
git commit -m "fix(security): TML sandbox fails closed without isolated-vm; validate user-function identifiers (NS1)"
```

---

### Task 2: Scope-aware JWT role claims (NS2 part 1, R1.3)

**Files:**

- Modify: `apps/api/src/services/auth.service.ts` (login ~line 232, refresh ~line 389)
- Test: `apps/api/tests/auth.service.test.ts` (append a describe block)

Background: both `login` and `refresh` build the JWT `roles`/`permissions` claims by flattening ALL `UserRole` rows, ignoring `UserRole.entityId`. A SUPERADMIN row scoped to one property therefore yields a **global** SUPERADMIN claim (`hasExplicitCrossEntityAccess` in `plugins/auth.ts` then bypasses entity checks). Provisioning creates legitimate admin rows with `entityId: null`, so excluding scoped cross-entity-admin rows breaks nothing legitimate.

Rule implemented: a `UserRole` row contributes to JWT claims iff

- `entityId === null` (a true global grant), OR
- the role is NOT a cross-entity admin role (`SUPERADMIN`/`PLATFORM_ADMIN`) AND `entityId` is one of the user's accessible entities (from `EntityUser`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/auth.service.test.ts` (match its existing imports/env setup; add `buildScopedClaims` to the imports from `../src/services/auth.service.js`):

```ts
describe("buildScopedClaims (NS2 — scope-aware JWT claims)", () => {
  const perm = (code: string) => ({ permission: { code } });
  const ENTITY_A = "entity-a";
  const ENTITY_B = "entity-b";

  it("includes global (entityId=null) roles and their permissions", () => {
    const claims = buildScopedClaims(
      [{ entityId: null, role: { code: "SUPERADMIN", permissions: [perm("ADMIN_USERS")] } }],
      []
    );
    expect(claims.roles).toEqual(["SUPERADMIN"]);
    expect(claims.permissions).toEqual(["ADMIN_USERS"]);
  });

  it("excludes a SUPERADMIN role granted with an entity scope (privilege-escalation vector)", () => {
    const claims = buildScopedClaims(
      [
        { entityId: ENTITY_A, role: { code: "SUPERADMIN", permissions: [perm("ADMIN_USERS")] } },
        { entityId: ENTITY_A, role: { code: "ACCOUNTANT", permissions: [perm("GL_READ")] } }
      ],
      [ENTITY_A]
    );
    expect(claims.roles).toEqual(["ACCOUNTANT"]);
    expect(claims.permissions).toEqual(["GL_READ"]);
  });

  it("excludes scoped roles for entities the user no longer has access to", () => {
    const claims = buildScopedClaims(
      [{ entityId: ENTITY_B, role: { code: "ACCOUNTANT", permissions: [perm("GL_READ")] } }],
      [ENTITY_A]
    );
    expect(claims.roles).toEqual([]);
    expect(claims.permissions).toEqual([]);
  });

  it("includes scoped non-admin roles for accessible entities and dedupes", () => {
    const claims = buildScopedClaims(
      [
        {
          entityId: ENTITY_A,
          role: { code: "ACCOUNTANT", permissions: [perm("GL_READ"), perm("GL_POST")] }
        },
        { entityId: ENTITY_B, role: { code: "ACCOUNTANT", permissions: [perm("GL_READ")] } }
      ],
      [ENTITY_A, ENTITY_B]
    );
    expect(claims.roles).toEqual(["ACCOUNTANT"]);
    expect(claims.permissions.sort()).toEqual(["GL_POST", "GL_READ"]);
  });

  it("treats PLATFORM_ADMIN the same as SUPERADMIN", () => {
    const claims = buildScopedClaims(
      [{ entityId: ENTITY_A, role: { code: "PLATFORM_ADMIN", permissions: [] } }],
      [ENTITY_A]
    );
    expect(claims.roles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/auth.service.test.ts`
Expected: FAIL — `buildScopedClaims` is not exported.

- [ ] **Step 3: Implement**

In `apps/api/src/services/auth.service.ts`, add near the top (module scope, after imports):

```ts
const CROSS_ENTITY_ADMIN_ROLES = new Set(["SUPERADMIN", "PLATFORM_ADMIN"]);

type ClaimUserRole = {
  entityId: string | null;
  role: { code: string; permissions: Array<{ permission: { code: string } }> };
};

/**
 * Build JWT role/permission claims from UserRole rows, honouring entity scope.
 * A row contributes iff it is a global grant (entityId null), or it is a
 * non-cross-entity-admin role scoped to an entity the user can access.
 * A scoped SUPERADMIN/PLATFORM_ADMIN row must never become a global claim.
 */
export function buildScopedClaims(
  userRoles: ClaimUserRole[],
  accessibleEntityIds: string[]
): { roles: string[]; permissions: string[] } {
  const accessible = new Set(accessibleEntityIds);
  const included = userRoles.filter((ur) => {
    if (ur.entityId === null || ur.entityId === undefined) return true;
    if (CROSS_ENTITY_ADMIN_ROLES.has(ur.role.code.toUpperCase())) return false;
    return accessible.has(ur.entityId);
  });
  return {
    roles: [...new Set(included.map((ur) => ur.role.code))],
    permissions: [
      ...new Set(included.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code)))
    ]
  };
}
```

In `login` (currently ~lines 231-240), replace:

```ts
// 8. Build roles & permissions
const roles = user.roles.map((ur: any) => ur.role.code);
const permissions = [
  ...new Set(
    user.roles.flatMap((ur: any) => ur.role.permissions.map((rp: any) => rp.permission.code))
  )
];
const entityIds = user.entities.map((eu: any) => eu.entityId);
```

with:

```ts
// 8. Build roles & permissions (scope-aware — see buildScopedClaims)
const entityIds = user.entities.map((eu: any) => eu.entityId);
const { roles, permissions } = buildScopedClaims(user.roles, entityIds);
```

In `refresh` (currently ~lines 389-397), replace:

```ts
const roles = user.roles.map((ur) => ur.role.code);
const permissions = [
  ...new Set(user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code)))
];
const entityIds = user.entities.map((eu) => eu.entityId);
```

with:

```ts
const entityIds = user.entities.map((eu) => eu.entityId);
const { roles, permissions } = buildScopedClaims(user.roles, entityIds);
```

(The Prisma `include: { roles: { include: { role: ... } } }` already returns the `entityId` scalar on each UserRole row, in both login and refresh.)

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx vitest run tests/auth.service.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean. If existing login/refresh tests constructed `user.roles` fixtures without `entityId`, the `undefined` branch in the helper keeps them passing (treated as global) — but flag any such fixture and add `entityId: null` explicitly.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/auth.service.ts apps/api/tests/auth.service.test.ts
git commit -m "fix(security): JWT role claims honour UserRole entity scope (NS2)"
```

---

### Task 3: Privilege ceiling on role grants + SUPERADMIN-only definition CRUD (NS2 part 2, R1.3)

**Files:**

- Modify: `apps/api/src/modules/admin/service.ts` (`AdminActorContext`, `assignRoleToUser`, new `checkPrivilegeCeiling`)
- Modify: `apps/api/src/modules/admin/router.ts` (`getActorContext`, `mapScopeError`, definition-route guards)
- Create: `apps/api/tests/admin-privilege-ceiling.test.ts`

Background: `assignRoleToUser` already entity-scopes the grant, but any actor with `ADMIN_ROLES_MANAGE` can grant ANY role — including SUPERADMIN — and the role/permission definition CRUD (`POST/PUT/DELETE /roles`, `/permissions`, role-permission bindings) has no privilege ceiling either.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/admin-privilege-ceiling.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkPrivilegeCeiling, type AdminActorContext } from "../src/modules/admin/service.js";

const perm = (code: string) => ({ permission: { code } });

function actor(overrides: Partial<AdminActorContext> = {}): AdminActorContext {
  return {
    userId: "actor-1",
    roles: ["PROPERTY_ADMIN"],
    permissions: ["ADMIN_USERS", "ADMIN_ROLES_MANAGE", "GL_READ", "GL_POST"],
    entityIds: ["entity-a"],
    entityId: "entity-a",
    ...overrides
  };
}

describe("checkPrivilegeCeiling (NS2 — no self-escalation)", () => {
  it("blocks a non-cross-entity admin from granting SUPERADMIN", () => {
    expect(checkPrivilegeCeiling(actor(), { code: "SUPERADMIN", permissions: [] })).toBe(false);
  });

  it("blocks granting PLATFORM_ADMIN (case-insensitive)", () => {
    expect(checkPrivilegeCeiling(actor(), { code: "platform_admin", permissions: [] })).toBe(false);
  });

  it("blocks granting a role whose permissions exceed the actor's own", () => {
    expect(
      checkPrivilegeCeiling(actor(), {
        code: "CONTROLLER",
        permissions: [perm("GL_READ"), perm("PERIOD_REOPEN")]
      })
    ).toBe(false);
  });

  it("allows granting a role whose permissions are a subset of the actor's", () => {
    expect(
      checkPrivilegeCeiling(actor(), {
        code: "CLERK",
        permissions: [perm("GL_READ"), perm("GL_POST")]
      })
    ).toBe(true);
  });

  it("lets SUPERADMIN grant anything", () => {
    expect(
      checkPrivilegeCeiling(actor({ roles: ["SUPERADMIN"] }), {
        code: "SUPERADMIN",
        permissions: [perm("ANYTHING")]
      })
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/admin-privilege-ceiling.test.ts`
Expected: FAIL — `checkPrivilegeCeiling` not exported.

- [ ] **Step 3: Implement service changes**

In `apps/api/src/modules/admin/service.ts`:

(a) Add `permissions` to the actor context (line ~9):

```ts
export type AdminActorContext = {
  userId?: string;
  roles: string[];
  permissions: string[];
  entityIds: string[];
  entityId?: string;
};
```

(b) Add below `hasCrossEntityAdminAccess`:

```ts
/**
 * Privilege ceiling: an actor may only grant roles that do not exceed their
 * own privileges. Cross-entity admin roles (SUPERADMIN/PLATFORM_ADMIN) can
 * only be granted by actors who already hold cross-entity admin access; any
 * other role requires its permission set to be a subset of the actor's.
 */
export function checkPrivilegeCeiling(
  actor: AdminActorContext,
  role: { code: string; permissions: Array<{ permission: { code: string } }> }
): boolean {
  if (hasCrossEntityAdminAccess(actor)) return true;
  if (CROSS_ENTITY_ADMIN_ROLES.has(role.code.toUpperCase())) return false;
  const actorPermissions = new Set(actor.permissions);
  return role.permissions.every((rp) => actorPermissions.has(rp.permission.code));
}
```

(c) In `assignRoleToUser` (line ~266), after the `actorAccess` check and before `chooseScopedRoleEntityId`, insert:

```ts
const role = await withBypassRLS(db, async (tx: any) =>
  tx.role.findUnique({
    where: { id: roleId },
    include: { permissions: { include: { permission: true } } }
  })
);
if (!role) return { error: "ROLE_NOT_FOUND" as const };
if (!checkPrivilegeCeiling(actor, role)) return { error: "FORBIDDEN" as const };
```

- [ ] **Step 4: Implement router changes**

In `apps/api/src/modules/admin/router.ts`:

(a) `getActorContext` (line ~76) — pass permissions through:

```ts
function getActorContext(request: FastifyRequest): svc.AdminActorContext {
  const user = request.user as any;
  return {
    userId: typeof user?.sub === "string" ? user.sub : undefined,
    roles: Array.isArray(user?.roles) ? user.roles : [],
    permissions: Array.isArray(user?.permissions) ? user.permissions : [],
    entityIds: Array.isArray(user?.entityIds) ? user.entityIds : [],
    entityId: request.entityId
  };
}
```

(b) `mapScopeError` (line ~59) — accept the new error:

```ts
function mapScopeError(
  reply: FastifyReply,
  error: "USER_NOT_FOUND" | "FORBIDDEN" | "ROLE_NOT_FOUND"
) {
  if (error === "USER_NOT_FOUND" || error === "ROLE_NOT_FOUND") {
    const message = error === "USER_NOT_FOUND" ? "User not found." : "Role not found.";
    return reply.code(404).send({ data: null, errors: [{ code: error, message }] });
  }
  return reply.code(403).send({
    data: null,
    errors: [
      {
        code: error,
        message:
          "You cannot manage users outside your assigned entity scope or grant privileges exceeding your own."
      }
    ]
  });
}
```

(c) Add the definition-CRUD guard. Import at top: `import { hasExplicitCrossEntityAccess } from "../../plugins/auth.js";` then add helper near `getActorContext`:

```ts
async function requireCrossEntityAdmin(request: FastifyRequest, reply: FastifyReply) {
  const roles = Array.isArray((request.user as any)?.roles)
    ? ((request.user as any).roles as string[])
    : [];
  if (!hasExplicitCrossEntityAccess(roles)) {
    return reply.code(403).send({
      data: null,
      errors: [
        {
          code: "FORBIDDEN",
          message: "Only SUPERADMIN can manage role and permission definitions."
        }
      ]
    });
  }
}
```

Apply `{ preHandler: [requireCrossEntityAdmin] }` as route options to these existing routes (handler bodies unchanged — second argument added):

- `router.post("/roles", { preHandler: [requireCrossEntityAdmin] }, async (request, reply) => { ... })`
- `router.put<...>("/roles/:id", { preHandler: [requireCrossEntityAdmin] }, ...)`
- `router.delete<...>("/roles/:id", { preHandler: [requireCrossEntityAdmin] }, ...)`
- `router.post("/permissions", { preHandler: [requireCrossEntityAdmin] }, ...)`
- `router.delete<...>("/permissions/:id", { preHandler: [requireCrossEntityAdmin] }, ...)`
- `router.post<...>("/roles/:id/permissions", { preHandler: [requireCrossEntityAdmin] }, ...)`
- `router.delete<...>("/roles/:id/permissions/:permissionId", { preHandler: [requireCrossEntityAdmin] }, ...)`

GET routes stay open to `ADMIN_USERS`/`ADMIN_ROLES_MANAGE` holders (read-only).

- [ ] **Step 5: Run tests + typecheck**

Run: `cd apps/api && npx vitest run tests/admin-privilege-ceiling.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean. `tsc` will flag any other construction sites of `AdminActorContext` missing `permissions` — fix them the same way as `getActorContext`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/service.ts apps/api/src/modules/admin/router.ts apps/api/tests/admin-privilege-ceiling.test.ts
git commit -m "fix(security): privilege ceiling on role grants; SUPERADMIN-only role/permission definition CRUD (NS2)"
```

---

### Task 4: Depreciation idempotency guard (NF4, R1.5)

**Files:**

- Modify: `apps/api/src/modules/fixed-asset/service.ts` (`runDepreciation`, ~lines 354-455)
- Test: `apps/api/tests/fixed-asset-engine.test.ts`

Background: the process lock only blocks **concurrent** runs. A second sequential run posts a second `DEPRC-{y}-{m}` journal and increments `accumulatedDepreciation` again. LER and year-end already guard on an existing journal reference; depreciation must do the same (plus an in-transaction recheck, mirroring `fx/service.ts`).

- [ ] **Step 1: Write the failing test**

In `apps/api/tests/fixed-asset-engine.test.ts`, find the `runDepreciation` describe block and its `mockPrisma`. Ensure the mock has `journal.findFirst: vi.fn().mockResolvedValue(null)` as a default (add it if missing — existing tests must keep passing). Then add:

```ts
it("refuses to run depreciation twice for the same period (NF4 idempotency)", async () => {
  // arrange: same fixtures as the successful-run test, but a DEPRC journal already exists
  mockPrisma.journal.findFirst.mockResolvedValue({
    id: "journal-existing",
    reference: "DEPRC-2026-03",
    status: "POSTED"
  });

  await expect(service.runDepreciation(ENTITY_ID, PERIOD_ID, ACTOR_ID)).rejects.toMatchObject({
    code: "DEPRECIATION_ALREADY_RUN",
    statusCode: 409
  });

  expect(mockPrisma.journal.create ?? vi.fn()).not.toHaveBeenCalled();
});
```

Adapt fixture names (`ENTITY_ID`, `PERIOD_ID`, `ACTOR_ID`, `service`) and the journal-creation mock shape to what that file already uses — the assertion that matters is the 409 `DEPRECIATION_ALREADY_RUN` rejection and that no journal is created.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/fixed-asset-engine.test.ts`
Expected: new test FAILS (run completes instead of rejecting); all existing tests still pass.

- [ ] **Step 3: Implement**

In `runDepreciation`, after the period-status validation (the `DEPRECIATION_PERIOD_NOT_OPEN` throw, ~line 368) and **before** `calculateDepreciation`, insert:

```ts
const journalReference = `DEPRC-${period.year}-${String(period.month).padStart(2, "0")}`;

// Idempotency guard: a posted depreciation journal for this period means
// the run already completed — a second run would double depreciation.
const completedRun = await (this.prisma as any).journal.findFirst({
  where: { entityId, periodId, source: "DEPRC", reference: journalReference, status: "POSTED" }
});
if (completedRun) {
  throw new FixedAssetServiceError(
    "DEPRECIATION_ALREADY_RUN",
    `Depreciation has already been posted for this period (journal ${completedRun.id}).`,
    409
  );
}
```

Inside the `$transaction` callback, before `tx.journal.create`, add the authoritative recheck:

```ts
const completedInTx = await tx.journal.findFirst({
  where: { entityId, periodId, source: "DEPRC", reference: journalReference, status: "POSTED" }
});
if (completedInTx) {
  throw new FixedAssetServiceError(
    "DEPRECIATION_ALREADY_RUN",
    `Depreciation has already been posted for this period (journal ${completedInTx.id}).`,
    409
  );
}
```

And in the `tx.journal.create` data, replace the inline reference with the variable:

```ts
            reference: journalReference,
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx vitest run tests/fixed-asset-engine.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/fixed-asset/service.ts apps/api/tests/fixed-asset-engine.test.ts
git commit -m "fix(finance): depreciation idempotency guard prevents double-posting (NF4)"
```

---

### Task 5: Ledger Revaluation posts account balances (NF1, R1.4)

**Files:**

- Modify: `apps/api/src/modules/fx/ledger-revaluation.ts` (transaction at ~lines 329-399)
- Test: `apps/api/tests/payment-profiles-revaluation.test.ts` (existing LER tests live here)

Background: LER creates POSTED journals (and optional next-period reversals) but never touches `account_period_balances`. Line amounts are derived from natural-sign journal-line sums, so debit/credit direction is already correct — only the canonical balance write is missing.

- [ ] **Step 1: Write the failing test**

In `apps/api/tests/payment-profiles-revaluation.test.ts`, add the GLRepository spy (see Ground rules) in the LER describe block's `beforeEach`, and add to the existing successful-posting test (the one that asserts a journal is created):

```ts
// NF1: balances must be updated for the revaluation journal
expect(balanceSpy).toHaveBeenCalledWith(
  ENTITY_ID,
  PERIOD_ID,
  expect.arrayContaining([
    expect.objectContaining({ accountId: expect.any(String), accountType: expect.any(String) })
  ])
);
```

And extend the auto-reverse test (the one asserting a reversal journal in `NEXT_PERIOD_ID`):

```ts
// NF1: reversal balances posted to the next period with flipped amounts
const reversalCall = balanceSpy.mock.calls.find((c) => c[1] === NEXT_PERIOD_ID);
expect(reversalCall).toBeDefined();
```

Stronger assertion where fixtures make amounts known: for a revaluation gain of `X` on account `acc-1` with gain account `acc-gain`, the first call's lines must contain `{ accountId: "acc-1", debitFunctional: D(X), creditFunctional: D(0) }` and `{ accountId: "acc-gain", debitFunctional: D(0), creditFunctional: D(X) }` (compare with `toNum(...)` per the file's helper), and the reversal call must contain the same accounts flipped.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/payment-profiles-revaluation.test.ts`
Expected: new assertions FAIL (`balanceSpy` never called).

- [ ] **Step 3: Implement**

In `apps/api/src/modules/fx/ledger-revaluation.ts`:

(a) Import: `import { GLRepository } from "../gl/repository.js";`

(b) After gain/loss accounts are resolved (~line 278) and before the journal-lines loop, build a type map:

```ts
const accountTypeById = new Map<string, string>();
for (const acct of accounts) accountTypeById.set(acct.id, acct.type);
accountTypeById.set(gainAccount.id, gainAccount.type);
accountTypeById.set(lossAccount.id, lossAccount.type);
```

(c) Inside the `$transaction` callback, immediately after the main `tx.journal.create` (after `const journal = await tx.journal.create({...});`):

```ts
const glRepo = new GLRepository(tx);
await glRepo.batchUpdateAccountBalances(
  entityId,
  input.periodId,
  journalLines.map((jl) => ({
    accountId: jl.accountId,
    debitFunctional: D(jl.debit),
    creditFunctional: D(jl.credit),
    accountType: accountTypeById.get(jl.accountId)!
  }))
);
```

(d) Inside the auto-reverse branch, immediately after the reversal `tx.journal.create` (after `revId = reversalJournal.id;` is fine):

```ts
await glRepo.batchUpdateAccountBalances(
  entityId,
  nextPeriod.id,
  journalLines.map((jl) => ({
    accountId: jl.accountId,
    debitFunctional: D(jl.credit), // flipped — reversal
    creditFunctional: D(jl.debit),
    accountType: accountTypeById.get(jl.accountId)!
  }))
);
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx vitest run tests/payment-profiles-revaluation.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/fx/ledger-revaluation.ts apps/api/tests/payment-profiles-revaluation.test.ts
git commit -m "fix(finance): ledger revaluation updates account_period_balances for journal and reversal (NF1)"
```

---

### Task 6: Year-end cleardown posts account balances + canonical sign direction (NF2, R1.4)

**Files:**

- Modify: `apps/api/src/modules/period-close/year-end-cleardown.ts` (~lines 195-281)
- Test: `apps/api/tests/year-end-intercompany.test.ts`

Background — **two defects, not one**:

1. The journal never updates `account_period_balances` (the headline NF2).
2. The engine was written against natural-sign balances (test fixtures: revenue closing `-50000`), but `account_period_balances.closing_balance` is **normal-balance-positive** (see `GLRepository.updateAccountBalance`: credit-normal closing = credits − debits, so revenue in its normal state is POSITIVE). Against real canonical data the current `balD.gt(ZERO) → credit` logic **credits revenue instead of debiting it** — adding balance updates without fixing direction would double revenue instead of zeroing it.

Fix: choose the posting side per account normal-balance, compute net P&L as `revenue − expense` (both canonical-positive), update balances through `GLRepository`, and flip the test fixtures to canonical signs. With canonical fixtures the resulting journal lines are identical to what the old code produced with natural-sign fixtures, so most journal assertions survive — only fixtures and total/netProfitLoss expectations change.

- [ ] **Step 1: Update fixtures and write the failing tests**

In `apps/api/tests/year-end-intercompany.test.ts`, in the cleardown describe blocks:

(a) Flip every revenue `closingBalance` fixture to canonical positive (expense stays positive — it already was):

- `{ accountId: "acc-rev-1", closingBalance: -50000 }` → `closingBalance: 50000`
- `-80000` → `80000`, `-20000` → `20000`, `-10000` → `10000`, `-5000` → `5000`, `0.001` stays.

(b) Update result expectations: `totalRevenue` becomes positive, `netProfitLoss` = revenue − expense (e.g. revenue 100000, expense 60000 → netProfitLoss 40000). Journal-line debit/credit assertions should already hold (revenue lines = debits, expense lines = credits, RE offset = credit of 40000); fix any that don't match this canonical shape.

(c) Add the GLRepository spy (Ground rules) and a new test:

```ts
it("updates account balances so the cleardown actually zeroes the TB (NF2)", async () => {
  mockPrisma.accountPeriodBalance.findMany.mockResolvedValue([
    { accountId: "acc-rev-1", closingBalance: 100000 }, // canonical: revenue positive
    { accountId: "acc-exp-1", closingBalance: 60000 }
  ]);

  await runYearEndCleardown(mockPrisma, ENTITY_ID, ACTOR_ID, { periodId: PERIOD_ID });

  expect(balanceSpy).toHaveBeenCalledTimes(1);
  const [entityArg, periodArg, lines] = balanceSpy.mock.calls[0];
  expect(entityArg).toBe(ENTITY_ID);
  expect(periodArg).toBe(PERIOD_ID);

  const byAccount = new Map(lines.map((l: any) => [l.accountId, l]));
  // DR revenue 100000 zeroes the credit-normal balance
  expect(toNum(byAccount.get("acc-rev-1").debitFunctional)).toBe(100000);
  expect(byAccount.get("acc-rev-1").accountType).toBe("REVENUE");
  // CR expense 60000 zeroes the debit-normal balance
  expect(toNum(byAccount.get("acc-exp-1").creditFunctional)).toBe(60000);
  // CR retained earnings 40000 (profit)
  expect(toNum(byAccount.get("acc-re").creditFunctional)).toBe(40000);
  expect(byAccount.get("acc-re").accountType).toBe("EQUITY");
});
```

(Add a local `toNum` helper if the file lacks one: `const toNum = (v: any) => (typeof v?.toNumber === "function" ? v.toNumber() : Number(v));`)

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `cd apps/api && npx vitest run tests/year-end-intercompany.test.ts`
Expected: new test FAILS; fixture-flipped tests may also fail until the implementation lands (direction logic) — that's expected at this point.

- [ ] **Step 3: Implement**

In `apps/api/src/modules/period-close/year-end-cleardown.ts`:

(a) Import: `import { GLRepository } from "../gl/repository.js";`

(b) Replace the net P&L line (~line 196):

```ts
// Canonical closing balances are normal-balance-positive, so P&L = revenue − expense
const netProfitLossD = totalRevenueD.sub(totalExpenseD);
```

(c) Replace the journal-line direction loop (~lines 206-226):

```ts
const DEBIT_NORMAL_TYPES = new Set(["ASSET", "EXPENSE", "CONTRA_REVENUE"]);

for (const line of lines) {
  const account = plAccounts.find((a: any) => a.code === line.accountCode);
  if (!account) continue;

  const balD = D(line.closingBalance);
  // account_period_balances stores normal-balance-positive closing balances
  // (GLRepository.updateAccountBalance). Zero a debit-normal account by
  // crediting its balance; zero a credit-normal account by debiting it.
  const isDebitNormal = DEBIT_NORMAL_TYPES.has(account.type);
  const postAsCredit = isDebitNormal ? balD.gt(ZERO) : balD.lt(ZERO);

  if (postAsCredit) {
    journalLines.push({
      accountId: account.id,
      debit: "0",
      credit: balD.abs().toFixed(4),
      description: `Year-end cleardown ${line.accountCode} ${line.accountName}`
    });
  } else {
    journalLines.push({
      accountId: account.id,
      debit: balD.abs().toFixed(4),
      credit: "0",
      description: `Year-end cleardown ${line.accountCode} ${line.accountName}`
    });
  }
}
```

(d) Before the `$transaction`, build the type map:

```ts
const accountTypeById = new Map<string, string>(plAccounts.map((a: any) => [a.id, a.type]));
accountTypeById.set(reAccount.id, reAccount.type);
```

(e) Inside the `$transaction`, after `tx.journal.create` and before `updatePeriodCloseStatusTx`:

```ts
const glRepo = new GLRepository(tx);
await glRepo.batchUpdateAccountBalances(
  entityId,
  input.periodId,
  journalLines.map((jl) => ({
    accountId: jl.accountId,
    debitFunctional: D(jl.debit),
    creditFunctional: D(jl.credit),
    accountType: accountTypeById.get(jl.accountId)!
  }))
);
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx vitest run tests/year-end-intercompany.test.ts && npx tsc --noEmit`
Expected: ALL cleardown tests PASS with canonical fixtures.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/period-close/year-end-cleardown.ts apps/api/tests/year-end-intercompany.test.ts
git commit -m "fix(finance): year-end cleardown updates balances and zeroes P&L under canonical sign convention (NF2)"
```

---

### Task 7: Intercompany posting updates both entities' balances (NF3, R1.4)

**Files:**

- Modify: `apps/api/src/modules/intercompany/service.ts` (`doCreateTransaction` ~440-581, `approveTransaction` ~684-776, `reverseTransaction` ~887+)
- Test: `apps/api/tests/year-end-intercompany.test.ts` (IC describe block) and/or `apps/api/tests/intercompany-v2.test.ts`

Background: all **three** IC posting paths (direct create, approve, reverse) create two POSTED journals — one per entity — and never update `account_period_balances` for either. Each path resolves four full account rows (`tx.account.findFirst`, so `.type` is available).

- [ ] **Step 1: Write the failing tests**

In the IC test file: add `type` to the account fixtures (e.g. `IC_REC_ACCOUNT` → `type: "ASSET"`, `IC_PAY_ACCOUNT` → `type: "LIABILITY"`; any revenue/expense mapping accounts get their types). Add the GLRepository spy. Then for the existing successful direct-post test add:

```ts
// NF3: balances must move in BOTH entities
expect(balanceSpy).toHaveBeenCalledTimes(2);

const initiatorCall = balanceSpy.mock.calls.find((c) => c[0] === ENTITY_ID);
const counterpartyCall = balanceSpy.mock.calls.find((c) => c[0] === MIRROR_ENTITY_ID);
expect(initiatorCall).toBeDefined();
expect(counterpartyCall).toBeDefined();

const initiatorLines = initiatorCall![2];
expect(initiatorLines).toHaveLength(2);
expect(initiatorLines.map((l: any) => l.accountType)).toEqual(
  expect.arrayContaining(["ASSET", "LIABILITY"])
);
```

Add equivalent assertions (`balanceSpy` called twice, once per entity) to the approve-path test and the reverse-path test if they exist; if a path has no test, add a minimal one following the file's existing fixtures for that path.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/year-end-intercompany.test.ts tests/intercompany-v2.test.ts`
Expected: new assertions FAIL (spy never called).

- [ ] **Step 3: Implement**

In `apps/api/src/modules/intercompany/service.ts`:

(a) Import: `import { GLRepository } from "../gl/repository.js";`

(b) Add a private helper to the `IntercompanyService` class (one canonical implementation for all three paths). Use the file's existing `D` helper for zero:

```ts
  /**
   * Post canonical balance updates for one IC journal pair: a debit line and a
   * credit line of the same functional amount in each of the two entities.
   */
  private async updateICBalances(
    tx: any,
    sides: Array<{
      entityId: string;
      periodId: string;
      debitAcct: { id: string; type: string };
      creditAcct: { id: string; type: string };
      amount: Prisma.Decimal;
    }>
  ): Promise<void> {
    const glRepo = new GLRepository(tx);
    for (const side of sides) {
      await glRepo.batchUpdateAccountBalances(side.entityId, side.periodId, [
        {
          accountId: side.debitAcct.id,
          debitFunctional: side.amount,
          creditFunctional: D(0),
          accountType: side.debitAcct.type
        },
        {
          accountId: side.creditAcct.id,
          debitFunctional: D(0),
          creditFunctional: side.amount,
          accountType: side.creditAcct.type
        }
      ]);
    }
  }
```

(c) In `doCreateTransaction`, inside the `$transaction`, after the counterparty `tx.journal.create` and before `tx.iCTransaction.create`:

```ts
await this.updateICBalances(tx, [
  {
    entityId: initiatingEntityId,
    periodId: period.id,
    debitAcct: initiatorDebitAcct,
    creditAcct: initiatorCreditAcct,
    amount: functionalAmountInitiator
  },
  {
    entityId: input.counterpartyEntityId,
    periodId: counterpartyPeriod.id,
    debitAcct: counterpartyDebitAcct,
    creditAcct: counterpartyCreditAcct,
    amount: functionalAmountCounterparty
  }
]);
```

(d) In `approveTransaction`, after the counterparty `tx.journal.create` and before `tx.iCTransaction.update` — identical block, with `txn.initiatingEntityId`, `initiatorPeriod.id`, `txn.counterpartyEntityId`, `counterpartyPeriod.id`.

(e) In `reverseTransaction`, after the counterparty reversal `tx.journal.create` — identical block with that path's variables (note the debit/credit account codes are already swapped there, so the helper is called the same way).

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx vitest run tests/year-end-intercompany.test.ts tests/intercompany-v2.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/intercompany/service.ts apps/api/tests/year-end-intercompany.test.ts apps/api/tests/intercompany-v2.test.ts
git commit -m "fix(finance): intercompany create/approve/reverse update account balances in both entities (NF3)"
```

---

### Task 8: Consolidation validates child entities against parent lineage (NS3, R1.6)

**Files:**

- Modify: `apps/api/src/modules/consolidation/service.ts` (`runConsolidation`, ~line 63)
- Test: `apps/api/tests/consolidation-ic.test.ts`

Background: `runConsolidation` queries `mv_period_account_balances` (materialized views ignore RLS) for arbitrary caller-supplied `childEntityIds` — a parent-scoped user can read any sibling entity's trial balance. The router already enforces `request.entityId === parentEntityId` and the auth plugin validates that entity against JWT claims (including descendants), so requiring every child to be a **descendant of the parent** closes the hole: descendants of an authorized parent are within the caller's access by the same lineage rule `plugins/auth.ts` uses.

Implementation mirrors `resolveEntityLineage` from `plugins/auth.ts` (raw SQL upward walk — works before/outside entity RLS context).

- [ ] **Step 1: Write the failing tests**

In `apps/api/tests/consolidation-ic.test.ts`, add to the consolidation `mockPrisma` (or extend if present):

```ts
const PARENT_ID = "parent-1";
const CHILD_ID = "child-1";
const SIBLING_ID = "sibling-1";

const ENTITY_TREE: Record<string, { id: string; parentId: string | null }> = {
  [PARENT_ID]: { id: PARENT_ID, parentId: null },
  [CHILD_ID]: { id: CHILD_ID, parentId: PARENT_ID },
  [SIBLING_ID]: { id: SIBLING_ID, parentId: "other-parent" },
  "other-parent": { id: "other-parent", parentId: null }
};

mockPrisma.$queryRawUnsafe = vi.fn().mockImplementation(async (_sql: string, id: string) => {
  return ENTITY_TREE[id] ? [ENTITY_TREE[id]] : [];
});
```

Then add tests (adapt the happy-path arrange to the file's existing run fixtures):

```ts
it("rejects child entities that are not descendants of the parent (NS3 IDOR)", async () => {
  await expect(
    service.runConsolidation({
      parentEntityId: PARENT_ID,
      childEntityIds: [SIBLING_ID],
      reportingCurrency: "USD",
      periodId: PERIOD_ID
    })
  ).rejects.toMatchObject({ code: "CONSOL_CHILD_FORBIDDEN", statusCode: 403 });
});

it("rejects the parent listed as its own child", async () => {
  await expect(
    service.runConsolidation({
      parentEntityId: PARENT_ID,
      childEntityIds: [PARENT_ID],
      reportingCurrency: "USD",
      periodId: PERIOD_ID
    })
  ).rejects.toMatchObject({ code: "CONSOL_CHILD_FORBIDDEN", statusCode: 403 });
});

it("accepts genuine descendants", async () => {
  // existing happy-path arrange; childEntityIds: [CHILD_ID]
  // assert the run proceeds past validation (no CONSOL_CHILD_FORBIDDEN)
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/consolidation-ic.test.ts`
Expected: new tests FAIL (no validation exists, runs proceed).

- [ ] **Step 3: Implement**

In `apps/api/src/modules/consolidation/service.ts`, add to the class:

```ts
  /** Walk parent_id upward from an entity (raw SQL — mirrors plugins/auth.ts). */
  private async resolveEntityLineage(entityId: string): Promise<string[]> {
    const lineage: string[] = [];
    const visited = new Set<string>();
    let currentId: string | null = entityId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const rows = (await (this.prisma as any).$queryRawUnsafe(
        `SELECT id, parent_id as "parentId" FROM entities WHERE id = $1 LIMIT 1`,
        currentId
      )) as Array<{ id: string; parentId: string | null }>;
      const entity = rows[0];
      if (!entity) break;
      lineage.push(entity.id);
      currentId = entity.parentId;
    }

    return lineage;
  }

  /**
   * NS3: every consolidated child must be a strict descendant of the parent.
   * mv_period_account_balances ignores RLS, so this is the access boundary.
   */
  private async assertChildrenAreSubsidiaries(
    parentEntityId: string,
    childEntityIds: string[]
  ): Promise<void> {
    for (const childId of [...new Set(childEntityIds)]) {
      const lineage = await this.resolveEntityLineage(childId);
      const isStrictDescendant =
        childId !== parentEntityId && lineage.slice(1).includes(parentEntityId);
      if (!isStrictDescendant) {
        throw new ConsolidationServiceError(
          "CONSOL_CHILD_FORBIDDEN",
          `Entity ${childId} is not a subsidiary of the consolidation parent.`,
          403
        );
      }
    }
  }
```

In `runConsolidation`, immediately after the `parentEntity` not-found check, insert:

```ts
await this.assertChildrenAreSubsidiaries(request.parentEntityId, request.childEntityIds);
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx vitest run tests/consolidation-ic.test.ts && npx tsc --noEmit`
Expected: PASS. If pre-existing consolidation tests now fail with `CONSOL_CHILD_FORBIDDEN`, give their mock `$queryRawUnsafe` the lineage map so their children are genuine descendants — do not weaken the validation.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/consolidation/service.ts apps/api/tests/consolidation-ic.test.ts
git commit -m "fix(security): consolidation validates childEntityIds against parent lineage (NS3)"
```

---

### Task 9: Secrets rotation runbook (NS4, R1.2)

**Files:**

- Create: `docs/SECRETS-ROTATION.md`

Verified already: neither `.env` nor `apps/api/.env` was ever committed (`git log --all` over both paths is empty; `git ls-files` shows nothing) — no history rewriting needed. The actual rotation requires AWS console / infrastructure access the agent does not have, so the deliverable is the runbook plus an explicit handoff to the user.

- [ ] **Step 1: Write `docs/SECRETS-ROTATION.md`**

```markdown
# Secrets Rotation Runbook (NS4 — CRITICAL-ASSESSMENT-2026-06-11)

Treat every value currently in `apps/api/.env` and the root `.env` as compromised
(they sat in plaintext on developer disks). Git history is clean — neither file
was ever committed — so rotation, not history rewriting, is what is required.

## 1. AWS SES access key (apps/api/.env: AWS_SES_ACCESS_KEY_ID / AWS_SES_SECRET_ACCESS_KEY)

1. AWS Console → IAM → Users → the SES sending user → Security credentials.
2. Create a new access key. Update `apps/api/.env` (or the secrets manager) with it.
3. Deploy/restart the API, send a test email (password-reset flow).
4. Deactivate, verify nothing breaks for 24h, then delete the old key.
5. Check CloudTrail for unexpected use of the old key before deletion.

## 2. JWT signing secret (JWT_SECRET — set in BOTH apps/api/.env and root .env)

1. Generate: `openssl rand -hex 64` (or `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`).
2. Replace `JWT_SECRET` in both files — they MUST match (the API and auth plugin read the same var).
3. Restart the API. **All existing access tokens become invalid immediately and
   every user must log in again** — schedule accordingly. Redis-backed sessions
   survive; only the JWTs are invalidated.

## 3. Platform API key (PLATFORM_API_KEY)

1. Generate a new value (same command as above).
2. Update `apps/api/.env` and every platform-level client that sends it.

## 4. Keycloak admin password (root .env)

1. Rotate via Keycloak admin console (or disable the account if Keycloak is no
   longer in the auth path — native auth has replaced it).

## 5. Get secrets off disk (target state)

- Move runtime secrets to a secrets manager (AWS Secrets Manager / SSM Parameter
  Store / Doppler) and inject as environment variables at deploy time.
- `.env` files remain for local development only, with placeholder values;
  `apps/api/.env.example` is the documented template.

## Status

- [ ] SES key rotated
- [ ] JWT_SECRET rotated
- [ ] PLATFORM_API_KEY rotated
- [ ] Keycloak admin password rotated/disabled
- [ ] Secrets manager adopted
```

- [ ] **Step 2: Commit**

```bash
git add docs/SECRETS-ROTATION.md
git commit -m "docs(security): secrets rotation runbook for NS4 (rotation itself requires operator access)"
```

- [ ] **Step 3: Tell the user** (in the session summary): rotation of the AWS SES key, JWT secret, platform key, and Keycloak password requires their AWS/infra access — point them at `docs/SECRETS-ROTATION.md`.

---

### Task 10: Full verification + assessment status update

**Files:**

- Modify: `docs/CRITICAL-ASSESSMENT-2026-06-11.md` (status columns only)

- [ ] **Step 1: Full suites**

Run:

```bash
cd apps/api && npx vitest run && npx tsc --noEmit
cd ../../packages/tml-engine && npx vitest run && npx tsc --noEmit
```

Expected: every test passes (baseline was 592 API tests; new tests add to that). Fix any regression before proceeding — do not skip tests to get green.

- [ ] **Step 2: Update statuses in `docs/CRITICAL-ASSESSMENT-2026-06-11.md`**

For NS1, NS2, NS3, NF1, NF2, NF3, NF4 rows and Tier 1 rows R1.1, R1.3–R1.6: change `OPEN` → `FIXED (2026-06-12)`. For NS4/R1.2: change to `PARTIAL (2026-06-12) — runbook in docs/SECRETS-ROTATION.md; rotation pending operator`. Add one line under NF2's row noting the additional direction fix: "Cleardown direction was also inverted for credit-normal accounts under the canonical balance convention; fixed together with the balance updates."

- [ ] **Step 3: Commit**

```bash
git add docs/CRITICAL-ASSESSMENT-2026-06-11.md
git commit -m "docs: mark Tier 1 findings fixed (NS1-NS3, NF1-NF4); NS4 partial pending operator rotation"
```

---

## Self-review notes

- **Spec coverage:** R1.1→Task 1, R1.2→Task 9, R1.3→Tasks 2+3, R1.4→Tasks 5+6+7, R1.5→Task 4, R1.6→Task 8, verification→Task 10. All six Tier 1 rows covered.
- **Known judgment calls baked in:**
  - Task 1 allows a `TML_ALLOW_INSECURE_SANDBOX` non-production escape hatch (assessment said "fail closed"; production always fails closed — the hatch exists because isolated-vm needs native build tooling that may be absent on dev machines).
  - Task 2 includes scoped non-admin roles' permissions in the global claims (current behavior preserved); only cross-entity-admin roles are scope-blocked. Full per-entity claim scoping is a larger change deferred to Tier 2+.
  - Task 6 fixes a direction bug the assessment did not list (NF2/NF8 interaction) because adding balance updates without it would corrupt revenue balances.
- **Type consistency:** `batchUpdateAccountBalances(entityId, periodId, lines[{accountId, debitFunctional: Prisma.Decimal, creditFunctional: Prisma.Decimal, accountType: string}])` matches `gl/repository.ts:518`. `AdminActorContext.permissions` added in Task 3 and consumed in `checkPrivilegeCeiling`; `getActorContext` updated in the same task.
