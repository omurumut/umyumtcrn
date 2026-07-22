import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import {
  companiesTable,
  db,
  energyActionPlansTable,
  energyTargetsTable,
  usersTable,
  vapProjectsTable,
} from "@workspace/db";
import type { SessionUser } from "../middlewares/auth.js";
import { writeAuditEvent } from "./audit.js";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbExecutor = typeof db | DbTransaction;

export class ActionPlanBadRequestError extends Error {}
export class ActionPlanForbiddenError extends Error {}

const ACTION_STATUSES = new Set(["planned", "in_progress", "completed", "delayed", "cancelled"]);
const ACTION_PRIORITIES = new Set(["low", "medium", "high"]);
const MAX_REAL = 3.4028235e38;

function isCompanyAdmin(role: string) { return role === "admin" || role === "kontrol_admin"; }
function isSuperAdmin(role: string) { return role === "superadmin"; }
function isStandard(role: string) { return !isCompanyAdmin(role) && !isSuperAdmin(role); }

export function parsePositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function requiredString(value: unknown, field: string, maxLength = 255): string {
  if (typeof value !== "string") throw new ActionPlanBadRequestError(`Gecersiz ${field}`);
  const parsed = value.trim();
  if (!parsed || parsed.length > maxLength) throw new ActionPlanBadRequestError(`Gecersiz ${field}`);
  return parsed;
}

function optionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new ActionPlanBadRequestError(`Gecersiz ${field}`);
  return value.trim() || null;
}

function optionalFinite(value: unknown, field: string, min = 0, max = MAX_REAL): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  let parsed: number;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) parsed = Number(value.trim());
  else throw new ActionPlanBadRequestError(`Gecersiz ${field}`);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_REAL || parsed < min || parsed > max) throw new ActionPlanBadRequestError(`Gecersiz ${field}`);
  return parsed;
}

function requiredProgress(value: unknown): number {
  const parsed = optionalFinite(value, "progressPercent", 0, 100);
  if (parsed === null || parsed === undefined) throw new ActionPlanBadRequestError("Gecersiz progressPercent");
  return parsed;
}

function calculateVapPaybackMonths(investmentCost: number | null, annualCostSaving: number | null): number | null {
  if (investmentCost === null || annualCostSaving === null || annualCostSaving === 0) return null;
  const paybackMonths = (investmentCost / annualCostSaving) * 12;
  if (!Number.isFinite(paybackMonths) || paybackMonths > MAX_REAL) {
    throw new ActionPlanBadRequestError("Geri odeme suresi hesaplanamadi");
  }
  return Number(paybackMonths.toFixed(1));
}

function enumValue(value: unknown, field: string, allowed: Set<string>, fallback?: string): string {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !allowed.has(value)) throw new ActionPlanBadRequestError(`Gecersiz ${field}`);
  return value;
}

function optionalIsoDate(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ActionPlanBadRequestError(`Gecersiz ${field}`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new ActionPlanBadRequestError(`Gecersiz ${field}`);
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ActionPlanBadRequestError(`Gecersiz ${field}`);
  return value;
}

async function resolveEffectiveCompanyId(executor: DbExecutor, role: string, sessionCompanyId: number, value: unknown, requireExplicit: boolean) {
  if (!isSuperAdmin(role)) return sessionCompanyId;
  if (value === undefined && !requireExplicit) return sessionCompanyId;
  const companyId = parsePositiveInteger(value);
  if (companyId === undefined) return undefined;
  const [company] = await executor.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.id, companyId));
  return company?.id;
}

async function resolveResponsibleUserId(executor: DbExecutor, value: unknown, companyId: number, unitId: number | null) {
  if (value === undefined) return { value: undefined };
  if (value === null) return { value: null };
  const userId = parsePositiveInteger(value);
  if (userId === undefined) return { error: "Gecersiz responsibleUserId" };
  const [user] = await executor.select({ companyId: usersTable.companyId, unitId: usersTable.unitId })
    .from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.companyId !== companyId || (user.unitId !== null && user.unitId !== unitId)) {
    return { error: "Sorumlu kullanici hedef kapsamina ait degil" };
  }
  return { value: userId };
}

export type CreateEnergyActionPlanInput = {
  session: SessionUser;
  body: Record<string, unknown>;
  companyIdInput?: unknown;
  request?: Request;
  executor?: DbTransaction;
  auditMetadata?: Record<string, unknown>;
};

export async function createEnergyActionPlan(input: CreateEnergyActionPlanInput) {
  const run = async (executor: DbExecutor) => createEnergyActionPlanInExecutor(executor, input);
  if (input.executor) return await run(input.executor);
  return await db.transaction(async (tx) => run(tx));
}

