/**
 * @hfp/tml-engine — JavaScript sandbox
 *
 * Executes user-defined JavaScript functions in a secure context.
 * Prefers isolated-vm (V8 isolate) for security; falls back to Node's
 * vm module if isolated-vm is unavailable.
 */

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
}

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MEMORY_MB = 64;

/**
 * Create a sandbox with the given user functions and built-in function source.
 * Tries isolated-vm first; falls back to Node vm module.
 */
export function createSandbox(
  userFunctions: TmlUserFunction[],
  builtinSource: string,
  options?: SandboxOptions
): Sandbox {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryMb = options?.memoryMb ?? DEFAULT_MEMORY_MB;

  // Build combined source: builtins first, then user functions
  const fnSource = buildFunctionSource(userFunctions, builtinSource);

  // Try isolated-vm first
  try {
    return createIsolatedVmSandbox(fnSource, timeoutMs, memoryMb);
  } catch {
    // isolated-vm not available — fall back to Node vm
    return createVmSandbox(fnSource, timeoutMs);
  }
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

function createIsolatedVmSandbox(fnSource: string, timeoutMs: number, memoryMb: number): Sandbox {
  // Dynamic require to avoid hard dependency — isolated-vm may not be installed
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const ivm = require("isolated-vm");

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

// ── Node vm fallback sandbox ───────────────────────────────────────────────

function createVmSandbox(fnSource: string, timeoutMs: number): Sandbox {
  const sandbox: Record<string, unknown> = {};
  const ctx = vm.createContext(sandbox);

  // Run function definitions in the sandbox context
  vm.runInContext(fnSource, ctx, { timeout: timeoutMs });

  // Inject __call helper
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
