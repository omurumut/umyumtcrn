import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type GuardError = Error & { code: string };
type GuardModule = {
  guardMgmFileImport: (requestedPath: unknown, defaultFilename: string) => Promise<{ fullPath: string; fileName: string; sizeBytes: number }>;
  MgmFileImportGuardError: new (...args: never[]) => GuardError;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectGuardError(errorType: GuardModule["MgmFileImportGuardError"], name: string, code: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof errorType, `${name}: expected guard error.`);
    assert(error.code === code, `${name}: expected ${code}, got ${error.code}.`);
    return;
  }
  throw new Error(`${name}: guard unexpectedly passed.`);
}

async function main(): Promise<void> {
  const guardModule = await import(pathToFileURL(path.resolve(__dirname, "../../artifacts/api-server/src/lib/mgm-file-import-guard.ts")).href) as GuardModule;
  const { guardMgmFileImport, MgmFileImportGuardError } = guardModule;
  const root = await mkdtemp(path.join(tmpdir(), "iso50001-mgm-import-root-"));
  const outside = await mkdtemp(path.join(tmpdir(), "iso50001-mgm-import-outside-"));
  const previousRoot = process.env.MGM_FILE_IMPORT_ROOT;
  const previousFlag = process.env.ENABLE_MGM_FILE_IMPORT;
  const previousMax = process.env.MGM_FILE_IMPORT_MAX_BYTES;
  try {
    process.env.MGM_FILE_IMPORT_ROOT = root;
    writeFileSync(path.join(root, "valid.xlsx"), "xlsx");
    writeFileSync(path.join(root, "bad.txt"), "txt");
    writeFileSync(path.join(root, "large.xlsx"), Buffer.alloc(2048));
    writeFileSync(path.join(outside, "outside.xlsx"), "xlsx");

    delete process.env.ENABLE_MGM_FILE_IMPORT;
    await expectGuardError(MgmFileImportGuardError, "flag disabled", "disabled", () => guardMgmFileImport("valid.xlsx", "valid.xlsx"));

    process.env.ENABLE_MGM_FILE_IMPORT = "true";
    process.env.MGM_FILE_IMPORT_MAX_BYTES = "1024";
    await expectGuardError(MgmFileImportGuardError, "absolute path", "invalid_path", () => guardMgmFileImport(path.join(root, "valid.xlsx"), "valid.xlsx"));
    await expectGuardError(MgmFileImportGuardError, "traversal", "invalid_path", () => guardMgmFileImport("../outside.xlsx", "valid.xlsx"));
    await expectGuardError(MgmFileImportGuardError, "wrong extension", "invalid_extension", () => guardMgmFileImport("bad.txt", "valid.xlsx"));
    await expectGuardError(MgmFileImportGuardError, "missing file", "missing_file", () => guardMgmFileImport("missing.xlsx", "valid.xlsx"));
    await expectGuardError(MgmFileImportGuardError, "large file", "file_too_large", () => guardMgmFileImport("large.xlsx", "valid.xlsx"));

    if (process.platform !== "win32") {
      symlinkSync(path.join(outside, "outside.xlsx"), path.join(root, "linked.xlsx"));
      await expectGuardError(MgmFileImportGuardError, "symlink outside root", "invalid_path", () => guardMgmFileImport("linked.xlsx", "valid.xlsx"));
    }

    const valid = await guardMgmFileImport("valid.xlsx", "valid.xlsx");
    assert(valid.fileName === "valid.xlsx", "Valid fixture fileName mismatch.");
    assert(!valid.fullPath.includes(".."), "Valid fixture path was not normalized.");

    console.log(JSON.stringify({ mgmFileImportGuardScenarios: process.platform === "win32" ? 7 : 8 }));
  } finally {
    if (previousRoot === undefined) delete process.env.MGM_FILE_IMPORT_ROOT;
    else process.env.MGM_FILE_IMPORT_ROOT = previousRoot;
    if (previousFlag === undefined) delete process.env.ENABLE_MGM_FILE_IMPORT;
    else process.env.ENABLE_MGM_FILE_IMPORT = previousFlag;
    if (previousMax === undefined) delete process.env.MGM_FILE_IMPORT_MAX_BYTES;
    else process.env.MGM_FILE_IMPORT_MAX_BYTES = previousMax;
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`[test-mgm-file-import-guard] Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
});
