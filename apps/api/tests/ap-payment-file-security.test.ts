import Fastify from "fastify";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runWithContext } from "../src/db/requestContext.js";

const storageMock = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn()
}));

vi.mock("../src/jobs/transfer-desk-storage.js", () => ({
  getStorageBackend: () => storageMock
}));

import {
  APService,
  buildPaymentFileStorageKey,
  sanitizePaymentFileDownloadName,
  validatePaymentFileStorageKey
} from "../src/modules/ap/service.js";
import { registerAPRouter } from "../src/modules/ap/router.js";
import { setAccessService } from "../src/modules/access/runtime.js";
import { staticAccessService } from "./helpers/access.js";

function makeService(paymentRun: Record<string, unknown> | null) {
  const prisma = {
    paymentRun: {
      findFirst: vi.fn().mockResolvedValue(paymentRun)
    }
  };
  return {
    service: new APService(prisma as never),
    prisma
  };
}

describe("AP payment file storage security", () => {
  beforeEach(() => {
    storageMock.read.mockReset();
    storageMock.write.mockReset();
  });

  it("builds payment file keys under tenant and entity namespaces", () => {
    expect(
      buildPaymentFileStorageKey({
        tenantSlug: "hotel-a",
        entityId: "entity-1",
        paymentRunId: "run-1",
        extension: "csv"
      })
    ).toBe("payment-runs/hotel-a/entities/entity-1/runs/run-1/bank-file.csv");
  });

  it("rejects path traversal-like stored keys before reading storage", async () => {
    const { service } = makeService({
      id: "run-1",
      entityId: "entity-1",
      bankFilePath: "payment-runs/hotel-a/entities/entity-1/runs/run-1/../../secret.csv"
    });

    await expect(
      runWithContext({ tenantSlug: "hotel-a" }, () =>
        service.getPaymentRunBankFile("entity-1", "run-1")
      )
    ).rejects.toMatchObject({ code: "AP_PAYMENT_FILE_INVALID_STORAGE_KEY" });
    expect(storageMock.read).not.toHaveBeenCalled();
  });

  it("denies download when the payment run does not belong to the requested entity", async () => {
    const { service, prisma } = makeService(null);

    await expect(
      runWithContext({ tenantSlug: "hotel-a" }, () =>
        service.getPaymentRunBankFile("wrong-entity", "run-1")
      )
    ).rejects.toMatchObject({ code: "AP_PAYMENT_RUN_NOT_FOUND" });
    expect(prisma.paymentRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entityId: "wrong-entity", id: "run-1" } })
    );
  });

  it("reads download content from the configured storage backend", async () => {
    const storageKey = buildPaymentFileStorageKey({
      tenantSlug: "hotel-a",
      entityId: "entity-1",
      paymentRunId: "run-1",
      extension: "csv"
    });
    storageMock.read.mockResolvedValueOnce("header\r\nrow\r\n");
    const { service } = makeService({
      id: "run-1",
      entityId: "entity-1",
      bankFilePath: storageKey
    });

    const file = await runWithContext({ tenantSlug: "hotel-a" }, () =>
      service.getPaymentRunBankFile("entity-1", "run-1")
    );

    expect(storageMock.read).toHaveBeenCalledWith(storageKey);
    expect(file).toEqual({
      content: "header\r\nrow\r\n",
      contentType: "text/csv",
      filename: "payment-run-run-1.csv",
      storageKey
    });
  });

  it("returns a controlled missing-object error when storage cannot read the file", async () => {
    const storageKey = buildPaymentFileStorageKey({
      tenantSlug: "hotel-a",
      entityId: "entity-1",
      paymentRunId: "run-1",
      extension: "xml"
    });
    storageMock.read.mockRejectedValueOnce(new Error("not found"));
    const { service } = makeService({
      id: "run-1",
      entityId: "entity-1",
      bankFilePath: storageKey
    });

    await expect(
      runWithContext({ tenantSlug: "hotel-a" }, () =>
        service.getPaymentRunBankFile("entity-1", "run-1")
      )
    ).rejects.toMatchObject({ code: "AP_PAYMENT_FILE_MISSING", statusCode: 404 });
  });

  it("sanitizes download filenames and validates tenant/entity/run ownership", () => {
    expect(sanitizePaymentFileDownloadName('run/../"bad"', "mt103")).toBe(
      "payment-run-run..bad.mt103"
    );
    expect(() =>
      validatePaymentFileStorageKey(
        "payment-runs/hotel-a/entities/entity-2/runs/run-1/bank-file.csv",
        {
          tenantSlug: "hotel-a",
          entityId: "entity-1",
          paymentRunId: "run-1"
        }
      )
    ).toThrowError("Payment file storage key does not match");
  });
});

describe("AP payment file download route authorization", () => {
  let app: ReturnType<typeof Fastify> | null = null;

  afterEach(async () => {
    setAccessService(null);
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("denies GET /payment-runs/:id/download without AP_PAYMENT_CONFIRM", async () => {
    app = Fastify({ logger: false });
    app.decorate("verifyAccessToken", async (request: any) => {
      request.user = { sub: "user-1", tenantId: "tenant-1" };
      request.entityId = "entity-1";
    });
    setAccessService(
      staticAccessService({
        tenantPermissions: [],
        entityPermissions: { "entity-1": ["PAYMENT_RUN_CREATE", "PAYMENT_RUN_READ"] }
      })
    );
    await registerAPRouter(app as any);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/ap/payment-runs/run-1/download",
      headers: { "x-entity-id": "entity-1" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      errors: [{ code: "INSUFFICIENT_PERMISSIONS" }]
    });
    expect(storageMock.read).not.toHaveBeenCalled();
  });
});
