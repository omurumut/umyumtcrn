import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import { companiesTable, db, unitsTable } from "@workspace/db";
import type { SessionUser } from "../../middlewares/auth.js";

export class AiScopeError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "AiScopeError";
  }
}

export type AiResolvedScope = {
  companyId: number;
  unitId: number | null;
  year: number;
};

export function isAiCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

export function isAiSuperAdmin(role: string) {
  return role === "superadmin";
}

export function parsePositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^[1-9]\d*$/.test(normalized)) {
      const parsed = Number(normalized);
      if (Number.isSafeInteger(parsed)) return parsed;
    }
  }
  throw new AiScopeError(400, `Gecersiz ${field}`);
}

export function parseMatchingPositiveInteger(bodyValue: unknown, queryValue: unknown, field: string) {
  const bodyId = parsePositiveInteger(bodyValue, field);
  const queryId = parsePositiveInteger(queryValue, field);
  if (bodyId !== undefined && queryId !== undefined && bodyId !== queryId) {
    throw new AiScopeError(400, `Body ve query ${field} degerleri uyusmuyor`);
  }
  return bodyId ?? queryId;
}

export function parseAiYear(bodyValue: unknown, queryValue: unknown) {
  const year = parseMatchingPositiveInteger(bodyValue, queryValue, "year") ?? new Date().getFullYear();
  if (year < 1900 || year > 3000) throw new AiScopeError(400, "Gecersiz year");
  return year;
}

export async function resolveAiScopeFromRequest(req: Request): Promise<AiResolvedScope> {
  const user = req.user;
  if (!user) throw new AiScopeError(401, "Giris yapmalisiniz");
  const body = isRecord(req.body) ? req.body : {};
  const requestedCompanyId = parseMatchingPositiveInteger(body.companyId, req.query.companyId, "companyId");
  const requestedUnitId = parseMatchingPositiveInteger(body.unitId, req.query.unitId, "unitId");
  const year = parseAiYear(body.year, req.query.year);
  return resolveAiScope({
    user,
    requestedCompanyId,
    requestedUnitId,
    year,
    companyExists,
    unitCompanyId,
  });
}

export async function resolveAiScope({
  user,
  requestedCompanyId,
  requestedUnitId,
  year,
  companyExists: companyExistsFn,
  unitCompanyId: unitCompanyIdFn,
}: {
  user: SessionUser;
  requestedCompanyId?: number;
  requestedUnitId?: number;
  year: number;
  companyExists: (companyId: number) => Promise<boolean>;
  unitCompanyId: (unitId: number) => Promise<number | null>;
}): Promise<AiResolvedScope> {
  const sessionCompanyId = parsePositiveInteger(user.companyId, "companyId");
  if (sessionCompanyId === undefined) throw new AiScopeError(400, "Gecersiz companyId");

  let companyId: number;
  if (isAiSuperAdmin(user.role)) {
    if (requestedCompanyId === undefined) throw new AiScopeError(400, "companyId zorunludur");
    companyId = requestedCompanyId;
  } else {
    if (requestedCompanyId !== undefined && requestedCompanyId !== sessionCompanyId) {
      throw new AiScopeError(403, "Bu sirket icin yetkiniz yok");
    }
    companyId = sessionCompanyId;
  }

  if (!await companyExistsFn(companyId)) throw new AiScopeError(404, "Sirket bulunamadi");

  let unitId: number | null;
  if (isAiCompanyAdmin(user.role) || isAiSuperAdmin(user.role)) {
    unitId = requestedUnitId ?? null;
  } else {
    const sessionUnitId = parsePositiveInteger(user.unitId, "unitId");
    if (sessionUnitId === undefined) throw new AiScopeError(403, "Birim kapsami gereklidir");
    if (requestedUnitId !== undefined && requestedUnitId !== sessionUnitId) {
      throw new AiScopeError(403, "Bu birim icin yetkiniz yok");
    }
    unitId = sessionUnitId;
  }

  if (unitId !== null) {
    const ownerCompanyId = await unitCompanyIdFn(unitId);
    if (ownerCompanyId === null) throw new AiScopeError(404, "Birim bulunamadi");
    if (ownerCompanyId !== companyId) throw new AiScopeError(403, "Bu birim icin yetkiniz yok");
  }

  return { companyId, unitId, year };
}

async function companyExists(companyId: number) {
  const [company] = await db.select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  return company !== undefined;
}

async function unitCompanyId(unitId: number) {
  const [unit] = await db.select({ companyId: unitsTable.companyId })
    .from(unitsTable)
    .where(and(eq(unitsTable.id, unitId)))
    .limit(1);
  return unit?.companyId ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
