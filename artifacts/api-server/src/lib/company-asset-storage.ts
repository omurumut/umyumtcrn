import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export type AssetStoragePutInput = {
  key: string;
  content: Buffer;
};

export interface AssetStorage {
  provider: string;
  put(input: AssetStoragePutInput): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

function assertSafeRelativeKey(key: string): void {
  if (!/^[a-z0-9/_-]+$/i.test(key) || key.includes("..") || key.startsWith("/") || key.startsWith("\\")) {
    throw new Error("Invalid storage key");
  }
}

class LocalAssetStorage implements AssetStorage {
  provider = "local";

  constructor(private readonly baseDirectory: string) {}

  private pathFor(key: string): string {
    assertSafeRelativeKey(key);
    const base = resolve(this.baseDirectory);
    const target = resolve(base, key);
    if (target !== base && !target.startsWith(`${base}${sep}`)) {
      throw new Error("Storage key escapes base directory");
    }
    return target;
  }

  async put(input: AssetStoragePutInput): Promise<void> {
    const target = this.pathFor(input.key);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(input.content);
    } finally {
      await handle.close();
    }
    await rm(target, { force: true });
    await rename(temporary, target);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      const handle = await open(this.pathFor(key), "r");
      await handle.close();
      return true;
    } catch {
      return false;
    }
  }
}

class UnconfiguredProductionStorage implements AssetStorage {
  provider = "unconfigured";

  private fail(): never {
    throw new Error("COMPANY_ASSET_STORAGE_PROVIDER must be configured for production uploads.");
  }

  async put(): Promise<void> { this.fail(); }
  async get(): Promise<Buffer> { this.fail(); }
  async delete(): Promise<void> { this.fail(); }
  async exists(): Promise<boolean> { this.fail(); }
}

export function createCompanyAssetStorage(env: NodeJS.ProcessEnv = process.env): AssetStorage {
  const provider = env.COMPANY_ASSET_STORAGE_PROVIDER?.trim().toLowerCase();
  const allowLocal = env.NODE_ENV !== "production" || provider === "local";
  if (allowLocal && (provider === undefined || provider === "" || provider === "local")) {
    const baseDirectory = env.COMPANY_ASSET_LOCAL_DIR?.trim() || resolve(process.cwd(), ".local", "company-assets");
    return new LocalAssetStorage(baseDirectory);
  }
  return new UnconfiguredProductionStorage();
}

export const companyAssetStorage = createCompanyAssetStorage();
