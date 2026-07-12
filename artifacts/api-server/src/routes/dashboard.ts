import { Router } from "express";
import type { Request, Response } from "express";
import {
  db,
  consumptionTable, metersTable, seuTable, weatherTable, unitsTable,
  energyTargetsTable, energyTargetProgressTable, energyActionPlansTable,
  vapProjectsTable, seuAssessmentsTable, seuAssessmentItemsTable,
  subUnitsTable, energySourcesTable, energyUseGroupsTable,
} from "@workspace/db";
import { eq, and, SQL, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

class DashboardScopeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function parsePositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value > 0) return value;
  } else if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new DashboardScopeError(400, `Geçersiz ${field}`);
}

async function resolveDashboardScope(req: Request) {
  const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
  const queryCompanyId = parsePositiveInteger(req.query.companyId, "companyId");
  const queryUnitId = parsePositiveInteger(req.query.unitId, "unitId");

  let companyId: number | undefined;
  let unitId: number | undefined;

  if (isSuperAdmin(role)) {
    companyId = queryCompanyId;
    unitId = queryUnitId;
  } else if (isCompanyAdmin(role)) {
    companyId = sessionCompanyId;
    unitId = queryUnitId;
  } else {
    companyId = sessionCompanyId;
    unitId = sessionUnitId ?? undefined;
    if (sessionUnitId === null) return { companyId, unitId, empty: true };
  }

  if (unitId !== undefined && companyId !== undefined) {
    const [unit] = await db.select({ companyId: unitsTable.companyId })
      .from(unitsTable)
      .where(eq(unitsTable.id, unitId));
    if (!unit || unit.companyId !== companyId) {
      throw new DashboardScopeError(403, "Bu birim için yetkiniz yok");
    }
  }

  return { companyId, unitId, empty: false };
}

