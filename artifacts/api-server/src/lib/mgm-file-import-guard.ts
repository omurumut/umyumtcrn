import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".xlsx", ".xls"]);

export class MgmFileImportGuardError extends Error {
  constructor(public readonly code: "disabled" | "invalid_path" | "invalid_extension" | "missing_file" | "invalid_file" | "file_too_large") {
    super(code);
  }
}

export type GuardedMgmImportFile = {
  fullPath: string;
  fileName: string;
  sizeBytes: number;
};

function importRoot(): string {
  const configured = process.env.MGM_FILE_IMPORT_ROOT?.trim();
  return configured && configured.length > 0
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "artifacts/api-server/data/mgm-import");
}

function maxBytes(): number {
  const raw = process.env.MGM_FILE_IMPORT_MAX_BYTES;
  if (!raw) return DEFAULT_MAX_BYTES;
  if (!/^[1-9]\d*$/.test(raw)) return DEFAULT_MAX_BYTES;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1_024 && parsed <= 250 * 1024 * 1024
    ? parsed
    : DEFAULT_MAX_BYTES;
}

export async function guardMgmFileImport(requestedPath: unknown, defaultFilename: string): Promise<GuardedMgmImportFile> {
  if (process.env.ENABLE_MGM_FILE_IMPORT !== "true") {
    throw new MgmFileImportGuardError("disabled");
  }

  const relativePath = requestedPath === undefined || requestedPath === null || requestedPath === ""
    ? defaultFilename
    : requestedPath;
  if (typeof relativePath !== "string" || relativePath.includes("\0") || path.isAbsolute(relativePath)) {
    throw new MgmFileImportGuardError("invalid_path");
  }

  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.split("/").some(part => part === ".." || part === "")) {
    throw new MgmFileImportGuardError("invalid_path");
  }

  const extension = path.extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new MgmFileImportGuardError("invalid_extension");
  }

  const root = await realpath(importRoot()).catch(() => {
    throw new MgmFileImportGuardError("missing_file");
  });
  const candidate = path.resolve(root, normalized);
  const realCandidate = await realpath(candidate).catch(() => {
    throw new MgmFileImportGuardError("missing_file");
  });
  const relativeToRoot = path.relative(root, realCandidate);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new MgmFileImportGuardError("invalid_path");
  }

  const fileStat = await stat(realCandidate).catch(() => {
    throw new MgmFileImportGuardError("missing_file");
  });
  if (!fileStat.isFile()) {
    throw new MgmFileImportGuardError("invalid_file");
  }
  if (fileStat.size > maxBytes()) {
    throw new MgmFileImportGuardError("file_too_large");
  }
  await access(realCandidate, constants.R_OK);

  return {
    fullPath: realCandidate,
    fileName: path.basename(realCandidate),
    sizeBytes: fileStat.size,
  };
}

export function mgmImportGuardStatus(error: MgmFileImportGuardError): number {
  if (error.code === "disabled") return 403;
  if (error.code === "missing_file") return 404;
  return 400;
}
