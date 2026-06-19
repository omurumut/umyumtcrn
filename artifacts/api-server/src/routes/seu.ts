import { Router } from "express";
import { db, seuTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/seu", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [];

    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null) {
      conditions.push(eq(seuTable.unitId, sessionUnitId));
    } else if (role === "admin") {
      conditions.push(eq(seuTable.companyId, sessionCompanyId));
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(seuTable.unitId, unitId));
    } else {
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(seuTable.unitId, unitId));
    }

    const items = conditions.length > 0
      ? await db.select().from(seuTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(seuTable.priority)
      : await db.select().from(seuTable).orderBy(seuTable.priority);
    res.json(items.map(i => ({
      id: i.id, unitId: i.unitId, name: i.name, category: i.category,
      annualKwh: i.annualKwh, percentage: i.percentage, priority: i.priority,
      targetReductionPercent: i.targetReductionPercent, responsible: i.responsible,
      notes: i.notes, createdAt: i.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/seu", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { name, category, annualKwh, percentage, priority, targetReductionPercent, responsible, notes, unitId } = req.body;
    if (!name || !category) {
      return res.status(400).json({ error: "Zorunlu alanlar eksik" });
    }
    const resolvedUnitId = role !== "admin" && role !== "superadmin" && sessionUnitId !== null
      ? sessionUnitId
      : (unitId ? parseInt(unitId) : null);
    const [item] = await db.insert(seuTable).values({
      name, category,
      annualKwh: parseFloat(annualKwh) || 0,
      percentage: parseFloat(percentage) || 0,
      priority: parseInt(priority) || 1,
      targetReductionPercent: targetReductionPercent ? parseFloat(targetReductionPercent) : null,
      responsible: responsible || null,
      notes: notes || null,
      unitId: resolvedUnitId,
      companyId: sessionCompanyId,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/seu/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(seuTable).where(eq(seuTable.id, id));
    if (!existing) return res.status(404).json({ error: "Bulunamadı" });
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.unitId !== sessionUnitId) {
      return res.status(403).json({ error: "Yetki yok" });
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      return res.status(403).json({ error: "Bu kaydı düzenleme yetkiniz yok" });
    }
    const updates: Record<string, unknown> = {};
    const { name, category, annualKwh, percentage, priority, targetReductionPercent, responsible, notes, unitId } = req.body;
    if (name !== undefined) updates.name = name;
    if (category !== undefined) updates.category = category;
    if (annualKwh !== undefined) updates.annualKwh = parseFloat(annualKwh);
    if (percentage !== undefined) updates.percentage = parseFloat(percentage);
    if (priority !== undefined) updates.priority = parseInt(priority);
    if (targetReductionPercent !== undefined) updates.targetReductionPercent = parseFloat(targetReductionPercent);
    if (responsible !== undefined) updates.responsible = responsible;
    if (notes !== undefined) updates.notes = notes;
    if ((role === "admin" || role === "superadmin") && unitId !== undefined) {
      updates.unitId = unitId ? parseInt(unitId) : null;
    }
    const [item] = await db.update(seuTable).set(updates).where(eq(seuTable.id, id)).returning();
    res.json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.delete("/seu/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(seuTable).where(eq(seuTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu kaydı silme yetkiniz yok" }); return;
    }
    await db.delete(seuTable).where(eq(seuTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
