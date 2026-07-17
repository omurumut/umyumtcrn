import { Router } from "express";
import { db, energyTargetProgressTable, energyTargetsTable } from "@workspace/db";
import { eq, and, SQL, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { writeAuditEvent } from "../lib/audit.js";

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

// GET /api/energy-target-progress
router.get("/energy-target-progress", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [eq(energyTargetProgressTable.companyId, sessionCompanyId)];
    if (isStandard(role) && sessionUnitId === null) { res.json([]); return; }

    const targetId = parsePositiveInteger(req.query.targetId);
    if (req.query.targetId !== undefined && targetId === undefined) { res.status(400).json({ error: "Geçersiz targetId" }); return; }
    if (targetId !== undefined) conditions.push(eq(energyTargetProgressTable.targetId, targetId));
    if (isStandard(role)) conditions.push(eq(energyTargetsTable.unitId, sessionUnitId!));

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

    res.json(rows);
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
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const parsedTargetId = parsePositiveInteger(targetId);
    const parsedPeriodYear = parsePositiveInteger(periodYear);
    if (parsedTargetId === undefined) { res.status(400).json({ error: "Geçersiz targetId" }); return; }
    if (parsedPeriodYear === undefined) { res.status(400).json({ error: "Geçersiz periodYear" }); return; }

    const targetConditions = [eq(energyTargetsTable.id, parsedTargetId), eq(energyTargetsTable.companyId, sessionCompanyId)];
    if (isStandard(role)) targetConditions.push(eq(energyTargetsTable.unitId, sessionUnitId!));
    const [target] = await db.select().from(energyTargetsTable).where(and(...targetConditions));
    if (!target) {
      res.status(403).json({ error: "Geçersiz hedef" }); return;
    }
    const parsedPeriodMonth =
      periodMonth !== null && periodMonth !== undefined && periodMonth !== ""
        ? parsePositiveInteger(periodMonth)
        : null;
    if (parsedPeriodMonth !== null && (parsedPeriodMonth === undefined || parsedPeriodMonth > 12)) {
      res.status(400).json({ error: "Geçersiz periodMonth" }); return;
    }
    const parsedActualSaving =
      actualSavingValue !== null && actualSavingValue !== undefined && actualSavingValue !== ""
        ? parseFloat(actualSavingValue)
        : null;

    const item = await db.transaction(async (tx) => {
      const [insertedItem] = await tx.insert(energyTargetProgressTable).values({
        companyId: sessionCompanyId,
        targetId: parsedTargetId,
        periodYear: parsedPeriodYear,
        periodMonth: parsedPeriodMonth,
        actualValue: parseFloat(actualValue),
        actualSavingValue: parsedActualSaving,
        comment: comment || null,
        recordedBy: userName,
      }).returning();

      // Son kaydı hedefin actual_value alanına yansıt
      const [updatedTarget] = await tx.update(energyTargetsTable).set({ actualValue: parseFloat(actualValue), updatedAt: new Date() })
        .where(and(...targetConditions))
        .returning({ id: energyTargetsTable.id });
      if (!updatedTarget) throw new Error("Target update failed");
      await writeAuditEvent(tx, {
        request: req,
        companyId: insertedItem.companyId,
        unitId: target.unitId,
        action: "target.progress.update",
        entityType: "target_progress",
        entityId: insertedItem.id,
        changes: { operation: "create", targetId: insertedItem.targetId, periodYear: insertedItem.periodYear, periodMonth: insertedItem.periodMonth, actualValue: insertedItem.actualValue },
      });

      return insertedItem;
    });

    res.status(201).json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/energy-target-progress/:id
router.delete("/energy-target-progress/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz progressId" }); return; }
    const recordConditions = [eq(energyTargetProgressTable.id, id), eq(energyTargetProgressTable.companyId, sessionCompanyId)];
    const [existing] = await db.select({ id: energyTargetProgressTable.id, companyId: energyTargetProgressTable.companyId, targetId: energyTargetProgressTable.targetId, targetUnitId: energyTargetsTable.unitId })
      .from(energyTargetProgressTable)
      .innerJoin(energyTargetsTable, eq(energyTargetProgressTable.targetId, energyTargetsTable.id))
      .where(and(...recordConditions, eq(energyTargetsTable.companyId, sessionCompanyId)));
    if (!existing) { res.status(404).send(); return; }
    if (existing.companyId !== sessionCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }
    if (isStandard(role) && existing.targetUnitId !== sessionUnitId) { res.status(403).json({ error: "Yetki yok" }); return; }
    recordConditions.push(eq(energyTargetProgressTable.targetId, existing.targetId));
    await db.transaction(async (tx) => {
      await tx.delete(energyTargetProgressTable).where(and(...recordConditions));
      const [latestProgress] = await tx
        .select({ actualValue: energyTargetProgressTable.actualValue })
        .from(energyTargetProgressTable)
        .where(and(
          eq(energyTargetProgressTable.companyId, sessionCompanyId),
          eq(energyTargetProgressTable.targetId, existing.targetId),
        ))
        .orderBy(desc(energyTargetProgressTable.recordedAt), desc(energyTargetProgressTable.id))
        .limit(1);
      await tx.update(energyTargetsTable)
        .set({ actualValue: latestProgress?.actualValue ?? null, updatedAt: new Date() })
        .where(and(
          eq(energyTargetsTable.id, existing.targetId),
          eq(energyTargetsTable.companyId, sessionCompanyId),
        ));
      await writeAuditEvent(tx, {
        request: req,
        companyId: existing.companyId,
        unitId: existing.targetUnitId,
        action: "target.progress.update",
        entityType: "target_progress",
        entityId: id,
        changes: { operation: "delete", targetId: existing.targetId },
      });
    });
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
