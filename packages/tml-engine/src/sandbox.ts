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
