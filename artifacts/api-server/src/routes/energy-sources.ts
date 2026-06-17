import { Router } from "express";
import { db, energySourcesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/energy-sources?unitId=1
router.get("/energy-sources", requireAuth, async (req, res) => {
  try {
    const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;

    if (req.user!.role !== "admin" && req.user!.unitId !== null) {
      const rows = await db.select().from(energySourcesTable)
        .where(eq(energySourcesTable.unitId, req.user!.unitId))
        .orderBy(energySourcesTable.name);
      res.json(rows);
      return;
    }

    if (unitId !== undefined) {
      const rows = await db.select().from(energySourcesTable)
        .where(eq(energySourcesTable.unitId, unitId))
        .orderBy(energySourcesTable.name);
      res.json(rows);
      return;
    }

    const rows = await db.select().from(energySourcesTable).orderBy(energySourcesTable.name);
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/energy-sources
router.post("/energy-sources", requireAuth, async (req, res) => {
  try {
    const { unitId, type, name, unit, active } = req.body;
    if (!unitId || !type || !name) {
      res.status(400).json({ error: "Birim, tür ve ad zorunludur" });
      return;
    }
    const parsedUnitId = parseInt(unitId);
    if (req.user!.role !== "admin" && req.user!.unitId !== parsedUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const [row] = await db.insert(energySourcesTable).values({
      unitId: parsedUnitId,
      type,
      name,
      unit: unit || "kWh",
      active: active !== undefined ? Boolean(active) : true,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/energy-sources/:id
router.patch("/energy-sources/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(energySourcesTable).where(eq(energySourcesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Enerji kaynağı bulunamadı" }); return; }
    if (req.user!.role !== "admin" && req.user!.unitId !== existing.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const { type, name, unit, active } = req.body;
    const updates: Record<string, unknown> = {};
    if (type !== undefined) updates.type = type;
    if (name !== undefined) updates.name = name;
    if (unit !== undefined) updates.unit = unit;
    if (active !== undefined) updates.active = Boolean(active);
    const [row] = await db.update(energySourcesTable).set(updates).where(eq(energySourcesTable.id, id)).returning();
    res.json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/energy-sources/:id
router.delete("/energy-sources/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(energySourcesTable).where(eq(energySourcesTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (req.user!.role !== "admin" && req.user!.unitId !== existing.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    await db.delete(energySourcesTable).where(eq(energySourcesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
