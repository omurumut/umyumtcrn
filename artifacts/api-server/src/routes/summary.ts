import { Router } from "express";
import type { Request } from "express";
import { db, companiesTable, unitsTable, metersTable, consumptionTable, seuTable, swotTable, risksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

class SummaryScopeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type SummaryScope = {
  companyId: number;
  unitId?: number;
  empty: boolean;
};

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
  throw new SummaryScopeError(400, `Geçersiz ${field}`);
}

function parseYear(value: unknown): number {
  if (value === undefined) return new Date().getFullYear();
  const year = parsePositiveInteger(value, "year");
  if (year === undefined || year < 1900 || year > 3000) {
    throw new SummaryScopeError(400, "Geçersiz year");
  }
  return year;
}

async function resolveSummaryScope(req: Request): Promise<SummaryScope> {
  const { role, companyId: sessionCompanyIdValue, unitId: sessionUnitIdValue } = req.user!;
  const queryCompanyId = parsePositiveInteger(req.query.companyId, "companyId");
  const queryUnitId = parsePositiveInteger(req.query.unitId, "unitId");
  const sessionCompanyId = parsePositiveInteger(sessionCompanyIdValue, "companyId");
  if (sessionCompanyId === undefined) throw new SummaryScopeError(400, "Geçersiz companyId");

  const standard = !isCompanyAdmin(role) && !isSuperAdmin(role);
  const sessionUnitId = parsePositiveInteger(sessionUnitIdValue, "unitId");
  if (standard && sessionUnitId === undefined) {
    return { companyId: sessionCompanyId, empty: true };
  }

  const companyId = isSuperAdmin(role) ? (queryCompanyId ?? sessionCompanyId) : sessionCompanyId;
  const unitId = standard
    ? sessionUnitId
    : queryUnitId;

  const [company] = await db.select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!company) throw new SummaryScopeError(404, "Şirket bulunamadı");

  if (unitId !== undefined) {
    const [unit] = await db.select({ companyId: unitsTable.companyId })
      .from(unitsTable)
      .where(eq(unitsTable.id, unitId))
      .limit(1);
    if (!unit) throw new SummaryScopeError(404, "Birim bulunamadı");
    if (unit.companyId !== companyId) {
      throw new SummaryScopeError(403, "Bu birim seçilen şirkete ait değil");
    }
  }

  return { companyId, unitId, empty: false };
}

function emptySummary(year: number) {
  return {
    year,
    unitCount: 0,
    grandTotalKwh: 0,
    grandTotalTep: 0,
    grandTotalCo2: 0,
    units: [],
  };
}

// GET /api/summary?year=2026
router.get("/summary", requireAuth, async (req, res) => {
  try {
    const year = parseYear(req.query.year);
    const prevYear = year - 1;
    const scope = await resolveSummaryScope(req);
    if (scope.empty) {
      res.json(emptySummary(year));
      return;
    }

    const unitsConds = [
      eq(unitsTable.active, true),
      eq(unitsTable.companyId, scope.companyId),
    ];
    if (scope.unitId !== undefined) unitsConds.push(eq(unitsTable.id, scope.unitId));
    const units = await db.select().from(unitsTable)
      .where(and(...unitsConds))
      .orderBy(unitsTable.name);

    const summaryItems = await Promise.all(units.map(async (unit) => {
      const currRows = await db
        .select({ kwh: consumptionTable.kwh, tep: consumptionTable.tep, co2: consumptionTable.co2 })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(and(
          eq(consumptionTable.companyId, scope.companyId),
          eq(metersTable.companyId, scope.companyId),
          eq(consumptionTable.year, year),
          eq(metersTable.unitId, unit.id),
        ));

      const prevRows = await db
        .select({ kwh: consumptionTable.kwh })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(and(
          eq(consumptionTable.companyId, scope.companyId),
          eq(metersTable.companyId, scope.companyId),
          eq(consumptionTable.year, prevYear),
          eq(metersTable.unitId, unit.id),
        ));

      const meters = await db
        .select({ id: metersTable.id })
        .from(metersTable)
        .where(and(
          eq(metersTable.companyId, scope.companyId),
          eq(metersTable.unitId, unit.id),
        ));

      const seuItems = await db
        .select({ id: seuTable.id })
        .from(seuTable)
        .where(and(
          eq(seuTable.companyId, scope.companyId),
          eq(seuTable.unitId, unit.id),
        ));

      const swotItems = await db
        .select({ id: swotTable.id })
        .from(swotTable)
        .where(and(
          eq(swotTable.companyId, scope.companyId),
          eq(swotTable.unitId, unit.id),
        ));

      const riskItems = await db
        .select({ id: risksTable.id })
        .from(risksTable)
        .where(and(
          eq(risksTable.companyId, scope.companyId),
          eq(risksTable.unitId, unit.id),
        ));

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
    if (err instanceof SummaryScopeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