function sendDashboardError(res: Response, err: unknown) {
  if (!(err instanceof DashboardScopeError)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

const MONTH_NAMES = ["", "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function buildConsumptionConditions(year: number, unitId?: number, companyId?: number): SQL[] {
  const conds: SQL[] = [eq(consumptionTable.year, year)];
  if (unitId !== undefined) conds.push(eq(metersTable.unitId, unitId));
  if (companyId !== undefined) {
    conds.push(eq(consumptionTable.companyId, companyId));
    conds.push(eq(metersTable.companyId, companyId));
  }
  return conds;
}

// GET /api/dashboard/kpi?year=2026&unitId=1
router.get("/dashboard/kpi", requireAuth, async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const scope = await resolveDashboardScope(req);
    const unitId = scope.unitId;
    const effectiveCompanyId = scope.companyId;

    if (scope.empty) {
      res.json({
        year, totalKwh: 0, totalTep: 0, totalCo2: 0,
        kwhChange: 0, tepChange: 0, co2Change: 0,
        meterCount: 0, activeSeuCount: 0,
      });
      return;
    }

    const currConds = buildConsumptionConditions(year, unitId, effectiveCompanyId);
    const prevConds = buildConsumptionConditions(year - 1, unitId, effectiveCompanyId);

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

    const metersConds: SQL[] = [];
    const seuConds: SQL[] = [];
    if (unitId !== undefined) {
      metersConds.push(eq(metersTable.unitId, unitId));
      seuConds.push(eq(seuTable.unitId, unitId));
    }
    if (effectiveCompanyId !== undefined) {
      metersConds.push(eq(metersTable.companyId, effectiveCompanyId));
      seuConds.push(eq(seuTable.companyId, effectiveCompanyId));
    }
    const meters = metersConds.length > 0
      ? await db.select().from(metersTable).where(metersConds.length === 1 ? metersConds[0] : and(...metersConds))
      : await db.select().from(metersTable);
    const seuItems = seuConds.length > 0
      ? await db.select().from(seuTable).where(seuConds.length === 1 ? seuConds[0] : and(...seuConds))
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
      totalCo2: Math.round((totalCo2 / 1000) * 100) / 100,
      kwhChange: Math.round(kwhChange * 10) / 10,
      tepChange: Math.round(tepChange * 10) / 10,
      co2Change: Math.round(co2Change * 10) / 10,
      meterCount: meters.length,
      activeSeuCount: seuItems.length,
    });
  } catch (err) {
    if (sendDashboardError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/dashboard/monthly-trend?year=2026&unitId=1
router.get("/dashboard/monthly-trend", requireAuth, async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const scope = await resolveDashboardScope(req);
    const unitId = scope.unitId;
    const effectiveCompanyId = scope.companyId;

    if (scope.empty) {
      res.json(Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        monthName: MONTH_NAMES[index + 1],
        kwh: 0, tep: 0, co2: 0, hdd: null, cdd: null,
      })));
      return;
    }

    const conds = buildConsumptionConditions(year, unitId, effectiveCompanyId);
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
    if (sendDashboardError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/dashboard/seu-breakdown?year=2026&unitId=1
router.get("/dashboard/seu-breakdown", requireAuth, async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const scope = await resolveDashboardScope(req);
    const unitId = scope.unitId;
    const effectiveCompanyId = scope.companyId;

    if (scope.empty) {
      res.json([]);
      return;
    }

    const seuConds: SQL[] = [];
    if (unitId !== undefined) seuConds.push(eq(seuTable.unitId, unitId));
    if (effectiveCompanyId !== undefined) seuConds.push(eq(seuTable.companyId, effectiveCompanyId));
    const seuItems = seuConds.length > 0
      ? await db.select().from(seuTable).where(seuConds.length === 1 ? seuConds[0] : and(...seuConds)).orderBy(seuTable.priority)
      : await db.select().from(seuTable).orderBy(seuTable.priority);

    if (seuItems.length === 0) {
      const conds = buildConsumptionConditions(year, unitId, effectiveCompanyId);
      const rows = await db
        .select({ meterName: metersTable.name, kwh: consumptionTable.kwh, category: metersTable.type })
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
      res.json(
        Object.entries(byMeter)
          .sort((a, b) => b[1].kwh - a[1].kwh)
          .map(([name, v]) => ({
            name,
            kwh: Math.round(v.kwh),
            percentage: total > 0 ? Math.round((v.kwh / total) * 1000) / 10 : 0,
            category: v.category,
          }))
      );
      return;
    }

    res.json(
      seuItems.map(s => ({
        name: s.name,
        kwh: Math.round(s.annualKwh),
        percentage: s.percentage,
        category: s.category,
      }))
    );
  } catch (err) {
    if (sendDashboardError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /api/dashboard/target-status ─────────────────────
router.get("/dashboard/target-status", requireAuth, async (req, res) => {
  try {
    const scope = await resolveDashboardScope(req);
    if (scope.empty) {
      res.json({ items: [] });
      return;
    }

    const year = req.query.year ? parseInt(req.query.year as string) : undefined;
    const energySourceIdParam = parsePositiveInteger(req.query.energySourceId, "energySourceId");
    const statusParam = req.query.status as string | undefined;

    const conds: SQL[] = [];
    if (scope.companyId !== undefined) conds.push(eq(energyTargetsTable.companyId, scope.companyId));
    if (scope.unitId !== undefined) conds.push(eq(energyTargetsTable.unitId, scope.unitId));
    // year filtresi SQL'den kaldırıldı — JS katmanında baselineYear <= year <= targetYear mantığıyla uygulanır
    if (energySourceIdParam !== undefined) conds.push(eq(energyTargetsTable.energySourceId, energySourceIdParam));
    if (statusParam) conds.push(eq(energyTargetsTable.status, statusParam));
    const targets = await db.select({
      id: energyTargetsTable.id,
      name: energyTargetsTable.name,
      objectiveText: energyTargetsTable.objectiveText,
      targetText: energyTargetsTable.targetText,
      targetType: energyTargetsTable.targetType,
      baselineYear: energyTargetsTable.baselineYear,
      baselineValue: energyTargetsTable.baselineValue,
      targetYear: energyTargetsTable.targetYear,
      targetValue: energyTargetsTable.targetValue,
      unitLabel: energyTargetsTable.unitLabel,
      targetReductionPercent: energyTargetsTable.targetReductionPercent,
      status: energyTargetsTable.status,
      unitId: energyTargetsTable.unitId,
      unitName: unitsTable.name,
      subUnitName: subUnitsTable.name,
      energySourceName: energySourcesTable.name,
    })
      .from(energyTargetsTable)
      .leftJoin(unitsTable, eq(energyTargetsTable.unitId, unitsTable.id))
      .leftJoin(subUnitsTable, eq(energyTargetsTable.subUnitId, subUnitsTable.id))
      .leftJoin(energySourcesTable, eq(energyTargetsTable.energySourceId, energySourcesTable.id))
      .where(conds.length === 1 ? conds[0] : and(...conds))
      .orderBy(energyTargetsTable.createdAt);

    // JS katmanında year filtresi: baselineYear <= selectedYear <= targetYear
    const activeTargets = year !== undefined
      ? targets.filter(t => {
          const baseline = t.baselineYear ?? 0;
          const targetY = t.targetYear ?? 9999;
          return baseline <= year && year <= targetY;
        })
      : targets;

    if (activeTargets.length === 0) {
      res.json({ items: [] });
      return;
    }

    const targetIds = activeTargets.map(t => t.id);

    const [allProgress, allActions] = await Promise.all([
      db.select()
        .from(energyTargetProgressTable)
        .where(and(
          inArray(energyTargetProgressTable.targetId, targetIds),
          ...(scope.companyId !== undefined ? [eq(energyTargetProgressTable.companyId, scope.companyId)] : []),
        ))
        .orderBy(energyTargetProgressTable.periodYear, energyTargetProgressTable.periodMonth),
      db.select({ id: energyActionPlansTable.id, targetId: energyActionPlansTable.targetId })
        .from(energyActionPlansTable)
        .where(and(
          inArray(energyActionPlansTable.targetId, targetIds),
          ...(scope.companyId !== undefined ? [eq(energyActionPlansTable.companyId, scope.companyId)] : []),
        )),
    ]);

    const progressByTarget: Record<number, typeof allProgress> = {};
    for (const p of allProgress) {
      if (!progressByTarget[p.targetId]) progressByTarget[p.targetId] = [];
      progressByTarget[p.targetId].push(p);
    }

    const actionCountByTarget: Record<number, number> = {};
    for (const a of allActions) {
      actionCountByTarget[a.targetId] = (actionCountByTarget[a.targetId] ?? 0) + 1;
    }

    const items = activeTargets.map(t => {
      const progressList = progressByTarget[t.id] ?? [];
      // latestProgress: seçili yıla ait progress kayıtları öncelikli; yoksa hedef listeye dahil ama latestProgress null
      const yearProgress = year !== undefined
        ? progressList.filter(p => p.periodYear === year)
        : progressList;
      const sorted = [...yearProgress].sort((a, b) => {
        if (b.periodYear !== a.periodYear) return b.periodYear - a.periodYear;
        return (b.periodMonth ?? 0) - (a.periodMonth ?? 0);
      });
      const latestProgress = sorted[0] ?? null;
      const actualValue = latestProgress?.actualValue ?? null;

      let achievementPct: number | null = null;
      if (
        t.baselineValue !== null &&
        t.targetValue !== null &&
        actualValue !== null &&
        t.baselineValue !== t.targetValue
      ) {
        achievementPct =
          Math.round(
            ((t.baselineValue - actualValue) / (t.baselineValue - t.targetValue)) * 1000,
          ) / 10;
      }

      return {
        id: t.id,
        name: t.name,
        objectiveText: t.objectiveText,
        targetText: t.targetText,
        unitName: t.unitName ?? null,
        subUnitName: t.subUnitName ?? null,
        energySourceName: t.energySourceName ?? null,
        targetType: t.targetType,
        baselineYear: t.baselineYear,
        baselineValue: t.baselineValue,
        targetYear: t.targetYear,
        targetValue: t.targetValue,
        actualValue,
        unitLabel: t.unitLabel,
        targetReductionPercent: t.targetReductionPercent,
        achievementPct,
        status: t.status,
        actionCount: actionCountByTarget[t.id] ?? 0,
        latestProgress: latestProgress
          ? {
              periodYear: latestProgress.periodYear,
              periodMonth: latestProgress.periodMonth,
              actualValue: latestProgress.actualValue,
              actualSavingValue: latestProgress.actualSavingValue,
            }
          : null,
        trend: progressList.map(p => ({
          periodYear: p.periodYear,
          periodMonth: p.periodMonth,
          actualValue: p.actualValue,
          actualSavingValue: p.actualSavingValue,
        })),
      };
    });

    res.json({ items });
  } catch (err) {
    if (sendDashboardError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /api/dashboard/action-status ─────────────────────
router.get("/dashboard/action-status", requireAuth, async (req, res) => {
  try {
    const scope = await resolveDashboardScope(req);
    if (scope.empty) {
      res.json({
        summary: { total: 0, planned: 0, inProgress: 0, completed: 0, cancelled: 0, overdue: 0, avgProgressPct: 0 },
        financial: { totalExpectedCostSaving: 0, totalInvestment: 0, avgPaybackMonths: null },
        items: [],
      });
      return;
    }

    const year = req.query.year ? parseInt(req.query.year as string) : undefined;
    const statusParam = req.query.status as string | undefined;
    const priorityParam = req.query.priority as string | undefined;
    const isVapParam = req.query.isVap !== undefined ? req.query.isVap === "true" : undefined;

    const actionConds: SQL[] = [];
    if (scope.companyId !== undefined) {
      actionConds.push(eq(energyActionPlansTable.companyId, scope.companyId));
      actionConds.push(eq(energyTargetsTable.companyId, scope.companyId));
    }
    if (scope.unitId !== undefined) actionConds.push(eq(energyTargetsTable.unitId, scope.unitId));
    if (statusParam) actionConds.push(eq(energyActionPlansTable.status, statusParam));
    if (priorityParam) actionConds.push(eq(energyActionPlansTable.priority, priorityParam));
    if (isVapParam !== undefined) actionConds.push(eq(energyActionPlansTable.isVap, isVapParam));

    const rows = await db.select({
      id: energyActionPlansTable.id,
      title: energyActionPlansTable.title,
      status: energyActionPlansTable.status,
      priority: energyActionPlansTable.priority,
      progressPercent: energyActionPlansTable.progressPercent,
      startDate: energyActionPlansTable.startDate,
      dueDate: energyActionPlansTable.dueDate,
      isVap: energyActionPlansTable.isVap,
      expectedCostSaving: energyActionPlansTable.expectedCostSaving,
      investmentCost: energyActionPlansTable.investmentCost,
      paybackMonths: energyActionPlansTable.paybackMonths,
      targetId: energyActionPlansTable.targetId,
      targetName: energyTargetsTable.name,
      targetUnitId: energyTargetsTable.unitId,
      targetBaselineYear: energyTargetsTable.baselineYear,
      targetYear: energyTargetsTable.targetYear,
      unitName: unitsTable.name,
    })
      .from(energyActionPlansTable)
      .leftJoin(energyTargetsTable, eq(energyActionPlansTable.targetId, energyTargetsTable.id))
      .leftJoin(unitsTable, eq(energyTargetsTable.unitId, unitsTable.id))
      .where(actionConds.length === 1 ? actionConds[0] : and(...actionConds));

    let filtered = rows;
    if (year !== undefined) {
      filtered = filtered.filter(r => {
        // Eylem planının kendi tarih aralığı varsa onu kullan
        if (r.startDate || r.dueDate) {
          const startY = r.startDate ? new Date(r.startDate).getFullYear() : 0;
          const endY = r.dueDate ? new Date(r.dueDate).getFullYear() : 9999;
          return startY <= year && year <= endY;
        }
        // Yoksa bağlı hedefin aktif yıl aralığını kullan
        const baselineY = r.targetBaselineYear ?? 0;
        const targetY = r.targetYear ?? 9999;
        return baselineY <= year && year <= targetY;
      });
    }
    const today = new Date().toISOString().split("T")[0];

    const items = filtered.map(r => {
      const isOverdue =
        !!r.dueDate &&
        r.dueDate < today &&
        r.status !== "completed" &&
        r.status !== "cancelled";
      return { ...r, isOverdue };
    });

    const total = items.length;
    const planned = items.filter(i => i.status === "planned").length;
    const inProgress = items.filter(i => i.status === "in_progress").length;
    const completed = items.filter(i => i.status === "completed").length;
    const cancelled = items.filter(i => i.status === "cancelled").length;
    const overdue = items.filter(i => i.isOverdue).length;
    const avgProgressPct =
      total > 0
        ? Math.round((items.reduce((a, i) => a + (i.progressPercent ?? 0), 0) / total) * 10) / 10
        : 0;
    const totalExpectedCostSaving = items.reduce((a, i) => a + (i.expectedCostSaving ?? 0), 0);
    const totalInvestment = items.reduce((a, i) => a + (i.investmentCost ?? 0), 0);

    const withPayback = items.filter(
      i => i.paybackMonths !== null && (i.investmentCost ?? 0) > 0,
    );
    const invForPayback = withPayback.reduce((a, i) => a + (i.investmentCost ?? 0), 0);
    const avgPaybackMonths =
      invForPayback > 0
        ? Math.round(
            (withPayback.reduce(
              (a, i) => a + (i.paybackMonths ?? 0) * (i.investmentCost ?? 0),
              0,
            ) /
              invForPayback) *
              10,
          ) / 10
        : null;

    res.json({
      summary: { total, planned, inProgress, completed, cancelled, overdue, avgProgressPct },
      financial: {
        totalExpectedCostSaving: Math.round(totalExpectedCostSaving),
        totalInvestment: Math.round(totalInvestment),
        avgPaybackMonths,
      },
      items: items.map(i => ({
        id: i.id,
        title: i.title,
        targetName: i.targetName ?? null,
        unitName: i.unitName ?? null,
        status: i.status,
        priority: i.priority,
        progressPct: i.progressPercent,
        dueDate: i.dueDate,
        isVap: i.isVap,
        isOverdue: i.isOverdue,
        expectedCostSaving: i.expectedCostSaving,
        investmentCost: i.investmentCost,
        paybackMonths: i.paybackMonths,
      })),
    });
  } catch (err) {
    if (sendDashboardError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /api/dashboard/vap-summary ───────────────────────
router.get("/dashboard/vap-summary", requireAuth, async (req, res) => {
  try {
    const scope = await resolveDashboardScope(req);
    if (scope.empty) {
      res.json({
        summary: { total: 0, byStatus: {}, byFeasibility: {} },
        financial: { totalInvestment: 0, totalAnnualCostSaving: 0, totalCo2ReductionTon: 0, portfolioPaybackMonths: null },
        items: [],
      });
      return;
    }

    const year = req.query.year ? parseInt(req.query.year as string) : undefined;
    const statusParam = req.query.status as string | undefined;
    const feasibilityStatusParam = req.query.feasibilityStatus as string | undefined;

    const vapConds: SQL[] = [];
    if (scope.companyId !== undefined) {
      vapConds.push(eq(vapProjectsTable.companyId, scope.companyId));
      vapConds.push(eq(energyActionPlansTable.companyId, scope.companyId));
      vapConds.push(eq(energyTargetsTable.companyId, scope.companyId));
    }
    if (scope.unitId !== undefined) vapConds.push(eq(energyTargetsTable.unitId, scope.unitId));
    if (statusParam) vapConds.push(eq(vapProjectsTable.status, statusParam));
    if (feasibilityStatusParam) vapConds.push(eq(vapProjectsTable.feasibilityStatus, feasibilityStatusParam));

    const rows = await db.select({
      id: vapProjectsTable.id,
      projectCode: vapProjectsTable.projectCode,
      projectTitle: vapProjectsTable.projectTitle,
      projectType: vapProjectsTable.projectType,
      annualEnergySavingValue: vapProjectsTable.annualEnergySavingValue,
      annualEnergySavingUnit: vapProjectsTable.annualEnergySavingUnit,
      annualCostSaving: vapProjectsTable.annualCostSaving,
      investmentCost: vapProjectsTable.investmentCost,
      paybackMonths: vapProjectsTable.paybackMonths,
      co2ReductionTon: vapProjectsTable.co2ReductionTon,
      feasibilityStatus: vapProjectsTable.feasibilityStatus,
      incentiveStatus: vapProjectsTable.incentiveStatus,
      status: vapProjectsTable.status,
      startDate: vapProjectsTable.startDate,
      endDate: vapProjectsTable.endDate,
      actionPlanIsVap: energyActionPlansTable.isVap,
      actionPlanStartDate: energyActionPlansTable.startDate,
      actionPlanDueDate: energyActionPlansTable.dueDate,
      targetName: energyTargetsTable.name,
      targetUnitId: energyTargetsTable.unitId,
      targetBaselineYear: energyTargetsTable.baselineYear,
      targetYear: energyTargetsTable.targetYear,
      unitName: unitsTable.name,
      energySourceName: energySourcesTable.name,
    })
      .from(vapProjectsTable)
      .leftJoin(energyActionPlansTable, eq(vapProjectsTable.actionPlanId, energyActionPlansTable.id))
      .leftJoin(energyTargetsTable, eq(energyActionPlansTable.targetId, energyTargetsTable.id))
      .leftJoin(unitsTable, eq(energyTargetsTable.unitId, unitsTable.id))
      .leftJoin(energySourcesTable, eq(energyTargetsTable.energySourceId, energySourcesTable.id))
      .where(vapConds.length === 1 ? vapConds[0] : and(...vapConds))
      .orderBy(vapProjectsTable.createdAt);

    let filtered = rows.filter(r => r.actionPlanIsVap === true);
    if (year !== undefined) {
      filtered = filtered.filter(r => {
        // Öncelik: VAP'ın kendi startDate/endDate tarihleri
        if (r.startDate || r.endDate) {
          const startY = r.startDate ? new Date(r.startDate).getFullYear() : 0;
          const endY = r.endDate ? new Date(r.endDate).getFullYear() : 9999;
          return startY <= year && year <= endY;
        }
        // Sonra: bağlı action plan'ın tarihleri
        if (r.actionPlanStartDate || r.actionPlanDueDate) {
          const startY = r.actionPlanStartDate ? new Date(r.actionPlanStartDate).getFullYear() : 0;
          const endY = r.actionPlanDueDate ? new Date(r.actionPlanDueDate).getFullYear() : 9999;
          return startY <= year && year <= endY;
        }
        // Son çare: bağlı hedefin aktif yıl aralığı
        const baselineY = r.targetBaselineYear ?? 0;
        const targetY = r.targetYear ?? 9999;
        return baselineY <= year && year <= targetY;
      });
    }
    const byStatus: Record<string, number> = {};
    const byFeasibility: Record<string, number> = {};
    let totalInvestment = 0;
    let totalAnnualCostSaving = 0;
    let totalCo2ReductionTon = 0;

    for (const r of filtered) {
      const s = r.status ?? "unknown";
      const f = r.feasibilityStatus ?? "unknown";
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      byFeasibility[f] = (byFeasibility[f] ?? 0) + 1;
      totalInvestment += r.investmentCost ?? 0;
      totalAnnualCostSaving += r.annualCostSaving ?? 0;
      totalCo2ReductionTon += r.co2ReductionTon ?? 0;
    }

    const withPayback = filtered.filter(r => r.paybackMonths !== null && (r.investmentCost ?? 0) > 0);
    const invForPayback = withPayback.reduce((a, r) => a + (r.investmentCost ?? 0), 0);
    const portfolioPaybackMonths =
      invForPayback > 0
        ? Math.round(
            (withPayback.reduce((a, r) => a + (r.paybackMonths ?? 0) * (r.investmentCost ?? 0), 0) /
              invForPayback) *
              10,
          ) / 10
        : null;

    res.json({
      summary: { total: filtered.length, byStatus, byFeasibility },
      financial: {
        totalInvestment: Math.round(totalInvestment),
        totalAnnualCostSaving: Math.round(totalAnnualCostSaving),
        totalCo2ReductionTon: Math.round(totalCo2ReductionTon * 100) / 100,
        portfolioPaybackMonths,
      },
      items: filtered.map(r => ({
        id: r.id,
        projectCode: r.projectCode,
        projectTitle: r.projectTitle,
        projectType: r.projectType,
        unitName: r.unitName ?? null,
        energySourceName: r.energySourceName ?? null,
        targetName: r.targetName ?? null,
        status: r.status,
        feasibilityStatus: r.feasibilityStatus,
        incentiveStatus: r.incentiveStatus,
        annualEnergySavingValue: r.annualEnergySavingValue,
        annualEnergySavingUnit: r.annualEnergySavingUnit,
        annualCostSaving: r.annualCostSaving,
        investmentCost: r.investmentCost,
        paybackMonths: r.paybackMonths,
        co2ReductionTon: r.co2ReductionTon,
        startDate: r.startDate,
        endDate: r.endDate,
      })),
    });
  } catch (err) {
    if (sendDashboardError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /api/dashboard/seu-summary ───────────────────────
router.get("/dashboard/seu-summary", requireAuth, async (req, res) => {
  try {
    const scope = await resolveDashboardScope(req);
    if (scope.empty) {
      res.json({ totalAssessments: 0, byUnit: [], topSeuItems: [] });
      return;
    }

    const year = req.query.year ? parseInt(req.query.year as string) : undefined;

    const assessmentConds: SQL[] = [eq(seuAssessmentsTable.recordType, "unit_official")];
    if (scope.companyId !== undefined) assessmentConds.push(eq(seuAssessmentsTable.companyId, scope.companyId));
    if (scope.unitId !== undefined) assessmentConds.push(eq(seuAssessmentsTable.unitId, scope.unitId));
    if (year !== undefined) assessmentConds.push(eq(seuAssessmentsTable.year, year));

    const assessments = await db.select({
      id: seuAssessmentsTable.id,
      unitId: seuAssessmentsTable.unitId,
      year: seuAssessmentsTable.year,
      unitTotalTep: seuAssessmentsTable.unitTotalTep,
      unitName: unitsTable.name,
    })
      .from(seuAssessmentsTable)
      .leftJoin(unitsTable, eq(seuAssessmentsTable.unitId, unitsTable.id))
      .where(assessmentConds.length === 1 ? assessmentConds[0] : and(...assessmentConds))
      .orderBy(seuAssessmentsTable.year);

    if (assessments.length === 0) {
      res.json({ totalAssessments: 0, byUnit: [], topSeuItems: [] });
      return;
    }

    const assessmentIds = assessments.map(a => a.id);

    const allItems = await db.select({
      id: seuAssessmentItemsTable.id,
      assessmentId: seuAssessmentItemsTable.assessmentId,
      name: seuAssessmentItemsTable.name,
      energyTep: seuAssessmentItemsTable.energyTep,
      consumptionSharePercent: seuAssessmentItemsTable.consumptionSharePercent,
      systemRecommendation: seuAssessmentItemsTable.systemRecommendation,
      userDecision: seuAssessmentItemsTable.userDecision,
      responsible: seuAssessmentItemsTable.responsible,
      targetReductionPercent: seuAssessmentItemsTable.targetReductionPercent,
      energyUseGroupName: energyUseGroupsTable.name,
    })
      .from(seuAssessmentItemsTable)
      .leftJoin(energyUseGroupsTable, eq(seuAssessmentItemsTable.energyUseGroupId, energyUseGroupsTable.id))
      .where(inArray(seuAssessmentItemsTable.assessmentId, assessmentIds));

    const assessmentById: Record<number, typeof assessments[0]> = {};
    for (const a of assessments) assessmentById[a.id] = a;

    const itemsByAssessment: Record<number, typeof allItems> = {};
    for (const item of allItems) {
      if (!itemsByAssessment[item.assessmentId]) itemsByAssessment[item.assessmentId] = [];
      itemsByAssessment[item.assessmentId].push(item);
    }

    const latestByUnit: Record<number, typeof assessments[0]> = {};
    for (const a of assessments) {
      const uid = a.unitId ?? 0;
      if (!latestByUnit[uid] || a.year > latestByUnit[uid].year) {
        latestByUnit[uid] = a;
      }
    }

    const byUnit = Object.values(latestByUnit).map(a => {
      const items = itemsByAssessment[a.id] ?? [];
      const confirmedItems = items.filter(i => i.userDecision === "seu");
      const confirmedSeuTep = confirmedItems.reduce((acc, i) => acc + (i.energyTep ?? 0), 0);
      const overrideCount = items.filter(
        i => i.userDecision !== null && i.userDecision !== i.systemRecommendation,
      ).length;
      const coveragePct =
        (a.unitTotalTep ?? 0) > 0
          ? Math.round((confirmedSeuTep / a.unitTotalTep) * 1000) / 10
          : 0;
      return {
        unitId: a.unitId,
        unitName: a.unitName ?? null,
        latestAssessmentYear: a.year,
        unitTotalTep: a.unitTotalTep,
        confirmedSeuCount: confirmedItems.length,
        confirmedSeuTep: Math.round(confirmedSeuTep * 100) / 100,
        coveragePct,
        overrideCount,
      };
    });

    const latestAssessmentIds = new Set(Object.values(latestByUnit).map(a => a.id));
    const confirmedItems = allItems
      .filter(i => i.userDecision === "seu" && latestAssessmentIds.has(i.assessmentId))
      .sort((a, b) => (b.energyTep ?? 0) - (a.energyTep ?? 0))
      .slice(0, 10);

    const topSeuItems = confirmedItems.map(i => ({
      name: i.name,
      energyUseGroupName: i.energyUseGroupName ?? null,
      unitName: assessmentById[i.assessmentId]?.unitName ?? null,
      energyTep: Math.round((i.energyTep ?? 0) * 100) / 100,
      consumptionSharePct: i.consumptionSharePercent,
      userDecision: i.userDecision,
      responsible: i.responsible ?? null,
      targetReductionPercent: i.targetReductionPercent,
    }));

    res.json({ totalAssessments: assessments.length, byUnit, topSeuItems });
  } catch (err) {
    if (sendDashboardError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
