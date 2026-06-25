import { Router } from "express";
import { db, energyActionPlansTable, energyTargetsTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/energy-action-plans
router.get("/energy-action-plans", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [eq(energyActionPlansTable.companyId, sessionCompanyId)];

    const targetId = req.query.targetId ? parseInt(req.query.targetId as string) : undefined;
    if (targetId !== undefined) conditions.push(eq(energyActionPlansTable.targetId, targetId));

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

    // Normal kullanıcı sadece kendi birimini görür
    const filtered =
      role !== "admin" && role !== "superadmin" && sessionUnitId !== null
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
    const [target] = await db.select({ id: energyTargetsTable.id, companyId: energyTargetsTable.companyId, unitId: energyTargetsTable.unitId })
      .from(energyTargetsTable).where(eq(energyTargetsTable.id, parseInt(targetId)));
    if (!target || target.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Geçersiz hedef" }); return;
    }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && target.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Bu hedefe eylem planı ekleme yetkiniz yok" }); return;
    }

    const progress = Math.min(100, Math.max(0, parseFloat(progressPercent ?? "0") || 0));

    const [item] = await db.insert(energyActionPlansTable).values({
      companyId: sessionCompanyId,
      targetId: parseInt(targetId),
      title,
      description: description || null,
      responsibleName: responsibleName || null,
      priority: priority || "medium",
      expectedSavingValue: expectedSavingValue !== undefined ? parseFloat(expectedSavingValue) : null,
      expectedSavingUnit: expectedSavingUnit || null,
      expectedCostSaving: expectedCostSaving !== undefined ? parseFloat(expectedCostSaving) : null,
      investmentCost: investmentCost !== undefined ? parseFloat(investmentCost) : null,
      paybackMonths: paybackMonths !== undefined ? parseFloat(paybackMonths) : null,
      startDate: startDate || null,
      dueDate: dueDate || null,
      completionDate: completionDate || null,
      progressPercent: progress,
      status: status || "planned",
      isVap: Boolean(isVap),
      notes: notes || null,
      createdBy: userName,
    }).returning();
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
    const id = parseInt(req.params.id as string);

    const [existing] = await db
      .select({ id: energyActionPlansTable.id, companyId: energyActionPlansTable.companyId, targetId: energyActionPlansTable.targetId })
      .from(energyActionPlansTable).where(eq(energyActionPlansTable.id, id));
    if (!existing) { res.status(404).json({ error: "Bulunamadı" }); return; }
    if (existing.companyId !== sessionCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }

    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null) {
      const [target] = await db.select({ unitId: energyTargetsTable.unitId }).from(energyTargetsTable).where(eq(energyTargetsTable.id, existing.targetId));
      if (target?.unitId !== sessionUnitId) { res.status(403).json({ error: "Yetki yok" }); return; }
    }

    const {
      title, description, responsibleName, priority,
      expectedSavingValue, expectedSavingUnit, expectedCostSaving,
      investmentCost, paybackMonths, startDate, dueDate, completionDate,
      progressPercent, status, isVap, notes,
    } = req.body;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description || null;
    if (responsibleName !== undefined) updates.responsibleName = responsibleName || null;
    if (priority !== undefined) updates.priority = priority;
    if (expectedSavingValue !== undefined) updates.expectedSavingValue = expectedSavingValue !== null ? parseFloat(expectedSavingValue) : null;
    if (expectedSavingUnit !== undefined) updates.expectedSavingUnit = expectedSavingUnit || null;
    if (expectedCostSaving !== undefined) updates.expectedCostSaving = expectedCostSaving !== null ? parseFloat(expectedCostSaving) : null;
    if (investmentCost !== undefined) updates.investmentCost = investmentCost !== null ? parseFloat(investmentCost) : null;
    if (paybackMonths !== undefined) updates.paybackMonths = paybackMonths !== null ? parseFloat(paybackMonths) : null;
    if (startDate !== undefined) updates.startDate = startDate || null;
    if (dueDate !== undefined) updates.dueDate = dueDate || null;
    if (completionDate !== undefined) updates.completionDate = completionDate || null;
    if (progressPercent !== undefined) updates.progressPercent = Math.min(100, Math.max(0, parseFloat(progressPercent) || 0));
    if (status !== undefined) updates.status = status;
    if (isVap !== undefined) updates.isVap = Boolean(isVap);
    if (notes !== undefined) updates.notes = notes || null;

    const [item] = await db.update(energyActionPlansTable).set(updates).where(eq(energyActionPlansTable.id, id)).returning();
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
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(energyActionPlansTable).where(eq(energyActionPlansTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (existing.companyId !== sessionCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null) {
      const [target] = await db.select({ unitId: energyTargetsTable.unitId }).from(energyTargetsTable).where(eq(energyTargetsTable.id, existing.targetId));
      if (target?.unitId !== sessionUnitId) { res.status(403).json({ error: "Yetki yok" }); return; }
    }
    await db.delete(energyActionPlansTable).where(eq(energyActionPlansTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
