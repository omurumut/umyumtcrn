import { Readable } from "node:stream";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type ReportS3Client = {
  send(command: { input: Record<string, unknown>; constructor: { name: string } }): Promise<unknown>;
};

type StoredObject = {
  body: Buffer;
  contentType: string;
  metadata: Record<string, string>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertStorageError(error: unknown, category: string): void {
  const actual = error as { category?: unknown };
  assert(actual.category === category, `Expected ${category}, got ${String(actual.category)}.`);
}

class FakeS3Client implements ReportS3Client {
  readonly objects = new Map<string, StoredObject>();
  readonly commands: Array<{ name: string; input: Record<string, unknown> }> = [];
  failNext: { name: string; error: Error & { $metadata?: { httpStatusCode?: number } } } | null = null;
  wrongHeadSize = false;
  wrongHeadChecksum = false;
  streamError = false;

  async send(command: { input: Record<string, unknown>; constructor: { name: string } }): Promise<unknown> {
    const name = command.constructor.name;
    this.commands.push({ name, input: command.input });
    if (this.failNext?.name === name) {
      const error = this.failNext.error;
      this.failNext = null;
      throw error;
    }
    const key = String(command.input.Key ?? "");
    if (name === "HeadBucketCommand") return {};
    if (name === "PutObjectCommand") {
      this.objects.set(key, {
        body: Buffer.from(command.input.Body as Buffer),
        contentType: String(command.input.ContentType),
        metadata: command.input.Metadata as Record<string, string>,
      });
      return { ETag: "\"not-used-for-integrity\"" };
    }
    if (name === "HeadObjectCommand") {
      const object = this.objects.get(key);
      if (!object) {
        const error = new Error("not found") as Error & { $metadata: { httpStatusCode: number } };
        error.name = "NoSuchKey";
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return {
        ContentLength: this.wrongHeadSize ? object.body.length + 1 : object.body.length,
        ContentType: object.contentType,
        Metadata: this.wrongHeadChecksum ? { sha256: "0".repeat(64) } : object.metadata,
      };
    }
    if (name === "GetObjectCommand") {
      const object = this.objects.get(key);
      if (!object) {
        const error = new Error("not found") as Error & { $metadata: { httpStatusCode: number } };
        error.name = "NoSuchKey";
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return {
        Body: this.streamError
          ? Readable.from((async function* streamFailure() {
            yield object.body.subarray(0, 1);
            throw new Error("stream failed");
          })())
          : Readable.from(object.body),
        ContentLength: object.body.length,
        ContentType: object.contentType,
        Metadata: object.metadata,
      };
    }
    if (name === "DeleteObjectCommand") {
      this.objects.delete(key);
      return {};
    }
    if (name === "ListObjectsV2Command") {
      const prefix = String(command.input.Prefix ?? "");
      const maxKeys = Number(command.input.MaxKeys ?? 1000);
      const continuationToken = typeof command.input.ContinuationToken === "string" ? command.input.ContinuationToken : null;
      const keys = [...this.objects.keys()].filter(candidate => candidate.startsWith(prefix)).sort((a, b) => a.localeCompare(b));
      const foundStart = continuationToken ? keys.findIndex(candidate => candidate > continuationToken) : 0;
      const start = foundStart < 0 ? keys.length : foundStart;
      const page = keys.slice(start, start + maxKeys);
      const next = page.length === maxKeys && keys[start + maxKeys] ? page[page.length - 1] : undefined;
      return {
        Contents: page.map(pageKey => ({
          Key: pageKey,
          Size: this.objects.get(pageKey)!.body.length,
          LastModified: new Date("2026-01-01T00:00:00.000Z"),
        })),
        IsTruncated: next !== undefined,
        NextContinuationToken: next,
      };
    }
    throw new Error(`Unexpected command: ${name}`);
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const storageModule = await import(pathToFileURL(resolve(import.meta.dirname, "../../artifacts/api-server/src/lib/report-storage.ts")).href) as {
    createReportStorage(env: NodeJS.ProcessEnv): { provider: string };
    createS3ReportStorage(config: unknown, client?: ReportS3Client): {
      put(input: { key: string; content: Buffer; contentType: string }): Promise<{ contentLength: number; checksumSha256: string }>;
      get(key: string): Promise<{ checksumSha256: string; stream: Readable }>;
      delete(key: string): Promise<void>;
      exists(key: string): Promise<boolean>;
      list(input: { prefix: string; continuationToken?: string | null; maxKeys: number }): Promise<{ objects: Array<{ key: string; sizeBytes: number; lastModified: Date | null }>; nextContinuationToken: string | null; truncated: boolean }>;
      checkReadinessDetails?(): Promise<{ status: string; category?: string }>;
    };
    normalizeReportStoragePrefix(value: string | undefined): string;
    parseS3ReportStorageConfig(env: NodeJS.ProcessEnv): unknown & { bucket?: string; forcePathStyle?: boolean; prefix?: string };
  };
  const {
    createReportStorage,
    createS3ReportStorage,
    normalizeReportStoragePrefix,
    parseS3ReportStorageConfig,
  } = storageModule;
  assert(normalizeReportStoragePrefix(undefined) === "", "Empty prefix should normalize to empty.");
  assert(normalizeReportStoragePrefix("/tenant-a/reports/") === "tenant-a/reports", "Prefix slash normalization failed.");
  for (const invalidPrefix of ["../x", "x\\y", "x/../y", "x\u0000y"]) {
    try {
      normalizeReportStoragePrefix(invalidPrefix);
      throw new Error(`Invalid prefix accepted: ${invalidPrefix}`);
    } catch (error) {
      assertStorageError(error, "storage_config_invalid");
    }
  }

  const validEnv = {
    REPORT_STORAGE_PROVIDER: "s3",
    REPORT_STORAGE_BUCKET: "fake-private-bucket",
    REPORT_STORAGE_REGION: "auto",
    REPORT_STORAGE_ENDPOINT: "https://storage.example.invalid",
    REPORT_STORAGE_ACCESS_KEY_ID: "fake-access-key",
    REPORT_STORAGE_SECRET_ACCESS_KEY: "fake-secret-key",
    REPORT_STORAGE_FORCE_PATH_STYLE: "true",
    REPORT_STORAGE_PREFIX: "env-a",
    REPORT_STORAGE_REQUEST_TIMEOUT_MS: "1500",
  };
  const config = parseS3ReportStorageConfig(validEnv);
  assert(config.bucket === "fake-private-bucket", "Bucket parse failed.");
  assert(config.forcePathStyle === true, "Force path style parse failed.");
  assert(config.prefix === "env-a", "Prefix parse failed.");
  assert(createReportStorage(validEnv).provider === "s3", "Factory did not create S3 provider.");
  assert(createReportStorage({ REPORT_STORAGE_PROVIDER: "bogus" }).provider === "unconfigured", "Unknown provider should be unconfigured.");
  assert(createReportStorage({ REPORT_STORAGE_PROVIDER: "s3", REPORT_STORAGE_REGION: "auto" }).provider === "unconfigured", "Missing bucket should fail closed.");
  assert(createReportStorage({
    REPORT_STORAGE_PROVIDER: "local",
    NODE_ENV: "production",
    REPORT_STORAGE_LOCAL_ROOT: "tmp/storage",
  }).provider === "unconfigured", "Production local provider should require disposable ack.");

  for (const invalidEnv of [
    { ...validEnv, REPORT_STORAGE_SECRET_ACCESS_KEY: undefined },
    { ...validEnv, REPORT_STORAGE_FORCE_PATH_STYLE: "yes" },
    { ...validEnv, REPORT_STORAGE_REQUEST_TIMEOUT_MS: "0" },
    { ...validEnv, REPORT_STORAGE_PREFIX: "../secret" },
  ]) {
    try {
      parseS3ReportStorageConfig(invalidEnv);
      throw new Error("Invalid S3 env accepted.");
    } catch (error) {
      assertStorageError(error, "storage_config_invalid");
      assert(!String(error).includes("fake-secret-key"), "Secret leaked in config error.");
    }
  }

  const fake = new FakeS3Client();
  const storage = createS3ReportStorage(config, fake);
  const key = "companies/1/reports/annual/2026/1/report.html";
  const content = Buffer.from("<!doctype html><html><body>ok</body></html>", "utf8");
  const put = await storage.put({ key, content, contentType: "text/html; charset=utf-8" });
  assert(put.contentLength === content.length, "Put metadata size mismatch.");
  assert(put.checksumSha256.length === 64, "Put checksum missing.");
  assert(fake.objects.has(`env-a/${key}`), "Prefix was not applied to S3 object key.");
  assert(await storage.exists(key), "Exists should return true.");
  const secondKey = "companies/1/reports/annual/2026/2/report.html";
  await storage.put({ key: secondKey, content: Buffer.from("<!doctype html><html><body>two</body></html>", "utf8"), contentType: "text/html; charset=utf-8" });
  const listed = await storage.list({ prefix: "companies/1/reports/", maxKeys: 1 });
  assert(listed.objects.length === 1 && listed.objects[0]?.key === key && listed.truncated === true && listed.nextContinuationToken === `env-a/${key}`, "S3 list first page mismatch.");
  const listedSecondPage = await storage.list({ prefix: "companies/1/reports/", maxKeys: 1, continuationToken: listed.nextContinuationToken });
  assert(listedSecondPage.objects.length === 1 && listedSecondPage.objects[0]?.key === secondKey && listedSecondPage.truncated === false, "S3 list continuation mismatch.");
  assert(listed.objects[0]?.sizeBytes === content.length && listed.objects[0]?.lastModified instanceof Date, "S3 list metadata mismatch.");
  for (const invalidListInput of [
    { prefix: "", maxKeys: 10 },
    { prefix: "../", maxKeys: 10 },
    { prefix: "companies\\1\\reports\\", maxKeys: 10 },
    { prefix: "companies/1/reports/", maxKeys: 1001 },
  ]) {
    try {
      await storage.list(invalidListInput);
      throw new Error("Invalid list input accepted.");
    } catch (error) {
      assertStorageError(error, "storage_config_invalid");
    }
  }
  const got = await storage.get(key);
  assert((await readAll(got.stream)).equals(content), "Downloaded stream content mismatch.");
  assert(got.checksumSha256 === put.checksumSha256, "Downloaded checksum mismatch.");
  await storage.delete(key);
  assert(!(await storage.exists(key)), "Delete should remove object.");
  assert(!JSON.stringify(fake.commands).includes("fake-secret-key"), "Fake command log leaked secret.");

  fake.wrongHeadChecksum = true;
  try {
    await storage.put({ key, content, contentType: "text/html; charset=utf-8" });
    throw new Error("Wrong checksum accepted.");
  } catch (error) {
    assertStorageError(error, "storage_integrity_mismatch");
  } finally {
    fake.wrongHeadChecksum = false;
  }

  const denied = new Error("denied") as Error & { $metadata: { httpStatusCode: number } };
  denied.name = "AccessDenied";
  denied.$metadata = { httpStatusCode: 403 };
  fake.failNext = { name: "HeadBucketCommand", error: denied };
  const readiness = await storage.checkReadinessDetails?.();
  assert(readiness?.status === "fail" && readiness.category === "storage_access_denied", "Readiness access denied mapping failed.");

  console.log(JSON.stringify({ s3ProviderScenarios: 27, network: "not_used" }));
}

main().catch((error: unknown) => {
  console.error(`[test-report-storage-s3] Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
});
