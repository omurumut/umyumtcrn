import { Router } from "express";
import { db, unitsTable, metersTable, consumptionTable, seuTable, swotTable, risksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// GET /api/summary?year=2026
router.get("/summary", async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const prevYear = year - 1;

    const units = await db.select().from(unitsTable).where(eq(unitsTable.active, true)).orderBy(unitsTable.name);

    const summaryItems = await Promise.all(units.map(async (unit) => {
      // Current year consumption via meters join
      const currRows = await db
        .select({ kwh: consumptionTable.kwh, tep: consumptionTable.tep, co2: consumptionTable.co2 })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(and(eq(consumptionTable.year, year), eq(metersTable.unitId, unit.id)));

      const prevRows = await db
        .select({ kwh: consumptionTable.kwh })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(and(eq(consumptionTable.year, prevYear), eq(metersTable.unitId, unit.id)));

      const meters = await db
        .select({ id: metersTable.id })
        .from(metersTable)
        .where(eq(metersTable.unitId, unit.id));

      const seuItems = await db
        .select({ id: seuTable.id })
        .from(seuTable)
        .where(eq(seuTable.unitId, unit.id));

      const swotItems = await db
        .select({ id: swotTable.id })
        .from(swotTable)
        .where(eq(swotTable.unitId, unit.id));

      const riskItems = await db
        .select({ id: risksTable.id })
        .from(risksTable)
        .where(eq(risksTable.unitId, unit.id));

      const totalKwh = currRows.reduce((a, r) => a + r.kwh, 0);
      const totalTep = currRows.reduce((a, r) => a + r.tep, 0);
      const totalCo2 = currRows.reduce((a, r) => a + r.co2, 0);
      const prevKwh = prevRows.reduce((a, r) => a + r.kwh, 0);
      const kwhChange = prevKwh > 0 ? ((totalKwh - prevKwh) / prevKwh) * 100 : 0;

      return {
        id: unit.id,
        name: unit.name,
        location: unit.location,
        type: unit.type,
        city: unit.city,
        responsible: unit.responsible,
        totalKwh: Math.round(totalKwh),
        totalTep: Math.round(totalTep * 1000) / 1000,
        totalCo2: Math.round(totalCo2 * 100) / 100,
        kwhChange: Math.round(kwhChange * 10) / 10,
        meterCount: meters.length,
        seuCount: seuItems.length,
        swotCount: swotItems.length,
        riskCount: riskItems.length,
      };
    }));

    // Sort by totalKwh descending
    summaryItems.sort((a, b) => b.totalKwh - a.totalKwh);

    const grandTotalKwh = summaryItems.reduce((a, u) => a + u.totalKwh, 0);
    const grandTotalTep = summaryItems.reduce((a, u) => a + u.totalTep, 0);
    const grandTotalCo2 = summaryItems.reduce((a, u) => a + u.totalCo2, 0);

    res.json({
      year,
      unitCount: units.length,
      grandTotalKwh: Math.round(grandTotalKwh),
      grandTotalTep: Math.round(grandTotalTep * 1000) / 1000,
      grandTotalCo2: Math.round(grandTotalCo2 * 100) / 100,
      units: summaryItems,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
