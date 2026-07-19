import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { constants } from "node:fs";
import { access, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export type ReportStorageProviderName = "local" | "unconfigured";

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
  stream: ReadStream;
};

export interface ReportStorage {
  provider: ReportStorageProviderName;
  put(input: ReportStoragePutInput): Promise<ReportStorageMetadata>;
  get(key: string): Promise<ReportStorageReadResult>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  checkReadiness(): Promise<"pass" | "disabled" | "fail">;
}

const SAFE_KEY_PATTERN = /^[a-z0-9/_@.+-]+$/i;

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
    throw new Error("Invalid report storage key");
  }
}

async function assertInsideRoot(root: string, target: string): Promise<void> {
  const rootReal = await realpath(root);
  const targetParent = path.dirname(target);
  await mkdir(targetParent, { recursive: true });
  const parentReal = await realpath(targetParent);
  const relative = path.relative(rootReal, parentReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Report storage key escapes root");
  }
}

class LocalReportStorage implements ReportStorage {
  provider: ReportStorageProviderName = "local";

  constructor(private readonly rootDirectory: string) {}

  private pathFor(key: string): string {
    assertSafeStorageKey(key);
    return path.resolve(this.rootDirectory, key);
  }

  async put(input: ReportStoragePutInput): Promise<ReportStorageMetadata> {
    if (input.content.length === 0) throw new Error("Report output is empty");
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
}

class UnconfiguredReportStorage implements ReportStorage {
  provider: ReportStorageProviderName = "unconfigured";

  private fail(): never {
    throw new Error("REPORT_STORAGE_PROVIDER must be configured for report archive storage.");
  }

  async put(): Promise<ReportStorageMetadata> { this.fail(); }
  async get(): Promise<ReportStorageReadResult> { this.fail(); }
  async delete(): Promise<void> { this.fail(); }
  async exists(): Promise<boolean> { return false; }
  async checkReadiness(): Promise<"disabled" | "fail"> {
    return process.env.REPORT_ARCHIVE_STORAGE_REQUIRED === "false" ? "disabled" : "fail";
  }
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
  return new UnconfiguredReportStorage();
}

export const reportStorage = createReportStorage();

export function reportStorageReadinessStatus(): Promise<"pass" | "disabled" | "fail"> {
  return reportStorage.checkReadiness();
}

export function calculateSha256(content: Buffer): string {
  return sha256(content);
}
