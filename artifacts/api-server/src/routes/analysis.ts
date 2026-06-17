import { Router } from "express";
import { db, consumptionTable, metersTable, weatherTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  const ssRes = ys.reduce((a, y, i) => a + (y - (slope * xs[i] + intercept)) ** 2, 0);
  const ssTot = ys.reduce((a, y) => a + (y - meanY) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r2 };
}

// GET /api/analysis/regression
router.get("/analysis/regression", requireAuth, async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const meterId = req.query.meterId ? parseInt(req.query.meterId as string) : undefined;

    const effectiveUnitId = req.user!.role !== "admin" && req.user!.unitId !== null
      ? req.user!.unitId
      : undefined;

    let consumptionRows = await db
      .select({
        month: consumptionTable.month,
        kwh: consumptionTable.kwh,
        hdd: consumptionTable.hdd,
        meterId: consumptionTable.meterId,
        meterUnitId: metersTable.unitId,
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(eq(consumptionTable.year, year));

    consumptionRows = consumptionRows.filter(r => {
      if (effectiveUnitId !== undefined && r.meterUnitId !== effectiveUnitId) return false;
      if (meterId !== undefined && r.meterId !== meterId) return false;
      return true;
    });

    const byMonth: Record<number, { kwh: number; hdd: number | null }> = {};
    for (const row of consumptionRows) {
      if (!byMonth[row.month]) byMonth[row.month] = { kwh: 0, hdd: row.hdd };
      byMonth[row.month].kwh += row.kwh;
    }

    const weatherRows = await db.select().from(weatherTable).where(eq(weatherTable.year, year));
    const weatherByMonth: Record<number, number> = {};
    for (const w of weatherRows) weatherByMonth[w.month] = w.hdd;

    const dataPoints: { month: number; actual: number; hdd: number }[] = [];
    for (let m = 1; m <= 12; m++) {
      const kwh = byMonth[m]?.kwh ?? 0;
      const hdd = byMonth[m]?.hdd ?? weatherByMonth[m] ?? 0;
      if (kwh > 0) dataPoints.push({ month: m, actual: kwh, hdd });
    }

    if (dataPoints.length < 2) {
      return res.json({
        slope: 0, intercept: 0, r2: 0,
        enpg: 0, enrc: 0, eei: 1,
        dataPoints: dataPoints.map(d => ({ ...d, predicted: d.actual })),
      });
    }

    const xs = dataPoints.map(d => d.hdd);
    const ys = dataPoints.map(d => d.actual);
    const { slope, intercept, r2 } = linearRegression(xs, ys);

    const totalActual = ys.reduce((a, b) => a + b, 0);
    const totalPredicted = dataPoints.map(d => slope * d.hdd + intercept).reduce((a, b) => a + b, 0);
    const totalHdd = xs.reduce((a, b) => a + b, 0);
    const enpg = totalHdd > 0 ? totalActual / totalHdd : 0;
    const enrc = totalActual > 0 ? totalPredicted / totalActual : 1;
    const eei = Math.min(2, Math.max(0.5, totalPredicted > 0 ? totalActual / totalPredicted : 1));

    res.json({
      slope: Math.round(slope * 100) / 100,
      intercept: Math.round(intercept * 100) / 100,
      r2: Math.round(r2 * 1000) / 1000,
      enpg: Math.round(enpg * 100) / 100,
      enrc: Math.round(enrc * 1000) / 1000,
      eei: Math.round(eei * 1000) / 1000,
      dataPoints: dataPoints.map(d => ({
        month: d.month,
        actual: d.actual,
        predicted: Math.max(0, Math.round((slope * d.hdd + intercept) * 10) / 10),
        hdd: d.hdd,
      })),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/analysis/performance
router.get("/analysis/performance", requireAuth, async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();

    const effectiveUnitId = req.user!.role !== "admin" && req.user!.unitId !== null
      ? req.user!.unitId
      : undefined;

    const filterByUnit = async (y: number) => {
      if (effectiveUnitId === undefined) {
        return db.select().from(consumptionTable).where(eq(consumptionTable.year, y));
      }
      const conds: SQL[] = [eq(consumptionTable.year, y)];
      const rows = await db
        .select({ kwh: consumptionTable.kwh, tep: consumptionTable.tep, co2: consumptionTable.co2, meterUnitId: metersTable.unitId })
        .from(consumptionTable)
        .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(and(...conds));
      return rows.filter(r => r.meterUnitId === effectiveUnitId);
    };

    const rows = await filterByUnit(year);
    const prevRows = await filterByUnit(year - 1);

    const totalKwh = rows.reduce((a, r) => a + r.kwh, 0);
    const totalTep = rows.reduce((a, r) => a + r.tep, 0);
    const totalCo2 = rows.reduce((a, r) => a + r.co2, 0);
    const prevKwh = prevRows.reduce((a, r) => a + r.kwh, 0);

    const savingsKwh = Math.max(0, prevKwh - totalKwh);
    const savingsTep = savingsKwh * 0.000086;
    const improvementPercent = prevKwh > 0 ? ((prevKwh - totalKwh) / prevKwh) * 100 : 0;

    const weatherRows = await db.select().from(weatherTable).where(eq(weatherTable.year, year));
    const totalHdd = weatherRows.reduce((a, r) => a + r.hdd, 0);
    const enpg = totalHdd > 0 ? totalKwh / totalHdd : 0;

    res.json({
      totalKwh: Math.round(totalKwh),
      totalTep: Math.round(totalTep * 1000) / 1000,
      totalCo2: Math.round(totalCo2 * 100) / 100,
      enpg: Math.round(enpg * 100) / 100,
      enrc: 1.0,
      eei: prevKwh > 0 ? Math.round((totalKwh / prevKwh) * 1000) / 1000 : 1,
      savingsKwh: Math.round(savingsKwh),
      savingsTep: Math.round(savingsTep * 1000) / 1000,
      improvementPercent: Math.round(improvementPercent * 10) / 10,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
