import { Router } from "express";
import { db, swotTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/swot", requireAuth, async (req, res) => {
  try {
    const conditions: SQL[] = [];
    if (req.user!.role !== "admin" && req.user!.unitId !== null) {
      conditions.push(eq(swotTable.unitId, req.user!.unitId));
    } else {
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(swotTable.unitId, unitId));
    }
    const items = conditions.length > 0
      ? await db.select().from(swotTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(swotTable.createdAt)
      : await db.select().from(swotTable).orderBy(swotTable.createdAt);
    res.json(items.map(i => ({
      id: i.id,
      unitId: i.unitId,
      category: i.category,
      title: i.title,
      description: i.description,
      score: i.score,
      impact: i.impact,
      createdAt: i.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/swot", requireAuth, async (req, res) => {
  try {
    const { category, title, description, score, impact, unitId } = req.body;
    if (!category || !title || !score || !impact) {
      return res.status(400).json({ error: "Zorunlu alanlar eksik" });
    }
    const resolvedUnitId = req.user!.role !== "admin" && req.user!.unitId !== null
      ? req.user!.unitId
      : (unitId ? parseInt(unitId) : null);
    const [item] = await db.insert(swotTable).values({
      category,
      title,
      description: description || null,
      score: parseInt(score),
      impact,
      unitId: resolvedUnitId,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/swot/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const updates: Record<string, unknown> = {};
    const { category, title, description, score, impact, unitId } = req.body;
    if (category !== undefined) updates.category = category;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (score !== undefined) updates.score = parseInt(score);
    if (impact !== undefined) updates.impact = impact;
    if (req.user!.role === "admin" && unitId !== undefined) {
      updates.unitId = unitId ? parseInt(unitId) : null;
    }
    const [item] = await db.update(swotTable).set(updates).where(eq(swotTable.id, id)).returning();
    if (!item) return res.status(404).json({ error: "Bulunamadı" });
    res.json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.delete("/swot/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(swotTable).where(eq(swotTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
