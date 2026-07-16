import { Router } from "express";
import type { Request, Response } from "express";
import { companiesTable, db, consumptionTable, metersTable, weatherTable, unitsTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

class AnalysisQueryError extends Error {}

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function parsePositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new AnalysisQueryError(`Geçersiz ${field}`);
}

function parseAnalysisYear(value: unknown): number {
  if (value === undefined || value === null) return new Date().getFullYear();
  const year = parsePositiveInteger(value, "year");
  if (year === undefined || year < 1900 || year > 3000) {
    throw new AnalysisQueryError("Geçersiz year");
  }
  return year;
}

async function resolveAnalysisScope(req: Request, requireCompanyContext = false) {
  const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
  const queryCompanyId = parsePositiveInteger(req.query.companyId, "companyId");
  const queryUnitId = parsePositiveInteger(req.query.unitId, "unitId");
  const companyId = isSuperAdmin(role) ? queryCompanyId : sessionCompanyId;
  const unitId = isCompanyAdmin(role) || isSuperAdmin(role) ? queryUnitId : sessionUnitId ?? undefined;
  const empty = !isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null;

  if (requireCompanyContext && companyId === undefined) {
    throw new AnalysisQueryError("companyId zorunlu");
  }

  if (isSuperAdmin(role) && companyId !== undefined) {
    const [company] = await db.select({ id: companiesTable.id })
      .from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!company) throw new AnalysisQueryError("Firma bulunamadı");
  }

  if (unitId !== undefined) {
    const [unit] = await db.select({ companyId: unitsTable.companyId })
      .from(unitsTable).where(eq(unitsTable.id, unitId));
    if (!unit || (companyId !== undefined && unit.companyId !== companyId)) {
      throw new AnalysisQueryError("Bu birim için yetkiniz yok");
    }
  }

  return { companyId, unitId, empty };
}

function buildAnalysisConditions(year: number, companyId?: number, unitId?: number, meterId?: number): SQL[] {
  const conditions: SQL[] = [eq(consumptionTable.year, year)];
  if (companyId !== undefined) {
    conditions.push(eq(consumptionTable.companyId, companyId));
    conditions.push(eq(metersTable.companyId, companyId));
  }
  if (unitId !== undefined) conditions.push(eq(metersTable.unitId, unitId));
  if (meterId !== undefined) conditions.push(eq(consumptionTable.meterId, meterId));
  return conditions;
}

function handleAnalysisQueryError(res: Response, err: unknown) {
  if (!(err instanceof AnalysisQueryError)) return false;
  const status = err.message === "Bu birim için yetkiniz yok" ? 403 : 400;
  res.status(status).json({ error: err.message });
  return true;
}

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
    const year = parseAnalysisYear(req.query.year);
    const meterId = parsePositiveInteger(req.query.meterId, "meterId");
    const scope = await resolveAnalysisScope(req, true);
    if (scope.empty) {
      res.json({
        slope: 0, intercept: 0, r2: 0,
        enpg: 0, enrc: 0, eei: 1,
        dataPoints: [],
      });
      return;
    }

    const consumptionRows = await db
      .select({
        month: consumptionTable.month,
        kwh: consumptionTable.kwh,
        hdd: consumptionTable.hdd,
        meterId: consumptionTable.meterId,
        meterUnitId: metersTable.unitId,
        meterCompanyId: metersTable.companyId,
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(and(...buildAnalysisConditions(year, scope.companyId, scope.unitId, meterId)));

    const byMonth: Record<number, { kwh: number; hdd: number | null }> = {};
    for (const row of consumptionRows) {
      if (!byMonth[row.month]) byMonth[row.month] = { kwh: 0, hdd: row.hdd };
      byMonth[row.month].kwh += row.kwh;
    }

    const weatherRows = await db.select({ month: weatherTable.month, hdd: weatherTable.hdd })
      .from(weatherTable)
      .where(and(eq(weatherTable.companyId, scope.companyId!), eq(weatherTable.year, year)))
      .orderBy(weatherTable.month, weatherTable.id);
    const weatherByMonth: Record<number, number | undefined> = {};
    const ambiguousMonths = new Set<number>();
    for (const weather of weatherRows) {
      if (weatherByMonth[weather.month] !== undefined) {
        ambiguousMonths.add(weather.month);
      } else {
        weatherByMonth[weather.month] = weather.hdd;
      }
    }
    for (const month of ambiguousMonths) delete weatherByMonth[month];

    const dataPoints: { month: number; actual: number; hdd: number }[] = [];
    for (let m = 1; m <= 12; m++) {
      const kwh = byMonth[m]?.kwh ?? 0;
      const hdd = byMonth[m]?.hdd ?? weatherByMonth[m] ?? 0;
      if (kwh > 0) dataPoints.push({ month: m, actual: kwh, hdd });
    }

    if (dataPoints.length < 2) {
      res.json({
        slope: 0, intercept: 0, r2: 0,
        enpg: 0, enrc: 0, eei: 1,
        dataPoints: dataPoints.map(d => ({ ...d, predicted: d.actual })),
      }); return;
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
    if (handleAnalysisQueryError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/analysis/performance
router.get("/analysis/performance", requireAuth, async (req, res) => {
  try {
    const year = parseAnalysisYear(req.query.year);
    const scope = await resolveAnalysisScope(req, true);
    if (scope.empty) {
      res.json({
        totalKwh: 0, totalTep: 0, totalCo2: 0,
        enpg: 0, enrc: 1.0, eei: 1,
        savingsKwh: 0, savingsTep: 0, improvementPercent: 0,
      });
      return;
    }

    const filterByUnit = async (y: number) => {
      return db
        .select({ kwh: consumptionTable.kwh, tep: consumptionTable.tep, co2: consumptionTable.co2 })
        .from(consumptionTable)
        .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(and(...buildAnalysisConditions(y, scope.companyId, scope.unitId)));
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

    const weatherRows = await db.select().from(weatherTable).where(and(
      eq(weatherTable.companyId, scope.companyId!),
      eq(weatherTable.year, year),
    ));
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
    if (handleAnalysisQueryError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
