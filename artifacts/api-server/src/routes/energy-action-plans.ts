import { Router } from "express";
import { db, energyActionPlansTable, energyTargetsTable, vapProjectsTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

function isCompanyAdmin(role: string) { return role === "admin" || role === "kontrol_admin"; }
function isSuperAdmin(role: string) { return role === "superadmin"; }
function isStandard(role: string) { return !isCompanyAdmin(role) && !isSuperAdmin(role); }
function parsePositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value); if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

// GET /api/energy-action-plans
router.get("/energy-action-plans", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [eq(energyActionPlansTable.companyId, sessionCompanyId)];

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
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
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
      targetId, title, description, responsibleName, priority,
      expectedSavingValue, expectedSavingUnit, expectedCostSaving,
      investmentCost, paybackMonths, startDate, dueDate, completionDate,
      progressPercent, status, isVap, notes,
    } = req.body;

    if (!targetId || !title) {
      res.status(400).json({ error: "Hedef ve başlık zorunludur" }); return;
    }

    // Hedefin aynı company_id içinde olduğunu doğrula
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const parsedTargetId = parsePositiveInteger(targetId);
    if (parsedTargetId === undefined) { res.status(400).json({ error: "Geçersiz targetId" }); return; }
    const targetConditions = [eq(energyTargetsTable.id, parsedTargetId), eq(energyTargetsTable.companyId, sessionCompanyId)];
    if (isStandard(role)) targetConditions.push(eq(energyTargetsTable.unitId, sessionUnitId!));
    const [target] = await db.select({ id: energyTargetsTable.id, companyId: energyTargetsTable.companyId, unitId: energyTargetsTable.unitId })
      .from(energyTargetsTable).where(and(...targetConditions));
    if (!target) {
      res.status(403).json({ error: "Geçersiz hedef" }); return;
    }
    if (isStandard(role) && sessionUnitId !== null && target.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Bu hedefe eylem planı ekleme yetkiniz yok" }); return;
    }

    const progress = Math.min(100, Math.max(0, parseFloat(progressPercent ?? "0") || 0));
    const toNum = (v: unknown) =>
      v !== null && v !== undefined && v !== "" && !isNaN(parseFloat(String(v)))
        ? parseFloat(String(v))
        : null;

    const [item] = await db.insert(energyActionPlansTable).values({
      companyId: sessionCompanyId,
      targetId: parsedTargetId,
      title,
      description: description || null,
      responsibleName: responsibleName || null,
      priority: priority || "medium",
      expectedSavingValue: toNum(expectedSavingValue),
      expectedSavingUnit: expectedSavingUnit || null,
      expectedCostSaving: toNum(expectedCostSaving),
      investmentCost: toNum(investmentCost),
      paybackMonths: toNum(paybackMonths),
      startDate: startDate || null,
      dueDate: dueDate || null,
      completionDate: completionDate || null,
      progressPercent: progress,
      status: status || "planned",
      isVap: Boolean(isVap),
      notes: notes || null,
      createdBy: userName,
    }).returning();

    // isVap=true ise otomatik VAP projesi oluştur
    if (Boolean(isVap)) {
      await db.insert(vapProjectsTable).values({
        companyId: sessionCompanyId,
        actionPlanId: item.id,
        projectTitle: title,
        annualCostSaving: toNum(expectedCostSaving),
        investmentCost: toNum(investmentCost),
        paybackMonths: toNum(paybackMonths),
        startDate: startDate || null,
        endDate: dueDate || null,
        status: "idea",
        notes: notes || null,
        createdBy: userName,
      });
    }

    res.status(201).json(item);
  } catch (err) {
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

    const recordConditions = [eq(energyActionPlansTable.id, id), eq(energyActionPlansTable.companyId, sessionCompanyId)];
    const [existing] = await db
      .select({
        id: energyActionPlansTable.id,
        companyId: energyActionPlansTable.companyId,
        targetId: energyActionPlansTable.targetId,
        isVap: energyActionPlansTable.isVap,
      })
      .from(energyActionPlansTable).where(and(...recordConditions));
    if (!existing) { res.status(404).json({ error: "Bulunamadı" }); return; }
    if (existing.companyId !== sessionCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }

    if (isStandard(role) && sessionUnitId !== null) {
      const [target] = await db.select({ unitId: energyTargetsTable.unitId }).from(energyTargetsTable).where(and(
        eq(energyTargetsTable.id, existing.targetId),
        eq(energyTargetsTable.companyId, sessionCompanyId),
        eq(energyTargetsTable.unitId, sessionUnitId!),
      ));
      if (target?.unitId !== sessionUnitId) { res.status(403).json({ error: "Yetki yok" }); return; }
    }

    const {
      title, description, responsibleName, priority,
      expectedSavingValue, expectedSavingUnit, expectedCostSaving,
      investmentCost, paybackMonths, startDate, dueDate, completionDate,
      progressPercent, status, isVap, notes,
    } = req.body;

    const toNum = (v: unknown) =>
      v !== null && v !== undefined && v !== "" && !isNaN(parseFloat(String(v)))
        ? parseFloat(String(v))
        : null;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description || null;
    if (responsibleName !== undefined) updates.responsibleName = responsibleName || null;
    if (priority !== undefined) updates.priority = priority;
    if (expectedSavingValue !== undefined) updates.expectedSavingValue = toNum(expectedSavingValue);
    if (expectedSavingUnit !== undefined) updates.expectedSavingUnit = expectedSavingUnit || null;
    if (expectedCostSaving !== undefined) updates.expectedCostSaving = toNum(expectedCostSaving);
    if (investmentCost !== undefined) updates.investmentCost = toNum(investmentCost);
    if (paybackMonths !== undefined) updates.paybackMonths = toNum(paybackMonths);
    if (startDate !== undefined) updates.startDate = startDate || null;
    if (dueDate !== undefined) updates.dueDate = dueDate || null;
    if (completionDate !== undefined) updates.completionDate = completionDate || null;
    if (progressPercent !== undefined) updates.progressPercent = Math.min(100, Math.max(0, toNum(progressPercent) ?? 0));
    if (status !== undefined) updates.status = status;
    if (isVap !== undefined) updates.isVap = Boolean(isVap);
    if (notes !== undefined) updates.notes = notes || null;

    recordConditions.push(eq(energyActionPlansTable.targetId, existing.targetId));
    const item = await db.transaction(async (tx) => {
      const [updatedItem] = await tx.update(energyActionPlansTable).set(updates).where(and(...recordConditions)).returning();
      if (!updatedItem) throw new Error("Action plan update failed");

      // isVap değişti ise VAP kaydını güncelle
      if (isVap !== undefined && Boolean(isVap) !== Boolean(existing.isVap)) {
        if (Boolean(isVap)) {
          // isVap true → bağlı VAP yoksa oluştur
          const [existingVap] = await tx.select({ id: vapProjectsTable.id })
            .from(vapProjectsTable)
            .where(and(eq(vapProjectsTable.actionPlanId, id), eq(vapProjectsTable.companyId, sessionCompanyId)));
          if (!existingVap) {
            const { name: userName } = req.user!;
            await tx.insert(vapProjectsTable).values({
              companyId: sessionCompanyId,
              actionPlanId: id,
              projectTitle: updatedItem.title,
              annualCostSaving: updatedItem.expectedCostSaving,
              investmentCost: updatedItem.investmentCost,
              paybackMonths: updatedItem.paybackMonths,
              status: "idea",
              createdBy: userName,
            });
          }
        } else {
          // isVap false → phantom VAP kaydını temizle
          await tx.delete(vapProjectsTable).where(and(eq(vapProjectsTable.actionPlanId, id), eq(vapProjectsTable.companyId, sessionCompanyId)));
        }
      }

      return updatedItem;
    });

    res.json(item);
  } catch (err) {
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
