import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createSandbox, SandboxUnavailableError, SandboxValidationError } from "../src/sandbox.js";

const req = createRequire(import.meta.url);
let hasIvm = true;
try {
  // resolve() is not enough — the native binary may be missing if build scripts were skipped
  req("isolated-vm");
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
    const sb = createSandbox([{ name: "double", params: ["x"], body: "return x * 2;" }], "", {
      ivmLoader: hasIvm ? undefined : failingLoader,
      allowInsecureFallback: true
    });
    expect(sb.callFunction("double", [21])).toBe(42);
    sb.dispose();
  });
});

describe("fail-closed behaviour", () => {
  it("throws SandboxUnavailableError when isolated-vm cannot load and no override is set", () => {
    expect(() => createSandbox([], "", { ivmLoader: failingLoader })).toThrow(
      SandboxUnavailableError
    );
  });

  it("ignores the environment: the flag alone does not allow the fallback", () => {
    vi.stubEnv("TML_ALLOW_INSECURE_SANDBOX", "true");
    vi.stubEnv("NODE_ENV", "test");
    expect(() => createSandbox([], "", { ivmLoader: failingLoader })).toThrow(
      SandboxUnavailableError
    );
  });

  it("uses the vm fallback only when the caller allows it", () => {
    const sb = createSandbox([{ name: "id", params: ["x"], body: "return x;" }], "", {
      ivmLoader: failingLoader,
      allowInsecureFallback: true
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
