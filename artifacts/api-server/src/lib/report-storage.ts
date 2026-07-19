import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { constants } from "node:fs";
import { access, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

export type ReportStorageProviderName = "local" | "s3" | "unconfigured";

export type ReportStorageErrorCategory =
  | "storage_config_invalid"
  | "storage_auth_failed"
  | "storage_access_denied"
  | "storage_bucket_not_found"
  | "storage_object_not_found"
  | "storage_timeout"
  | "storage_network_error"
  | "storage_integrity_mismatch"
  | "storage_upload_failed"
  | "storage_download_failed"
  | "storage_delete_failed"
  | "storage_unknown_error";

export class ReportStorageError extends Error {
  constructor(
    readonly category: ReportStorageErrorCategory,
    message = category,
  ) {
    super(message);
    this.name = "ReportStorageError";
  }
}

export type ReportStoragePutInput = {
  key: string;
  content: Buffer;
  contentType: string;
};

export type ReportStorageMetadata = {
  key: string;
  contentType: string;
  contentLength: number;
  checksumSha256: string;
};

export type ReportStorageReadResult = ReportStorageMetadata & {
  stream: Readable;
};

export type ReportStorageReadiness = {
  status: "pass" | "disabled" | "fail";
  category?: ReportStorageErrorCategory;
};

export interface ReportStorage {
  provider: ReportStorageProviderName;
  put(input: ReportStoragePutInput): Promise<ReportStorageMetadata>;
  get(key: string): Promise<ReportStorageReadResult>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  checkReadiness(): Promise<"pass" | "disabled" | "fail">;
  checkReadinessDetails?(): Promise<ReportStorageReadiness>;
}

export type ReportS3Client = {
  send(command: { input: Record<string, unknown>; constructor: { name: string } }): Promise<unknown>;
};

export type S3ReportStorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  forcePathStyle: boolean;
  prefix: string;
  requestTimeoutMs: number;
  maxDownloadBytes: number;
};

const SAFE_KEY_PATTERN = /^[a-z0-9/_@.+-]+$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_S3_TIMEOUT_MS = 5_000;
const MIN_S3_TIMEOUT_MS = 500;
const MAX_S3_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function assertSafeStorageKey(key: string): void {
  if (!SAFE_KEY_PATTERN.test(key) || key.includes("..") || key.startsWith("/") || key.startsWith("\\") || key.includes("\\")) {
    throw new ReportStorageError("storage_config_invalid");
  }
}

async function assertInsideRoot(root: string, target: string): Promise<void> {
  const rootReal = await realpath(root);
  const targetParent = path.dirname(target);
  await mkdir(targetParent, { recursive: true });
  const parentReal = await realpath(targetParent);
  const relative = path.relative(rootReal, parentReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ReportStorageError("storage_config_invalid");
  }
}

function parseStrictBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new ReportStorageError("storage_config_invalid");
}

function parseBoundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^[1-9]\d*$/.test(value.trim())) throw new ReportStorageError("storage_config_invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new ReportStorageError("storage_config_invalid");
  return parsed;
}

export function normalizeReportStoragePrefix(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return "";
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  if (
    normalized.includes("..")
    || normalized.includes("\\")
    || /[\x00-\x1f\x7f]/.test(normalized)
    || !SAFE_KEY_PATTERN.test(normalized)
  ) {
    throw new ReportStorageError("storage_config_invalid");
  }
  return normalized;
}

