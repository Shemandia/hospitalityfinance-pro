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
import { config, requireConfig } from "../config.js";

// ── Interface ────────────────────────────────────────────────────────────────

export interface StorageBackend {
  /** Read a file and return its content as a UTF-8 string. */
  read(key: string): Promise<string>;
  /** Write content to a file. Creates parent directories/prefixes as needed. */
  write(key: string, content: string): Promise<void>;
}

export function assertSafeStorageKey(key: string): string {
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new Error("Storage key is required.");
  }

  if (
    key.includes("\\") ||
    key.startsWith("/") ||
    key.startsWith("./") ||
    /^[a-zA-Z]:/.test(key) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(key)
  ) {
    throw new Error("Storage key must be a relative object key.");
  }

  const normalized = path.posix.normalize(key);
  const segments = normalized.split("/");
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    segments.includes("..") ||
    segments.includes("")
  ) {
    throw new Error("Storage key contains unsafe path segments.");
  }

  return normalized;
}

// ── Local filesystem (dev) ───────────────────────────────────────────────────

export class LocalStorageBackend implements StorageBackend {
  private readonly rootPath: string;

  constructor(private readonly basePath: string) {
    this.rootPath = assertStorageRootIsPrivate(basePath);
  }

  async read(key: string): Promise<string> {
    const fullPath = this.resolveKey(key);
    return fs.readFile(fullPath, "utf-8");
  }

  async write(key: string, content: string): Promise<void> {
    const fullPath = this.resolveKey(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
  }

  private resolveKey(key: string): string {
    const safeKey = assertSafeStorageKey(key);
    const fullPath = path.resolve(this.rootPath, safeKey);
    const relative = path.relative(this.rootPath, fullPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Storage key resolves outside the storage root.");
    }
    return fullPath;
  }
}

export function assertStorageRootIsPrivate(basePath: string): string {
  const root = path.resolve(basePath);
  const cwd = process.cwd();
  const publicRoots = [
    path.resolve(cwd, "apps/web/public"),
    path.resolve(cwd, "apps/api/public"),
    path.resolve(cwd, "public")
  ];

  for (const publicRoot of publicRoots) {
    const relative = path.relative(publicRoot, root);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      throw new Error(
        `TD_LOCAL_UPLOADS_PATH must not point inside a public web root: ${publicRoot}`
      );
    }
  }

  return root;
}

// ── S3 (prod) ────────────────────────────────────────────────────────────────

export class S3StorageBackend implements StorageBackend {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.client = new S3Client({
      region: requireConfig(["AWS_REGION"], "S3 storage").AWS_REGION
    });
    this.bucket = requireConfig(["TD_S3_BUCKET"], "S3 storage").TD_S3_BUCKET;
  }

  async read(key: string): Promise<string> {
    const safeKey = assertSafeStorageKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey }));
    return (await res.Body?.transformToString("utf-8")) ?? "";
  }

  async write(key: string, content: string): Promise<void> {
    const safeKey = assertSafeStorageKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey,
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
    const backend = config().STORAGE_BACKEND;
    if (backend === "s3") {
      _instance = new S3StorageBackend();
    } else {
      const basePath = config().TD_LOCAL_UPLOADS_PATH;
      _instance = new LocalStorageBackend(basePath);
    }
  }
  return _instance;
}

/** Reset the cached instance (for testing). */
export function resetStorageBackend(): void {
  _instance = null;
}
