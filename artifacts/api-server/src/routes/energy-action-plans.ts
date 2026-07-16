import { Router } from "express";
import type { Response } from "express";
import { db, companiesTable, energyActionPlansTable, energyTargetsTable, usersTable, vapProjectsTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

class BadRequestError extends Error {}

const ACTION_STATUSES = new Set(["planned", "in_progress", "completed", "delayed", "cancelled"]);
const ACTION_PRIORITIES = new Set(["low", "medium", "high"]);
const MAX_REAL = 3.4028235e38;

function isCompanyAdmin(role: string) { return role === "admin" || role === "kontrol_admin"; }
function isSuperAdmin(role: string) { return role === "superadmin"; }
function isStandard(role: string) { return !isCompanyAdmin(role) && !isSuperAdmin(role); }
function parsePositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value.trim()); if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function requiredString(value: unknown, field: string, maxLength = 255): string {
  if (typeof value !== "string") throw new BadRequestError(`Geçersiz ${field}`);
  const parsed = value.trim();
  if (!parsed || parsed.length > maxLength) throw new BadRequestError(`Geçersiz ${field}`);
  return parsed;
}

function optionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new BadRequestError(`Geçersiz ${field}`);
  return value.trim() || null;
}

function optionalFinite(value: unknown, field: string, min = 0, max = MAX_REAL): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  let parsed: number;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) parsed = Number(value.trim());
  else throw new BadRequestError(`Geçersiz ${field}`);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_REAL || parsed < min || parsed > max) throw new BadRequestError(`Geçersiz ${field}`);
  return parsed;
}

function requiredProgress(value: unknown): number {
  const parsed = optionalFinite(value, "progressPercent", 0, 100);
  if (parsed === null || parsed === undefined) throw new BadRequestError("Geçersiz progressPercent");
  return parsed;
}

function calculateVapPaybackMonths(investmentCost: number | null, annualCostSaving: number | null): number | null {
  if (investmentCost === null || annualCostSaving === null || annualCostSaving === 0) return null;
  const paybackMonths = (investmentCost / annualCostSaving) * 12;
  if (!Number.isFinite(paybackMonths) || paybackMonths > MAX_REAL) {
    throw new BadRequestError("Geri ödeme süresi hesaplanamadı");
  }
  return Number(paybackMonths.toFixed(1));
}

function enumValue(value: unknown, field: string, allowed: Set<string>, fallback?: string): string {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !allowed.has(value)) throw new BadRequestError(`Geçersiz ${field}`);
  return value;
}

function optionalIsoDate(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestError(`Geçersiz ${field}`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new BadRequestError(`Geçersiz ${field}`);
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new BadRequestError(`Geçersiz ${field}`);
  return value;
}

function handleBadRequest(res: Response, err: unknown) {
  if (!(err instanceof BadRequestError)) return false;
  res.status(400).json({ error: err.message });
  return true;
}

async function resolveEffectiveCompanyId(role: string, sessionCompanyId: number, value: unknown, requireExplicit: boolean) {
  if (!isSuperAdmin(role)) return sessionCompanyId;
  if (value === undefined && !requireExplicit) return sessionCompanyId;
  const companyId = parsePositiveInteger(value);
  if (companyId === undefined) return undefined;
  const [company] = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.id, companyId));
  return company?.id;
}

async function resolveResponsibleUserId(value: unknown, companyId: number, unitId: number | null) {
  if (value === undefined) return { value: undefined };
  if (value === null) return { value: null };
  const userId = parsePositiveInteger(value);
  if (userId === undefined) return { error: "Geçersiz responsibleUserId" };
  const [user] = await db.select({ companyId: usersTable.companyId, unitId: usersTable.unitId })
    .from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.companyId !== companyId || (user.unitId !== null && user.unitId !== unitId)) {
    return { error: "Sorumlu kullanıcı hedef kapsamına ait değil" };
  }
  return { value: userId };
}

