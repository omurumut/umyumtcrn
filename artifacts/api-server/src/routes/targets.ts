import { Router } from "express";
import { db, energyTargetsTable, consumptionTable, metersTable } from "@workspace/db";
import { eq, and, SQL, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

async function calcProgress(unitId: number | null, baselineYear: number, targetYear: number) {
  const currentYear = new Date().getFullYear();
  const endYear = Math.min(targetYear, currentYear);
  const years: number[] = [];
  for (let y = baselineYear; y <= endYear; y++) years.push(y);
  if (years.length === 0) return { baselineKwh: null, yearlyProgress: [] };

  const meterRows = unitId
    ? await db.select({ id: metersTable.id }).from(metersTable).where(eq(metersTable.unitId, unitId))
    : await db.select({ id: metersTable.id }).from(metersTable);

  if (meterRows.length === 0) return { baselineKwh: null, yearlyProgress: [] };
  const meterIds = meterRows.map((m) => m.id);

  const rows = await db
    .select({
      year: consumptionTable.year,
      totalKwh: sql<number>`sum(${consumptionTable.kwh})`.as("total_kwh"),
    })
    .from(consumptionTable)
    .where(and(inArray(consumptionTable.meterId, meterIds), inArray(consumptionTable.year, years)))
    .groupBy(consumptionTable.year);

  const kwhByYear: Record<number, number> = {};
  for (const r of rows) kwhByYear[r.year] = r.totalKwh ?? 0;

  const baselineKwh = kwhByYear[baselineYear] ?? null;
  const yearlyProgress = years.map((y) => {
    const actualKwh = kwhByYear[y] ?? null;
    const reductionPercent =
      baselineKwh && actualKwh !== null
        ? parseFloat((((baselineKwh - actualKwh) / baselineKwh) * 100).toFixed(2))
        : null;
    return { year: y, actualKwh, reductionPercent };
  });
  return { baselineKwh, yearlyProgress };
}

// GET /api/targets
router.get("/targets", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [];

    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null) {
      conditions.push(eq(energyTargetsTable.unitId, sessionUnitId));
    } else if (role === "admin") {
      conditions.push(eq(energyTargetsTable.companyId, sessionCompanyId));
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(energyTargetsTable.unitId, unitId));
    } else {
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(energyTargetsTable.unitId, unitId));
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;
      if (companyId !== undefined) conditions.push(eq(energyTargetsTable.companyId, companyId));
    }

    const targets = conditions.length > 0
      ? await db.select().from(energyTargetsTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(energyTargetsTable.createdAt)
      : await db.select().from(energyTargetsTable).orderBy(energyTargetsTable.createdAt);

    const result = await Promise.all(
      targets.map(async (t) => {
        const progress = await calcProgress(t.unitId, t.baselineYear, t.targetYear);
        return { ...t, ...progress };
      })
    );
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/targets
router.post("/targets", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const {
      name, baselineYear, targetYear, targetReductionPercent, notes, unitId,
      objectiveText, targetText, targetType, baselineValue, targetValue, actualValue,
      unitLabel, status, subUnitId, energySourceId, seuAssessmentId,
    } = req.body;
    if (!name || !baselineYear || !targetYear || targetReductionPercent === undefined) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" }); return;
    }
    const resolvedUnitId = role !== "admin" && role !== "superadmin" && sessionUnitId !== null
      ? sessionUnitId
      : unitId ? parseInt(unitId) : null;
    const [item] = await db.insert(energyTargetsTable).values({
      name,
      baselineYear: parseInt(baselineYear),
      targetYear: parseInt(targetYear),
      targetReductionPercent: parseFloat(targetReductionPercent),
      notes: notes || null,
      unitId: resolvedUnitId,
      companyId: sessionCompanyId,
      objectiveText: objectiveText || null,
      targetText: targetText || null,
      targetType: targetType || null,
      baselineValue: baselineValue != null && baselineValue !== "" ? parseFloat(baselineValue) : null,
      targetValue: targetValue != null && targetValue !== "" ? parseFloat(targetValue) : null,
      actualValue: actualValue != null && actualValue !== "" ? parseFloat(actualValue) : null,
      unitLabel: unitLabel || null,
      status: status || "active",
      subUnitId: subUnitId ? parseInt(subUnitId) : null,
      energySourceId: energySourceId ? parseInt(energySourceId) : null,
      seuAssessmentId: seuAssessmentId ? parseInt(seuAssessmentId) : null,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/targets/:id
router.patch("/targets/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(energyTargetsTable).where(eq(energyTargetsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Bulunamadı" }); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu kaydı düzenleme yetkiniz yok" }); return;
    }
    const {
      name, baselineYear, targetYear, targetReductionPercent, notes, unitId,
      objectiveText, targetText, targetType, baselineValue, targetValue, actualValue,
      unitLabel, status, subUnitId, energySourceId, seuAssessmentId,
    } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (baselineYear !== undefined) updates.baselineYear = parseInt(baselineYear);
    if (targetYear !== undefined) updates.targetYear = parseInt(targetYear);
    if (targetReductionPercent !== undefined) updates.targetReductionPercent = parseFloat(targetReductionPercent);
    if (notes !== undefined) updates.notes = notes || null;
    if ((role === "admin" || role === "superadmin") && unitId !== undefined) updates.unitId = unitId ? parseInt(unitId) : null;
    if (objectiveText !== undefined) updates.objectiveText = objectiveText || null;
    if (targetText !== undefined) updates.targetText = targetText || null;
    if (targetType !== undefined) updates.targetType = targetType || null;
    if (baselineValue !== undefined) updates.baselineValue = baselineValue !== "" && baselineValue != null ? parseFloat(baselineValue) : null;
    if (targetValue !== undefined) updates.targetValue = targetValue !== "" && targetValue != null ? parseFloat(targetValue) : null;
    if (actualValue !== undefined) updates.actualValue = actualValue !== "" && actualValue != null ? parseFloat(actualValue) : null;
    if (unitLabel !== undefined) updates.unitLabel = unitLabel || null;
    if (status !== undefined) updates.status = status || null;
    if (subUnitId !== undefined) updates.subUnitId = subUnitId ? parseInt(subUnitId) : null;
    if (energySourceId !== undefined) updates.energySourceId = energySourceId ? parseInt(energySourceId) : null;
    if (seuAssessmentId !== undefined) updates.seuAssessmentId = seuAssessmentId ? parseInt(seuAssessmentId) : null;
    const [item] = await db.update(energyTargetsTable).set(updates).where(eq(energyTargetsTable.id, id)).returning();
    res.json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/targets/:id
router.delete("/targets/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(energyTargetsTable).where(eq(energyTargetsTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu kaydı silme yetkiniz yok" }); return;
    }
    await db.delete(energyTargetsTable).where(eq(energyTargetsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