async function createEnergyActionPlanInExecutor(executor: DbExecutor, input: CreateEnergyActionPlanInput) {
  const { role, companyId: sessionCompanyId, unitId: sessionUnitId, name: userName } = input.session;
  const body = input.body;
  const {
    targetId, title, description, responsibleUserId, responsibleName, priority,
    expectedSavingValue, expectedSavingUnit, expectedCostSaving,
    investmentCost, paybackMonths, startDate, dueDate, completionDate,
    progressPercent, status, isVap, notes,
  } = body;

  if (targetId === undefined || title === undefined) {
    throw new ActionPlanBadRequestError("Hedef ve baslik zorunludur");
  }
  const parsedTitle = requiredString(title, "title");
  const parsedDescription = optionalString(description, "description");
  const parsedResponsibleName = optionalString(responsibleName, "responsibleName");
  const parsedPriority = enumValue(priority, "priority", ACTION_PRIORITIES, "medium");
  const parsedExpectedSavingValue = optionalFinite(expectedSavingValue, "expectedSavingValue");
  const parsedExpectedSavingUnit = optionalString(expectedSavingUnit, "expectedSavingUnit");
  const parsedExpectedCostSaving = optionalFinite(expectedCostSaving, "expectedCostSaving");
  const parsedInvestmentCost = optionalFinite(investmentCost, "investmentCost");
  const parsedPaybackMonths = optionalFinite(paybackMonths, "paybackMonths");
  const parsedStartDate = optionalIsoDate(startDate, "startDate");
  const parsedDueDate = optionalIsoDate(dueDate, "dueDate");
  const parsedCompletionDate = optionalIsoDate(completionDate, "completionDate");
  if (parsedStartDate && parsedDueDate && parsedDueDate < parsedStartDate) throw new ActionPlanBadRequestError("Bitis tarihi baslangic tarihinden once olamaz");
  const progress = progressPercent === undefined ? 0 : requiredProgress(progressPercent);
  const requestedStatus = enumValue(status, "status", ACTION_STATUSES, "planned");
  const effectiveStatus = progress === 100 ? "completed" : requestedStatus;
  if (effectiveStatus === "completed" && progress !== 100) throw new ActionPlanBadRequestError("Tamamlanan eylemin ilerlemesi 100 olmalidir");
  const parsedIsVap = optionalBoolean(isVap, "isVap") ?? false;
  const parsedNotes = optionalString(notes, "notes");
  const calculatedVapPaybackMonths = parsedIsVap
    ? calculateVapPaybackMonths(parsedInvestmentCost ?? null, parsedExpectedCostSaving ?? null)
    : null;

  if (isStandard(role) && sessionUnitId === null) throw new ActionPlanForbiddenError("Yetki yok");
  const effectiveCompanyId = await resolveEffectiveCompanyId(executor, role, sessionCompanyId, input.companyIdInput, true);
  if (effectiveCompanyId === undefined) throw new ActionPlanBadRequestError("Gecersiz companyId");
  const parsedTargetId = parsePositiveInteger(targetId);
  if (parsedTargetId === undefined) throw new ActionPlanBadRequestError("Gecersiz targetId");
  const targetConditions = [eq(energyTargetsTable.id, parsedTargetId), eq(energyTargetsTable.companyId, effectiveCompanyId)];
  if (isStandard(role)) targetConditions.push(eq(energyTargetsTable.unitId, sessionUnitId!));
  const [target] = await executor.select({ id: energyTargetsTable.id, companyId: energyTargetsTable.companyId, unitId: energyTargetsTable.unitId })
    .from(energyTargetsTable).where(and(...targetConditions));
  if (!target) throw new ActionPlanForbiddenError("Gecersiz hedef");
  if (isStandard(role) && sessionUnitId !== null && target.unitId !== sessionUnitId) {
    throw new ActionPlanForbiddenError("Bu hedefe eylem plani ekleme yetkiniz yok");
  }
  const owner = await resolveResponsibleUserId(executor, responsibleUserId, target.companyId, target.unitId);
  if (owner.error) throw new ActionPlanBadRequestError(owner.error);

  const [created] = await executor.insert(energyActionPlansTable).values({
    companyId: target.companyId,
    targetId: parsedTargetId,
    title: parsedTitle,
    description: parsedDescription ?? null,
    responsibleUserId: owner.value,
    responsibleName: parsedResponsibleName ?? null,
    priority: parsedPriority,
    expectedSavingValue: parsedExpectedSavingValue ?? null,
    expectedSavingUnit: parsedExpectedSavingUnit ?? null,
    expectedCostSaving: parsedExpectedCostSaving ?? null,
    investmentCost: parsedInvestmentCost ?? null,
    paybackMonths: parsedPaybackMonths ?? null,
    startDate: parsedStartDate ?? null,
    dueDate: parsedDueDate ?? null,
    completionDate: parsedCompletionDate ?? null,
    progressPercent: progress,
    status: effectiveStatus,
    isVap: parsedIsVap,
    notes: parsedNotes ?? null,
    createdBy: userName,
  }).returning();

  if (parsedIsVap) {
    const [vap] = await executor.insert(vapProjectsTable).values({
      companyId: target.companyId,
      actionPlanId: created.id,
      projectTitle: parsedTitle,
      annualCostSaving: parsedExpectedCostSaving ?? null,
      investmentCost: parsedInvestmentCost ?? null,
      paybackMonths: calculatedVapPaybackMonths,
      startDate: parsedStartDate ?? null,
      endDate: parsedDueDate ?? null,
      status: "idea",
      notes: parsedNotes ?? null,
      createdBy: userName,
    }).returning({ id: vapProjectsTable.id });
    await writeAuditEvent(executor, {
      request: input.request,
      companyId: target.companyId,
      unitId: target.unitId,
      action: "vap.create",
      entityType: "vap_project",
      entityId: vap.id,
      changes: { createdByActionPlan: created.id },
      metadata: input.auditMetadata,
    });
  }
  await writeAuditEvent(executor, {
    request: input.request,
    companyId: created.companyId,
    unitId: target.unitId,
    action: "action.create",
    entityType: "action_plan",
    entityId: created.id,
    changes: { created: { targetId: created.targetId, status: created.status, priority: created.priority, progressPercent: created.progressPercent, isVap: created.isVap } },
    metadata: input.auditMetadata,
  });

  return { action: created, target };
}