export function parseS3ReportStorageConfig(env: NodeJS.ProcessEnv): S3ReportStorageConfig {
  const bucket = env.REPORT_STORAGE_BUCKET?.trim();
  const region = env.REPORT_STORAGE_REGION?.trim();
  const endpoint = env.REPORT_STORAGE_ENDPOINT?.trim();
  const accessKeyId = env.REPORT_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.REPORT_STORAGE_SECRET_ACCESS_KEY?.trim();
  const sessionToken = env.REPORT_STORAGE_SESSION_TOKEN?.trim();
  if (!bucket || !region) throw new ReportStorageError("storage_config_invalid");
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) throw new ReportStorageError("storage_config_invalid");
  return {
    bucket,
    region,
    endpoint: endpoint || undefined,
    accessKeyId: accessKeyId || undefined,
    secretAccessKey: secretAccessKey || undefined,
    sessionToken: sessionToken || undefined,
    forcePathStyle: parseStrictBoolean(env.REPORT_STORAGE_FORCE_PATH_STYLE, false),
    prefix: normalizeReportStoragePrefix(env.REPORT_STORAGE_PREFIX),
    requestTimeoutMs: parseBoundedInteger(
      env.REPORT_STORAGE_REQUEST_TIMEOUT_MS,
      DEFAULT_S3_TIMEOUT_MS,
      MIN_S3_TIMEOUT_MS,
      MAX_S3_TIMEOUT_MS,
    ),
    maxDownloadBytes: parseBoundedInteger(
      env.REPORT_STORAGE_MAX_DOWNLOAD_BYTES,
      DEFAULT_MAX_DOWNLOAD_BYTES,
      1,
      DEFAULT_MAX_DOWNLOAD_BYTES,
    ),
  };
}

function s3ObjectKey(config: S3ReportStorageConfig, key: string): string {
  assertSafeStorageKey(key);
  return config.prefix ? `${config.prefix}/${key}` : key;
}

function safeS3Category(error: unknown, fallback: ReportStorageErrorCategory): ReportStorageErrorCategory {
  if (error instanceof ReportStorageError) return error.category;
  const candidate = error as { name?: unknown; Code?: unknown; code?: unknown; $metadata?: { httpStatusCode?: number } };
  const name = String(candidate.name ?? candidate.Code ?? candidate.code ?? "").toLowerCase();
  const status = candidate.$metadata?.httpStatusCode;
  if (name.includes("timeout") || name.includes("timedout") || name.includes("abort")) return "storage_timeout";
  if (name.includes("credentials") || name.includes("signature") || status === 401) return "storage_auth_failed";
  if (name.includes("accessdenied") || name.includes("forbidden") || status === 403) return "storage_access_denied";
  if (name.includes("nosuchbucket") || status === 404 && fallback === "storage_bucket_not_found") return "storage_bucket_not_found";
  if (name.includes("nosuchkey") || name.includes("notfound") || status === 404) return "storage_object_not_found";
  if (name.includes("network") || name.includes("econn") || name.includes("enotfound") || name.includes("socket")) return "storage_network_error";
  return fallback;
}

function s3Checksum(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  const raw = record.sha256 ?? record["checksum-sha256"] ?? record.checksumsha256;
  return typeof raw === "string" && SHA256_PATTERN.test(raw) ? raw : null;
}

function bodyToNodeStream(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (body && typeof body === "object" && typeof (body as { pipe?: unknown }).pipe === "function") return body as Readable;
  if (body && typeof body === "object" && typeof (body as { transformToWebStream?: unknown }).transformToWebStream === "function") {
    const webStream = (body as { transformToWebStream(): ReadableStream }).transformToWebStream();
    return Readable.fromWeb(webStream);
  }
  if (body && typeof body === "object" && Symbol.asyncIterator in body) {
    return Readable.from(body as AsyncIterable<Uint8Array>);
  }
  throw new ReportStorageError("storage_download_failed");
}

export function createS3ReportStorageClient(config: S3ReportStorageConfig): ReportS3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: config.accessKeyId && config.secretAccessKey
      ? {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
      }
      : undefined,
    maxAttempts: 2,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: config.requestTimeoutMs,
      requestTimeout: config.requestTimeoutMs,
    }),
  });
}

class LocalReportStorage implements ReportStorage {
  provider: ReportStorageProviderName = "local";

  constructor(private readonly rootDirectory: string) {}

  private pathFor(key: string): string {
    assertSafeStorageKey(key);
    return path.resolve(this.rootDirectory, key);
  }

