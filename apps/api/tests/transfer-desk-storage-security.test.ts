import { describe, expect, it } from "vitest";
import {
  assertSafeStorageKey,
  assertStorageRootIsPrivate
} from "../src/jobs/transfer-desk-storage.js";

describe("StorageBackend security guards", () => {
  it("rejects unsafe object keys", () => {
    expect(() => assertSafeStorageKey("../secret.csv")).toThrow();
    expect(() => assertSafeStorageKey("payment-runs\\secret.csv")).toThrow();
    expect(() => assertSafeStorageKey("/tmp/secret.csv")).toThrow();
    expect(() => assertSafeStorageKey("file:///tmp/secret.csv")).toThrow();
  });

  it("rejects local storage roots under public web directories", () => {
    expect(() => assertStorageRootIsPrivate("apps/web/public/payment-runs")).toThrow(
      "TD_LOCAL_UPLOADS_PATH must not point inside a public web root"
    );
    expect(() => assertStorageRootIsPrivate("uploads")).not.toThrow();
  });
});
