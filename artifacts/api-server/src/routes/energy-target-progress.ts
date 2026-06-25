import { Router } from "express";
import { db, energyTargetProgressTable, energyTargetsTable } from "@workspace/db";
import { eq, and, SQL, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/energy-target-progress
router.get("/energy-target-progress", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [eq(energyTargetProgressTable.companyId, sessionCompanyId)];

    const targetId = req.query.targetId ? parseInt(req.query.targetId as string) : undefined;
    if (targetId !== undefined) conditions.push(eq(energyTargetProgressTable.targetId, targetId));

    const rows = await db
      .select({
        id: energyTargetProgressTable.id,
        companyId: energyTargetProgressTable.companyId,
        targetId: energyTargetProgressTable.targetId,
        periodYear: energyTargetProgressTable.periodYear,
        periodMonth: energyTargetProgressTable.periodMonth,
        actualValue: energyTargetProgressTable.actualValue,
        actualSavingValue: energyTargetProgressTable.actualSavingValue,
        comment: energyTargetProgressTable.comment,
        recordedBy: energyTargetProgressTable.recordedBy,
        recordedAt: energyTargetProgressTable.recordedAt,
        targetUnitId: energyTargetsTable.unitId,
      })
      .from(energyTargetProgressTable)
      .leftJoin(energyTargetsTable, eq(energyTargetProgressTable.targetId, energyTargetsTable.id))
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(desc(energyTargetProgressTable.recordedAt));

    const filtered =
      role !== "admin" && role !== "superadmin" && sessionUnitId !== null
        ? rows.filter((r) => r.targetUnitId === sessionUnitId)
        : rows;

    res.json(filtered);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/energy-target-progress
router.post("/energy-target-progress", requireAuth, async (req, res) => {
  try {
    const { companyId: sessionCompanyId, unitId: sessionUnitId, role, name: userName } = req.user!;
    const { targetId, periodYear, periodMonth, actualValue, actualSavingValue, comment } = req.body;

    if (!targetId || periodYear === undefined || actualValue === undefined) {
      res.status(400).json({ error: "Hedef, yıl ve gerçekleşen değer zorunludur" }); return;
    }

    const [target] = await db.select().from(energyTargetsTable).where(eq(energyTargetsTable.id, parseInt(targetId)));
    if (!target || target.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Geçersiz hedef" }); return;
    }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && target.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const [item] = await db.insert(energyTargetProgressTable).values({
      companyId: sessionCompanyId,
      targetId: parseInt(targetId),
      periodYear: parseInt(periodYear),
      periodMonth: periodMonth !== undefined ? parseInt(periodMonth) : null,
      actualValue: parseFloat(actualValue),
      actualSavingValue: actualSavingValue !== undefined ? parseFloat(actualSavingValue) : null,
      comment: comment || null,
      recordedBy: userName,
    }).returning();

    // Son kaydı hedefin actual_value alanına yansıt
    await db.update(energyTargetsTable).set({ actualValue: parseFloat(actualValue), updatedAt: new Date() })
      .where(eq(energyTargetsTable.id, parseInt(targetId)));

    res.status(201).json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/energy-target-progress/:id
router.delete("/energy-target-progress/:id", requireAuth, async (req, res) => {
  try {
    const { companyId: sessionCompanyId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(energyTargetProgressTable).where(eq(energyTargetProgressTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (existing.companyId !== sessionCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }
    await db.delete(energyTargetProgressTable).where(eq(energyTargetProgressTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
