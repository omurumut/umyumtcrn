import { Router } from "express";
import { db, metersTable, consumptionTable, subUnitsTable, energySourcesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/meters?unitId=1&subUnitId=2&energySourceId=3
router.get("/meters", requireAuth, async (req, res) => {
  try {
    const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
    const subUnitId = req.query.subUnitId ? parseInt(req.query.subUnitId as string) : undefined;
    const energySourceId = req.query.energySourceId ? parseInt(req.query.energySourceId as string) : undefined;

    const rows = await db
      .select({
        id: metersTable.id,
        unitId: metersTable.unitId,
        subUnitId: metersTable.subUnitId,
        energySourceId: metersTable.energySourceId,
        name: metersTable.name,
        type: metersTable.type,
        location: metersTable.location,
        city: metersTable.city,
        unit: metersTable.unit,
        description: metersTable.description,
        createdAt: metersTable.createdAt,
        subUnitName: subUnitsTable.name,
        energySourceName: energySourcesTable.name,
      })
      .from(metersTable)
      .leftJoin(subUnitsTable, eq(metersTable.subUnitId, subUnitsTable.id))
      .leftJoin(energySourcesTable, eq(metersTable.energySourceId, energySourcesTable.id))
      .orderBy(metersTable.createdAt);

    const filtered = rows.filter(m => {
      if (req.user!.role !== "admin" && req.user!.unitId !== null && m.unitId !== req.user!.unitId) return false;
      if (unitId !== undefined && m.unitId !== unitId) return false;
      if (subUnitId !== undefined && m.subUnitId !== subUnitId) return false;
      if (energySourceId !== undefined && m.energySourceId !== energySourceId) return false;
      return true;
    });

    res.json(filtered);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/meters
router.post("/meters", requireAuth, async (req, res) => {
  try {
    const { name, type, location, city, unit, description, unitId, subUnitId, energySourceId } = req.body;
    if (!name || !type || !location || !unit) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" }); return;
    }
    const parsedUnitId = unitId ? parseInt(unitId) : null;
    if (req.user!.role !== "admin" && req.user!.unitId !== null && parsedUnitId !== req.user!.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const [meter] = await db.insert(metersTable).values({
      name,
      type,
      location,
      city: city || "Istanbul",
      unit,
      description: description || null,
      unitId: parsedUnitId,
      subUnitId: subUnitId ? parseInt(subUnitId) : null,
      energySourceId: energySourceId ? parseInt(energySourceId) : null,
    }).returning();
    res.status(201).json(meter);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/meters/:id
router.get("/meters/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const [meter] = await db.select().from(metersTable).where(eq(metersTable.id, id));
    if (!meter) { res.status(404).json({ error: "Sayaç bulunamadı" }); return; }
    if (req.user!.role !== "admin" && req.user!.unitId !== null && meter.unitId !== req.user!.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    res.json(meter);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/meters/:id
router.patch("/meters/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(metersTable).where(eq(metersTable.id, id));
    if (!existing) { res.status(404).json({ error: "Sayaç bulunamadı" }); return; }
    if (req.user!.role !== "admin" && req.user!.unitId !== null && existing.unitId !== req.user!.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const { name, type, location, city, unit, description, unitId, subUnitId, energySourceId } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (location !== undefined) updates.location = location;
    if (city !== undefined) updates.city = city;
    if (unit !== undefined) updates.unit = unit;
    if (description !== undefined) updates.description = description;
    if (unitId !== undefined) updates.unitId = unitId ? parseInt(unitId) : null;
    if (subUnitId !== undefined) updates.subUnitId = subUnitId ? parseInt(subUnitId) : null;
    if (energySourceId !== undefined) updates.energySourceId = energySourceId ? parseInt(energySourceId) : null;
    const [meter] = await db.update(metersTable).set(updates).where(eq(metersTable.id, id)).returning();
    res.json(meter);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/meters/:id
router.delete("/meters/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(metersTable).where(eq(metersTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (req.user!.role !== "admin" && req.user!.unitId !== null && existing.unitId !== req.user!.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    await db.delete(consumptionTable).where(eq(consumptionTable.meterId, id));
    await db.delete(metersTable).where(eq(metersTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
