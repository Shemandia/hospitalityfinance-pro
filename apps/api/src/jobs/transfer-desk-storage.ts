/**
 * Transfer Desk — file storage abstraction.
 *
 * Provides a unified interface for reading/writing transfer files regardless
 * of whether the deployment uses local disk (dev) or S3 (prod).
 *
 * Switched by STORAGE_BACKEND env var: "local" | "s3" (defaults to "local").
 */

import fs from "node:fs/promises";
import path from "node:path";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

// ── Interface ────────────────────────────────────────────────────────────────

export interface StorageBackend {
  /** Read a file and return its content as a UTF-8 string. */
  read(key: string): Promise<string>;
  /** Write content to a file. Creates parent directories/prefixes as needed. */
  write(key: string, content: string): Promise<void>;
}

// ── Local filesystem (dev) ───────────────────────────────────────────────────

export class LocalStorageBackend implements StorageBackend {
  constructor(private readonly basePath: string) {}

  async read(key: string): Promise<string> {
    const fullPath = path.resolve(this.basePath, key);
    return fs.readFile(fullPath, "utf-8");
  }

  async write(key: string, content: string): Promise<void> {
    const fullPath = path.resolve(this.basePath, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
  }
}

// ── S3 (prod) ────────────────────────────────────────────────────────────────

export class S3StorageBackend implements StorageBackend {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.client = new S3Client({
      region: process.env.AWS_REGION ?? "eu-west-1"
    });
    this.bucket = process.env.TD_S3_BUCKET ?? "hfp-transfer-desk";
  }

  async read(key: string): Promise<string> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return (await res.Body?.transformToString("utf-8")) ?? "";
  }

  async write(key: string, content: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: "text/plain; charset=utf-8"
      })
    );
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

let _instance: StorageBackend | null = null;

export function getStorageBackend(): StorageBackend {
  if (!_instance) {
    const backend = process.env.STORAGE_BACKEND ?? "local";
    if (backend === "s3") {
      _instance = new S3StorageBackend();
    } else {
      const basePath = process.env.TD_LOCAL_UPLOADS_PATH ?? "./uploads";
      _instance = new LocalStorageBackend(basePath);
    }
  }
  return _instance;
}

/** Reset the cached instance (for testing). */
export function resetStorageBackend(): void {
  _instance = null;
}
