import { Router } from "express";
import { db, energyTargetsTable, consumptionTable, metersTable } from "@workspace/db";
import { eq, and, SQL, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

async function calcProgress(unitId: number | null, baselineYear: number, targetYear: number) {
  // Fetch yearly kWh sums for this unit from baselineYear to current year
  const currentYear = new Date().getFullYear();
  const endYear = Math.min(targetYear, currentYear);

  const years: number[] = [];
  for (let y = baselineYear; y <= endYear; y++) years.push(y);
  if (years.length === 0) return { baselineKwh: null, yearlyProgress: [] };

  // Get meterIds for this unit
  const meterRows = unitId
    ? await db.select({ id: metersTable.id }).from(metersTable).where(eq(metersTable.unitId, unitId))
    : await db.select({ id: metersTable.id }).from(metersTable);

  if (meterRows.length === 0) return { baselineKwh: null, yearlyProgress: [] };
  const meterIds = meterRows.map((m) => m.id);

  // Sum kWh per year
  const rows = await db
    .select({
      year: consumptionTable.year,
      totalKwh: sql<number>`sum(${consumptionTable.kwh})`.as("total_kwh"),
    })
    .from(consumptionTable)
    .where(
      and(
        inArray(consumptionTable.meterId, meterIds),
        inArray(consumptionTable.year, years)
      )
    )
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
    const conditions: SQL[] = [];
    if (req.user!.role !== "admin" && req.user!.unitId !== null) {
      conditions.push(eq(energyTargetsTable.unitId, req.user!.unitId));
    } else {
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(energyTargetsTable.unitId, unitId));
    }

    const targets =
      conditions.length > 0
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
    const { name, baselineYear, targetYear, targetReductionPercent, notes, unitId } = req.body;
    if (!name || !baselineYear || !targetYear || targetReductionPercent === undefined) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" });
      return;
    }
    const resolvedUnitId =
      req.user!.role !== "admin" && req.user!.unitId !== null
        ? req.user!.unitId
        : unitId ? parseInt(unitId) : null;

    const [item] = await db.insert(energyTargetsTable).values({
      name,
      baselineYear: parseInt(baselineYear),
      targetYear: parseInt(targetYear),
      targetReductionPercent: parseFloat(targetReductionPercent),
      notes: notes || null,
      unitId: resolvedUnitId,
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
    const id = parseInt(req.params.id as string);
    const updates: Record<string, unknown> = {};
    const { name, baselineYear, targetYear, targetReductionPercent, notes, unitId } = req.body;
    if (name !== undefined) updates.name = name;
    if (baselineYear !== undefined) updates.baselineYear = parseInt(baselineYear);
    if (targetYear !== undefined) updates.targetYear = parseInt(targetYear);
    if (targetReductionPercent !== undefined) updates.targetReductionPercent = parseFloat(targetReductionPercent);
    if (notes !== undefined) updates.notes = notes || null;
    if (req.user!.role === "admin" && unitId !== undefined) updates.unitId = unitId ? parseInt(unitId) : null;
    const [item] = await db.update(energyTargetsTable).set(updates).where(eq(energyTargetsTable.id, id)).returning();
    if (!item) { res.status(404).json({ error: "Bulunamadı" }); return; }
    res.json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/targets/:id
router.delete("/targets/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(energyTargetsTable).where(eq(energyTargetsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
