import { Router } from "express";
import { db, consumptionTable, metersTable, subUnitsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/consumption
router.get("/consumption", requireAuth, async (req, res) => {
  try {
    const meterId = req.query.meterId ? parseInt(req.query.meterId as string) : undefined;
    const year = req.query.year ? parseInt(req.query.year as string) : undefined;
    const month = req.query.month ? parseInt(req.query.month as string) : undefined;

    const rows = await db
      .select({
        id: consumptionTable.id,
        meterId: consumptionTable.meterId,
        meterName: metersTable.name,
        meterUnitId: metersTable.unitId,
        year: consumptionTable.year,
        month: consumptionTable.month,
        kwh: consumptionTable.kwh,
        tep: consumptionTable.tep,
        co2: consumptionTable.co2,
        hdd: consumptionTable.hdd,
        cdd: consumptionTable.cdd,
        notes: consumptionTable.notes,
        createdAt: consumptionTable.createdAt,
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .orderBy(consumptionTable.year, consumptionTable.month);

    const filtered = rows.filter(r => {
      if (req.user!.role !== "admin" && req.user!.unitId !== null && r.meterUnitId !== req.user!.unitId) return false;
      if (meterId !== undefined && r.meterId !== meterId) return false;
      if (year !== undefined && r.year !== year) return false;
      if (month !== undefined && r.month !== month) return false;
      return true;
    });

    res.json(filtered.map(({ meterUnitId, ...r }) => r));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/consumption
router.post("/consumption", requireAuth, async (req, res) => {
  try {
    const { meterId, year, month, kwh, tep, co2, hdd, cdd, notes } = req.body;
    if (!meterId || !year || !month) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" }); return;
    }

    // Check user access to meter
    if (req.user!.role !== "admin" && req.user!.unitId !== null) {
      const [meter] = await db.select().from(metersTable).where(eq(metersTable.id, parseInt(meterId)));
      if (!meter || meter.unitId !== req.user!.unitId) {
        res.status(403).json({ error: "Yetki yok" }); return;
      }
    }

    const kwhVal = parseFloat(kwh) || 0;
    const tepVal = tep !== undefined ? parseFloat(tep) : kwhVal * 0.000086;
    const co2Val = co2 !== undefined ? parseFloat(co2) : kwhVal * 0.4;

    const [record] = await db.insert(consumptionTable).values({
      meterId: parseInt(meterId),
      year: parseInt(year),
      month: parseInt(month),
      kwh: kwhVal,
      tep: tepVal,
      co2: co2Val,
      hdd: hdd !== undefined ? parseFloat(hdd) : null,
      cdd: cdd !== undefined ? parseFloat(cdd) : null,
      notes: notes || null,
    }).returning();

    const [meterRow] = await db.select({ name: metersTable.name }).from(metersTable).where(eq(metersTable.id, record.meterId));
    res.status(201).json({ ...record, meterName: meterRow?.name ?? null });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/consumption/:id
router.patch("/consumption/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const { kwh, tep, co2, hdd, cdd, notes } = req.body;
    const updates: Record<string, unknown> = {};
    if (kwh !== undefined) updates.kwh = parseFloat(kwh);
    if (tep !== undefined) updates.tep = parseFloat(tep);
    if (co2 !== undefined) updates.co2 = parseFloat(co2);
    if (hdd !== undefined) updates.hdd = parseFloat(hdd);
    if (cdd !== undefined) updates.cdd = parseFloat(cdd);
    if (notes !== undefined) updates.notes = notes;
    const [record] = await db.update(consumptionTable).set(updates).where(eq(consumptionTable.id, id)).returning();
    if (!record) { res.status(404).json({ error: "Kayıt bulunamadı" }); return; }
    res.json(record);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/consumption/:id
router.delete("/consumption/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(consumptionTable).where(eq(consumptionTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
