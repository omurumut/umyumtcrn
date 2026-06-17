import { Router } from "express";
import { db, consumptionTable, metersTable, seuTable, weatherTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";

const router = Router();

const MONTH_NAMES = ["", "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function buildConsumptionConditions(year: number, unitId?: number): SQL[] {
  const conds: SQL[] = [eq(consumptionTable.year, year)];
  if (unitId !== undefined) conds.push(eq(metersTable.unitId, unitId));
  return conds;
}

// GET /api/dashboard/kpi?year=2026&unitId=1
router.get("/dashboard/kpi", async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;

    const currConds = buildConsumptionConditions(year, unitId);
    const prevConds = buildConsumptionConditions(year - 1, unitId);

    const rows = await db
      .select({ kwh: consumptionTable.kwh, tep: consumptionTable.tep, co2: consumptionTable.co2 })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(currConds.length === 1 ? currConds[0] : and(...currConds));

    const prevRows = await db
      .select({ kwh: consumptionTable.kwh, tep: consumptionTable.tep, co2: consumptionTable.co2 })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(prevConds.length === 1 ? prevConds[0] : and(...prevConds));

    // meters and SEU counts filtered by unit
    const metersConds: SQL[] = [];
    const seuConds: SQL[] = [];
    if (unitId !== undefined) {
      metersConds.push(eq(metersTable.unitId, unitId));
      seuConds.push(eq(seuTable.unitId, unitId));
    }
    const meters = metersConds.length > 0
      ? await db.select().from(metersTable).where(metersConds[0])
      : await db.select().from(metersTable);
    const seuItems = seuConds.length > 0
      ? await db.select().from(seuTable).where(seuConds[0])
      : await db.select().from(seuTable);

    const totalKwh = rows.reduce((a, r) => a + r.kwh, 0);
    const totalTep = rows.reduce((a, r) => a + r.tep, 0);
    const totalCo2 = rows.reduce((a, r) => a + r.co2, 0);
    const prevKwh = prevRows.reduce((a, r) => a + r.kwh, 0);
    const prevTep = prevRows.reduce((a, r) => a + r.tep, 0);
    const prevCo2 = prevRows.reduce((a, r) => a + r.co2, 0);

    const kwhChange = prevKwh > 0 ? ((totalKwh - prevKwh) / prevKwh) * 100 : 0;
    const tepChange = prevTep > 0 ? ((totalTep - prevTep) / prevTep) * 100 : 0;
    const co2Change = prevCo2 > 0 ? ((totalCo2 - prevCo2) / prevCo2) * 100 : 0;

    res.json({
      year,
      totalKwh: Math.round(totalKwh),
      totalTep: Math.round(totalTep * 1000) / 1000,
      totalCo2: Math.round(totalCo2 * 100) / 100,
      kwhChange: Math.round(kwhChange * 10) / 10,
      tepChange: Math.round(tepChange * 10) / 10,
      co2Change: Math.round(co2Change * 10) / 10,
      meterCount: meters.length,
      activeSeuCount: seuItems.length,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/dashboard/monthly-trend?year=2026&unitId=1
router.get("/dashboard/monthly-trend", async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;

    const conds = buildConsumptionConditions(year, unitId);
    const rows = await db
      .select({ kwh: consumptionTable.kwh, tep: consumptionTable.tep, co2: consumptionTable.co2, month: consumptionTable.month })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(conds.length === 1 ? conds[0] : and(...conds));

    const weatherRows = await db.select().from(weatherTable).where(eq(weatherTable.year, year));

    const byMonth: Record<number, { kwh: number; tep: number; co2: number }> = {};
    const weatherByMonth: Record<number, { hdd: number; cdd: number }> = {};

    for (let m = 1; m <= 12; m++) byMonth[m] = { kwh: 0, tep: 0, co2: 0 };
    for (const r of rows) {
      byMonth[r.month].kwh += r.kwh;
      byMonth[r.month].tep += r.tep;
      byMonth[r.month].co2 += r.co2;
    }
    for (const w of weatherRows) weatherByMonth[w.month] = { hdd: w.hdd, cdd: w.cdd };

    const trend = [];
    for (let m = 1; m <= 12; m++) {
      trend.push({
        month: m,
        monthName: MONTH_NAMES[m],
        kwh: Math.round(byMonth[m].kwh),
        tep: Math.round(byMonth[m].tep * 1000) / 1000,
        co2: Math.round(byMonth[m].co2 * 100) / 100,
        hdd: weatherByMonth[m]?.hdd ?? null,
        cdd: weatherByMonth[m]?.cdd ?? null,
      });
    }
    res.json(trend);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/dashboard/seu-breakdown?year=2026&unitId=1
router.get("/dashboard/seu-breakdown", async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;

    const seuConds: SQL[] = [];
    if (unitId !== undefined) seuConds.push(eq(seuTable.unitId, unitId));
    const seuItems = seuConds.length > 0
      ? await db.select().from(seuTable).where(seuConds[0]).orderBy(seuTable.priority)
      : await db.select().from(seuTable).orderBy(seuTable.priority);

    if (seuItems.length === 0) {
      // Fall back to consumption by meter (filtered by unit if provided)
      const conds = buildConsumptionConditions(year, unitId);
      const rows = await db
        .select({
          meterName: metersTable.name,
          kwh: consumptionTable.kwh,
          category: metersTable.type,
        })
        .from(consumptionTable)
        .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(conds.length === 1 ? conds[0] : and(...conds));

      const byMeter: Record<string, { kwh: number; category: string }> = {};
      for (const r of rows) {
        const key = r.meterName ?? "Bilinmeyen";
        if (!byMeter[key]) byMeter[key] = { kwh: 0, category: r.category ?? "diger" };
        byMeter[key].kwh += r.kwh;
      }
      const total = Object.values(byMeter).reduce((a, b) => a + b.kwh, 0);
      return res.json(
        Object.entries(byMeter)
          .sort((a, b) => b[1].kwh - a[1].kwh)
          .map(([name, v]) => ({
            name,
            kwh: Math.round(v.kwh),
            percentage: total > 0 ? Math.round((v.kwh / total) * 1000) / 10 : 0,
            category: v.category,
          }))
      );
    }

    return res.json(
      seuItems.map(s => ({
        name: s.name,
        kwh: Math.round(s.annualKwh),
        percentage: s.percentage,
        category: s.category,
      }))
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