// GET /api/energy-action-plans
router.get("/energy-action-plans", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const effectiveCompanyId = await resolveEffectiveCompanyId(role, sessionCompanyId, req.query.companyId, false);
    if (effectiveCompanyId === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    const conditions: SQL[] = [
      eq(energyActionPlansTable.companyId, effectiveCompanyId),
      eq(energyTargetsTable.companyId, effectiveCompanyId),
    ];

    if (isStandard(role) && sessionUnitId === null) { res.json([]); return; }
    const targetId = parsePositiveInteger(req.query.targetId);
    if (req.query.targetId !== undefined && targetId === undefined) { res.status(400).json({ error: "Geçersiz targetId" }); return; }
    if (targetId !== undefined) conditions.push(eq(energyActionPlansTable.targetId, targetId));
    if (isStandard(role)) conditions.push(eq(energyTargetsTable.unitId, sessionUnitId!));

    const plans = await db
      .select({
        id: energyActionPlansTable.id,
        companyId: energyActionPlansTable.companyId,
        targetId: energyActionPlansTable.targetId,
        title: energyActionPlansTable.title,
        description: energyActionPlansTable.description,
        responsibleUserId: energyActionPlansTable.responsibleUserId,
        responsibleName: energyActionPlansTable.responsibleName,
        priority: energyActionPlansTable.priority,
        expectedSavingValue: energyActionPlansTable.expectedSavingValue,
        expectedSavingUnit: energyActionPlansTable.expectedSavingUnit,
        expectedCostSaving: energyActionPlansTable.expectedCostSaving,
        investmentCost: energyActionPlansTable.investmentCost,
        paybackMonths: energyActionPlansTable.paybackMonths,
        startDate: energyActionPlansTable.startDate,
        dueDate: energyActionPlansTable.dueDate,
        completionDate: energyActionPlansTable.completionDate,
        progressPercent: energyActionPlansTable.progressPercent,
        status: energyActionPlansTable.status,
        isVap: energyActionPlansTable.isVap,
        notes: energyActionPlansTable.notes,
        createdBy: energyActionPlansTable.createdBy,
        createdAt: energyActionPlansTable.createdAt,
        updatedAt: energyActionPlansTable.updatedAt,
        targetName: energyTargetsTable.name,
        targetUnitId: energyTargetsTable.unitId,
      })
      .from(energyActionPlansTable)
      .leftJoin(energyTargetsTable, eq(energyActionPlansTable.targetId, energyTargetsTable.id))
      .where(and(...conditions))
      .orderBy(energyActionPlansTable.createdAt);

    // Non-admin ve birime atanmamış kullanıcı şirket geneli veri göremez
    if (isStandard(role) && sessionUnitId === null) {
      res.json([]);
      return;
    }

    // Normal kullanıcı sadece kendi birimini görür
    const filtered =
      isStandard(role)
        ? plans.filter((p) => p.targetUnitId === sessionUnitId)
        : plans;

    res.json(filtered);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/energy-action-plans
router.post("/energy-action-plans", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId, name: userName } = req.user!;
    const {
      targetId, title, description, responsibleUserId, responsibleName, priority,
      expectedSavingValue, expectedSavingUnit, expectedCostSaving,
      investmentCost, paybackMonths, startDate, dueDate, completionDate,
      progressPercent, status, isVap, notes,
    } = req.body;

    if (targetId === undefined || title === undefined) {
      res.status(400).json({ error: "Hedef ve başlık zorunludur" }); return;
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
    if (parsedStartDate && parsedDueDate && parsedDueDate < parsedStartDate) throw new BadRequestError("Bitiş tarihi başlangıç tarihinden önce olamaz");
    const progress = progressPercent === undefined ? 0 : requiredProgress(progressPercent);
    const requestedStatus = enumValue(status, "status", ACTION_STATUSES, "planned");
    const effectiveStatus = progress === 100 ? "completed" : requestedStatus;
    if (effectiveStatus === "completed" && progress !== 100) throw new BadRequestError("Tamamlanan eylemin ilerlemesi 100 olmalıdır");
    const parsedIsVap = optionalBoolean(isVap, "isVap") ?? false;
    const parsedNotes = optionalString(notes, "notes");
    const calculatedVapPaybackMonths = parsedIsVap
      ? calculateVapPaybackMonths(parsedInvestmentCost ?? null, parsedExpectedCostSaving ?? null)
      : null;

    // Hedefin aynı company_id içinde olduğunu doğrula
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const effectiveCompanyId = await resolveEffectiveCompanyId(role, sessionCompanyId, req.body.companyId, true);
    if (effectiveCompanyId === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    const parsedTargetId = parsePositiveInteger(targetId);
    if (parsedTargetId === undefined) { res.status(400).json({ error: "Geçersiz targetId" }); return; }
    const targetConditions = [eq(energyTargetsTable.id, parsedTargetId), eq(energyTargetsTable.companyId, effectiveCompanyId)];
    if (isStandard(role)) targetConditions.push(eq(energyTargetsTable.unitId, sessionUnitId!));
    const [target] = await db.select({ id: energyTargetsTable.id, companyId: energyTargetsTable.companyId, unitId: energyTargetsTable.unitId })
      .from(energyTargetsTable).where(and(...targetConditions));
    if (!target) {
      res.status(403).json({ error: "Geçersiz hedef" }); return;
    }
    if (isStandard(role) && sessionUnitId !== null && target.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Bu hedefe eylem planı ekleme yetkiniz yok" }); return;
    }
    const owner = await resolveResponsibleUserId(responsibleUserId, target.companyId, target.unitId);
    if (owner.error) { res.status(400).json({ error: owner.error }); return; }

    const [item] = await db.insert(energyActionPlansTable).values({
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

    // isVap=true ise otomatik VAP projesi oluştur
    if (parsedIsVap) {
      await db.insert(vapProjectsTable).values({
        companyId: target.companyId,
        actionPlanId: item.id,
        projectTitle: parsedTitle,
        annualCostSaving: parsedExpectedCostSaving ?? null,
        investmentCost: parsedInvestmentCost ?? null,
        paybackMonths: calculatedVapPaybackMonths,
        startDate: parsedStartDate ?? null,
        endDate: parsedDueDate ?? null,
        status: "idea",
        notes: parsedNotes ?? null,
        createdBy: userName,
      });
    }

    res.status(201).json(item);
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PUT /api/energy-action-plans/:id
router.put("/energy-action-plans/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz actionPlanId" }); return; }
    const effectiveCompanyId = await resolveEffectiveCompanyId(role, sessionCompanyId, req.body.companyId, true);
    if (effectiveCompanyId === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }

    const recordConditions = [eq(energyActionPlansTable.id, id), eq(energyActionPlansTable.companyId, effectiveCompanyId)];
    const [existing] = await db
      .select({
        id: energyActionPlansTable.id,
        companyId: energyActionPlansTable.companyId,
        targetId: energyActionPlansTable.targetId,
        isVap: energyActionPlansTable.isVap,
        progressPercent: energyActionPlansTable.progressPercent,
        status: energyActionPlansTable.status,
        startDate: energyActionPlansTable.startDate,
        dueDate: energyActionPlansTable.dueDate,
      })
      .from(energyActionPlansTable).where(and(...recordConditions));
    if (!existing) { res.status(404).json({ error: "Bulunamadı" }); return; }
    if (existing.companyId !== effectiveCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }
    const [target] = await db.select({ companyId: energyTargetsTable.companyId, unitId: energyTargetsTable.unitId })
      .from(energyTargetsTable).where(and(
        eq(energyTargetsTable.id, existing.targetId),
        eq(energyTargetsTable.companyId, effectiveCompanyId),
      ));
    if (!target || (isStandard(role) && target.unitId !== sessionUnitId)) { res.status(403).json({ error: "Yetki yok" }); return; }

    const {
      title, description, responsibleUserId, responsibleName, priority,
      expectedSavingValue, expectedSavingUnit, expectedCostSaving,
      investmentCost, paybackMonths, startDate, dueDate, completionDate,
      progressPercent, status, isVap, notes,
    } = req.body;
    const parsedTitle = title !== undefined ? requiredString(title, "title") : undefined;
    const parsedDescription = description !== undefined ? optionalString(description, "description") : undefined;
    const parsedResponsibleName = responsibleName !== undefined ? optionalString(responsibleName, "responsibleName") : undefined;
    const parsedPriority = priority !== undefined ? enumValue(priority, "priority", ACTION_PRIORITIES) : undefined;
    const parsedExpectedSavingValue = expectedSavingValue !== undefined ? optionalFinite(expectedSavingValue, "expectedSavingValue") : undefined;
    const parsedExpectedSavingUnit = expectedSavingUnit !== undefined ? optionalString(expectedSavingUnit, "expectedSavingUnit") : undefined;
    const parsedExpectedCostSaving = expectedCostSaving !== undefined ? optionalFinite(expectedCostSaving, "expectedCostSaving") : undefined;
    const parsedInvestmentCost = investmentCost !== undefined ? optionalFinite(investmentCost, "investmentCost") : undefined;
    const parsedPaybackMonths = paybackMonths !== undefined ? optionalFinite(paybackMonths, "paybackMonths") : undefined;
    const parsedStartDate = startDate !== undefined ? optionalIsoDate(startDate, "startDate") : undefined;
    const parsedDueDate = dueDate !== undefined ? optionalIsoDate(dueDate, "dueDate") : undefined;
    const parsedCompletionDate = completionDate !== undefined ? optionalIsoDate(completionDate, "completionDate") : undefined;
    const finalStartDate = parsedStartDate !== undefined ? parsedStartDate : existing.startDate;
    const finalDueDate = parsedDueDate !== undefined ? parsedDueDate : existing.dueDate;
    if (finalStartDate && finalDueDate && finalDueDate < finalStartDate) throw new BadRequestError("Bitiş tarihi başlangıç tarihinden önce olamaz");
    const parsedProgress = progressPercent !== undefined ? requiredProgress(progressPercent) : undefined;
    const requestedStatus = status !== undefined ? enumValue(status, "status", ACTION_STATUSES) : existing.status;
    const finalProgress = parsedProgress ?? existing.progressPercent;
    const finalStatus = finalProgress === 100 ? "completed" : requestedStatus;
    if (finalStatus === "completed" && finalProgress !== 100) throw new BadRequestError("Tamamlanan eylemin ilerlemesi 100 olmalıdır");
    const parsedIsVap = isVap !== undefined ? optionalBoolean(isVap, "isVap") : undefined;
    const parsedNotes = notes !== undefined ? optionalString(notes, "notes") : undefined;
    const owner = await resolveResponsibleUserId(responsibleUserId, target.companyId, target.unitId);
    if (owner.error) { res.status(400).json({ error: owner.error }); return; }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsedTitle !== undefined) updates.title = parsedTitle;
    if (parsedDescription !== undefined) updates.description = parsedDescription;
    if (owner.value !== undefined) updates.responsibleUserId = owner.value;
    if (parsedResponsibleName !== undefined) updates.responsibleName = parsedResponsibleName;
    if (parsedPriority !== undefined) updates.priority = parsedPriority;
    if (parsedExpectedSavingValue !== undefined) updates.expectedSavingValue = parsedExpectedSavingValue;
    if (parsedExpectedSavingUnit !== undefined) updates.expectedSavingUnit = parsedExpectedSavingUnit;
    if (parsedExpectedCostSaving !== undefined) updates.expectedCostSaving = parsedExpectedCostSaving;
    if (parsedInvestmentCost !== undefined) updates.investmentCost = parsedInvestmentCost;
    if (parsedPaybackMonths !== undefined) updates.paybackMonths = parsedPaybackMonths;
    if (parsedStartDate !== undefined) updates.startDate = parsedStartDate;
    if (parsedDueDate !== undefined) updates.dueDate = parsedDueDate;
    if (parsedCompletionDate !== undefined) updates.completionDate = parsedCompletionDate;
    if (progressPercent !== undefined) updates.progressPercent = finalProgress;
    if (status !== undefined || finalProgress === 100) updates.status = finalStatus;
    if (parsedIsVap !== undefined) updates.isVap = parsedIsVap;
    if (parsedNotes !== undefined) updates.notes = parsedNotes;

    recordConditions.push(eq(energyActionPlansTable.targetId, existing.targetId));
    const item = await db.transaction(async (tx) => {
      const [updatedItem] = await tx.update(energyActionPlansTable).set(updates).where(and(...recordConditions)).returning();
      if (!updatedItem) throw new Error("Action plan update failed");

      // isVap değişti ise VAP kaydını güncelle
      if (parsedIsVap !== undefined && parsedIsVap !== Boolean(existing.isVap)) {
        if (parsedIsVap) {
          // isVap true → bağlı VAP yoksa oluştur
          const [existingVap] = await tx.select({ id: vapProjectsTable.id })
            .from(vapProjectsTable)
            .where(and(eq(vapProjectsTable.actionPlanId, id), eq(vapProjectsTable.companyId, effectiveCompanyId)));
          if (!existingVap) {
            const { name: userName } = req.user!;
            await tx.insert(vapProjectsTable).values({
              companyId: target.companyId,
              actionPlanId: id,
              projectTitle: updatedItem.title,
              annualCostSaving: updatedItem.expectedCostSaving,
              investmentCost: updatedItem.investmentCost,
              paybackMonths: calculateVapPaybackMonths(updatedItem.investmentCost, updatedItem.expectedCostSaving),
              status: "idea",
              createdBy: userName,
            });
          }
        } else {
          // isVap false → phantom VAP kaydını temizle
          await tx.delete(vapProjectsTable).where(and(eq(vapProjectsTable.actionPlanId, id), eq(vapProjectsTable.companyId, effectiveCompanyId)));
        }
      }

      return updatedItem;
    });

    res.json(item);
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/energy-action-plans/:id
router.delete("/energy-action-plans/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz actionPlanId" }); return; }
    const recordConditions = [eq(energyActionPlansTable.id, id), eq(energyActionPlansTable.companyId, sessionCompanyId)];
    const [existing] = await db.select().from(energyActionPlansTable).where(and(...recordConditions));
    if (!existing) { res.status(404).send(); return; }
    if (existing.companyId !== sessionCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }
    if (isStandard(role) && sessionUnitId !== null) {
      const [target] = await db.select({ unitId: energyTargetsTable.unitId }).from(energyTargetsTable).where(and(
        eq(energyTargetsTable.id, existing.targetId),
        eq(energyTargetsTable.companyId, sessionCompanyId),
        eq(energyTargetsTable.unitId, sessionUnitId!),
      ));
      if (target?.unitId !== sessionUnitId) { res.status(403).json({ error: "Yetki yok" }); return; }
    }
    recordConditions.push(eq(energyActionPlansTable.targetId, existing.targetId));
    await db.delete(energyActionPlansTable).where(and(...recordConditions));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