  async put(input: ReportStoragePutInput): Promise<ReportStorageMetadata> {
    if (input.content.length === 0) throw new ReportStorageError("storage_upload_failed");
    const target = this.pathFor(input.key);
    await mkdir(this.rootDirectory, { recursive: true });
    await assertInsideRoot(this.rootDirectory, target);
    const temporary = `${target}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(input.content);
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    const metadata = await stat(target);
    return {
      key: input.key,
      contentType: input.contentType,
      contentLength: metadata.size,
      checksumSha256: sha256(input.content),
    };
  }

  async get(key: string): Promise<ReportStorageReadResult> {
    const target = this.pathFor(key);
    await assertInsideRoot(this.rootDirectory, target);
    const metadata = await stat(target);
    return {
      key,
      contentType: "application/octet-stream",
      contentLength: metadata.size,
      checksumSha256: await sha256File(target),
      stream: createReadStream(target),
    };
  }

  async delete(key: string): Promise<void> {
    const target = this.pathFor(key);
    await assertInsideRoot(this.rootDirectory, target);
    await rm(target, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      const target = this.pathFor(key);
      await assertInsideRoot(this.rootDirectory, target);
      await access(target, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async checkReadiness(): Promise<"pass"> {
    await access(this.rootDirectory, constants.R_OK | constants.W_OK);
    return "pass";
  }

  async checkReadinessDetails(): Promise<ReportStorageReadiness> {
    return { status: await this.checkReadiness() };
  }
}

export class S3ReportStorage implements ReportStorage {
  provider: ReportStorageProviderName = "s3";

  constructor(
    private readonly config: S3ReportStorageConfig,
    private readonly client: ReportS3Client = createS3ReportStorageClient(config),
  ) {}

  async put(input: ReportStoragePutInput): Promise<ReportStorageMetadata> {
    if (input.content.length === 0 || input.content.length > this.config.maxDownloadBytes) {
      throw new ReportStorageError("storage_upload_failed");
    }
    const key = s3ObjectKey(this.config, input.key);
    const checksumSha256 = sha256(input.content);
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: input.content,
        ContentType: input.contentType,
        ContentLength: input.content.length,
        Metadata: { sha256: checksumSha256 },
      }) as unknown as { input: Record<string, unknown>; constructor: { name: string } });
      const head = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }) as unknown as { input: Record<string, unknown>; constructor: { name: string } }) as {
        ContentLength?: number;
        ContentType?: string;
        Metadata?: Record<string, string>;
      };
      const storedChecksum = s3Checksum(head.Metadata);
      const contentLength = head.ContentLength;
      if (contentLength !== input.content.length || storedChecksum !== checksumSha256) {
        throw new ReportStorageError("storage_integrity_mismatch");
      }
      return {
        key: input.key,
        contentType: head.ContentType || input.contentType,
        contentLength,
        checksumSha256,
      };
    } catch (error) {
      throw new ReportStorageError(safeS3Category(error, "storage_upload_failed"));
    }
  }

  async get(key: string): Promise<ReportStorageReadResult> {
    const objectKey = s3ObjectKey(this.config, key);
    try {
      const result = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey,
      }) as unknown as { input: Record<string, unknown>; constructor: { name: string } }) as {
        Body?: unknown;
        ContentLength?: number;
        ContentType?: string;
        Metadata?: Record<string, string>;
      };
      const contentLength = result.ContentLength;
      if (!Number.isSafeInteger(contentLength) || contentLength === undefined || contentLength <= 0 || contentLength > this.config.maxDownloadBytes) {
        throw new ReportStorageError("storage_download_failed");
      }
      const checksumSha256 = s3Checksum(result.Metadata);
      if (!checksumSha256) throw new ReportStorageError("storage_integrity_mismatch");
      return {
        key,
        contentType: result.ContentType || "application/octet-stream",
        contentLength,
        checksumSha256,
        stream: bodyToNodeStream(result.Body),
      };
    } catch (error) {
      throw new ReportStorageError(safeS3Category(error, "storage_download_failed"));
    }
  }

  async delete(key: string): Promise<void> {
    const objectKey = s3ObjectKey(this.config, key);
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey,
      }) as unknown as { input: Record<string, unknown>; constructor: { name: string } });
    } catch (error) {
      const category = safeS3Category(error, "storage_delete_failed");
      if (category !== "storage_object_not_found") throw new ReportStorageError(category);
    }
  }

  async exists(key: string): Promise<boolean> {
    const objectKey = s3ObjectKey(this.config, key);
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey,
      }) as unknown as { input: Record<string, unknown>; constructor: { name: string } });
      return true;
    } catch (error) {
      const category = safeS3Category(error, "storage_unknown_error");
      if (category === "storage_object_not_found") return false;
      throw new ReportStorageError(category);
    }
  }

  async checkReadiness(): Promise<"pass" | "fail"> {
    return (await this.checkReadinessDetails()).status === "pass" ? "pass" : "fail";
  }

  async checkReadinessDetails(): Promise<ReportStorageReadiness> {
    try {
      await this.client.send(new HeadBucketCommand({
        Bucket: this.config.bucket,
      }) as unknown as { input: Record<string, unknown>; constructor: { name: string } });
      return { status: "pass" };
    } catch (error) {
      return { status: "fail", category: safeS3Category(error, "storage_bucket_not_found") };
    }
  }
}

class UnconfiguredReportStorage implements ReportStorage {
  provider: ReportStorageProviderName = "unconfigured";

  constructor(private readonly category: ReportStorageErrorCategory = "storage_config_invalid") {}

  private fail(): never {
    throw new ReportStorageError(this.category);
  }

  async put(): Promise<ReportStorageMetadata> { this.fail(); }
  async get(): Promise<ReportStorageReadResult> { this.fail(); }
  async delete(): Promise<void> { this.fail(); }
  async exists(): Promise<boolean> { return false; }
  async checkReadiness(): Promise<"disabled" | "fail"> {
    return process.env.REPORT_ARCHIVE_STORAGE_REQUIRED === "false" ? "disabled" : "fail";
  }

  async checkReadinessDetails(): Promise<ReportStorageReadiness> {
    const status = await this.checkReadiness();
    return status === "disabled" ? { status } : { status, category: this.category };
  }
}

export function createS3ReportStorage(config: S3ReportStorageConfig, client?: ReportS3Client): ReportStorage {
  return new S3ReportStorage(config, client);
}

export function createReportStorage(env: NodeJS.ProcessEnv = process.env): ReportStorage {
  const provider = env.REPORT_STORAGE_PROVIDER?.trim().toLowerCase();
  if (provider === "local") {
    const productionLocalAllowed = env.NODE_ENV !== "production"
      || (env.TEST_DB_DISPOSABLE === "true" && env.REPORT_STORAGE_LOCAL_PRODUCTION_ACK === "disposable-test");
    if (!productionLocalAllowed) return new UnconfiguredReportStorage();
    const root = env.REPORT_STORAGE_LOCAL_ROOT?.trim();
    if (!root) return new UnconfiguredReportStorage();
    return new LocalReportStorage(path.resolve(root));
  }
  if (provider === "s3") {
    try {
      return new S3ReportStorage(parseS3ReportStorageConfig(env));
    } catch (error) {
      return new UnconfiguredReportStorage(error instanceof ReportStorageError ? error.category : "storage_config_invalid");
    }
  }
  if (provider) return new UnconfiguredReportStorage();
  return new UnconfiguredReportStorage();
}

export const reportStorage = createReportStorage();

export async function reportStorageReadinessDetails(): Promise<ReportStorageReadiness> {
  return reportStorage.checkReadinessDetails ? reportStorage.checkReadinessDetails() : { status: await reportStorage.checkReadiness() };
}

export async function reportStorageReadinessStatus(): Promise<"pass" | "disabled" | "fail"> {
  return (await reportStorageReadinessDetails()).status;
}

export function calculateSha256(content: Buffer): string {
  return sha256(content);
}

export async function runReportStorageWriteSmoke(storage: ReportStorage, acknowledged: boolean): Promise<"passed" | "skipped" | "failed"> {
  if (!acknowledged) return "skipped";
  const key = `companies/0/reports/diagnostics/${new Date().getUTCFullYear()}/${randomUUID()}/smoke.txt`;
  const content = Buffer.from("report storage diagnostics smoke", "utf8");
  let uploaded = false;
  try {
    const put = await storage.put({ key, content, contentType: "text/plain; charset=utf-8" });
    uploaded = true;
    if (put.checksumSha256 !== sha256(content) || put.contentLength !== content.length) return "failed";
    if (!(await storage.exists(key))) return "failed";
    const read = await storage.get(key);
    if (read.checksumSha256 !== put.checksumSha256 || read.contentLength !== content.length) return "failed";
    read.stream.destroy();
    await storage.delete(key);
    uploaded = false;
    return (await storage.exists(key)) ? "failed" : "passed";
  } catch {
    if (uploaded) await storage.delete(key).catch(() => undefined);
    return "failed";
  }
}
