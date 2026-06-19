import { Router } from "express";
import { db, swotTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/swot", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [];

    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null) {
      // Normal kullanıcı: kendi birimi
      conditions.push(eq(swotTable.unitId, sessionUnitId));
    } else if (role === "admin") {
      // Admin: kendi firması
      conditions.push(eq(swotTable.companyId, sessionCompanyId));
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(swotTable.unitId, unitId));
    } else {
      // Superadmin: isteğe bağlı unitId filtresi
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(swotTable.unitId, unitId));
    }

    const items = conditions.length > 0
      ? await db.select().from(swotTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(swotTable.createdAt)
      : await db.select().from(swotTable).orderBy(swotTable.createdAt);
    res.json(items.map(i => ({
      id: i.id, unitId: i.unitId, category: i.category, title: i.title,
      description: i.description, score: i.score, impact: i.impact, createdAt: i.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/swot", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { category, title, description, score, impact, unitId } = req.body;
    if (!category || !title || !score || !impact) {
      return res.status(400).json({ error: "Zorunlu alanlar eksik" });
    }
    const resolvedUnitId = role !== "admin" && role !== "superadmin" && sessionUnitId !== null
      ? sessionUnitId
      : (unitId ? parseInt(unitId) : null);
    const [item] = await db.insert(swotTable).values({
      category, title,
      description: description || null,
      score: parseInt(score),
      impact,
      unitId: resolvedUnitId,
      companyId: sessionCompanyId,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/swot/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(swotTable).where(eq(swotTable.id, id));
    if (!existing) return res.status(404).json({ error: "Bulunamadı" });
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.unitId !== sessionUnitId) {
      return res.status(403).json({ error: "Yetki yok" });
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      return res.status(403).json({ error: "Bu kaydı düzenleme yetkiniz yok" });
    }
    const updates: Record<string, unknown> = {};
    const { category, title, description, score, impact, unitId } = req.body;
    if (category !== undefined) updates.category = category;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (score !== undefined) updates.score = parseInt(score);
    if (impact !== undefined) updates.impact = impact;
    if ((role === "admin" || role === "superadmin") && unitId !== undefined) {
      updates.unitId = unitId ? parseInt(unitId) : null;
    }
    const [item] = await db.update(swotTable).set(updates).where(eq(swotTable.id, id)).returning();
    res.json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.delete("/swot/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(swotTable).where(eq(swotTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu kaydı silme yetkiniz yok" }); return;
    }
    await db.delete(swotTable).where(eq(swotTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
